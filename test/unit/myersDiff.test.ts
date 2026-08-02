import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MyersDiff,
  computeLineDiff,
  diffLines,
  splitLines,
  joinLines,
} from '../../api/algorithms/myersDiff.js';

function applyOperations(ops: ReturnType<typeof diffLines>): { old: string[]; next: string[] } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      assert.equal(op.oldLineNum !== null, true, 'equal op must have oldLineNum');
      assert.equal(op.newLineNum !== null, true, 'equal op must have newLineNum');
      oldLines.push(op.content);
      newLines.push(op.content);
    } else if (op.type === 'delete') {
      oldLines.push(op.content);
    } else if (op.type === 'insert') {
      newLines.push(op.content);
    }
  }
  return { old: oldLines, next: newLines };
}

interface DiffCase {
  name: string;
  a: string[];
  b: string[];
}

const arrayCases: DiffCase[] = [
  { name: 'both empty arrays', a: [], b: [] },
  { name: 'empty source to three lines', a: [], b: ['x', 'y', 'z'] },
  { name: 'three lines to empty target', a: ['x', 'y', 'z'], b: [] },
  { name: 'identical single line', a: ['hello'], b: ['hello'] },
  { name: 'one line modified in three', a: ['a', 'b', 'c'], b: ['a', 'B', 'c'] },
  { name: 'line inserted at start', a: ['b', 'c'], b: ['a', 'b', 'c'] },
  { name: 'line inserted at end', a: ['a', 'b'], b: ['a', 'b', 'c'] },
  { name: 'line deleted in middle', a: ['a', 'b', 'c'], b: ['a', 'c'] },
  { name: 'duplicate lines preserved', a: ['x', 'x', 'x'], b: ['x', 'y', 'x', 'x'] },
  { name: 'unicode lines', a: ['第一行', '第二行'], b: ['第一行', '第三行', '第二行'] },
  { name: 'disjoint replacements', a: ['1', '2', '3', '4'], b: ['1', 'two', '3', 'four'] },
  { name: 'CRLF lines preserved as raw tokens', a: ['a\r', 'b\r'], b: ['a\r', 'c\r', 'b\r'] },
];

test('MyersDiff array cases reconstruct inputs and produce shortest edits', () => {
  for (const tc of arrayCases) {
    const ops = new MyersDiff(tc.a, tc.b).computeDiff();
    const reconstructed = applyOperations(ops);
    assert.deepEqual(reconstructed.old, tc.a, `${tc.name}: old lines must reconstruct`);
    assert.deepEqual(reconstructed.next, tc.b, `${tc.name}: new lines must reconstruct`);

    const editCount = ops.filter((o) => o.type !== 'equal').length;
    const lowerBound = (() => {
      const lcs = longestCommonSubsequence(tc.a, tc.b);
      return tc.a.length + tc.b.length - 2 * lcs;
    })();
    assert.equal(
      editCount,
      lowerBound,
      `${tc.name}: edit distance ${editCount} should equal LCS bound ${lowerBound}`
    );
  }
});

test('computeLineDiff collapses adjacent delete+insert into modify', () => {
  const diffs = computeLineDiff(['a', 'b'], ['a', 'B']);
  const modify = diffs.find((d) => d.type === 'modify');
  assert.ok(modify, 'expected a modify operation');
  assert.equal(modify!.content, 'B');
  assert.deepEqual(
    diffs.map((d) => d.type),
    ['equal', 'modify']
  );
});

interface TextCase {
  name: string;
  a: string;
  b: string;
  expectedA: string[];
  expectedB: string[];
  expectEqual: boolean;
}

const textCases: TextCase[] = [
  { name: 'empty text both', a: '', b: '', expectedA: [], expectedB: [], expectEqual: true },
  {
    name: 'no trailing newline single line',
    a: 'only',
    b: 'only',
    expectedA: ['only'],
    expectedB: ['only'],
    expectEqual: true,
  },
  {
    name: 'no trailing newline modified',
    a: 'old',
    b: 'new',
    expectedA: ['old'],
    expectedB: ['new'],
    expectEqual: false,
  },
  {
    name: 'CRLF raw text is not silently normalized',
    a: 'a\r\nb',
    b: 'a\r\nb',
    expectedA: ['a\r', 'b'],
    expectedB: ['a\r', 'b'],
    expectEqual: true,
  },
  {
    name: 'duplicate repeated lines',
    a: 'x\nx\nx',
    b: 'x\nx\nx',
    expectedA: ['x', 'x', 'x'],
    expectedB: ['x', 'x', 'x'],
    expectEqual: true,
  },
  {
    name: 'unicode content',
    a: '你好\n世界',
    b: '你好\n世界',
    expectedA: ['你好', '世界'],
    expectedB: ['你好', '世界'],
    expectEqual: true,
  },
];

test('diffLines/splitLines handle text edge cases', () => {
  for (const tc of textCases) {
    assert.deepEqual(splitLines(tc.a), tc.expectedA, `${tc.name}: split a`);
    assert.deepEqual(splitLines(tc.b), tc.expectedB, `${tc.name}: split b`);
    const ops = diffLines(tc.a, tc.b);
    const reconstructed = applyOperations(ops);
    assert.deepEqual(reconstructed.old, tc.expectedA, `${tc.name}: reconstruct old`);
    assert.deepEqual(reconstructed.next, tc.expectedB, `${tc.name}: reconstruct new`);
    if (tc.expectEqual) {
      assert.equal(ops.every((o) => o.type === 'equal'), true, `${tc.name}: all equal`);
    }
  }
});

test('joinLines is the inverse of splitLines for LF text', () => {
  const text = 'alpha\nbeta\ngamma';
  assert.equal(joinLines(splitLines(text)), text);
  assert.equal(joinLines(splitLines('')), '');
  assert.equal(joinLines(splitLines('single')), 'single');
});

function longestCommonSubsequence(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[a.length][b.length];
}
