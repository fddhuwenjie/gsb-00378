import type { DiffOperation, DiffOperationType, LineDiff } from '@shared/types';

interface Point {
  x: number;
  y: number;
}

interface Snake {
  start: Point;
  end: Point;
}

export class MyersDiff {
  private a: string[];
  private b: string[];
  private aIds: number[];
  private bIds: number[];
  private N: number;
  private M: number;
  private MAX: number;

  constructor(a: string[], b: string[]) {
    this.a = a;
    this.b = b;
    // 行内容映射为数值 id，加速大文件下的高频比较
    const ids = new Map<string, number>();
    const toId = (s: string): number => {
      let id = ids.get(s);
      if (id === undefined) {
        id = ids.size;
        ids.set(s, id);
      }
      return id;
    };
    this.aIds = a.map(toId);
    this.bIds = b.map(toId);
    this.N = a.length;
    this.M = b.length;
    this.MAX = this.N + this.M;
  }

  private equals(x: number, y: number): boolean {
    if (x < 0 || x >= this.N || y < 0 || y >= this.M) {
      return false;
    }
    return this.aIds[x] === this.bIds[y];
  }

  public computeDiff(): DiffOperation[] {
    // 修剪公共前缀/后缀（与 git xdl 的 xdl_trim_ends 一致：
    // 避免"insert@前 + delete@后"的错位表示，同时大幅缩小 Myers 搜索空间）
    let start = 0;
    while (start < this.N && start < this.M && this.aIds[start] === this.bIds[start]) {
      start++;
    }
    let endA = this.N;
    let endB = this.M;
    while (endA > start && endB > start && this.aIds[endA - 1] === this.bIds[endB - 1]) {
      endA--;
      endB--;
    }

    const prefixOps: DiffOperation[] = [];
    for (let k = 0; k < start; k++) {
      prefixOps.push({ type: 'equal', content: this.a[k], oldLineNum: k, newLineNum: k });
    }
    const suffixOps: DiffOperation[] = [];
    for (let k = 0; k < this.N - endA; k++) {
      suffixOps.push({
        type: 'equal',
        content: this.a[endA + k],
        oldLineNum: endA + k,
        newLineNum: endB + k,
      });
    }

    if (start === endA && start === endB) {
      return [...prefixOps, ...suffixOps];
    }

    const sub = new MyersDiff(this.a.slice(start, endA), this.b.slice(start, endB));
    const midOps = sub.computeCoreDiff().map((o) => ({
      ...o,
      oldLineNum: o.oldLineNum === null ? null : o.oldLineNum + start,
      newLineNum: o.newLineNum === null ? null : o.newLineNum + start,
    }));

    // 在完整序列上做 slide-down 规范化并统一重排行号
    return this.normalizeOperations([...prefixOps, ...midOps, ...suffixOps]);
  }

  /** 不做前缀/后缀修剪与规范化的核心 Myers diff */
  private computeCoreDiff(): DiffOperation[] {
    if (this.N === 0 && this.M === 0) {
      return [];
    }

    if (this.N === 0) {
      return this.b.map((line, i) => ({
        type: 'insert' as DiffOperationType,
        content: line,
        oldLineNum: null,
        newLineNum: i,
      }));
    }

    if (this.M === 0) {
      return this.a.map((line, i) => ({
        type: 'delete' as DiffOperationType,
        content: line,
        oldLineNum: i,
        newLineNum: null,
      }));
    }

    const trace = this.shortestEditScript();
    return this.backtrack(trace);
  }

  /**
   * 变更块 slide-down 规范化：纯插入/纯删除块后跟相同内容的 equal 行时，
   * 将块向文件末尾方向滑动到最末位置（与 git xdiff 的锚定语义一致，
   * 消除重复行场景下的锚定歧义），最后统一重排行号。
   */
  private normalizeOperations(ops: DiffOperation[]): DiffOperation[] {
    const seq = ops.map((o) => ({ type: o.type, content: o.content }));

    let i = 0;
    while (i < seq.length) {
      if (seq[i].type === 'equal') {
        i++;
        continue;
      }
      let j = i;
      let delCount = 0;
      let insCount = 0;
      while (j < seq.length && seq[j].type !== 'equal') {
        if (seq[j].type === 'delete') delCount++;
        else insCount++;
        j++;
      }
      // 混合块（删除+插入）不滑动
      if (delCount > 0 && insCount > 0) {
        i = j;
        continue;
      }
      const runType: DiffOperationType = delCount > 0 ? 'delete' : 'insert';
      const runLen = delCount + insCount;
      const contents = seq.slice(i, j).map((o) => o.content);

      // 计算可滑动步数 t：后续 equal 行内容与（旋转后的）块首行相同
      let t = 0;
      while (
        j + t < seq.length &&
        seq[j + t].type === 'equal' &&
        seq[j + t].content === contents[t % runLen]
      ) {
        t++;
      }

      if (t > 0) {
        const equals = Array.from({ length: t }, (_, k) => ({
          type: 'equal' as const,
          content: contents[k % runLen],
        }));
        const rot = t % runLen;
        const newRun = [...contents.slice(rot), ...contents.slice(0, rot)].map((content) => ({
          type: runType,
          content,
        }));
        seq.splice(i, runLen + t, ...equals, ...newRun);
        i += equals.length + newRun.length;
      } else {
        i = j;
      }
    }

    // 滑动后统一重排行号，保证 old/new 两侧各自连续
    let oldIdx = 0;
    let newIdx = 0;
    return seq.map((o) => {
      if (o.type === 'equal') {
        return { type: 'equal' as const, content: o.content, oldLineNum: oldIdx++, newLineNum: newIdx++ };
      }
      if (o.type === 'delete') {
        return { type: 'delete' as const, content: o.content, oldLineNum: oldIdx++, newLineNum: null };
      }
      return { type: 'insert' as const, content: o.content, oldLineNum: null, newLineNum: newIdx++ };
    });
  }

  private shortestEditScript(): Map<number, number[]> {
    const { N, M, MAX } = this;
    const V = new Map<number, number>();
    const trace: Map<number, number[]> = new Map();

    V.set(1, 0);

    for (let d = 0; d <= MAX; d++) {
      const vSnapshot = new Array(V.size * 2);
      let idx = 0;
      for (const [k, v] of V.entries()) {
        vSnapshot[idx++] = k;
        vSnapshot[idx++] = v;
      }
      trace.set(d, vSnapshot);

      for (let k = -d; k <= d; k += 2) {
        let x: number;
        const prevKMinus = V.get(k - 1) ?? -1;
        const prevKPlus = V.get(k + 1) ?? -1;

        if (k === -d || (k !== d && prevKMinus < prevKPlus)) {
          x = prevKPlus;
        } else {
          x = prevKMinus + 1;
        }

        let y = x - k;

        while (this.equals(x, y)) {
          x++;
          y++;
        }

        V.set(k, x);

        if (x >= N && y >= M) {
          return trace;
        }
      }
    }

    return trace;
  }

  private backtrack(trace: Map<number, number[]>): DiffOperation[] {
    const { N, M } = this;
    const operations: DiffOperation[] = [];

    let x = N;
    let y = M;

    for (let d = trace.size - 1; d > 0; d--) {
      const vSnapshot = trace.get(d)!;
      const V = new Map<number, number>();
      for (let i = 0; i < vSnapshot.length; i += 2) {
        V.set(vSnapshot[i], vSnapshot[i + 1]);
      }

      const k = x - y;
      const prevKMinus = V.get(k - 1) ?? -1;
      const prevKPlus = V.get(k + 1) ?? -1;

      let prevK: number;
      if (k === -d || (k !== d && prevKMinus < prevKPlus)) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }

      const prevX = V.get(prevK)!;
      const prevY = prevX - prevK;

      while (x > prevX && y > prevY) {
        operations.unshift({
          type: 'equal',
          content: this.a[x - 1],
          oldLineNum: x - 1,
          newLineNum: y - 1,
        });
        x--;
        y--;
      }

      if (d > 0) {
        if (x > prevX) {
          operations.unshift({
            type: 'delete',
            content: this.a[x - 1],
            oldLineNum: x - 1,
            newLineNum: null,
          });
          x--;
        } else if (y > prevY) {
          operations.unshift({
            type: 'insert',
            content: this.b[y - 1],
            oldLineNum: null,
            newLineNum: y - 1,
          });
          y--;
        }
      }
    }

    while (x > 0 && y > 0) {
      operations.unshift({
        type: 'equal',
        content: this.a[x - 1],
        oldLineNum: x - 1,
        newLineNum: y - 1,
      });
      x--;
      y--;
    }

    return operations;
  }
}

export function computeLineDiff(a: string[], b: string[]): LineDiff[] {
  const myers = new MyersDiff(a, b);
  return lineDiffsFromOperations(myers.computeDiff());
}

/** 由已计算的 diff 操作序列生成展示层 LineDiff（避免重复跑 Myers） */
export function lineDiffsFromOperations(operations: DiffOperation[]): LineDiff[] {
  const lineDiffs: LineDiff[] = [];

  let i = 0;
  while (i < operations.length) {
    const op = operations[i];

    if (op.type === 'equal') {
      lineDiffs.push({
        type: 'equal',
        content: op.content,
        oldLineNum: op.oldLineNum,
        newLineNum: op.newLineNum,
      });
      i++;
    } else if (op.type === 'delete') {
      if (i + 1 < operations.length && operations[i + 1].type === 'insert') {
        const insertOp = operations[i + 1];
        lineDiffs.push({
          type: 'modify',
          content: insertOp.content,
          oldLineNum: op.oldLineNum,
          newLineNum: insertOp.newLineNum,
        });
        i += 2;
      } else {
        lineDiffs.push({
          type: 'delete',
          content: op.content,
          oldLineNum: op.oldLineNum,
          newLineNum: null,
        });
        i++;
      }
    } else if (op.type === 'insert') {
      lineDiffs.push({
        type: 'insert',
        content: op.content,
        oldLineNum: null,
        newLineNum: op.newLineNum,
      });
      i++;
    } else {
      i++;
    }
  }

  return lineDiffs;
}

export function diffLines(a: string, b: string): DiffOperation[] {
  const linesA = splitLines(a);
  const linesB = splitLines(b);
  const myers = new MyersDiff(linesA, linesB);
  return myers.computeDiff();
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split('\n');
}

export function joinLines(lines: string[]): string {
  return lines.join('\n');
}
