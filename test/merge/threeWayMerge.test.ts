import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge';

interface MergeCase {
  name: string;
  base: string;
  local: string;
  remote: string;
  merged: string;
  conflictCount: number;
}

const C_START = '<<<<<<< local';
const C_SEP = '=======';
const C_END = '>>>>>>> remote';

function block(local: string, remote: string): string {
  return `${C_START}\n${local}\n${C_SEP}\n${remote}\n${C_END}`;
}

const mergeCases: MergeCase[] = [
  {
    name: 'all three empty strings',
    base: '',
    local: '',
    remote: '',
    merged: '',
    conflictCount: 0,
  },
  {
    name: 'all identical multiline',
    base: 'a\nb\nc',
    local: 'a\nb\nc',
    remote: 'a\nb\nc',
    merged: 'a\nb\nc',
    conflictCount: 0,
  },
  {
    name: 'empty base, both sides add identical content auto-resolves',
    base: '',
    local: 'x',
    remote: 'x',
    merged: 'x',
    conflictCount: 0,
  },
  {
    name: 'empty base, sides add different content conflicts',
    base: '',
    local: 'x',
    remote: 'y',
    merged: block('x', 'y'),
    conflictCount: 1,
  },
  {
    name: 'no trailing newline: only local adds a trailing newline',
    base: 'a',
    local: 'a\n',
    remote: 'a',
    merged: 'a\n',
    conflictCount: 0,
  },
  {
    name: 'no trailing newline: both sides add a trailing newline identically',
    base: 'a',
    local: 'a\n',
    remote: 'a\n',
    merged: 'a\n',
    conflictCount: 0,
  },
  {
    name: 'CRLF inputs are normalized and merged cleanly',
    base: 'a\r\nb\r\n',
    local: 'a\r\nB\r\n',
    remote: 'a\r\nb\r\n',
    merged: 'a\nB\n',
    conflictCount: 0,
  },
  {
    name: 'duplicate lines: only local changes the second occurrence',
    base: 'x\nx\nx\n',
    local: 'x\ny\nx\n',
    remote: 'x\nx\nx\n',
    merged: 'x\ny\nx\n',
    conflictCount: 0,
  },
  {
    name: 'duplicate lines: sides change different occurrences disjointly',
    base: 'x\nx\nx\n',
    local: 'y\nx\nx\n',
    remote: 'x\nx\nz\n',
    merged: 'y\nx\nz\n',
    conflictCount: 0,
  },
  {
    name: 'unicode content merged cleanly',
    base: '你好\n世界',
    local: '你好\nworld',
    remote: '你好\n世界',
    merged: '你好\nworld',
    conflictCount: 0,
  },
  {
    name: 'only local changes, remote equals base',
    base: 'a\nb\nc',
    local: 'a\nB\nc',
    remote: 'a\nb\nc',
    merged: 'a\nB\nc',
    conflictCount: 0,
  },
  {
    name: 'only remote changes, local equals base',
    base: 'a\nb\nc',
    local: 'a\nb\nc',
    remote: 'a\nb\nC',
    merged: 'a\nb\nC',
    conflictCount: 0,
  },
  {
    name: 'both sides make the identical change auto-resolves',
    base: 'a\nb',
    local: 'a\nB',
    remote: 'a\nB',
    merged: 'a\nB',
    conflictCount: 0,
  },
  {
    name: 'both sides delete the same line auto-resolves',
    base: 'a\nb',
    local: 'b',
    remote: 'b',
    merged: 'b',
    conflictCount: 0,
  },
  {
    name: 'disjoint modifications at start and end are both preserved',
    base: 'a\nb\nc\nd',
    local: 'A\nb\nc\nd',
    remote: 'a\nb\nc\nD',
    merged: 'A\nb\nc\nD',
    conflictCount: 0,
  },
  {
    name: 'disjoint modifications around unchanged middle are both preserved',
    base: 'a\nb\nc\nd\ne',
    local: 'X\nb\nc\nd\ne',
    remote: 'a\nb\nc\nd\nY',
    merged: 'X\nb\nc\nd\nY',
    conflictCount: 0,
  },
  {
    name: 'both sides change the same line differently conflicts',
    base: 'a\nb',
    local: 'a\nL',
    remote: 'a\nR',
    merged: `a\n${block('L', 'R')}`,
    conflictCount: 1,
  },
  {
    name: 'one side deletes while the other modifies the same line conflicts',
    base: 'a',
    local: '',
    remote: 'b',
    merged: `${C_START}\n${C_SEP}\nb\n${C_END}`,
    conflictCount: 1,
  },
  {
    name: 'two non-overlapping conflicts are both reported',
    base: 'a\nb\nc\nd',
    local: 'L\nb\nL2\nd',
    remote: 'R\nb\nR2\nd',
    merged: `${block('L', 'R')}\nb\n${block('L2', 'R2')}\nd`,
    conflictCount: 2,
  },
];

describe('merge: performThreeWayMerge table-driven cases', () => {
  for (const tc of mergeCases) {
    it(tc.name, () => {
      const result = performThreeWayMerge(tc.base, tc.local, tc.remote);
      assert.equal(result.mergedContent, tc.merged, `mergedContent mismatch for: ${tc.name}`);
      assert.equal(result.hasConflicts, tc.conflictCount > 0, `hasConflicts mismatch for: ${tc.name}`);
      assert.equal(result.conflictCount, tc.conflictCount, `conflictCount mismatch for: ${tc.name}`);
      assert.equal(result.conflicts.length, tc.conflictCount, `conflicts.length mismatch for: ${tc.name}`);
      assert.ok(Array.isArray(result.diffs.baseToLocal));
      assert.ok(Array.isArray(result.diffs.baseToRemote));
    });
  }
});

describe('merge: conflict object shape', () => {
  it('exposes localContent, remoteContent, baseContent and a unique id per conflict', () => {
    const result = performThreeWayMerge('a\nb', 'a\nL', 'a\nR');
    assert.equal(result.conflicts.length, 1);
    const c = result.conflicts[0];
    assert.equal(typeof c.id, 'string');
    assert.ok(c.id.length > 0);
    assert.deepEqual(c.localContent, ['L']);
    assert.deepEqual(c.remoteContent, ['R']);
    assert.deepEqual(c.baseContent, ['b']);
    assert.equal(c.resolved, false);
    assert.equal(c.resolution, null);
  });

  it('assigns distinct ids to distinct conflicts', () => {
    const result = performThreeWayMerge('a\nb\nc\nd', 'L\nb\nL2\nd', 'R\nb\nR2\nd');
    const ids = result.conflicts.map((c) => c.id);
    assert.equal(new Set(ids).size, 2, 'conflict ids must be unique');
  });

  it('does not include CRLF in normalized output', () => {
    const result = performThreeWayMerge('a\r\nb', 'a\r\nL', 'a\r\nR');
    assert.ok(!result.mergedContent.includes('\r'));
  });
});
