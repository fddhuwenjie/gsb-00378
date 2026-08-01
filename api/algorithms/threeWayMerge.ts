import type { Conflict, LineDiff, DiffOperation } from '@shared/types';
import { MyersDiff, computeLineDiff, splitLines, joinLines } from './myersDiff';
import { generateId, toLF, linesEqualIgnoreTrailingWhitespace } from '../utils/lineUtils';

const CONFLICT_START_LOCAL = '<<<<<<< local';
const CONFLICT_SEPARATOR = '=======';
const CONFLICT_END_REMOTE = '>>>>>>> remote';

interface BaseMapping {
  baseLine: number;
  localLine: number | null;
  remoteLine: number | null;
}

interface PendingModification {
  type: 'local' | 'remote';
  baseStart: number;
  baseEnd: number;
  content: string[];
  originalLines: string[];
}

export class ThreeWayMerge {
  private baseLines: string[];
  private localLines: string[];
  private remoteLines: string[];
  private baseToLocalOps: DiffOperation[];
  private baseToRemoteOps: DiffOperation[];
  private conflicts: Conflict[] = [];

  constructor(base: string, local: string, remote: string) {
    this.baseLines = splitLines(toLF(base));
    this.localLines = splitLines(toLF(local));
    this.remoteLines = splitLines(toLF(remote));

    const diffLocal = new MyersDiff(this.baseLines, this.localLines);
    this.baseToLocalOps = diffLocal.computeDiff();

    const diffRemote = new MyersDiff(this.baseLines, this.remoteLines);
    this.baseToRemoteOps = diffRemote.computeDiff();
  }

  public merge(): {
    mergedContent: string;
    conflicts: Conflict[];
    hasConflicts: boolean;
    conflictCount: number;
    diffs: {
      baseToLocal: LineDiff[];
      baseToRemote: LineDiff[];
    };
  } {
    const localModifications = this.extractModifications(this.baseToLocalOps, 'local');
    const remoteModifications = this.extractModifications(this.baseToRemoteOps, 'remote');

    const mergedLines: string[] = [];
    const sortedModifications = this.sortAndDetectConflicts(localModifications, remoteModifications);

    let basePos = 0;

    for (const mod of sortedModifications) {
      const isConflict = 'isConflict' in mod;
      const baseStart = isConflict
        ? Math.min(mod.localMod.baseStart, mod.remoteMod.baseStart)
        : mod.baseStart;

      while (basePos < baseStart && basePos < this.baseLines.length) {
        mergedLines.push(this.baseLines[basePos]);
        basePos++;
      }

      if (isConflict) {
        const localMod = mod.localMod;
        const remoteMod = mod.remoteMod;

        const startLine = mergedLines.length;

        mergedLines.push(CONFLICT_START_LOCAL);
        mergedLines.push(...localMod.content);
        mergedLines.push(CONFLICT_SEPARATOR);
        mergedLines.push(...remoteMod.content);
        mergedLines.push(CONFLICT_END_REMOTE);

        const endLine = mergedLines.length - 1;

        this.conflicts.push({
          id: generateId(),
          startLine,
          endLine,
          localContent: localMod.content,
          remoteContent: remoteMod.content,
          baseContent: localMod.originalLines,
          resolved: false,
          resolution: null,
        });

        basePos = Math.max(localMod.baseEnd, remoteMod.baseEnd);
      } else {
        mergedLines.push(...mod.content);
        basePos = mod.baseEnd;
      }
    }

    while (basePos < this.baseLines.length) {
      mergedLines.push(this.baseLines[basePos]);
      basePos++;
    }

    const diffs = {
      baseToLocal: computeLineDiff(this.baseLines, this.localLines),
      baseToRemote: computeLineDiff(this.baseLines, this.remoteLines),
    };

    return {
      mergedContent: joinLines(mergedLines),
      conflicts: this.conflicts,
      hasConflicts: this.conflicts.length > 0,
      conflictCount: this.conflicts.length,
      diffs,
    };
  }

  private extractModifications(
    operations: DiffOperation[],
    source: 'local' | 'remote'
  ): PendingModification[] {
    const modifications: PendingModification[] = [];
    let i = 0;

    while (i < operations.length) {
      const op = operations[i];

      if (op.type === 'equal') {
        i++;
        continue;
      }

      const originalLines: string[] = [];
      const newContent: string[] = [];
      let baseStart = op.oldLineNum ?? (operations[i - 1]?.oldLineNum ?? -1) + 1;
      let baseEnd = baseStart;

      while (i < operations.length && operations[i].type !== 'equal') {
        const currentOp = operations[i];
        if (currentOp.type === 'delete') {
          originalLines.push(currentOp.content);
          baseEnd = (currentOp.oldLineNum ?? baseStart) + 1;
        } else if (currentOp.type === 'insert') {
          newContent.push(currentOp.content);
          if (baseEnd === baseStart) {
            baseEnd = baseStart;
          }
        }
        i++;
      }

      if (originalLines.length > 0 || newContent.length > 0) {
        modifications.push({
          type: source,
          baseStart,
          baseEnd,
          content: newContent,
          originalLines,
        });
      }
    }

    return modifications;
  }

  private sortAndDetectConflicts(
    localMods: PendingModification[],
    remoteMods: PendingModification[]
  ): Array<PendingModification | { isConflict: true; localMod: PendingModification; remoteMod: PendingModification }> {
    const result: Array<
      PendingModification | { isConflict: true; localMod: PendingModification; remoteMod: PendingModification }
    > = [];

    let i = 0;
    let j = 0;

    while (i < localMods.length && j < remoteMods.length) {
      const localMod = localMods[i];
      const remoteMod = remoteMods[j];

      if (this.overlaps(localMod, remoteMod) || this.isInsertAtSamePosition(localMod, remoteMod)) {
        if (this.isSameModification(localMod, remoteMod)) {
          result.push(localMod);
        } else {
          result.push({
            isConflict: true,
            localMod,
            remoteMod,
          });
        }
        i++;
        j++;
      } else if (localMod.baseStart < remoteMod.baseStart) {
        result.push(localMod);
        i++;
      } else {
        result.push(remoteMod);
        j++;
      }
    }

    while (i < localMods.length) {
      result.push(localMods[i]);
      i++;
    }

    while (j < remoteMods.length) {
      result.push(remoteMods[j]);
      j++;
    }

    return result;
  }

  private overlaps(a: PendingModification, b: PendingModification): boolean {
    return a.baseStart < b.baseEnd && b.baseStart < a.baseEnd;
  }

  private isInsertAtSamePosition(a: PendingModification, b: PendingModification): boolean {
    const aIsInsert = a.originalLines.length === 0;
    const bIsInsert = b.originalLines.length === 0;
    return aIsInsert && bIsInsert && a.baseStart === b.baseStart;
  }

  private isSameModification(a: PendingModification, b: PendingModification): boolean {
    if (a.content.length !== b.content.length) {
      return false;
    }

    for (let i = 0; i < a.content.length; i++) {
      if (!linesEqualIgnoreTrailingWhitespace(a.content[i], b.content[i])) {
        return false;
      }
    }

    return true;
  }

  public getDiffs(): {
    baseToLocal: LineDiff[];
    baseToRemote: LineDiff[];
  } {
    return {
      baseToLocal: computeLineDiff(this.baseLines, this.localLines),
      baseToRemote: computeLineDiff(this.baseLines, this.remoteLines),
    };
  }
}

export function resolveConflict(
  mergedContent: string,
  conflict: Conflict,
  resolution: 'local' | 'remote' | 'manual',
  customContent?: string
): string {
  const lines = splitLines(mergedContent);

  const resolutionContent =
    resolution === 'local'
      ? conflict.localContent
      : resolution === 'remote'
        ? conflict.remoteContent
        : splitLines(customContent ?? '');

  const conflictLength = conflict.endLine - conflict.startLine + 1;
  lines.splice(conflict.startLine, conflictLength, ...resolutionContent);

  return joinLines(lines);
}

export function performThreeWayMerge(base: string, local: string, remote: string) {
  const merger = new ThreeWayMerge(base, local, remote);
  return merger.merge();
}
