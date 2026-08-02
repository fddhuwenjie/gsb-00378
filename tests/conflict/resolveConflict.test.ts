/**
 * REGRESSION SUITE — category: conflict (conflict resolution)
 *
 * Locks in the previous round's fix for multi-conflict position drift and the
 * refusal to replace arbitrary text for unknown/stale conflicts. Expected
 * values are hand-derived from the resolution rules: choosing local/remote/
 * manual replaces exactly the matching conflict block; an unresolvable conflict
 * throws instead of mutating text. Run alone with `npm run test:conflict`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  performThreeWayMerge,
  resolveConflict,
  ConflictResolutionError,
} from '../../api/algorithms/threeWayMerge.ts';

const MARK_LOCAL = '<<<<<<< local';
const MARK_SEP = '=======';
const MARK_REMOTE = '>>>>>>> remote';

describe('conflict: single resolution by side', () => {
  it('resolves a single conflict by choosing local', () => {
    const merged = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const out = resolveConflict(merged.mergedContent, merged.conflicts[0], 'local');
    assert.equal(out, 'a\nX\nc');
  });

  it('resolves a single conflict by choosing remote', () => {
    const merged = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const out = resolveConflict(merged.mergedContent, merged.conflicts[0], 'remote');
    assert.equal(out, 'a\nY\nc');
  });

  it('resolves a single conflict with manual content', () => {
    const merged = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const out = resolveConflict(merged.mergedContent, merged.conflicts[0], 'manual', 'MANUAL');
    assert.equal(out, 'a\nMANUAL\nc');
  });

  it('manual resolution with multi-line content expands the block', () => {
    // Rule: manual content 'M1\nM2' replaces the whole conflict block verbatim.
    const merged = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const out = resolveConflict(merged.mergedContent, merged.conflicts[0], 'manual', 'M1\nM2');
    assert.equal(out, 'a\nM1\nM2\nc');
  });

  it('manual resolution with empty content removes the conflicting region', () => {
    // Rule: empty manual content splits to zero lines, so the whole block is
    // spliced out and the surrounding lines join directly.
    const merged = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const out = resolveConflict(merged.mergedContent, merged.conflicts[0], 'manual', '');
    assert.equal(out, 'a\nc');
  });
});

describe('conflict: multi-conflict positioning (no drift)', () => {
  it('locates later conflicts accurately after an earlier one is resolved', () => {
    const merged = performThreeWayMerge(
      'a\nb\nc\nd\ne',
      'A1\nb\nc\nd\nE1',
      'A2\nb\nc\nd\nE2'
    );
    assert.equal(merged.conflictCount, 2);

    const afterFirst = resolveConflict(merged.mergedContent, merged.conflicts[0], 'local');
    assert.equal(
      afterFirst,
      ['A1', 'b', 'c', 'd', MARK_LOCAL, 'E1', MARK_SEP, 'E2', MARK_REMOTE].join('\n')
    );

    const afterSecond = resolveConflict(afterFirst, merged.conflicts[1], 'remote');
    assert.equal(afterSecond, 'A1\nb\nc\nd\nE2');
  });

  it('resolving the LATER conflict first still keeps the earlier one intact', () => {
    // Order independence: resolving conflicts[1] first must not disturb
    // conflicts[0]'s block, which we then resolve correctly.
    const merged = performThreeWayMerge(
      'a\nb\nc\nd\ne',
      'A1\nb\nc\nd\nE1',
      'A2\nb\nc\nd\nE2'
    );
    const afterSecond = resolveConflict(merged.mergedContent, merged.conflicts[1], 'local');
    assert.equal(
      afterSecond,
      [MARK_LOCAL, 'A1', MARK_SEP, 'A2', MARK_REMOTE, 'b', 'c', 'd', 'E1'].join('\n')
    );
    const afterFirst = resolveConflict(afterSecond, merged.conflicts[0], 'remote');
    assert.equal(afterFirst, 'A2\nb\nc\nd\nE1');
  });

  it('resolving all conflicts yields fully clean text with no markers', () => {
    const merged = performThreeWayMerge(
      'a\nb\nc\nd\ne',
      'A1\nb\nc\nd\nE1',
      'A2\nb\nc\nd\nE2'
    );
    let content = merged.mergedContent;
    content = resolveConflict(content, merged.conflicts[0], 'local');
    content = resolveConflict(content, merged.conflicts[1], 'local');
    assert.equal(content, 'A1\nb\nc\nd\nE1');
    assert.ok(!content.includes('<<<<<<<'));
    assert.ok(!content.includes('======='));
    assert.ok(!content.includes('>>>>>>>'));
  });
});

describe('conflict: repeated execution / idempotency', () => {
  it('re-resolving an already-resolved conflict is rejected (not silently mangled)', () => {
    const merged = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const once = resolveConflict(merged.mergedContent, merged.conflicts[0], 'local');
    assert.equal(once, 'a\nX\nc');

    assert.throws(
      () => resolveConflict(once, merged.conflicts[0], 'local'),
      ConflictResolutionError
    );
  });

  it('resolving the same conflict repeatedly on the ORIGINAL content is stable', () => {
    // Rule: resolveConflict is pure. Calling it repeatedly against the same
    // unresolved input must yield the same result every time.
    const merged = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const r1 = resolveConflict(merged.mergedContent, merged.conflicts[0], 'local');
    const r2 = resolveConflict(merged.mergedContent, merged.conflicts[0], 'local');
    const r3 = resolveConflict(merged.mergedContent, merged.conflicts[0], 'local');
    assert.equal(r1, 'a\nX\nc');
    assert.equal(r2, r1);
    assert.equal(r3, r1);
    // The original is never mutated in place.
    assert.equal(
      merged.mergedContent,
      ['a', MARK_LOCAL, 'X', MARK_SEP, 'Y', MARK_REMOTE, 'c'].join('\n')
    );
  });
});

describe('conflict: invalid / unknown targets are rejected', () => {
  it('rejects an unknown conflict instead of replacing arbitrary text', () => {
    const merged = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const unknown = {
      id: 'does-not-exist',
      startLine: 1,
      endLine: 5,
      localContent: ['ZZZ'],
      remoteContent: ['QQQ'],
      baseContent: ['b'],
      resolved: false,
      resolution: null,
    } as const;

    assert.throws(
      () => resolveConflict(merged.mergedContent, unknown, 'local'),
      ConflictResolutionError
    );
    assert.equal(
      merged.mergedContent,
      ['a', MARK_LOCAL, 'X', MARK_SEP, 'Y', MARK_REMOTE, 'c'].join('\n')
    );
  });

  it('rejects resolution against content that has no conflict markers at all', () => {
    const merged = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    // Clean text (already merged elsewhere) has no block to anchor on.
    assert.throws(
      () => resolveConflict('totally\nclean\ntext', merged.conflicts[0], 'local'),
      ConflictResolutionError
    );
  });

  it('rejects a conflict whose payload does not match any live block', () => {
    // Correct markers exist, but the requested local/remote payload differs, so
    // there is no matching block and we must refuse.
    const merged = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const mismatched = { ...merged.conflicts[0], localContent: ['NOPE'] };
    assert.throws(
      () => resolveConflict(merged.mergedContent, mismatched, 'local'),
      ConflictResolutionError
    );
  });
});
