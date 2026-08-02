import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performThreeWayMerge, resolveConflict } from '../../api/algorithms/threeWayMerge';
import type { Conflict } from '@shared/types';

function merge(base: string, local: string, remote: string) {
  const result = performThreeWayMerge(base, local, remote);
  return { merged: result.mergedContent, conflicts: result.conflicts };
}

function fakeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: 'conflict-does-not-exist',
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

describe('resolve: single conflict', () => {
  it('chooses local content and removes markers', () => {
    const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
    const out = resolveConflict(merged, conflicts[0], 'local');
    assert.equal(out, 'a\nL');
    assert.ok(!out.includes('<<<<<<<'));
    assert.ok(!out.includes('>>>>>>>'));
  });

  it('chooses remote content and removes markers', () => {
    const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
    const out = resolveConflict(merged, conflicts[0], 'remote');
    assert.equal(out, 'a\nR');
  });

  it('uses manual custom content and removes markers', () => {
    const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
    const out = resolveConflict(merged, conflicts[0], 'manual', 'CUSTOM');
    assert.equal(out, 'a\nCUSTOM');
  });

  it('manual empty content removes the block entirely', () => {
    const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
    const out = resolveConflict(merged, conflicts[0], 'manual', '');
    assert.equal(out, 'a');
  });
});

describe('resolve: multi-conflict position drift', () => {
  const base = 'a\nb\nc\nd\ne';
  const local = 'L\nb\nL2\nd\ne';
  const remote = 'R\nb\nR2\nd\ne';

  it('resolves conflicts in forward order without line drift', () => {
    const { merged, conflicts } = merge(base, local, remote);
    assert.equal(conflicts.length, 2);

    const afterFirst = resolveConflict(merged, conflicts[0], 'local');
    assert.equal(afterFirst, 'L\nb\n<<<<<<< local\nL2\n=======\nR2\n>>>>>>> remote\nd\ne');

    const afterSecond = resolveConflict(afterFirst, conflicts[1], 'remote');
    assert.equal(afterSecond, 'L\nb\nR2\nd\ne');
    assert.ok(!afterSecond.includes('<<<<<<<'));
  });

  it('resolves conflicts in reverse order correctly', () => {
    const { merged, conflicts } = merge(base, local, remote);

    const afterSecond = resolveConflict(merged, conflicts[1], 'remote');
    assert.equal(afterSecond, '<<<<<<< local\nL\n=======\nR\n>>>>>>> remote\nb\nR2\nd\ne');

    const afterFirst = resolveConflict(afterSecond, conflicts[0], 'local');
    assert.equal(afterFirst, 'L\nb\nR2\nd\ne');
  });

  it('resolving earlier conflict with a larger manual block still locates the later conflict', () => {
    const { merged, conflicts } = merge(base, local, remote);
    const afterFirst = resolveConflict(merged, conflicts[0], 'manual', 'X1\nX2\nX3');
    const afterSecond = resolveConflict(afterFirst, conflicts[1], 'remote');
    assert.equal(afterSecond, 'X1\nX2\nX3\nb\nR2\nd\ne');
    assert.ok(!afterSecond.includes('<<<<<<<'));
  });

  it('resolves three sequentially resolved conflicts correctly', () => {
    const b = '1\n2\n3\n4\n5\n6\n7';
    const l = 'L1\n2\nL3\n4\nL5\n6\n7';
    const r = 'R1\n2\nR3\n4\nR5\n6\n7';
    const { merged, conflicts } = merge(b, l, r);
    assert.equal(conflicts.length, 3);

    let content = merged;
    content = resolveConflict(content, conflicts[0], 'local');
    content = resolveConflict(content, conflicts[1], 'remote');
    content = resolveConflict(content, conflicts[2], 'local');

    assert.equal(content, 'L1\n2\nR3\n4\nL5\n6\n7');
  });
});

describe('resolve: idempotency and safety', () => {
  it('rejects resolving the same conflict a second time', () => {
    const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
    const once = resolveConflict(merged, conflicts[0], 'local');
    assert.throws(
      () => resolveConflict(once, conflicts[0], 'remote'),
      /conflict/i,
    );
  });

  it('rejects an unknown conflict id and does not produce output', () => {
    const { merged } = merge('a\nb', 'a\nL', 'a\nR');
    const unknown = fakeConflict();
    assert.throws(() => resolveConflict(merged, unknown, 'local'));
  });

  it('unknown conflict id with valid-looking line numbers cannot replace arbitrary text', () => {
    const { merged } = merge('a\nb\nc\nd', 'L\nb\nL2\nd', 'R\nb\nR2\nd');
    const original = merged;
    const malicious = fakeConflict({
      startLine: 5,
      endLine: 5,
      localContent: ['HACKED-LOCAL'],
      remoteContent: ['HACKED-REMOTE'],
    });
    assert.throws(() => resolveConflict(original, malicious, 'manual', 'HACKED'));
    assert.ok(!original.includes('HACKED'));
    assert.ok(original.includes('\nb\n'));
  });

  it('rejects a conflict whose content no longer matches any block', () => {
    const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
    const tampered = { ...conflicts[0], localContent: ['TAMPERED'] };
    assert.throws(() => resolveConflict(merged, tampered, 'local'));
  });
});

describe('resolve: preserves trailing newline state', () => {
  it('keeps a trailing newline when one existed', () => {
    const { merged, conflicts } = merge('a\nb\n', 'a\nL\n', 'a\nR\n');
    const out = resolveConflict(merged, conflicts[0], 'local');
    assert.equal(out, 'a\nL\n');
  });

  it('does not invent a trailing newline when none existed', () => {
    const { merged, conflicts } = merge('a\nb', 'a\nL', 'a\nR');
    const out = resolveConflict(merged, conflicts[0], 'local');
    assert.equal(out, 'a\nL');
  });
});
