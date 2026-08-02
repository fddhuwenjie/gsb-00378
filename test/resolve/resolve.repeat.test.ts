import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performThreeWayMerge, resolveConflict, ConflictNotFoundError, parseConflictBlocks } from '../../api/algorithms/threeWayMerge';
import type { Conflict } from '@shared/types';

function merge(base: string, local: string, remote: string) {
  const result = performThreeWayMerge(base, local, remote);
  return { merged: result.mergedContent, conflicts: result.conflicts };
}

function fakeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: 'conflict-totally-unknown',
    startLine: 0,
    endLine: 0,
    localContent: ['__no_such_local__'],
    remoteContent: ['__no_such_remote__'],
    baseContent: [],
    resolved: false,
    resolution: null,
    ...overrides,
  };
}

describe('resolve: repeated execution on fresh content is deterministic', () => {
  it('resolving the same fresh conflict with local repeatedly yields the same output', () => {
    const expected = 'a\nL';
    for (let run = 0; run < 3; run++) {
      const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
      assert.equal(resolveConflict(merged, conflicts[0], 'local'), expected);
    }
  });

  it('resolving the same fresh conflict with remote repeatedly yields the same output', () => {
    const expected = 'a\nR';
    for (let run = 0; run < 3; run++) {
      const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
      assert.equal(resolveConflict(merged, conflicts[0], 'remote'), expected);
    }
  });

  it('resolving the same fresh conflict with manual repeatedly yields the same output', () => {
    const expected = 'a\nMANUAL';
    for (let run = 0; run < 3; run++) {
      const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
      assert.equal(resolveConflict(merged, conflicts[0], 'manual', 'MANUAL'), expected);
    }
  });

  it('sequential resolution of two conflicts is stable across repeated runs', () => {
    const expected = 'L\nb\nR2\nd\ne';
    for (let run = 0; run < 2; run++) {
      const { merged, conflicts } = merge('a\nb\nc\nd\ne', 'L\nb\nL2\nd\ne', 'R\nb\nR2\nd\ne');
      let content = resolveConflict(merged, conflicts[0], 'local');
      content = resolveConflict(content, conflicts[1], 'remote');
      assert.equal(content, expected);
    }
  });
});

describe('resolve: error type and invalid input', () => {
  it('throws ConflictNotFoundError (not a generic error) for an unknown conflict', () => {
    const { merged } = merge('a\nb', 'a\nL', 'a\nR');
    assert.throws(
      () => resolveConflict(merged, fakeConflict(), 'local'),
      (err: unknown) => err instanceof ConflictNotFoundError,
    );
  });

  it('throws ConflictNotFoundError when mergedContent is empty', () => {
    assert.throws(
      () => resolveConflict('', fakeConflict(), 'local'),
      (err: unknown) => err instanceof ConflictNotFoundError,
    );
  });

  it('throws when the conflict object is malformed (missing content arrays)', () => {
    const { merged } = merge('a\nb', 'a\nL', 'a\nR');
    const malformed = { id: 'x' } as unknown as Conflict;
    assert.throws(
      () => resolveConflict(merged, malformed, 'local'),
      (err: unknown) => err instanceof ConflictNotFoundError,
    );
  });

  it('throws an explicit error for an invalid resolution type', () => {
    const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
    assert.throws(
      () => resolveConflict(merged, conflicts[0], 'bogus' as unknown as 'local'),
      /Invalid resolution type/i,
    );
  });

  it('does not mutate the input mergedContent string on failure', () => {
    const { merged } = merge('a\nb', 'a\nL', 'a\nR');
    const snapshot = merged;
    assert.throws(() => resolveConflict(merged, fakeConflict(), 'local'));
    assert.equal(merged, snapshot);
  });
});

describe('resolve: parseConflictBlocks helper', () => {
  it('finds zero blocks in clean content', () => {
    assert.deepEqual(parseConflictBlocks(['a', 'b', 'c']), []);
  });

  it('finds one block and reports its local/remote content', () => {
    const lines = ['before', '<<<<<<< local', 'L', '=======', 'R', '>>>>>>> remote', 'after'];
    const blocks = parseConflictBlocks(lines);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].startLine, 1);
    assert.equal(blocks[0].sepLine, 3);
    assert.equal(blocks[0].endLine, 5);
    assert.deepEqual(blocks[0].localContent, ['L']);
    assert.deepEqual(blocks[0].remoteContent, ['R']);
  });

  it('finds two non-overlapping blocks', () => {
    const lines = [
      '<<<<<<< local', 'L1', '=======', 'R1', '>>>>>>> remote',
      'mid',
      '<<<<<<< local', 'L2', '=======', 'R2', '>>>>>>> remote',
    ];
    const blocks = parseConflictBlocks(lines);
    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks[0].localContent, ['L1']);
    assert.deepEqual(blocks[1].remoteContent, ['R2']);
  });
});
