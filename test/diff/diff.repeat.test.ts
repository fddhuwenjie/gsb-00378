import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MyersDiff, computeLineDiff, splitLines, joinLines } from '../../api/algorithms/myersDiff';
import { toLF } from '../../api/utils/lineUtils';

function compact(ops: { type: string; content: string }[]) {
  return ops.map((o) => `${o.type}:${o.content}`);
}

describe('diff: repeated execution is deterministic', () => {
  const samples: Array<{ name: string; a: string[]; b: string[] }> = [
    { name: 'empty both', a: [], b: [] },
    { name: 'empty a', a: [], b: ['x', 'y'] },
    { name: 'empty b', a: ['x', 'y'], b: [] },
    { name: 'duplicate lines', a: ['x', 'x', 'x'], b: ['x', 'y', 'x'] },
    { name: 'unicode', a: ['你好', '世界'], b: ['你好', '地球'] },
    { name: 'multi change', a: ['a', 'b', 'c', 'd'], b: ['A', 'b', 'c', 'D'] },
  ];

  for (const s of samples) {
    it(`computeDiff is stable across 3 runs: ${s.name}`, () => {
      const first = new MyersDiff(s.a, s.b).computeDiff();
      for (let run = 0; run < 3; run++) {
        const again = new MyersDiff(s.a, s.b).computeDiff();
        assert.deepEqual(again, first, `run ${run} must match the first run`);
      }
    });
  }

  it('computeLineDiff is stable across repeated runs for duplicate lines', () => {
    const a = ['x', 'x', 'x', 'x'];
    const b = ['y', 'x', 'x', 'z'];
    const first = computeLineDiff(a, b).map((d) => `${d.type}:${d.content}`);
    for (let run = 0; run < 3; run++) {
      assert.deepEqual(computeLineDiff(a, b).map((d) => `${d.type}:${d.content}`), first);
    }
  });
});

describe('diff: duplicate-line alignment regression', () => {
  it('changing the first of three equal lines anchors the delete to index 0', () => {
    const ops = new MyersDiff(['x', 'x', 'x'], ['y', 'x', 'x']).computeDiff();
    const del = ops.find((o) => o.type === 'delete')!;
    const ins = ops.find((o) => o.type === 'insert')!;
    assert.equal(del.oldLineNum, 0, 'delete must target the first base line, not the last');
    assert.equal(ins.newLineNum, 0);
    assert.deepEqual(compact(ops), ['delete:x', 'insert:y', 'equal:x', 'equal:x']);
  });

  it('changing the last of three equal lines anchors the delete to index 2', () => {
    const ops = new MyersDiff(['x', 'x', 'x'], ['x', 'x', 'y']).computeDiff();
    const del = ops.find((o) => o.type === 'delete')!;
    const ins = ops.find((o) => o.type === 'insert')!;
    assert.equal(del.oldLineNum, 2, 'delete must target the last base line');
    assert.equal(ins.newLineNum, 2);
    assert.deepEqual(compact(ops), ['equal:x', 'equal:x', 'delete:x', 'insert:y']);
  });

  it('changing the middle occurrence anchors the delete to index 1', () => {
    const ops = new MyersDiff(['x', 'x', 'x'], ['x', 'y', 'x']).computeDiff();
    const del = ops.find((o) => o.type === 'delete')!;
    assert.equal(del.oldLineNum, 1, 'delete must target the middle base line');
    assert.deepEqual(compact(ops), ['equal:x', 'delete:x', 'insert:y', 'equal:x']);
  });
});

describe('diff: line-ending regression', () => {
  it('CRLF input normalized to LF splits into the same lines as LF input', () => {
    const crlf = toLF('a\r\nb\r\nc\r\n');
    const lf = 'a\nb\nc\n';
    assert.deepEqual(splitLines(crlf), splitLines(lf));
    assert.equal(joinLines(splitLines(crlf)), lf);
  });

  it('CR-only input is normalized to LF by toLF', () => {
    assert.equal(toLF('a\rb\rc'), 'a\nb\nc');
  });

  it('a file with no trailing newline is not given one by joinLines', () => {
    const lines = splitLines('a\nb');
    assert.equal(joinLines(lines), 'a\nb');
  });

  it('a file ending with a newline preserves the trailing empty element round-trip', () => {
    const original = 'a\nb\n';
    assert.equal(joinLines(splitLines(original)), original);
  });
});

describe('diff: empty-input invariants', () => {
  it('diff of empty arrays has no operations and does not throw', () => {
    assert.deepEqual(new MyersDiff([], []).computeDiff(), []);
  });

  it('diff of empty string lines yields only inserts or only deletes, never equals', () => {
    const inserts = new MyersDiff([], ['a', 'b']).computeDiff();
    assert.ok(inserts.every((o) => o.type === 'insert'));
    assert.equal(inserts.length, 2);

    const deletes = new MyersDiff(['a', 'b'], []).computeDiff();
    assert.ok(deletes.every((o) => o.type === 'delete'));
    assert.equal(deletes.length, 2);
  });
});
