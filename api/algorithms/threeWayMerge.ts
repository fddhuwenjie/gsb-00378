import type { Conflict, LineDiff, DiffOperation } from '@shared/types';
import { MyersDiff, computeLineDiff, lineDiffsFromOperations, splitLines, joinLines } from './myersDiff';
import { generateId, toLF } from '../utils/lineUtils';

const CONFLICT_START_LOCAL = '<<<<<<< local';
const CONFLICT_SEPARATOR = '=======';
const CONFLICT_END_REMOTE = '>>>>>>> remote';

interface Modification {
  side: 'local' | 'remote';
  baseStart: number;
  baseEnd: number;
  content: string[];
}

interface ModGroup {
  kind: 'mod' | 'group';
  start: number;
  end: number;
  mod?: Modification;
  localMods?: Modification[];
  remoteMods?: Modification[];
}

/** 冲突校验失败：客户端提交的对象不是指向真实冲突块的合法描述 */
export class ConflictValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictValidationError';
  }
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
    const localMods = this.extractModifications(this.baseToLocalOps, 'local');
    const remoteMods = this.extractModifications(this.baseToRemoteOps, 'remote');

    const items = this.groupModifications(localMods, remoteMods);

    const mergedLines: string[] = [];
    let basePos = 0;

    for (const item of items) {
      while (basePos < item.start) {
        mergedLines.push(this.baseLines[basePos]);
        basePos++;
      }

      if (item.kind === 'mod') {
        mergedLines.push(...item.mod!.content);
        basePos = item.end;
        continue;
      }

      // 冲突组：分别计算两侧在并集 base 区间 [start, end) 上的内容
      const localContent = this.applyMods(item.start, item.end, item.localMods!);
      const remoteContent = this.applyMods(item.start, item.end, item.remoteMods!);

      if (arraysEqual(localContent, remoteContent)) {
        // 两边修改结果一致 → 干净合并，只保留一份
        mergedLines.push(...localContent);
        basePos = item.end;
        continue;
      }

      // ZEALOUS 细化：共同前缀/后缀行移出冲突块（与 git merge-file 一致）
      let prefix = 0;
      const minLen = Math.min(localContent.length, remoteContent.length);
      while (prefix < minLen && localContent[prefix] === remoteContent[prefix]) {
        prefix++;
      }
      let suffix = 0;
      while (
        suffix < minLen - prefix &&
        localContent[localContent.length - 1 - suffix] === remoteContent[remoteContent.length - 1 - suffix]
      ) {
        suffix++;
      }

      for (let k = 0; k < prefix; k++) {
        mergedLines.push(localContent[k]);
      }

      const localSide = localContent.slice(prefix, localContent.length - suffix);
      const remoteSide = remoteContent.slice(prefix, remoteContent.length - suffix);

      const startLine = mergedLines.length;
      mergedLines.push(CONFLICT_START_LOCAL);
      mergedLines.push(...localSide);
      mergedLines.push(CONFLICT_SEPARATOR);
      mergedLines.push(...remoteSide);
      mergedLines.push(CONFLICT_END_REMOTE);
      const endLine = mergedLines.length - 1;

      this.conflicts.push({
        id: generateId(),
        startLine,
        endLine,
        localContent: localSide,
        remoteContent: remoteSide,
        baseContent: this.baseLines.slice(item.start, item.end),
        resolved: false,
        resolution: null,
      });

      for (let k = localContent.length - suffix; k < localContent.length; k++) {
        mergedLines.push(localContent[k]);
      }

      basePos = item.end;
    }

    while (basePos < this.baseLines.length) {
      mergedLines.push(this.baseLines[basePos]);
      basePos++;
    }

    return {
      mergedContent: joinLines(mergedLines),
      conflicts: this.conflicts,
      hasConflicts: this.conflicts.length > 0,
      conflictCount: this.conflicts.length,
      diffs: {
        baseToLocal: lineDiffsFromOperations(this.baseToLocalOps),
        baseToRemote: lineDiffsFromOperations(this.baseToRemoteOps),
      },
    };
  }

  private extractModifications(operations: DiffOperation[], side: 'local' | 'remote'): Modification[] {
    const modifications: Modification[] = [];
    let i = 0;

    while (i < operations.length) {
      const op = operations[i];

      if (op.type === 'equal') {
        i++;
        continue;
      }

      const newContent: string[] = [];
      let baseStart = op.oldLineNum ?? (operations[i - 1]?.oldLineNum ?? -1) + 1;
      let baseEnd = baseStart;

      while (i < operations.length && operations[i].type !== 'equal') {
        const currentOp = operations[i];
        if (currentOp.type === 'delete') {
          baseEnd = (currentOp.oldLineNum ?? baseStart) + 1;
        } else if (currentOp.type === 'insert') {
          newContent.push(currentOp.content);
        }
        i++;
      }

      modifications.push({ side, baseStart, baseEnd, content: newContent });
    }

    return modifications;
  }

  /**
   * 将两边修改按 git merge-file 语义分组：
   * 闭区间 [baseStart, baseEnd] 相交（含贴边，即插入点落在对方区间边界）即冲突，
   * 冲突组沿两边后续修改传递性扩展，组内取 base 并集区间。
   */
  private groupModifications(localMods: Modification[], remoteMods: Modification[]): ModGroup[] {
    const items: ModGroup[] = [];
    let i = 0;
    let j = 0;

    const intersects = (a: Modification, b: Modification): boolean =>
      a.baseStart <= b.baseEnd && b.baseStart <= a.baseEnd;

    while (i < localMods.length && j < remoteMods.length) {
      const l = localMods[i];
      const r = remoteMods[j];

      if (intersects(l, r)) {
        const group: ModGroup = {
          kind: 'group',
          start: Math.min(l.baseStart, r.baseStart),
          end: Math.max(l.baseEnd, r.baseEnd),
          localMods: [l],
          remoteMods: [r],
        };
        i++;
        j++;
        // 传递性扩展：任一边的后续修改触及组区间则并入
        let extended = true;
        while (extended) {
          extended = false;
          while (i < localMods.length && localMods[i].baseStart <= group.end) {
            group.localMods!.push(localMods[i]);
            group.end = Math.max(group.end, localMods[i].baseEnd);
            i++;
            extended = true;
          }
          while (j < remoteMods.length && remoteMods[j].baseStart <= group.end) {
            group.remoteMods!.push(remoteMods[j]);
            group.end = Math.max(group.end, remoteMods[j].baseEnd);
            j++;
            extended = true;
          }
        }
        items.push(group);
      } else if (l.baseStart <= r.baseStart) {
        items.push({ kind: 'mod', start: l.baseStart, end: l.baseEnd, mod: l });
        i++;
      } else {
        items.push({ kind: 'mod', start: r.baseStart, end: r.baseEnd, mod: r });
        j++;
      }
    }

    while (i < localMods.length) {
      const l = localMods[i];
      items.push({ kind: 'mod', start: l.baseStart, end: l.baseEnd, mod: l });
      i++;
    }
    while (j < remoteMods.length) {
      const r = remoteMods[j];
      items.push({ kind: 'mod', start: r.baseStart, end: r.baseEnd, mod: r });
      j++;
    }

    return items;
  }

  /** 单边修改应用到 base 区间 [start, end) 上得到的内容 */
  private applyMods(start: number, end: number, mods: Modification[]): string[] {
    const out: string[] = [];
    let pos = start;
    for (const m of mods) {
      while (pos < m.baseStart) {
        out.push(this.baseLines[pos]);
        pos++;
      }
      out.push(...m.content);
      pos = m.baseEnd;
    }
    while (pos < end) {
      out.push(this.baseLines[pos]);
      pos++;
    }
    return out;
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

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 校验 conflict 对象是否精确指向 mergedContent 中的一个真实冲突块：
 * 行号合法、起止行为冲突标记、分隔符位置与两侧内容逐行匹配。
 * 不满足时抛出 ConflictValidationError（防止伪造对象替换任意文本）。
 */
function assertValidConflict(lines: string[], conflict: Conflict): void {
  const { startLine, endLine, localContent, remoteContent } = conflict;

  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 0 ||
    endLine < startLine ||
    endLine >= lines.length
  ) {
    throw new ConflictValidationError('无效冲突：行号越界或不合法');
  }

  if (lines[startLine] !== CONFLICT_START_LOCAL || lines[endLine] !== CONFLICT_END_REMOTE) {
    throw new ConflictValidationError('无效冲突：指定位置不存在冲突标记');
  }

  if (!Array.isArray(localContent) || !Array.isArray(remoteContent)) {
    throw new ConflictValidationError('无效冲突：冲突内容缺失');
  }

  const separatorLine = startLine + 1 + localContent.length;
  if (separatorLine >= endLine || lines[separatorLine] !== CONFLICT_SEPARATOR) {
    throw new ConflictValidationError('无效冲突：分隔标记与冲突内容不匹配');
  }

  const actualLocal = lines.slice(startLine + 1, separatorLine);
  const actualRemote = lines.slice(separatorLine + 1, endLine);
  if (!arraysEqual(actualLocal, localContent) || !arraysEqual(actualRemote, remoteContent)) {
    throw new ConflictValidationError('无效冲突：冲突内容与标记区域不匹配');
  }
}

export function resolveConflict(
  mergedContent: string,
  conflict: Conflict,
  resolution: 'local' | 'remote' | 'manual',
  customContent?: string
): string {
  const lines = splitLines(mergedContent);

  assertValidConflict(lines, conflict);

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
