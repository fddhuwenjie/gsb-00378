import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MyersDiff, computeLineDiff, splitLines, joinLines, diffLines } from '../../api/algorithms/myersDiff';
import { toLF } from '../../api/utils/lineUtils';

interface DiffCase {
  name: string;
  a: string[];
  b: string[];
  ops: Array<{ type: 'equal' | 'insert' | 'delete'; content: string }>;
}

const diffCases: DiffCase[] = [
  {
    name: 'both empty',
    a: [],
    b: [],
    ops: [],
  },
  {
    name: 'empty a inserts all b lines',
    a: [],
    b: ['a', 'b'],
    ops: [
      { type: 'insert', content: 'a' },
      { type: 'insert', content: 'b' },
    ],
  },
  {
    name: 'empty b deletes all a lines',
    a: ['x', 'y'],
    b: [],
    ops: [
      { type: 'delete', content: 'x' },
      { type: 'delete', content: 'y' },
    ],
  },
  {
    name: 'identical single line',
    a: ['same'],
    b: ['same'],
    ops: [{ type: 'equal', content: 'same' }],
  },
  {
    name: 'identical multiple lines',
    a: ['a', 'b', 'c'],
    b: ['a', 'b', 'c'],
    ops: [
      { type: 'equal', content: 'a' },
      { type: 'equal', content: 'b' },
      { type: 'equal', content: 'c' },
    ],
  },
  {
    name: 'modify one line in middle',
    a: ['a', 'b', 'c'],
    b: ['a', 'B', 'c'],
    ops: [
      { type: 'equal', content: 'a' },
      { type: 'delete', content: 'b' },
      { type: 'insert', content: 'B' },
      { type: 'equal', content: 'c' },
    ],
  },
  {
    name: 'insert line at start',
    a: ['b', 'c'],
    b: ['a', 'b', 'c'],
    ops: [
      { type: 'insert', content: 'a' },
      { type: 'equal', content: 'b' },
      { type: 'equal', content: 'c' },
    ],
  },
  {
    name: 'insert line in middle',
    a: ['a', 'c'],
    b: ['a', 'b', 'c'],
    ops: [
      { type: 'equal', content: 'a' },
      { type: 'insert', content: 'b' },
      { type: 'equal', content: 'c' },
    ],
  },
  {
    name: 'insert line at end',
    a: ['a', 'b'],
    b: ['a', 'b', 'c'],
    ops: [
      { type: 'equal', content: 'a' },
      { type: 'equal', content: 'b' },
      { type: 'insert', content: 'c' },
    ],
  },
  {
    name: 'delete line at start',
    a: ['a', 'b', 'c'],
    b: ['b', 'c'],
    ops: [
      { type: 'delete', content: 'a' },
      { type: 'equal', content: 'b' },
      { type: 'equal', content: 'c' },
    ],
  },
  {
    name: 'delete line in middle',
    a: ['a', 'b', 'c'],
    b: ['a', 'c'],
    ops: [
      { type: 'equal', content: 'a' },
      { type: 'delete', content: 'b' },
      { type: 'equal', content: 'c' },
    ],
  },
  {
    name: 'delete line at end',
    a: ['a', 'b', 'c'],
    b: ['a', 'b'],
    ops: [
      { type: 'equal', content: 'a' },
      { type: 'equal', content: 'b' },
      { type: 'delete', content: 'c' },
    ],
  },
  {
    name: 'duplicate lines modify the second occurrence',
    a: ['x', 'x', 'x'],
    b: ['x', 'y', 'x'],
    ops: [
      { type: 'equal', content: 'x' },
      { type: 'delete', content: 'x' },
      { type: 'insert', content: 'y' },
      { type: 'equal', content: 'x' },
    ],
  },
  {
    name: 'unicode content',
    a: ['你好', '世界'],
    b: ['你好', 'world'],
    ops: [
      { type: 'equal', content: '你好' },
      { type: 'delete', content: '世界' },
      { type: 'insert', content: 'world' },
    ],
  },
  {
    name: 'empty string lines are distinguished',
    a: ['a', '', 'c'],
    b: ['a', 'b', 'c'],
    ops: [
      { type: 'equal', content: 'a' },
      { type: 'delete', content: '' },
      { type: 'insert', content: 'b' },
      { type: 'equal', content: 'c' },
    ],
  },
  {
    name: 'completely different content',
    a: ['one', 'two'],
    b: ['three', 'four'],
    ops: [
      { type: 'delete', content: 'one' },
      { type: 'delete', content: 'two' },
      { type: 'insert', content: 'three' },
      { type: 'insert', content: 'four' },
    ],
  },
];

describe('diff: MyersDiff.computeDiff table-driven cases', () => {
  for (const tc of diffCases) {
    it(tc.name, () => {
      const ops = new MyersDiff(tc.a, tc.b).computeDiff();
      const compact = ops.map((o) => ({ type: o.type, content: o.content }));
      assert.deepEqual(compact, tc.ops);
    });
  }

  it('produces monotonically increasing line numbers', () => {
    const ops = new MyersDiff(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'y']).computeDiff();
    let lastOld = -1;
    let lastNew = -1;
    for (const op of ops) {
      if (op.oldLineNum !== null) {
        assert.ok(op.oldLineNum > lastOld, `oldLineNum ${op.oldLineNum} must be > ${lastOld}`);
        lastOld = op.oldLineNum;
      }
      if (op.newLineNum !== null) {
        assert.ok(op.newLineNum > lastNew, `newLineNum ${op.newLineNum} must be > ${lastNew}`);
        lastNew = op.newLineNum;
      }
    }
  });

  it('insert line numbers point into b, delete into a', () => {
    const ops = new MyersDiff(['a', 'b'], ['a', 'c']).computeDiff();
    const del = ops.find((o) => o.type === 'delete')!;
    const ins = ops.find((o) => o.type === 'insert')!;
    assert.equal(del.oldLineNum, 1);
    assert.equal(del.newLineNum, null);
    assert.equal(ins.oldLineNum, null);
    assert.equal(ins.newLineNum, 1);
  });
});

describe('diff: splitLines / joinLines round-trip', () => {
  const cases = [
    { name: 'empty string', text: '' },
    { name: 'single line no newline', text: 'hello' },
    { name: 'single line with newline', text: 'hello\n' },
    { name: 'multiple lines with trailing newline', text: 'a\nb\nc\n' },
    { name: 'multiple lines no trailing newline', text: 'a\nb\nc' },
    { name: 'blank lines preserved', text: '\n\n\n' },
    { name: 'unicode text', text: '你好\n世界\n' },
    { name: 'crlf is normalized before splitting by caller', text: 'a\r\nb\n' },
  ];

  for (const tc of cases) {
    it(tc.name, () => {
      const normalized = toLF(tc.text);
      assert.equal(joinLines(splitLines(normalized)), normalized);
    });
  }

  it('splitLines of empty string returns empty array', () => {
    assert.deepEqual(splitLines(''), []);
  });

  it('splitLines keeps the phantom empty line for trailing newline', () => {
    assert.deepEqual(splitLines('a\n'), ['a', '']);
    assert.deepEqual(splitLines('a'), ['a']);
  });
});

describe('diff: computeLineDiff groups delete+insert into modify', () => {
  it('marks a replaced line as modify with new content', () => {
    const lineDiffs = computeLineDiff(['a', 'b', 'c'], ['a', 'B', 'c']);
    assert.deepEqual(
      lineDiffs.map((d) => d.type),
      ['equal', 'modify', 'equal'],
    );
    assert.equal(lineDiffs[1].content, 'B');
    assert.equal(lineDiffs[1].oldLineNum, 1);
    assert.equal(lineDiffs[1].newLineNum, 1);
  });

  it('keeps pure inserts and deletes separate', () => {
    const inserted = computeLineDiff(['a'], ['a', 'b']);
    assert.deepEqual(
      inserted.map((d) => d.type),
      ['equal', 'insert'],
    );
    const deleted = computeLineDiff(['a', 'b'], ['a']);
    assert.deepEqual(
      deleted.map((d) => d.type),
      ['equal', 'delete'],
    );
  });
});

describe('diff: diffLines string entry point', () => {
  it('diffs multiline strings', () => {
    const ops = diffLines('a\nb', 'a\nc');
    assert.deepEqual(
      ops.map((o) => `${o.type}:${o.content}`),
      ['equal:a', 'delete:b', 'insert:c'],
    );
  });
});
