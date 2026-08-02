import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge';
import { toLF } from '../../api/utils/lineUtils';

const C_START = '<<<<<<< local';
const C_SEP = '=======';
const C_END = '>>>>>>> remote';

function block(local: string, remote: string): string {
  return `${C_START}\n${local}\n${C_SEP}\n${remote}\n${C_END}`;
}

interface RepeatCase {
  name: string;
  base: string;
  local: string;
  remote: string;
  expected: string;
  conflictCount: number;
}

const repeatCases: RepeatCase[] = [
  {
    name: 'all empty',
    base: '',
    local: '',
    remote: '',
    expected: '',
    conflictCount: 0,
  },
  {
    name: 'only local changes (no trailing newline edge)',
    base: 'a',
    local: 'a\n',
    remote: 'a',
    expected: 'a\n',
    conflictCount: 0,
  },
  {
    name: 'CRLF normalized clean merge',
    base: 'a\r\nb\r\n',
    local: 'a\r\nB\r\n',
    remote: 'a\r\nb\r\n',
    expected: 'a\nB\n',
    conflictCount: 0,
  },
  {
    name: 'duplicate lines change different occurrences',
    base: 'x\nx\nx\n',
    local: 'y\nx\nx\n',
    remote: 'x\nx\nz\n',
    expected: 'y\nx\nz\n',
    conflictCount: 0,
  },
  {
    name: 'disjoint start and end preserved',
    base: 'a\nb\nc\nd',
    local: 'A\nb\nc\nd',
    remote: 'a\nb\nc\nD',
    expected: 'A\nb\nc\nD',
    conflictCount: 0,
  },
  {
    name: 'two conflicts stable',
    base: 'a\nb\nc\nd',
    local: 'L\nb\nL2\nd',
    remote: 'R\nb\nR2\nd',
    expected: `${block('L', 'R')}\nb\n${block('L2', 'R2')}\nd`,
    conflictCount: 2,
  },
];

describe('merge: repeated execution is deterministic', () => {
  for (const tc of repeatCases) {
    it(`repeated merge gives same result: ${tc.name}`, () => {
      const first = performThreeWayMerge(tc.base, tc.local, tc.remote);
      assert.equal(first.mergedContent, tc.expected);
      assert.equal(first.conflictCount, tc.conflictCount);
      for (let run = 0; run < 3; run++) {
        const again = performThreeWayMerge(tc.base, tc.local, tc.remote);
        assert.deepEqual(again.mergedContent, first.mergedContent, `run ${run} mergedContent must match`);
        assert.deepEqual(again.conflictCount, first.conflictCount, `run ${run} conflictCount must match`);
        assert.deepEqual(again.hasConflicts, first.hasConflicts, `run ${run} hasConflicts must match`);
        assert.deepEqual(
          again.conflicts.map((c) => ({
            startLine: c.startLine,
            endLine: c.endLine,
            localContent: c.localContent,
            remoteContent: c.remoteContent,
            baseContent: c.baseContent,
          })),
          first.conflicts.map((c) => ({
            startLine: c.startLine,
            endLine: c.endLine,
            localContent: c.localContent,
            remoteContent: c.remoteContent,
            baseContent: c.baseContent,
          })),
          `run ${run} conflict positions must match`,
        );
      }
    });
  }
});

describe('merge: empty-input regression invariants', () => {
  it('does not throw when only base is non-empty and both sides delete everything identically', () => {
    const result = performThreeWayMerge('a\nb', '', '');
    assert.equal(result.hasConflicts, false);
    assert.equal(result.conflictCount, 0);
    assert.equal(result.mergedContent, '');
  });

  it('empty side against unchanged other side auto-merges', () => {
    const result = performThreeWayMerge('a', 'a', '');
    assert.equal(result.conflictCount, 0);
    assert.equal(result.mergedContent, '');
  });

  it('output never contains CRLF even when all inputs use CRLF', () => {
    const result = performThreeWayMerge('a\r\nb', 'a\r\nL', 'a\r\nR');
    assert.equal(result.mergedContent.includes('\r'), false);
    assert.equal(result.mergedContent, toLF(result.mergedContent));
  });
});
