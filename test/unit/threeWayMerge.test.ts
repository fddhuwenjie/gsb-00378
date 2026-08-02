import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge.js';
import {
  parseConflictObjects,
  hasConflictMarkers,
} from '../../api/algorithms/conflictMarkers.js';

interface MergeCase {
  name: string;
  base: string;
  local: string;
  remote: string;
  expectConflict: boolean;
  expectMerged?: string;
  expectConflictCount?: number;
}

const cases: MergeCase[] = [
  {
    name: 'all three empty strings',
    base: '',
    local: '',
    remote: '',
    expectConflict: false,
    expectMerged: '',
    expectConflictCount: 0,
  },
  {
    name: 'empty base, identical non-empty local and remote auto-merges',
    base: '',
    local: 'created content',
    remote: 'created content',
    expectConflict: false,
    expectMerged: 'created content',
  },
  {
    name: 'empty base, different local and remote yields one conflict',
    base: '',
    local: 'local line',
    remote: 'remote line',
    expectConflict: true,
    expectConflictCount: 1,
  },
  {
    name: 'identical inputs produce identical output without conflicts',
    base: 'a\nb\nc',
    local: 'a\nb\nc',
    remote: 'a\nb\nc',
    expectConflict: false,
    expectMerged: 'a\nb\nc',
  },
  {
    name: 'single-side local change only',
    base: 'line1\nline2\nline3',
    local: 'line1\nLOCAL\nline3',
    remote: 'line1\nline2\nline3',
    expectConflict: false,
    expectMerged: 'line1\nLOCAL\nline3',
  },
  {
    name: 'single-side remote change only',
    base: 'line1\nline2\nline3',
    local: 'line1\nline2\nline3',
    remote: 'line1\nREMOTE\nline3',
    expectConflict: false,
    expectMerged: 'line1\nREMOTE\nline3',
  },
  {
    name: 'both sides make the same change, auto-merges',
    base: 'a\nb\nc',
    local: 'a\nB\nc',
    remote: 'a\nB\nc',
    expectConflict: false,
    expectMerged: 'a\nB\nc',
  },
  {
    name: 'disjoint changes at different lines are both preserved',
    base: 'a\nb\nc\nd',
    local: 'A\nb\nc\nd',
    remote: 'a\nb\nc\nD',
    expectConflict: false,
    expectMerged: 'A\nb\nc\nD',
  },
  {
    name: 'overlapping different edits produce a conflict',
    base: 'a\nb\nc',
    local: 'a\nLOCAL\nc',
    remote: 'a\nREMOTE\nc',
    expectConflict: true,
    expectConflictCount: 1,
  },
  {
    name: 'two disjoint conflicting regions produce two conflicts',
    base: 'a\nb\nc\nd\ne',
    local: 'L1\nb\nc\nd\nL5',
    remote: 'R1\nb\nc\nd\nR5',
    expectConflict: true,
    expectConflictCount: 2,
  },
  {
    name: 'no trailing newline single line',
    base: 'same',
    local: 'changed-local',
    remote: 'changed-remote',
    expectConflict: true,
    expectConflictCount: 1,
  },
  {
    name: 'CRLF inputs normalize to LF in merged output',
    base: 'x\r\ny\r\nz',
    local: 'X\r\ny\r\nz',
    remote: 'x\r\ny\r\nZ',
    expectConflict: false,
    expectMerged: 'X\ny\nZ',
  },
  {
    name: 'duplicate lines modified at a distinct position',
    base: 'dup\ndup\ndup',
    local: 'dup\nCHANGED\ndup',
    remote: 'dup\ndup\ndup',
    expectConflict: false,
    expectMerged: 'dup\nCHANGED\ndup',
  },
  {
    name: 'unicode lines merge by code points',
    base: '第一行\n第二行\n第三行',
    local: '第一行\n本地修改\n第三行',
    remote: '第一行\n远程修改\n第三行',
    expectConflict: true,
    expectConflictCount: 1,
  },
  {
    name: 'local deletes a line remote keeps',
    base: 'keep\ndelete\nkeep',
    local: 'keep\nkeep',
    remote: 'keep\ndelete\nkeep',
    expectConflict: false,
    expectMerged: 'keep\nkeep',
  },
];

test('three-way merge table-driven cases', () => {
  for (const tc of cases) {
    const result = performThreeWayMerge(tc.base, tc.local, tc.remote);

    assert.equal(
      result.hasConflicts,
      tc.expectConflict,
      `${tc.name}: hasConflicts mismatch`
    );
    assert.equal(
      result.conflictCount,
      result.conflicts.length,
      `${tc.name}: conflictCount must match conflicts array length`
    );

    if (tc.expectConflictCount !== undefined) {
      assert.equal(
        result.conflictCount,
        tc.expectConflictCount,
        `${tc.name}: expected ${tc.expectConflictCount} conflicts`
      );
    }

    if (tc.expectMerged !== undefined) {
      assert.equal(
        result.mergedContent,
        tc.expectMerged,
        `${tc.name}: merged content mismatch`
      );
    }

    for (const conflict of result.conflicts) {
      assert.match(conflict.id, /^conflict-[a-z0-9]+$/, `${tc.name}: conflict id format`);
      assert.ok(conflict.startLine >= 0, `${tc.name}: startLine >= 0`);
      assert.ok(conflict.endLine >= conflict.startLine, `${tc.name}: endLine >= startLine`);
      assert.equal(
        result.mergedContent.split('\n')[conflict.startLine],
        `<<<<<<< local:${conflict.id}`,
        `${tc.name}: start marker must embed the id`
      );
      assert.equal(
        result.mergedContent.split('\n')[conflict.endLine],
        `>>>>>>> remote:${conflict.id}`,
        `${tc.name}: end marker must embed the id`
      );
    }

    const reparsed = parseConflictObjects(result.mergedContent);
    assert.equal(
      reparsed.length,
      result.conflicts.length,
      `${tc.name}: reparsed conflict count must match`
    );
    for (let i = 0; i < reparsed.length; i++) {
      assert.equal(
        reparsed[i].id,
        result.conflicts[i].id,
        `${tc.name}: reparsed conflict id ${i}`
      );
      assert.equal(
        reparsed[i].startLine,
        result.conflicts[i].startLine,
        `${tc.name}: reparsed startLine ${i}`
      );
      assert.equal(
        reparsed[i].endLine,
        result.conflicts[i].endLine,
        `${tc.name}: reparsed endLine ${i}`
      );
    }

    assert.equal(
      hasConflictMarkers(result.mergedContent),
      tc.expectConflict,
      `${tc.name}: hasConflictMarkers consistency`
    );
  }
});
