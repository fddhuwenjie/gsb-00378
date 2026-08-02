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
  private N: number;
  private M: number;
  private MAX: number;

  constructor(a: string[], b: string[]) {
    this.a = a;
    this.b = b;
    this.N = a.length;
    this.M = b.length;
    this.MAX = this.N + this.M;
  }

  private equals(x: number, y: number): boolean {
    if (x < 0 || x >= this.N || y < 0 || y >= this.M) {
      return false;
    }
    return this.a[x] === this.b[y];
  }

  public computeDiff(): DiffOperation[] {
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
    const operations = this.backtrack(trace);
    return this.cleanupOperations(operations);
  }

  private cleanupOperations(operations: DiffOperation[]): DiffOperation[] {
    const ops = operations.map((op) => ({ ...op }));

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 1; i < ops.length; i++) {
        const prev = ops[i - 1];
        const cur = ops[i];
        if (
          cur.type === 'delete' &&
          prev.type === 'equal' &&
          prev.content === cur.content &&
          cur.oldLineNum !== null &&
          prev.oldLineNum !== null
        ) {
          const followedByInsert = i + 1 < ops.length && ops[i + 1].type === 'insert';
          if (followedByInsert) continue;

          const prevOld = prev.oldLineNum;
          prev.oldLineNum = cur.oldLineNum;
          cur.oldLineNum = prevOld;

          ops[i - 1] = cur;
          ops[i] = prev;
          changed = true;
        }
      }
    }

    for (let i = 0; i + 1 < ops.length; i++) {
      if (ops[i].type === 'insert' && ops[i + 1].type === 'delete') {
        const tmp = ops[i];
        ops[i] = ops[i + 1];
        ops[i + 1] = tmp;
      }
    }

    return ops;
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
  const operations = myers.computeDiff();
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
