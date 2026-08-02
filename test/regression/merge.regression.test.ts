import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge.js';
import { parseConflictObjects } from '../../api/algorithms/conflictMarkers.js';
import { toLF } from '../../api/utils/lineUtils.js';

describe('[REGRESSION][MERGE] empty files', () => {
  test('all three empty strings merge to empty without conflict (regression)', () => {
    const r = performThreeWayMerge('', '', '');
    assert.equal(r.hasConflicts, false);
    assert.equal(r.conflictCount, 0);
    assert.equal(r.mergedContent, '');
  });

  test('empty base with identical non-empty sides produces that content (regression)', () => {
    const r = performThreeWayMerge('', 'created\nfile', 'created\nfile');
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, 'created\nfile');
  });

  test('empty base with differing sides yields one conflict (regression)', () => {
    const r = performThreeWayMerge('', 'local', 'remote');
    assert.equal(r.hasConflicts, true);
    assert.equal(r.conflictCount, 1);
  });

  test('both sides empty with non-empty base: agreed deletion yields empty (regression)', () => {
    const r = performThreeWayMerge('a\nb\nc', '', '');
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, '');
  });

  test('one side empty while other keeps base: single-side deletion auto-merges (regression)', () => {
    const r = performThreeWayMerge('a\nb', 'a\nb', '');
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, '');
  });
});

describe('[REGRESSION][MERGE] line endings', () => {
  test('CRLF inputs normalize to LF in merged output (regression)', () => {
    const r = performThreeWayMerge(
      'x\r\ny\r\nz',
      'X\r\ny\r\nz',
      'x\r\ny\r\nZ'
    );
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, 'X\ny\nZ');
    assert.equal(r.mergedContent.includes('\r'), false);
  });

  test('identical CRLF sides normalize to identical LF content (regression)', () => {
    const crlf = 'A\r\nb\r\nC';
    const r = performThreeWayMerge(crlf, crlf, crlf);
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, toLF(crlf));
  });

  test('no trailing newline single-line edits merge correctly (regression)', () => {
    const r = performThreeWayMerge('base', 'local-only', 'base');
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, 'local-only');
  });
});

describe('[REGRESSION][MERGE] duplicate lines', () => {
  test('disjoint edits around duplicate lines do not false-conflict (regression)', () => {
    const base = 'a\ndup\ndup\ndup\nb';
    const local = 'A\ndup\ndup\ndup\nb';
    const remote = 'a\ndup\ndup\ndup\nB';
    const r = performThreeWayMerge(base, local, remote);
    assert.equal(r.hasConflicts, false, 'disjoint duplicate-line edits must auto-merge');
    assert.equal(r.mergedContent, 'A\ndup\ndup\ndup\nB');
  });

  test('same-position replacement of a duplicate line by both sides conflicts (regression)', () => {
    const base = 'dup\ndup\ndup';
    const local = 'FIRST\ndup\ndup';
    const remote = 'LAST\ndup\ndup';
    const r = performThreeWayMerge(base, local, remote);
    assert.equal(r.hasConflicts, true);
    assert.equal(r.conflictCount, 1);
  });

  test('one side inserts before a run, other appends after: disjoint (regression)', () => {
    const base = 'dup\ndup';
    const local = 'FIRST\ndup\ndup';
    const remote = 'dup\ndup\nLAST';
    const r = performThreeWayMerge(base, local, remote);
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, 'FIRST\ndup\ndup\nLAST');
  });
});

describe('[REGRESSION][MERGE] single-side / same / disjoint', () => {
  test('only local changes: auto-merges to local version (regression)', () => {
    const r = performThreeWayMerge('1\n2\n3', '1\nL\n3', '1\n2\n3');
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, '1\nL\n3');
  });

  test('only remote changes: auto-merges to remote version (regression)', () => {
    const r = performThreeWayMerge('1\n2\n3', '1\n2\n3', '1\nR\n3');
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, '1\nR\n3');
  });

  test('both sides make identical change: auto-merges without conflict (regression)', () => {
    const r = performThreeWayMerge('a\nb\nc', 'a\nB\nc', 'a\nB\nc');
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, 'a\nB\nc');
  });

  test('disjoint edits at different lines both preserved (regression)', () => {
    const r = performThreeWayMerge('a\nb\nc\nd', 'A\nb\nc\nd', 'a\nb\nc\nD');
    assert.equal(r.hasConflicts, false);
    assert.equal(r.mergedContent, 'A\nb\nc\nD');
  });

  test('overlapping different edits produce exactly one conflict (regression)', () => {
    const r = performThreeWayMerge('a\nb', 'L\nb', 'R\nb');
    assert.equal(r.hasConflicts, true);
    assert.equal(r.conflictCount, 1);
  });

  test('two disjoint conflicting regions produce two conflicts with unique IDs (regression)', () => {
    const r = performThreeWayMerge(
      '1\n2\n3\n4\n5',
      'L1\n2\n3\n4\nL5',
      'R1\n2\n3\n4\nR5'
    );
    assert.equal(r.conflictCount, 2);
    assert.notEqual(r.conflicts[0].id, r.conflicts[1].id);
  });
});

describe('[REGRESSION][MERGE] conflict markers embed IDs and round-trip', () => {
  test('each conflict marker start/end embeds the same conflict ID (regression)', () => {
    const r = performThreeWayMerge('b', 'L', 'R');
    assert.equal(r.conflictCount, 1);
    const id = r.conflicts[0].id;
    const lines = r.mergedContent.split('\n');
    assert.equal(lines[r.conflicts[0].startLine], `<<<<<<< local:${id}`);
    assert.equal(lines[r.conflicts[0].endLine], `>>>>>>> remote:${id}`);
  });

  test('reparsing merged content returns same conflict IDs and positions (regression)', () => {
    const r = performThreeWayMerge('a\nb', 'L\nb', 'R\nb');
    const reparsed = parseConflictObjects(r.mergedContent);
    assert.equal(reparsed.length, 1);
    assert.equal(reparsed[0].id, r.conflicts[0].id);
    assert.equal(reparsed[0].startLine, r.conflicts[0].startLine);
    assert.equal(reparsed[0].endLine, r.conflicts[0].endLine);
  });

  test('unicode content merges by code points without mojibake (regression)', () => {
    const r = performThreeWayMerge(
      '第一行\n第二行',
      '第一行\n本地',
      '第一行\n远程'
    );
    assert.equal(r.conflictCount, 1);
    assert.ok(r.mergedContent.includes('本地'));
    assert.ok(r.mergedContent.includes('远程'));
  });
});

describe('[REGRESSION][MERGE] repeated execution is deterministic', () => {
  test('running the same merge twice yields the same structure (IDs excepted) (regression)', () => {
    const base = 'a\nb\nc\nd';
    const local = 'A\nb\nc\nd';
    const remote = 'a\nb\nc\nD';
    const r1 = performThreeWayMerge(base, local, remote);
    const r2 = performThreeWayMerge(base, local, remote);

    assert.equal(r1.hasConflicts, r2.hasConflicts);
    assert.equal(r1.conflictCount, r2.conflictCount);
    assert.equal(r1.mergedContent.replace(/conflict-[a-z0-9]+/g, 'ID'), r2.mergedContent.replace(/conflict-[a-z0-9]+/g, 'ID'));
  });

  test('conflict IDs are unique within a single merge result (regression)', () => {
    const r = performThreeWayMerge(
      '1\n2\n3\n4\n5',
      'L1\n2\n3\n4\nL5',
      'R1\n2\n3\n4\nR5'
    );
    assert.equal(r.conflictCount, 2);
    assert.notEqual(r.conflicts[0].id, r.conflicts[1].id);
    assert.ok(r.conflicts.every((c) => /^conflict-[a-z0-9]+$/.test(c.id)));
  });
});
