import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performThreeWayMerge, resolveConflict } from './threeWayMerge';
import { toLF } from '../utils/lineUtils';
import { hashContent } from '../utils/hash';
import type { Conflict } from '@shared/types';

/**
 * Bump this when the merge/conflict algorithm changes in a way that
 * invalidates previously recorded decisions. Stored with every session.
 */
export const ALGORITHM_VERSION = '1.0.0';

export type Resolution = 'local' | 'remote' | 'manual';

export interface SessionDecision {
  /** Stable content-based conflict id (never a drifting line number). */
  conflictId: string;
  resolution: Resolution;
  /** Present only for resolution === 'manual'. */
  customContent?: string;
}

export interface InputHashes {
  base: string;
  local: string;
  remote: string;
}

export interface MergeSession {
  sessionId: string;
  algorithmVersion: string;
  createdAt: string;
  updatedAt: string;
  /** Content hashes (after LF normalization) of the three inputs. */
  inputHashes: InputHashes;
  /** Recorded conflict decisions. No absolute line numbers are stored. */
  decisions: SessionDecision[];
}

export interface RestoredConflict extends Conflict {
  resolved: boolean;
  resolution: Resolution | null;
}

export interface RestoredSession {
  session: MergeSession;
  /** True iff current input hashes match the ones recorded in the session. */
  inputMatches: boolean;
  /** True iff session.algorithmVersion === ALGORITHM_VERSION. */
  algorithmMatches: boolean;
  /**
   * True when inputs changed or the algorithm version differs.
   * No decisions are replayed in this case; every conflict is pending and
   * the caller must reconfirm before any decision is applied.
   */
  stale: boolean;
  mergedContent: string;
  conflicts: RestoredConflict[];
  resolvedCount: number;
  pendingCount: number;
  /** Decision conflict ids that were successfully replayed. */
  appliedDecisionIds: string[];
  /** Decision conflict ids that could not be matched to a current conflict. */
  staleDecisionIds: string[];
}

/**
 * Computes SHA-256 hashes of normalized inputs. Normalization (CRLF -> LF)
 * is applied so line-ending-only differences do not invalidate sessions.
 */
export function computeInputHashes(base: string, local: string, remote: string): InputHashes {
  return {
    base: hashContent(base),
    local: hashContent(local),
    remote: hashContent(remote),
  };
}

function hashesEqual(a: InputHashes, b: InputHashes): boolean {
  return a.base === b.base && a.local === b.local && a.remote === b.remote;
}

/** Creates an empty session for the given inputs (does not write to disk). */
export function createSession(base: string, local: string, remote: string): MergeSession {
  const now = new Date().toISOString();
  return {
    sessionId: randomUUID(),
    algorithmVersion: ALGORITHM_VERSION,
    createdAt: now,
    updatedAt: now,
    inputHashes: computeInputHashes(base, local, remote),
    decisions: [],
  };
}

/** Adds or replaces a decision for a conflict. */
export function recordDecision(
  session: MergeSession,
  conflictId: string,
  resolution: Resolution,
  customContent?: string,
): void {
  const decision: SessionDecision = { conflictId, resolution };
  if (resolution === 'manual') {
    decision.customContent = customContent ?? '';
  }
  const idx = session.decisions.findIndex((d) => d.conflictId === conflictId);
  if (idx >= 0) {
    session.decisions[idx] = decision;
  } else {
    session.decisions.push(decision);
  }
  session.updatedAt = new Date().toISOString();
}

/**
 * Replays recorded decisions onto a fresh merge of the supplied inputs.
 * Decisions are applied in the conflicts' natural order so that marker-based
 * resolution locates each block correctly regardless of prior line shifts.
 *
 * Returns the replayed content, per-conflict resolved state, and the ids of
 * decisions that could not be matched (stale).
 */
export function applyDecisions(
  base: string,
  local: string,
  remote: string,
  decisions: SessionDecision[],
): {
  mergedContent: string;
  conflicts: RestoredConflict[];
  appliedIds: string[];
  missingIds: string[];
} {
  const result = performThreeWayMerge(base, local, remote);
  const conflictsById = new Map<string, Conflict>();
  for (const c of result.conflicts) {
    conflictsById.set(c.id, c);
  }

  const orderIndex = new Map<string, number>();
  result.conflicts.forEach((c, i) => orderIndex.set(c.id, i));

  const orderedDecisions = [...decisions].sort(
    (a, b) => (orderIndex.get(a.conflictId) ?? Number.MAX_SAFE_INTEGER)
      - (orderIndex.get(b.conflictId) ?? Number.MAX_SAFE_INTEGER),
  );

  let content = result.mergedContent;
  const appliedIds: string[] = [];
  const missingIds: string[] = [];
  const resolvedIds = new Set<string>();
  const resolutionById = new Map<string, Resolution>();

  for (const d of orderedDecisions) {
    const conflict = conflictsById.get(d.conflictId);
    if (!conflict) {
      missingIds.push(d.conflictId);
      continue;
    }
    content = resolveConflict(content, conflict, d.resolution, d.customContent);
    resolvedIds.add(d.conflictId);
    resolutionById.set(d.conflictId, d.resolution);
    appliedIds.push(d.conflictId);
  }

  const conflicts: RestoredConflict[] = result.conflicts.map((c) => ({
    ...c,
    resolved: resolvedIds.has(c.id),
    resolution: resolutionById.get(c.id) ?? null,
  }));

  return { mergedContent: content, conflicts, appliedIds, missingIds };
}

/**
 * Restores a session against the supplied inputs.
 *
 * If the inputs or algorithm version changed, `stale` is true and NO decisions
 * are applied (all conflicts pending) — old decisions must be reconfirmed.
 * Otherwise decisions are replayed and the same output is reproduced.
 */
export function restoreSession(
  session: MergeSession,
  base: string,
  local: string,
  remote: string,
): RestoredSession {
  const currentHashes = computeInputHashes(base, local, remote);
  const inputMatches = hashesEqual(session.inputHashes, currentHashes);
  const algorithmMatches = session.algorithmVersion === ALGORITHM_VERSION;
  const stale = !inputMatches || !algorithmMatches;

  if (stale) {
    const result = performThreeWayMerge(base, local, remote);
    const conflicts: RestoredConflict[] = result.conflicts.map((c) => ({
      ...c,
      resolved: false,
      resolution: null,
    }));
    return {
      session,
      inputMatches,
      algorithmMatches,
      stale: true,
      mergedContent: result.mergedContent,
      conflicts,
      resolvedCount: 0,
      pendingCount: conflicts.length,
      appliedDecisionIds: [],
      staleDecisionIds: session.decisions.map((d) => d.conflictId),
    };
  }

  const replayed = applyDecisions(base, local, remote, session.decisions);
  const resolvedCount = replayed.conflicts.filter((c) => c.resolved).length;
  return {
    session,
    inputMatches: true,
    algorithmMatches: true,
    stale: false,
    mergedContent: replayed.mergedContent,
    conflicts: replayed.conflicts,
    resolvedCount,
    pendingCount: replayed.conflicts.length - resolvedCount,
    appliedDecisionIds: replayed.appliedIds,
    staleDecisionIds: replayed.missingIds,
  };
}

/** Default persistence directory inside the repository. */
export function defaultSessionDir(): string {
  return path.resolve(process.cwd(), '.sessions');
}

function sessionFile(sessionId: string, dir: string): string {
  if (/[\\/]|\.\./.test(sessionId)) {
    throw new Error('Invalid session id');
  }
  return path.join(dir, `${sessionId}.json`);
}

/** Persists a session as JSON to the given directory (default: .sessions). */
export async function saveSession(
  session: MergeSession,
  dir: string = defaultSessionDir(),
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const file = sessionFile(session.sessionId, dir);
  await fs.writeFile(file, JSON.stringify(session, null, 2), 'utf8');
  return file;
}

/** Loads a session from disk. Returns null if the file does not exist. */
export async function loadSession(
  sessionId: string,
  dir: string = defaultSessionDir(),
): Promise<MergeSession | null> {
  let raw: string;
  try {
    raw = await fs.readFile(sessionFile(sessionId, dir), 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed = JSON.parse(raw) as MergeSession;
  if (
    !parsed ||
    typeof parsed.sessionId !== 'string' ||
    typeof parsed.algorithmVersion !== 'string' ||
    !parsed.inputHashes ||
    !Array.isArray(parsed.decisions)
  ) {
    throw new Error('Corrupt session file');
  }
  return parsed;
}

/** Deletes a session file. Returns true if a file was removed. */
export async function deleteSession(
  sessionId: string,
  dir: string = defaultSessionDir(),
): Promise<boolean> {
  try {
    await fs.unlink(sessionFile(sessionId, dir));
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** Normalized LF content helper, exported for tests that need to compare outputs. */
export function normalizeText(text: string): string {
  return toLF(text);
}
