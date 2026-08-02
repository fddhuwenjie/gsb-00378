/**
 * Saveable merge sessions.
 *
 * A session records only what is needed to reproduce a resolution WITHOUT
 * storing anything that can drift:
 *   - content hashes of base/local/remote (not the content, not line numbers),
 *   - the algorithm version that produced the merge,
 *   - the user's decisions keyed by the DETERMINISTIC, content-derived
 *     conflict id (plus any manual content).
 *
 * On reopen we re-run the merge on the supplied content and replay the
 * decisions by conflict id. Because ids are derived from conflict content, a
 * decision only re-applies when the exact conflicting text is unchanged; if the
 * text changed, its id changes, the saved decision no longer matches, and it is
 * surfaced as stale so the caller can re-confirm — never silently applied to
 * similar-but-different text.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Conflict } from '@shared/types';
import {
  ALGORITHM_VERSION,
  performThreeWayMerge,
  resolveConflict,
} from '../algorithms/threeWayMerge.js';
import { sha256, toLF } from '../utils/lineUtils.js';

/** Schema version of the persisted session file itself. */
export const SESSION_SCHEMA_VERSION = 1;

export type Resolution = 'local' | 'remote' | 'manual';

export interface ConflictDecision {
  conflictId: string;
  resolution: Resolution;
  /** Present (and required) only for manual resolutions. */
  customContent?: string;
}

export interface MergeSession {
  schemaVersion: number;
  algorithmVersion: number;
  sessionId: string;
  createdAt: string;
  /** Fingerprints of the LF-normalized inputs. No content, no line numbers. */
  hashes: {
    base: string;
    local: string;
    remote: string;
  };
  decisions: ConflictDecision[];
}

export interface ReplayInput {
  base: string;
  local: string;
  remote: string;
}

export interface ReplayResult {
  algorithmVersionMatches: boolean;
  /** Whether each supplied input still matches the saved hash. */
  contentMatches: { base: boolean; local: boolean; remote: boolean };
  /** Decisions whose conflict id maps to a current conflict — applied. */
  appliedDecisions: ConflictDecision[];
  /** Decisions whose conflict id is absent now — require re-confirmation. */
  staleDecisions: ConflictDecision[];
  /** Current conflicts that have no saved decision. */
  unresolvedConflicts: Conflict[];
  /** The merged text after applying the valid decisions. */
  mergedContent: string;
  /** SHA-256 of `mergedContent`, for cheap before/after comparison. */
  outputHash: string;
  /** True when the caller must re-confirm before trusting the result. */
  requiresReconfirmation: boolean;
}

function hashContent(text: string): string {
  // Hash the LF-normalized form so CRLF/LF differences don't spuriously
  // invalidate a session (the merge itself normalizes the same way).
  return sha256(toLF(text));
}

/**
 * Build an in-memory session from the inputs and the decisions the user made.
 * Does not touch disk.
 */
export function createSession(
  input: ReplayInput,
  decisions: ConflictDecision[],
  opts: { sessionId?: string; createdAt?: string } = {}
): MergeSession {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    sessionId: opts.sessionId ?? sha256(`${Date.now()}:${Math.random()}`).slice(0, 16),
    createdAt: opts.createdAt ?? new Date().toISOString(),
    hashes: {
      base: hashContent(input.base),
      local: hashContent(input.local),
      remote: hashContent(input.remote),
    },
    decisions: decisions.map((d) => ({
      conflictId: d.conflictId,
      resolution: d.resolution,
      ...(d.resolution === 'manual' ? { customContent: d.customContent ?? '' } : {}),
    })),
  };
}

/**
 * Re-run the merge on the supplied content and replay the saved decisions.
 * Decisions are matched to conflicts by content-derived id, so stale decisions
 * (whose text changed) are reported rather than applied.
 */
export function replaySession(session: MergeSession, input: ReplayInput): ReplayResult {
  const algorithmVersionMatches = session.algorithmVersion === ALGORITHM_VERSION;

  const contentMatches = {
    base: hashContent(input.base) === session.hashes.base,
    local: hashContent(input.local) === session.hashes.local,
    remote: hashContent(input.remote) === session.hashes.remote,
  };

  const merge = performThreeWayMerge(input.base, input.local, input.remote);
  const conflictsById = new Map(merge.conflicts.map((c) => [c.id, c]));
  const decisionById = new Map(session.decisions.map((d) => [d.conflictId, d]));

  const appliedDecisions: ConflictDecision[] = [];
  const staleDecisions: ConflictDecision[] = [];

  // A saved decision is stale if its conflict id is no longer present (text
  // changed, so the deterministic id changed) OR the algorithm version differs.
  for (const decision of session.decisions) {
    if (algorithmVersionMatches && conflictsById.has(decision.conflictId)) {
      appliedDecisions.push(decision);
    } else {
      staleDecisions.push(decision);
    }
  }

  // Apply valid decisions. resolveConflict is content-anchored and pure, so we
  // fold over the current conflicts using each conflict's live payload.
  let mergedContent = merge.mergedContent;
  for (const conflict of merge.conflicts) {
    const decision = appliedDecisions.find((d) => d.conflictId === conflict.id);
    if (!decision) continue;
    mergedContent = resolveConflict(
      mergedContent,
      conflict,
      decision.resolution,
      decision.customContent
    );
  }

  const unresolvedConflicts = merge.conflicts.filter((c) => !decisionById.has(c.id));

  return {
    algorithmVersionMatches,
    contentMatches,
    appliedDecisions,
    staleDecisions,
    unresolvedConflicts,
    mergedContent,
    outputHash: sha256(mergedContent),
    requiresReconfirmation: !algorithmVersionMatches || staleDecisions.length > 0,
  };
}

/**
 * Filesystem-backed store for sessions. All files live under a caller-provided
 * directory (a repo-local temp dir in tests) so persistence is easy to clean up
 * and never leaks outside the workspace.
 */
export class SessionStore {
  constructor(private readonly baseDir: string) {}

  private filePath(sessionId: string): string {
    // Guard against path traversal via a crafted id.
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baseDir, `${safe}.session.json`);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  /** Persist a session atomically (write temp file, then rename). */
  async save(session: MergeSession): Promise<string> {
    await this.init();
    const target = this.filePath(session.sessionId);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const data = JSON.stringify(session, null, 2);
    await fs.writeFile(tmp, data, 'utf8');
    await fs.rename(tmp, target);
    return target;
  }

  async exists(sessionId: string): Promise<boolean> {
    try {
      await fs.access(this.filePath(sessionId));
      return true;
    } catch {
      return false;
    }
  }

  /** Load a session from disk. Throws if missing or malformed. */
  async load(sessionId: string): Promise<MergeSession> {
    const raw = await fs.readFile(this.filePath(sessionId), 'utf8');
    const parsed = JSON.parse(raw) as MergeSession;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.hashes !== 'object'
    ) {
      throw new Error(`Malformed session file for id ${sessionId}`);
    }
    return parsed;
  }

  async delete(sessionId: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(sessionId));
    } catch {
      // Already gone — deletion is idempotent.
    }
  }

  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.baseDir);
      return entries
        .filter((f) => f.endsWith('.session.json'))
        .map((f) => f.replace(/\.session\.json$/, ''));
    } catch {
      return [];
    }
  }
}
