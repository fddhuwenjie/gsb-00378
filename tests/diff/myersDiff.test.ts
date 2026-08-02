/**
 * REGRESSION SUITE — category: diff (Myers diff)
 *
 * Every assertion here is either migrated verbatim from the previous suite or
 * added new. Expected values are hand-derived from the diff rules (an operation
 * stream that, when replayed, reconstructs each side), never copied from the
 * implementation's output. Run this category alone with `npm run test:diff`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MyersDiff,
  computeLineDiff,
  splitLines,
  joinLines,
} from '../../api/algorithms/myersDiff.ts';

/** Reconstruct the target (b) side from a diff op stream. */
function reconstructNew(ops: { type: string; content: string }[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.type === 'equal' || op.type === 'insert') out.push(op.content);
  }
  return out;
}

/** Reconstruct the source (a) side from a diff op stream. */
function reconstructOld(ops: { type: string; content: string }[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.type === 'equal' || op.type === 'delete') out.push(op.content);
  }
  return out;
}

function diff(a: string, b: string) {
  return new MyersDiff(splitLines(a), splitLines(b)).computeDiff();
}

describe('diff: splitLines / joinLines', () => {
  const cases: Array<{ name: string; text: string; expected: string[] }> = [
    { name: 'empty file yields no lines', text: '', expected: [] },
    { name: 'single line without newline', text: 'abc', expected: ['abc'] },
    { name: 'no trailing newline', text: 'a\nb', expected: ['a', 'b'] },
    {
      name: 'trailing newline produces a trailing empty line',
      text: 'a\nb\n',
      expected: ['a', 'b', ''],
    },
    {
      name: 'duplicate lines are all preserved',
      text: 'x\nx\nx',
      expected: ['x', 'x', 'x'],
    },
    {
      name: 'unicode lines are preserved verbatim',
      text: 'café\n😀\nΩ',
      expected: ['café', '😀', 'Ω'],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      assert.deepEqual(splitLines(c.text), c.expected);
    });
  }

  it('joinLines is the inverse of splitLines for non-empty text', () => {
    const samples = ['a\nb', 'a\nb\n', 'x\nx\nx', 'café\n😀'];
    for (const s of samples) {
      assert.equal(joinLines(splitLines(s)), s);
    }
  });
});

describe('diff: MyersDiff.computeDiff — table driven', () => {
  interface Case {
    name: string;
    a: string;
    b: string;
    expected: Array<{ type: string; content: string }>;
  }

  const cases: Case[] = [
    {
      name: 'empty to empty produces no operations',
      a: '',
      b: '',
      expected: [],
    },
    {
      name: 'empty to content is all inserts',
      a: '',
      b: 'a\nb',
      expected: [
        { type: 'insert', content: 'a' },
        { type: 'insert', content: 'b' },
      ],
    },
    {
      name: 'content to empty is all deletes',
      a: 'a\nb',
      b: '',
      expected: [
        { type: 'delete', content: 'a' },
        { type: 'delete', content: 'b' },
      ],
    },
    {
      name: 'identical inputs are all equal',
      a: 'a\nb\nc',
      b: 'a\nb\nc',
      expected: [
        { type: 'equal', content: 'a' },
        { type: 'equal', content: 'b' },
        { type: 'equal', content: 'c' },
      ],
    },
    {
      name: 'single line change is delete+insert',
      a: 'a\nb\nc',
      b: 'a\nB\nc',
      expected: [
        { type: 'equal', content: 'a' },
        { type: 'delete', content: 'b' },
        { type: 'insert', content: 'B' },
        { type: 'equal', content: 'c' },
      ],
    },
    {
      name: 'appended duplicate line is a single insert',
      a: 'x\nx\nx',
      b: 'x\nx\nx\nx',
      expected: [
        { type: 'equal', content: 'x' },
        { type: 'equal', content: 'x' },
        { type: 'equal', content: 'x' },
        { type: 'insert', content: 'x' },
      ],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const ops = diff(c.a, c.b).map((op) => ({ type: op.type, content: op.content }));
      assert.deepEqual(ops, c.expected);
    });
  }
});

describe('diff: MyersDiff.computeDiff — reconstruction invariant', () => {
  const pairs: Array<{ name: string; a: string; b: string }> = [
    { name: 'no trailing newline', a: 'a\nb\nc', b: 'a\nb\nc\nd' },
    { name: 'trailing newline difference', a: 'a\nb', b: 'a\nb\n' },
    { name: 'duplicate lines rearranged', a: 'x\nx\ny\nx', b: 'x\ny\nx\nx' },
    { name: 'unicode edits', a: 'café\n😀\nΩ', b: 'cafe\n😀\nΩ\n!' },
    { name: 'full replacement', a: 'a\nb\nc', b: 'x\ny\nz' },
  ];

  for (const p of pairs) {
    it(`${p.name}: reconstructs both sides exactly`, () => {
      const ops = diff(p.a, p.b);
      assert.deepEqual(reconstructOld(ops), splitLines(p.a), 'old side mismatch');
      assert.deepEqual(reconstructNew(ops), splitLines(p.b), 'new side mismatch');
    });
  }
});

describe('diff: computeLineDiff', () => {
  it('collapses a delete+insert pair into a single modify', () => {
    const diffs = computeLineDiff(splitLines('a\nb\nc'), splitLines('a\nB\nc'));
    assert.deepEqual(
      diffs.map((d) => ({ type: d.type, content: d.content, oldLineNum: d.oldLineNum, newLineNum: d.newLineNum })),
      [
        { type: 'equal', content: 'a', oldLineNum: 0, newLineNum: 0 },
        { type: 'modify', content: 'B', oldLineNum: 1, newLineNum: 1 },
        { type: 'equal', content: 'c', oldLineNum: 2, newLineNum: 2 },
      ]
    );
  });

  it('reports standalone inserts and deletes', () => {
    const inserts = computeLineDiff(splitLines('a'), splitLines('a\nb'));
    assert.deepEqual(inserts.map((d) => d.type), ['equal', 'insert']);

    const deletes = computeLineDiff(splitLines('a\nb'), splitLines('a'));
    assert.deepEqual(deletes.map((d) => d.type), ['equal', 'delete']);
  });
});

describe('diff: repeated execution is deterministic', () => {
  // Rule: a pure diff must return byte-identical results across repeated calls
  // and across independent instances for the same input.
  const pairs: Array<{ a: string; b: string }> = [
    { a: 'a\nb\nc', b: 'a\nB\nc' },
    { a: 'x\nx\nx', b: 'x\nx\nx\nx' },
    { a: 'café\n😀', b: 'cafe\n😀\n!' },
    { a: '', b: 'a\nb' },
  ];

  for (const p of pairs) {
    it(`same input diffs identically on repeat: ${JSON.stringify(p)}`, () => {
      const first = diff(p.a, p.b);
      const second = diff(p.a, p.b);
      const third = new MyersDiff(splitLines(p.a), splitLines(p.b)).computeDiff();
      assert.deepEqual(second, first);
      assert.deepEqual(third, first);
    });
  }

  it('a single MyersDiff instance yields the same result when re-run', () => {
    const engine = new MyersDiff(splitLines('a\nb\nc\nd'), splitLines('a\nX\nc\nd'));
    const first = engine.computeDiff();
    const second = engine.computeDiff();
    assert.deepEqual(second, first);
  });
});

describe('diff: degenerate / edge inputs', () => {
  it('diff of identical empty inputs is an empty op stream', () => {
    assert.deepEqual(diff('', ''), []);
  });

  it('diff treats a lone trailing newline as an inserted empty line', () => {
    // 'a' -> ['a']; 'a\n' -> ['a', '']. The rule: one appended empty line.
    const ops = diff('a', 'a\n').map((o) => ({ type: o.type, content: o.content }));
    assert.deepEqual(ops, [
      { type: 'equal', content: 'a' },
      { type: 'insert', content: '' },
    ]);
  });
});
