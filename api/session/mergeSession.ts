import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Conflict } from '@shared/types';
import { performThreeWayMerge } from '../algorithms/threeWayMerge.js';
import { parseConflictObjects, resolveConflictById } from '../algorithms/conflictMarkers.js';
import { toLF } from '../utils/lineUtils.js';

export const ALGORITHM_VERSION = 'merge-3way-v2';

export type ResolutionKind = 'local' | 'remote' | 'manual';

export interface ConflictDecision {
  signature: string;
  resolution: ResolutionKind;
  customContent?: string;
}

export interface MergeSessionData {
  sessionId: string;
  algorithmVersion: string;
  baseHash: string;
  localHash: string;
  remoteHash: string;
  decisions: ConflictDecision[];
  createdAt: string;
  updatedAt: string;
}

export type RestoreStatus = 'clean' | 'partial' | 'stale';

export interface RestoredConflict {
  id: string;
  signature: string;
  startLine: number;
  endLine: number;
  localContent: string[];
  remoteContent: string[];
  resolved: boolean;
  resolution: ResolutionKind | null;
}

export interface RestoreResult {
  status: RestoreStatus;
  sessionId: string;
  mergedContent: string;
  outputHash: string;
  conflicts: RestoredConflict[];
  replayed: string[];
  invalidated: string[];
  unchanged: boolean;
}

export function hashText(text: string): string {
  return createHash('sha256').update(toLF(text), 'utf8').digest('hex');
}

export function conflictSignature(conflict: {
  localContent: string[];
  remoteContent: string[];
  baseContent: string[];
}): string {
  const canonical = [
    JSON.stringify(conflict.localContent),
    JSON.stringify(conflict.remoteContent),
    JSON.stringify(conflict.baseContent),
  ].join('\u0000');
  return 'sig-' + createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

export function createSession(base: string, local: string, remote: string): MergeSessionData {
  const now = new Date().toISOString();
  const baseHash = hashText(base);
  const localHash = hashText(local);
  const remoteHash = hashText(remote);
  const sessionId =
    'session-' +
    createHash('sha256')
      .update(`${ALGORITHM_VERSION}:${baseHash}:${localHash}:${remoteHash}`, 'utf8')
      .digest('hex')
      .slice(0, 16);
  return {
    sessionId,
    algorithmVersion: ALGORITHM_VERSION,
    baseHash,
    localHash,
    remoteHash,
    decisions: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function addDecision(
  session: MergeSessionData,
  conflict: { localContent: string[]; remoteContent: string[]; baseContent: string[] },
  resolution: ResolutionKind,
  customContent?: string
): MergeSessionData {
  const signature = conflictSignature(conflict);
  const decisions = session.decisions.filter((d) => d.signature !== signature);
  const decision: ConflictDecision = { signature, resolution };
  if (resolution === 'manual') {
    decision.customContent = customContent ?? '';
  }
  decisions.push(decision);
  return {
    ...session,
    decisions,
    updatedAt: new Date().toISOString(),
  };
}

export function sessionPath(directory: string, session: MergeSessionData): string {
  return path.join(directory, `${session.sessionId}.json`);
}

export async function saveSession(
  directory: string,
  session: MergeSessionData
): Promise<string> {
  await fs.mkdir(directory, { recursive: true });
  const file = sessionPath(directory, session);
  const payload = JSON.stringify(session, null, 2);
  await fs.writeFile(file, payload, 'utf8');
  return file;
}

export async function loadSession(
  directory: string,
  sessionId: string
): Promise<MergeSessionData> {
  const file = path.join(directory, `${sessionId}.json`);
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw) as MergeSessionData;
}

export function sessionMatchesContent(
  session: MergeSessionData,
  base: string,
  local: string,
  remote: string
): boolean {
  return (
    session.algorithmVersion === ALGORITHM_VERSION &&
    session.baseHash === hashText(base) &&
    session.localHash === hashText(local) &&
    session.remoteHash === hashText(remote)
  );
}

export function restoreSession(
  session: MergeSessionData,
  base: string,
  local: string,
  remote: string
): RestoreResult {
  const sameContent = sessionMatchesContent(session, base, local, remote);
  const initialMerge = performThreeWayMerge(base, local, remote);

  const bySignature = new Map<string, Conflict>();
  for (const conflict of initialMerge.conflicts) {
    const sig = conflictSignature(conflict);
    if (!bySignature.has(sig)) {
      bySignature.set(sig, conflict);
    }
  }

  let mergedContent = initialMerge.mergedContent;
  const replayed: string[] = [];
  const invalidated: string[] = [];
  const resolvedIds = new Set<string>();

  if (sameContent) {
    for (const decision of session.decisions) {
      const conflict = bySignature.get(decision.signature);
      if (!conflict) {
        invalidated.push(decision.signature);
        continue;
      }
      const result = resolveConflictById(
        mergedContent,
        conflict.id,
        decision.resolution,
        decision.customContent
      );
      mergedContent = result.mergedContent;
      replayed.push(decision.signature);
      resolvedIds.add(conflict.id);
    }
  } else {
    for (const decision of session.decisions) {
      invalidated.push(decision.signature);
    }
  }

  const remainingParsed = parseConflictObjects(mergedContent);
  const remainingById = new Map<string, Conflict>();
  for (const c of initialMerge.conflicts) {
    if (!resolvedIds.has(c.id)) {
      remainingById.set(c.id, c);
    }
  }

  const restoredConflicts: RestoredConflict[] = remainingParsed.map((c) => {
    const original = remainingById.get(c.id);
    const sig = original
      ? conflictSignature(original)
      : conflictSignature({
          localContent: c.localContent,
          remoteContent: c.remoteContent,
          baseContent: [],
        });
    return {
      id: c.id,
      signature: sig,
      startLine: c.startLine,
      endLine: c.endLine,
      localContent: c.localContent,
      remoteContent: c.remoteContent,
      resolved: false,
      resolution: null,
    };
  });

  const outputHash = hashText(mergedContent);

  let status: RestoreStatus;
  if (!sameContent) {
    status = 'stale';
  } else if (
    replayed.length === session.decisions.length &&
    restoredConflicts.length === 0
  ) {
    status = 'clean';
  } else {
    status = 'partial';
  }

  return {
    status,
    sessionId: session.sessionId,
    mergedContent,
    outputHash,
    conflicts: restoredConflicts,
    replayed,
    invalidated,
    unchanged: sameContent && session.decisions.length === 0,
  };
}
