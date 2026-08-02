import type { Conflict } from '@shared/types';
import { splitLines, joinLines } from './myersDiff';

export const CONFLICT_START_PREFIX = '<<<<<<< local:';
export const CONFLICT_SEPARATOR = '=======';
export const CONFLICT_END_PREFIX = '>>>>>>> remote:';

export interface ParsedConflict {
  id: string;
  startLine: number;
  separatorLine: number;
  endLine: number;
  localLines: string[];
  remoteLines: string[];
}

export class ConflictNotFoundError extends Error {
  public readonly conflictId: string;
  constructor(conflictId: string) {
    super(`Conflict not found or already resolved: ${conflictId}`);
    this.name = 'ConflictNotFoundError';
    this.conflictId = conflictId;
  }
}

export function buildConflictMarkers(
  id: string,
  localLines: string[],
  remoteLines: string[]
): string[] {
  return [
    `${CONFLICT_START_PREFIX}${id}`,
    ...localLines,
    CONFLICT_SEPARATOR,
    ...remoteLines,
    `${CONFLICT_END_PREFIX}${id}`,
  ];
}

export function parseConflicts(lines: string[]): ParsedConflict[] {
  const conflicts: ParsedConflict[] = [];
  let i = 0;

  while (i < lines.length) {
    const startLine = lines[i];
    if (typeof startLine === 'string' && startLine.startsWith(CONFLICT_START_PREFIX)) {
      const id = startLine.slice(CONFLICT_START_PREFIX.length);
      let separatorLine = -1;
      let endLine = -1;
      let j = i + 1;

      while (j < lines.length) {
        const line = lines[j];
        if (line === CONFLICT_SEPARATOR && separatorLine === -1) {
          separatorLine = j;
        } else if (
          typeof line === 'string' &&
          line.startsWith(CONFLICT_END_PREFIX) &&
          separatorLine !== -1
        ) {
          const endId = line.slice(CONFLICT_END_PREFIX.length);
          if (endId === id) {
            endLine = j;
            break;
          }
        }
        j++;
      }

      if (separatorLine !== -1 && endLine !== -1) {
        conflicts.push({
          id,
          startLine: i,
          separatorLine,
          endLine,
          localLines: lines.slice(i + 1, separatorLine),
          remoteLines: lines.slice(separatorLine + 1, endLine),
        });
        i = endLine + 1;
        continue;
      }
    }
    i++;
  }

  return conflicts;
}

export function parseConflictObjects(mergedContent: string): Conflict[] {
  const lines = splitLines(mergedContent);
  const parsed = parseConflicts(lines);
  return parsed.map((c) => ({
    id: c.id,
    startLine: c.startLine,
    endLine: c.endLine,
    localContent: c.localLines,
    remoteContent: c.remoteLines,
    baseContent: [],
    resolved: false,
    resolution: null,
  }));
}

export function hasConflictMarkers(mergedContent: string): boolean {
  const lines = splitLines(mergedContent);
  return parseConflicts(lines).length > 0;
}

export type ResolutionKind = 'local' | 'remote' | 'manual';

export interface ResolveResult {
  mergedContent: string;
  resolvedId: string;
  conflicts: Conflict[];
}

export function resolveConflictById(
  mergedContent: string,
  conflictId: string,
  resolution: ResolutionKind,
  customContent?: string
): ResolveResult {
  if (typeof conflictId !== 'string' || conflictId.length === 0) {
    throw new ConflictNotFoundError(String(conflictId));
  }

  if (resolution !== 'local' && resolution !== 'remote' && resolution !== 'manual') {
    throw new Error(`Invalid resolution type: ${resolution}`);
  }

  let lines = splitLines(mergedContent);
  const parsed = parseConflicts(lines);
  const target = parsed.find((c) => c.id === conflictId);

  if (!target) {
    throw new ConflictNotFoundError(conflictId);
  }

  const resolutionLines =
    resolution === 'local'
      ? target.localLines
      : resolution === 'remote'
        ? target.remoteLines
        : splitLines(customContent ?? '');

  const replacement = [...resolutionLines];
  lines.splice(target.startLine, target.endLine - target.startLine + 1, ...replacement);

  const remainingRaw = parseConflicts(lines);
  const conflicts: Conflict[] = remainingRaw.map((c) => ({
    id: c.id,
    startLine: c.startLine,
    endLine: c.endLine,
    localContent: c.localLines,
    remoteContent: c.remoteLines,
    baseContent: [],
    resolved: false,
    resolution: null,
  }));

  return {
    mergedContent: joinLines(lines),
    resolvedId: conflictId,
    conflicts,
  };
}
