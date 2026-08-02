import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge.js';
import { splitLines } from '../../api/algorithms/myersDiff.js';
import { hasConflictMarkers } from '../../api/algorithms/conflictMarkers.js';
import { toLF } from '../../api/utils/lineUtils.js';

const determinismSamples: Array<{ name: string; base: string; x: string }> = [
  { name: 'empty all', base: '', x: '' },
  { name: 'empty base, non-empty identical sides', base: '', x: 'a\nb\nc' },
  { name: 'single line no newline', base: 'a', x: 'b' },
  { name: 'multi-line LF', base: 'one\ntwo\nthree', x: 'one\nTWO\nthree\nfour' },
  { name: 'CRLF input normalized to LF', base: 'a\r\nb\r\nc', x: 'A\r\nb\r\nC' },
  { name: 'duplicate lines', base: 'x\nx\nx', x: 'x\ny\nx' },
  { name: 'unicode', base: '山\n河', x: '山\n河\n湖\n海' },
];

test('property: merge(base, x, x) === x (LF-normalized) for deterministic samples', () => {
  for (const sample of determinismSamples) {
    const result = performThreeWayMerge(sample.base, sample.x, sample.x);
    assert.equal(
      result.hasConflicts,
      false,
      `${sample.name}: identical sides must not conflict`
    );
    assert.equal(
      result.conflictCount,
      0,
      `${sample.name}: conflict count must be zero`
    );
    assert.equal(
      result.mergedContent,
      toLF(sample.x),
      `${sample.name}: merged output must equal the LF-normalized common modified side`
    );
  }
});

interface SingleSideCase {
  name: string;
  base: string;
  changed: string;
  unchanged: string;
  side: 'local' | 'remote';
}

const singleSideCases: SingleSideCase[] = [
  {
    name: 'local modifies middle line',
    base: 'a\nb\nc',
    changed: 'a\nB\nc',
    unchanged: 'a\nb\nc',
    side: 'local',
  },
  {
    name: 'remote appends line',
    base: 'line1\nline2',
    unchanged: 'line1\nline2',
    changed: 'line1\nline2\nline3',
    side: 'remote',
  },
  {
    name: 'local deletes a line',
    base: 'keep\ndrop\nkeep',
    changed: 'keep\nkeep',
    unchanged: 'keep\ndrop\nkeep',
    side: 'local',
  },
  {
    name: 'local changes empty file',
    base: '',
    changed: 'created',
    unchanged: '',
    side: 'local',
  },
  {
    name: 'unicode single-side',
    base: '苹果\n香蕉',
    unchanged: '苹果\n香蕉',
    changed: '苹果\n橘子',
    side: 'remote',
  },
];

test('property: a change made by only one side merges without conflict', () => {
  for (const tc of singleSideCases) {
    const local = tc.side === 'local' ? tc.changed : tc.unchanged;
    const remote = tc.side === 'remote' ? tc.changed : tc.unchanged;
    const result = performThreeWayMerge(tc.base, local, remote);

    assert.equal(result.hasConflicts, false, `${tc.name}: no conflicts expected`);
    assert.equal(result.conflictCount, 0, `${tc.name}: conflict count 0`);
    assert.equal(
      hasConflictMarkers(result.mergedContent),
      false,
      `${tc.name}: no conflict markers`
    );
    assert.equal(
      result.mergedContent,
      tc.changed,
      `${tc.name}: merged result must equal the side that changed`
    );
  }
});

interface DisjointCase {
  name: string;
  base: string;
  local: string;
  remote: string;
  mustContain: string[];
  mustNotContain: string[];
  expected: string;
}

const disjointCases: DisjointCase[] = [
  {
    name: 'local changes first line, remote changes last line',
    base: '0\n1\n2\n3',
    local: 'L\n1\n2\n3',
    remote: '0\n1\n2\nR',
    mustContain: ['L', 'R'],
    mustNotContain: ['<<<<<<<', '>>>>>>>'],
    expected: 'L\n1\n2\nR',
  },
  {
    name: 'local inserts at start, remote appends at end',
    base: 'middle',
    local: 'start\nmiddle',
    remote: 'middle\nend',
    mustContain: ['start', 'middle', 'end'],
    mustNotContain: ['<<<<<<<', '>>>>>>>'],
    expected: 'start\nmiddle\nend',
  },
  {
    name: 'disjoint edits around duplicate lines (distinct copies changed per side)',
    base: 'a\ndup\ndup\ndup\nb',
    local: 'A\ndup\ndup\ndup\nb',
    remote: 'a\ndup\ndup\ndup\nB',
    mustContain: ['A', 'B'],
    mustNotContain: ['<<<<<<<', '>>>>>>>'],
    expected: 'A\ndup\ndup\ndup\nB',
  },
];

test('property: disjoint modifications are both preserved without conflicts', () => {
  for (const tc of disjointCases) {
    const result = performThreeWayMerge(tc.base, tc.local, tc.remote);
    assert.equal(result.hasConflicts, false, `${tc.name}: no conflicts`);
    assert.equal(result.conflictCount, 0, `${tc.name}: zero conflicts`);
    assert.equal(
      hasConflictMarkers(result.mergedContent),
      false,
      `${tc.name}: no conflict markers`
    );
    for (const fragment of tc.mustContain) {
      assert.ok(
        result.mergedContent.includes(fragment),
        `${tc.name}: merged content must contain ${fragment}`
      );
    }
    for (const fragment of tc.mustNotContain) {
      assert.equal(
        result.mergedContent.includes(fragment),
        false,
        `${tc.name}: merged content must not contain ${fragment}`
      );
    }
    assert.equal(
      result.mergedContent,
      tc.expected,
      `${tc.name}: exact merged output`
    );

    const lines = splitLines(result.mergedContent);
    for (const line of lines) {
      assert.equal(
        line.startsWith('<<<<<<<') || line.startsWith('>>>>>>>'),
        false,
        `${tc.name}: no line begins with a conflict marker`
      );
    }
  }
});
