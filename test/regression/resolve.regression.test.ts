import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge.js';
import {
  resolveConflictById,
  parseConflictObjects,
  ConflictNotFoundError,
  buildConflictMarkers,
  parseConflicts,
} from '../../api/algorithms/conflictMarkers.js';

function multiConflictFixture() {
  const result = performThreeWayMerge(
    'alpha\nbeta\ngamma\ndelta\nepsilon',
    'LOCAL-ALPHA\nbeta\ngamma\ndelta\nLOCAL-EPSILON',
    'REMOTE-ALPHA\nbeta\ngamma\ndelta\nREMOTE-EPSILON'
  );
  assert.equal(result.conflictCount, 2);
  return result;
}

describe('[REGRESSION][RESOLVE] position drift after prior resolution', () => {
  test('resolving first conflict keeps second conflict accurately located (regression)', () => {
    const fixture = multiConflictFixture();
    const [first, second] = fixture.conflicts;

    const afterFirst = resolveConflictById(fixture.mergedContent, first.id, 'local');
    assert.equal(afterFirst.conflicts.length, 1);
    assert.equal(afterFirst.conflicts[0].id, second.id);

    const reparsed = parseConflictObjects(afterFirst.mergedContent);
    assert.equal(reparsed.length, 1);
    assert.equal(reparsed[0].id, second.id);
    assert.equal(reparsed[0].startLine, afterFirst.conflicts[0].startLine);
    assert.equal(reparsed[0].endLine, afterFirst.conflicts[0].endLine);

    const lines = afterFirst.mergedContent.split('\n');
    assert.equal(lines[reparsed[0].startLine], `<<<<<<< local:${second.id}`);
    assert.equal(lines[reparsed[0].endLine], `>>>>>>> remote:${second.id}`);
  });

  test('large replacement in first conflict still relocates second correctly (regression)', () => {
    const fixture = multiConflictFixture();
    const [first, second] = fixture.conflicts;

    const afterFirst = resolveConflictById(
      fixture.mergedContent,
      first.id,
      'manual',
      'x1\nx2\nx3\nx4\nx5\nx6'
    );
    const reparsed = parseConflictObjects(afterFirst.mergedContent);
    assert.equal(reparsed.length, 1);
    assert.equal(reparsed[0].id, second.id);
    assert.equal(reparsed[0].startLine, afterFirst.conflicts[0].startLine);

    const final = resolveConflictById(afterFirst.mergedContent, second.id, 'remote');
    assert.equal(final.conflicts.length, 0);
    assert.equal(final.mergedContent, 'x1\nx2\nx3\nx4\nx5\nx6\nbeta\ngamma\ndelta\nREMOTE-EPSILON');
  });

  test('sequential resolution of all conflicts yields clean output (regression)', () => {
    const fixture = multiConflictFixture();
    const [first, second] = fixture.conflicts;

    const step1 = resolveConflictById(fixture.mergedContent, first.id, 'local');
    assert.equal(step1.conflicts.length, 1);
    const step2 = resolveConflictById(step1.mergedContent, second.id, 'remote');
    assert.equal(step2.conflicts.length, 0);
    assert.equal(
      step2.mergedContent,
      'LOCAL-ALPHA\nbeta\ngamma\ndelta\nREMOTE-EPSILON'
    );
    assert.equal(step2.mergedContent.includes('<<<<<<<'), false);
  });
});

describe('[REGRESSION][RESOLVE] idempotency and repeated resolution', () => {
  test('resolving an already-resolved ID throws ConflictNotFoundError (regression)', () => {
    const result = performThreeWayMerge('b', 'L', 'R');
    const id = result.conflicts[0].id;
    const once = resolveConflictById(result.mergedContent, id, 'local');
    assert.equal(once.conflicts.length, 0);

    assert.throws(
      () => resolveConflictById(once.mergedContent, id, 'remote'),
      (err: unknown) => err instanceof ConflictNotFoundError && err.conflictId === id
    );
  });

  test('repeated resolution with manual content does not modify already-clean text (regression)', () => {
    const result = performThreeWayMerge('b', 'L', 'R');
    const id = result.conflicts[0].id;
    const once = resolveConflictById(result.mergedContent, id, 'local');
    const before = once.mergedContent;

    try {
      resolveConflictById(before, id, 'manual', 'INJECTED');
      assert.fail('expected ConflictNotFoundError');
    } catch (err) {
      assert.ok(err instanceof ConflictNotFoundError);
    }
    assert.equal(once.mergedContent, before);
  });

  test('two different conflicts resolved independently do not affect each other (regression)', () => {
    const fixture = multiConflictFixture();
    const [first, second] = fixture.conflicts;

    const r1 = resolveConflictById(fixture.mergedContent, first.id, 'local');
    const r2 = resolveConflictById(r1.mergedContent, second.id, 'remote');
    assert.equal(r2.conflicts.length, 0);

    const fromOriginalSecond = resolveConflictById(fixture.mergedContent, second.id, 'remote');
    assert.equal(fromOriginalSecond.conflicts.length, 1);
    assert.equal(fromOriginalSecond.conflicts[0].id, first.id);
  });
});

describe('[REGRESSION][RESOLVE] unknown conflict ID cannot replace arbitrary text', () => {
  test('unknown ID is rejected regardless of supplied line numbers (regression)', () => {
    const result = performThreeWayMerge('a\nb\nc', 'L\nb\nc', 'R\nb\nc');
    const original = result.mergedContent;

    try {
      resolveConflictById(original, 'conflict-nonexistent', 'manual', 'INJECTED');
      assert.fail('expected ConflictNotFoundError for unknown id');
    } catch (err) {
      assert.ok(err instanceof ConflictNotFoundError);
      assert.match(err.message, /not found/);
    }
  });

  test('empty string ID is rejected (regression)', () => {
    const result = performThreeWayMerge('b', 'L', 'R');
    assert.throws(
      () => resolveConflictById(result.mergedContent, '', 'local'),
      ConflictNotFoundError
    );
  });

  test('marker IDs in content cannot be spoofed to resolve a different block (regression)', () => {
    const fixture = multiConflictFixture();
    const [first, second] = fixture.conflicts;

    const afterFirst = resolveConflictById(fixture.mergedContent, first.id, 'manual', `<<<<<<< local:${second.id}\nfake\n>>>>>>> remote:${second.id}`);
    const reparsed = parseConflictObjects(afterFirst.mergedContent);
    assert.equal(reparsed.length, 1, 'injected lookalike markers must not create extra resolvable blocks');
    assert.equal(reparsed[0].id, second.id);
  });
});

describe('[REGRESSION][RESOLVE] invalid input and error responses', () => {
  test('invalid resolution kind throws (regression)', () => {
    const result = performThreeWayMerge('b', 'L', 'R');
    const id = result.conflicts[0].id;
    assert.throws(
      () => resolveConflictById(result.mergedContent, id, 'invalid' as 'local', undefined),
      /invalid|type/i
    );
  });

  test('manual resolution with undefined customContent removes block (regression)', () => {
    const result = performThreeWayMerge('b', 'L', 'R');
    const id = result.conflicts[0].id;
    const r = resolveConflictById(result.mergedContent, id, 'manual', undefined);
    assert.equal(r.mergedContent, '');
    assert.equal(r.conflicts.length, 0);
  });

  test('buildConflictMarkers and parseConflicts round-trip (regression)', () => {
    const markers = buildConflictMarkers('cid-xyz', ['L1', 'L2'], ['R1']);
    const parsed = parseConflicts(markers);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'cid-xyz');
    assert.deepEqual(parsed[0].localLines, ['L1', 'L2']);
    assert.deepEqual(parsed[0].remoteLines, ['R1']);
  });

  test('non-string mergedContent (null) is rejected without mutating anything (regression)', () => {
    const result = performThreeWayMerge('b', 'L', 'R');
    assert.throws(
      () =>
        resolveConflictById(
          null as unknown as string,
          result.conflicts[0].id,
          'local'
        ),
      /Cannot read|split|undefined|null/i
    );
  });

  test('resolving with remote then local on different conflicts is order-independent for final set (regression)', () => {
    const fixture = multiConflictFixture();
    const [first, second] = fixture.conflicts;

    const orderA = resolveConflictById(
      resolveConflictById(fixture.mergedContent, first.id, 'local').mergedContent,
      second.id,
      'remote'
    );
    const orderB = resolveConflictById(
      resolveConflictById(fixture.mergedContent, second.id, 'remote').mergedContent,
      first.id,
      'local'
    );

    assert.equal(orderA.conflicts.length, 0);
    assert.equal(orderB.conflicts.length, 0);
    assert.equal(orderA.mergedContent, orderB.mergedContent);
  });
});
