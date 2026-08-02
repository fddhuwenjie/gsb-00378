import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge.js';
import {
  resolveConflictById,
  parseConflictObjects,
  parseConflicts,
  hasConflictMarkers,
  ConflictNotFoundError,
  buildConflictMarkers,
} from '../../api/algorithms/conflictMarkers.js';

function buildMultiConflict(): {
  merged: string;
  firstId: string;
  secondId: string;
} {
  const result = performThreeWayMerge(
    'alpha\nbeta\ngamma\ndelta\nepsilon',
    'LOCAL-ALPHA\nbeta\ngamma\ndelta\nLOCAL-EPSILON',
    'REMOTE-ALPHA\nbeta\ngamma\ndelta\nREMOTE-EPSILON'
  );
  assert.equal(result.conflictCount, 2, 'fixture must produce two conflicts');
  return {
    merged: result.mergedContent,
    firstId: result.conflicts[0].id,
    secondId: result.conflicts[1].id,
  };
}

interface ResolutionCase {
  name: string;
  resolution: 'local' | 'remote' | 'manual';
  customContent?: string;
}

test('single conflict can be resolved with local, remote, and manual content', () => {
  const result = performThreeWayMerge(
    'base line',
    'local line',
    'remote line'
  );
  assert.equal(result.conflictCount, 1);
  const id = result.conflicts[0].id;

  const cases: ResolutionCase[] = [
    { name: 'local', resolution: 'local' },
    { name: 'remote', resolution: 'remote' },
    { name: 'manual', resolution: 'manual', customContent: 'handcrafted\nvalue' },
    { name: 'manual empty', resolution: 'manual', customContent: '' },
  ];

  for (const tc of cases) {
    const resolved = resolveConflictById(result.mergedContent, id, tc.resolution, tc.customContent);
    assert.equal(
      hasConflictMarkers(resolved.mergedContent),
      false,
      `${tc.name}: no conflict markers remain`
    );
    assert.equal(resolved.conflicts.length, 0, `${tc.name}: no conflicts remain`);

    const expected =
      tc.resolution === 'local'
        ? result.conflicts[0].localContent.join('\n')
        : tc.resolution === 'remote'
          ? result.conflicts[0].remoteContent.join('\n')
          : (tc.customContent ?? '');
    assert.equal(resolved.mergedContent, expected, `${tc.name}: resolved content`);
  }
});

test('resolving first conflict keeps second conflict accurately located (no drift)', () => {
  const fixture = buildMultiConflict();

  const linesBefore = fixture.merged.split('\n');
  const secondStartBefore = linesBefore.findIndex(
    (line) => line === `<<<<<<< local:${fixture.secondId}`
  );
  assert.ok(secondStartBefore > 0, 'second conflict must exist');

  const afterFirst = resolveConflictById(fixture.merged, fixture.firstId, 'local');
  assert.equal(afterFirst.conflicts.length, 1, 'only one conflict remains');
  assert.equal(afterFirst.conflicts[0].id, fixture.secondId, 'remaining id is the second conflict');

  const reparsed = parseConflictObjects(afterFirst.mergedContent);
  assert.equal(reparsed.length, 1, 'reparser sees one conflict');
  assert.equal(reparsed[0].id, fixture.secondId);
  assert.equal(
    reparsed[0].startLine,
    afterFirst.conflicts[0].startLine,
    'returned and reparsed startLine agree'
  );

  const linesAfter = afterFirst.mergedContent.split('\n');
  assert.equal(
    linesAfter[reparsed[0].startLine],
    `<<<<<<< local:${fixture.secondId}`,
    'startLine points at the real second conflict marker'
  );
  assert.equal(
    linesAfter[reparsed[0].endLine],
    `>>>>>>> remote:${fixture.secondId}`,
    'endLine points at the real second conflict end marker'
  );

  const fullyResolved = resolveConflictById(
    afterFirst.mergedContent,
    afterFirst.conflicts[0].id,
    'remote'
  );
  assert.equal(fullyResolved.conflicts.length, 0, 'all conflicts resolved after second step');
  assert.equal(
    hasConflictMarkers(fullyResolved.mergedContent),
    false,
    'final output is clean'
  );
  assert.equal(
    fullyResolved.mergedContent,
    'LOCAL-ALPHA\nbeta\ngamma\ndelta\nREMOTE-EPSILON',
    'both resolutions applied at correct positions'
  );
});

test('position drift stress: different-sized resolutions still relocate remaining conflicts', () => {
  const fixture = buildMultiConflict();

  const afterFirst = resolveConflictById(
    fixture.merged,
    fixture.firstId,
    'manual',
    'extra\nline\none\nextra\nline\ntwo'
  );
  assert.equal(afterFirst.conflicts.length, 1);
  const reparsed = parseConflictObjects(afterFirst.mergedContent);
  assert.equal(reparsed[0].id, fixture.secondId);
  assert.equal(
    afterFirst.conflicts[0].startLine,
    reparsed[0].startLine,
    'positions must come from reparsing, not stale absolute line numbers'
  );

  const afterSecond = resolveConflictById(
    afterFirst.mergedContent,
    afterFirst.conflicts[0].id,
    'local'
  );
  assert.equal(
    afterSecond.mergedContent,
    'extra\nline\none\nextra\nline\ntwo\nbeta\ngamma\ndelta\nLOCAL-EPSILON'
  );
});

test('resolving an already-resolved/unknown id is explicitly rejected and cannot replace text', () => {
  const result = performThreeWayMerge('b', 'L', 'R');
  const id = result.conflicts[0].id;
  const once = resolveConflictById(result.mergedContent, id, 'local');
  assert.equal(once.conflicts.length, 0);

  assert.throws(
    () => resolveConflictById(once.mergedContent, id, 'remote'),
    (err: unknown) => err instanceof ConflictNotFoundError && err.conflictId === id
  );

  const sentinel = once.mergedContent;
  try {
    resolveConflictById(sentinel, id, 'manual', 'ARBITRARY REPLACEMENT');
    assert.fail('expected ConflictNotFoundError for repeated resolution');
  } catch (err) {
    assert.ok(err instanceof ConflictNotFoundError);
  }
  assert.equal(once.mergedContent, sentinel, 'content must be untouched when id is unknown');
});

test('unknown conflict id cannot splice arbitrary text regardless of supplied line numbers', () => {
  const result = performThreeWayMerge('a\nb\nc', 'L\nb\nc', 'R\nb\nc');
  const original = result.mergedContent;
  const fakeId = 'conflict-doesnotexist';

  try {
    resolveConflictById(original, fakeId, 'manual', 'INJECTED');
    assert.fail('unknown conflict id must be rejected');
  } catch (err) {
    assert.ok(err instanceof ConflictNotFoundError);
    assert.match(err.message, /not found/);
  }
  assert.equal(original, result.mergedContent, 'no mutation when id is unknown');
});

test('buildConflictMarkers and parseConflicts round-trip', () => {
  const markers = buildConflictMarkers('cid-1', ['L1', 'L2'], ['R1']);
  const parsed = parseConflicts(markers);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'cid-1');
  assert.deepEqual(parsed[0].localLines, ['L1', 'L2']);
  assert.deepEqual(parsed[0].remoteLines, ['R1']);
  assert.equal(parsed[0].startLine, 0);
  assert.equal(parsed[0].separatorLine, 3);
  assert.equal(parsed[0].endLine, 5);
});

test('empty manual resolution removes the entire conflict block', () => {
  const result = performThreeWayMerge('x', 'L', 'R');
  const id = result.conflicts[0].id;
  const resolved = resolveConflictById(result.mergedContent, id, 'manual', '');
  assert.equal(resolved.mergedContent, '');
  assert.equal(resolved.conflicts.length, 0);
});
