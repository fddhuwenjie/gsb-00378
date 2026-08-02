import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  MyersDiff,
  computeLineDiff,
  diffLines,
  splitLines,
  joinLines,
} from '../../api/algorithms/myersDiff.js';
import type { DiffOperation, LineDiff } from '@shared/types';
import { toLF } from '../../api/utils/lineUtils.js';

type AnyDiffOp = DiffOperation | LineDiff;

function reconstruct(ops: AnyDiffOp[]): { old: string[]; next: string[] } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      oldLines.push(op.content);
      newLines.push(op.content);
    } else if (op.type === 'delete') {
      oldLines.push(op.content);
    } else if (op.type === 'insert') {
      newLines.push(op.content);
    } else if (op.type === 'modify') {
      newLines.push(op.content);
    }
  }
  return { old: oldLines, next: newLines };
}

describe('[REGRESSION][DIFF] empty inputs', () => {
  test('two empty arrays produce no operations (regression)', () => {
    const ops = new MyersDiff([], []).computeDiff();
    assert.deepEqual(ops, []);
  });

  test('empty to non-empty produces only inserts (regression)', () => {
    const ops = new MyersDiff([], ['a', 'b']).computeDiff();
    assert.equal(ops.length, 2);
    assert.ok(ops.every((o) => o.type === 'insert'));
    assert.deepEqual(
      ops.map((o) => o.content),
      ['a', 'b']
    );
  });

  test('non-empty to empty produces only deletes (regression)', () => {
    const ops = new MyersDiff(['a', 'b'], []).computeDiff();
    assert.equal(ops.length, 2);
    assert.ok(ops.every((o) => o.type === 'delete'));
  });

  test('empty string splitLines returns empty array (regression)', () => {
    assert.deepEqual(splitLines(''), []);
    assert.equal(joinLines([]), '');
  });
});

describe('[REGRESSION][DIFF] line endings', () => {
  test('CRLF lines are preserved as raw tokens before normalization (regression)', () => {
    const lines = splitLines('a\r\nb\r\nc');
    assert.deepEqual(lines, ['a\r', 'b\r', 'c']);
  });

  test('LF text round-trips through split/join exactly (regression)', () => {
    const text = 'line1\nline2\nline3';
    assert.equal(joinLines(splitLines(text)), text);
  });

  test('single line without trailing newline round-trips (regression)', () => {
    assert.equal(joinLines(splitLines('only')), 'only');
  });

  test('toLF normalizes CRLF and CR to LF (regression)', () => {
    assert.equal(toLF('a\r\nb\r\nc'), 'a\nb\nc');
    assert.equal(toLF('a\rb\rc'), 'a\nb\nc');
    assert.equal(toLF('already\nlf'), 'already\nlf');
  });

  test('diff on CRLF-normalized text yields shortest edit script (regression)', () => {
    const a = toLF('line1\r\nline2\r\nline3');
    const b = toLF('line1\r\nCHANGED\r\nline3');
    const ops = diffLines(a, b);
    const { old: ro, next: rn } = reconstruct(ops);
    assert.deepEqual(ro, ['line1', 'line2', 'line3']);
    assert.deepEqual(rn, ['line1', 'CHANGED', 'line3']);
  });
});

describe('[REGRESSION][DIFF] duplicate lines', () => {
  test('duplicate lines: insert before deletes does not collapse into wrong edit (regression)', () => {
    const base = ['dup', 'dup', 'dup', 'dup'];
    const local = ['FIRST', 'dup', 'dup', 'dup'];
    const ops = new MyersDiff(base, local).computeDiff();
    const { old, next } = reconstruct(ops);
    assert.deepEqual(old, base);
    assert.deepEqual(next, local);
  });

  test('duplicate lines: replace at end is anchored correctly (regression)', () => {
    const base = ['dup', 'dup', 'dup', 'dup'];
    const remote = ['dup', 'dup', 'dup', 'LAST'];
    const ops = new MyersDiff(base, remote).computeDiff();
    const { old, next } = reconstruct(ops);
    assert.deepEqual(old, base);
    assert.deepEqual(next, remote);
  });

  test('all-identical lines with one middle replacement yields a minimum edit script (regression)', () => {
    const a = ['x', 'x', 'x'];
    const b = ['x', 'Y', 'x'];
    const diffs = computeLineDiff(a, b);
    const { old, next } = reconstruct(diffs);
    assert.deepEqual(old, a, 'old side must reconstruct the source');
    assert.deepEqual(next, b, 'new side must reconstruct the target');
    const editOps = diffs.filter((d) => d.type !== 'equal');
    assert.equal(editOps.length, 2, 'replacing one of three identical lines needs exactly 2 edits');
    assert.ok(
      editOps.every((d) => d.type === 'insert' || d.type === 'delete' || d.type === 'modify'),
      'edit operations must be insert/delete/modify'
    );
  });

  test('adjacent delete+insert on distinct lines collapses into modify (regression)', () => {
    const diffs = computeLineDiff(['old', 'keep'], ['new', 'keep']);
    const modify = diffs.filter((d) => d.type === 'modify');
    assert.equal(modify.length, 1);
    assert.equal(modify[0].content, 'new');
    assert.equal(diffs[diffs.length - 1].type, 'equal');
  });
});

describe('[REGRESSION][DIFF] invalid input handling', () => {
  test('null/undefined source arrays fail fast without returning a bogus diff (regression)', () => {
    assert.throws(() => {
      new MyersDiff(null as unknown as string[], []).computeDiff();
    });
    assert.throws(() => {
      new MyersDiff(undefined as unknown as string[], []).computeDiff();
    });
  });

  test('computeLineDiff collapses adjacent delete+insert into modify (regression)', () => {
    const diffs = computeLineDiff(['old'], ['new']);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].type, 'modify');
    assert.equal(diffs[0].content, 'new');
  });

  test('diff output line numbers are monotonically valid (regression)', () => {
    const cases: Array<[string, string]> = [
      ['', 'x'],
      ['a\nb\nc', ''],
      ['a\nb\nc', 'a\nB\nc'],
      ['x\nx\nx', 'x\nY\nx'],
    ];
    for (const [a, b] of cases) {
      const ops = diffLines(a, b);
      let lastOld = -1;
      let lastNew = -1;
      for (const op of ops) {
        if (op.oldLineNum !== null) {
          assert.ok(op.oldLineNum > lastOld, `${a} -> ${b}: oldLineNum must increase`);
          lastOld = op.oldLineNum;
        }
        if (op.newLineNum !== null) {
          assert.ok(op.newLineNum > lastNew, `${a} -> ${b}: newLineNum must increase`);
          lastNew = op.newLineNum;
        }
      }
    }
  });
});
