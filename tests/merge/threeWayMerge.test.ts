/**
 * REGRESSION SUITE — category: merge (three-way merge)
 *
 * Migrates the previous clean-merge table tests, CRLF/newline tests, conflict
 * DETECTION tests and the deterministic property tests. Conflict RESOLUTION
 * lives in tests/conflict. Expected values are hand-derived from the merge
 * rules (identical edits win silently, disjoint edits both apply, divergent
 * edits produce a git-style block), never copied from implementation output.
 * Run alone with `npm run test:merge`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge.ts';
import { splitLines } from '../../api/algorithms/myersDiff.ts';

const MARK_LOCAL = '<<<<<<< local';
const MARK_SEP = '=======';
const MARK_REMOTE = '>>>>>>> remote';

describe('merge: clean merges (table driven)', () => {
  interface Case {
    name: string;
    base: string;
    local: string;
    remote: string;
    expected: string;
    conflictCount: number;
  }

  const cases: Case[] = [
    {
      name: 'all empty stays empty with no conflicts',
      base: '',
      local: '',
      remote: '',
      expected: '',
      conflictCount: 0,
    },
    {
      name: 'empty base, both sides add identical content',
      base: '',
      local: 'a\nb',
      remote: 'a\nb',
      expected: 'a\nb',
      conflictCount: 0,
    },
    {
      name: 'only local changed keeps local edit',
      base: 'a\nb\nc',
      local: 'a\nB\nc',
      remote: 'a\nb\nc',
      expected: 'a\nB\nc',
      conflictCount: 0,
    },
    {
      name: 'only remote changed keeps remote edit',
      base: 'a\nb\nc',
      local: 'a\nb\nc',
      remote: 'a\nb\nC',
      expected: 'a\nb\nC',
      conflictCount: 0,
    },
    {
      name: 'disjoint edits are both preserved',
      base: 'a\nb\nc\nd\ne',
      local: 'A\nb\nc\nd\ne',
      remote: 'a\nb\nc\nd\nE',
      expected: 'A\nb\nc\nd\nE',
      conflictCount: 0,
    },
    {
      name: 'both sides make the identical edit — no conflict',
      base: 'a\nb\nc',
      local: 'a\nZ\nc',
      remote: 'a\nZ\nc',
      expected: 'a\nZ\nc',
      conflictCount: 0,
    },
    {
      name: 'unicode single-side edit',
      base: 'café\n😀',
      local: 'CAFÉ\n😀',
      remote: 'café\n😀',
      expected: 'CAFÉ\n😀',
      conflictCount: 0,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = performThreeWayMerge(c.base, c.local, c.remote);
      assert.equal(result.mergedContent, c.expected);
      assert.equal(result.conflictCount, c.conflictCount);
      assert.equal(result.hasConflicts, c.conflictCount > 0);
    });
  }
});

describe('merge: CRLF and trailing newlines', () => {
  it('normalizes CRLF input to LF in the merged output', () => {
    const result = performThreeWayMerge('a\r\nb\r\nc', 'a\r\nB\r\nc', 'a\r\nb\r\nc');
    assert.equal(result.mergedContent, 'a\nB\nc');
    assert.equal(result.conflictCount, 0);
  });

  it('treats a mixed CRLF/LF identical edit on both sides as conflict-free', () => {
    const result = performThreeWayMerge('a\nb\nc', 'a\r\nZ\r\nc', 'a\nZ\nc');
    assert.equal(result.mergedContent, 'a\nZ\nc');
    assert.equal(result.conflictCount, 0);
  });

  it('preserves the trailing empty line produced by a trailing newline', () => {
    const result = performThreeWayMerge('a\nb\n', 'a\nb\n', 'a\nb\n');
    assert.equal(result.mergedContent, 'a\nb\n');
    assert.equal(result.conflictCount, 0);
  });
});

describe('merge: conflict detection', () => {
  it('marks both-sides-different edits as a single conflict block', () => {
    const result = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    assert.equal(result.conflictCount, 1);
    assert.equal(result.hasConflicts, true);
    assert.equal(
      result.mergedContent,
      ['a', MARK_LOCAL, 'X', MARK_SEP, 'Y', MARK_REMOTE, 'c'].join('\n')
    );

    const conflict = result.conflicts[0];
    assert.deepEqual(conflict.localContent, ['X']);
    assert.deepEqual(conflict.remoteContent, ['Y']);
    assert.deepEqual(conflict.baseContent, ['b']);
    assert.equal(conflict.resolved, false);
  });

  it('detects two independent conflicts with distinct ids', () => {
    const result = performThreeWayMerge(
      'a\nb\nc\nd\ne',
      'A1\nb\nc\nd\nE1',
      'A2\nb\nc\nd\nE2'
    );
    assert.equal(result.conflictCount, 2);
    assert.notEqual(result.conflicts[0].id, result.conflicts[1].id);
    assert.deepEqual(result.conflicts[0].localContent, ['A1']);
    assert.deepEqual(result.conflicts[1].localContent, ['E1']);
  });
});

describe('merge property: merge(base, x, x) === x', () => {
  const CORPUS: string[] = [
    '',
    'a',
    'a\nb',
    'a\nb\nc',
    'a\nb\nc\nd\ne',
    'x\nx\nx',
    'line1\nline2\nline3\nline4',
    'café\n😀\nΩ',
    'a\nb\n',
  ];

  for (const base of CORPUS) {
    for (const x of CORPUS) {
      it(`base=${JSON.stringify(base)} x=${JSON.stringify(x)}`, () => {
        const result = performThreeWayMerge(base, x, x);
        assert.equal(result.conflictCount, 0, 'identical sides must not conflict');
        assert.equal(result.mergedContent, x);
      });
    }
  }
});

describe('merge property: single-side change merges without conflict', () => {
  interface Edit {
    name: string;
    base: string;
    edit: (lines: string[]) => string[];
  }

  const edits: Edit[] = [
    {
      name: 'modify first line',
      base: 'a\nb\nc\nd',
      edit: (l) => ['A', ...l.slice(1)],
    },
    {
      name: 'modify middle line',
      base: 'a\nb\nc\nd',
      edit: (l) => [l[0], 'B', ...l.slice(2)],
    },
    {
      name: 'append a line',
      base: 'a\nb\nc',
      edit: (l) => [...l, 'z'],
    },
    {
      name: 'delete a line',
      base: 'a\nb\nc\nd',
      edit: (l) => l.filter((_, i) => i !== 2),
    },
    {
      name: 'insert into the middle',
      base: 'a\nb\nc',
      edit: (l) => [l[0], 'NEW', ...l.slice(1)],
    },
  ];

  for (const e of edits) {
    const changed = e.edit(splitLines(e.base)).join('\n');

    it(`local-only: ${e.name}`, () => {
      const result = performThreeWayMerge(e.base, changed, e.base);
      assert.equal(result.conflictCount, 0);
      assert.equal(result.mergedContent, changed);
    });

    it(`remote-only: ${e.name}`, () => {
      const result = performThreeWayMerge(e.base, e.base, changed);
      assert.equal(result.conflictCount, 0);
      assert.equal(result.mergedContent, changed);
    });
  }
});

describe('merge property: disjoint edits are both preserved without conflict', () => {
  interface Case {
    name: string;
    base: string;
    local: string;
    remote: string;
    expected: string;
  }

  const cases: Case[] = [
    {
      name: 'edit first vs edit last',
      base: 'a\nb\nc\nd\ne',
      local: 'A\nb\nc\nd\ne',
      remote: 'a\nb\nc\nd\nE',
      expected: 'A\nb\nc\nd\nE',
    },
    {
      name: 'edit top region vs edit bottom region',
      base: 'l1\nl2\nl3\nl4\nl5\nl6',
      local: 'l1\nL2\nl3\nl4\nl5\nl6',
      remote: 'l1\nl2\nl3\nl4\nL5\nl6',
      expected: 'l1\nL2\nl3\nl4\nL5\nl6',
    },
    {
      name: 'local inserts near top, remote inserts near bottom',
      base: 'a\nb\nc\nd\ne\nf',
      local: 'a\nNEW\nb\nc\nd\ne\nf',
      remote: 'a\nb\nc\nd\ne\nEXTRA\nf',
      expected: 'a\nNEW\nb\nc\nd\ne\nEXTRA\nf',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = performThreeWayMerge(c.base, c.local, c.remote);
      assert.equal(result.conflictCount, 0, 'disjoint edits must not conflict');
      assert.equal(result.mergedContent, c.expected);
      assert.ok(!result.mergedContent.includes('<<<<<<<'));
    });
  }
});

describe('merge: repeated execution is deterministic', () => {
  // Rule: the merge is a pure function — same inputs must give identical merged
  // text, conflict count and per-conflict payloads on every call. (Conflict ids
  // are random, so we compare everything except id.)
  const cases: Array<{ base: string; local: string; remote: string }> = [
    { base: 'a\nb\nc', local: 'a\nX\nc', remote: 'a\nY\nc' },
    { base: 'a\nb\nc\nd\ne', local: 'A1\nb\nc\nd\nE1', remote: 'A2\nb\nc\nd\nE2' },
    { base: '', local: 'a\nb', remote: 'a\nb' },
  ];

  for (const c of cases) {
    it(`stable merged content + conflicts across runs: ${JSON.stringify(c)}`, () => {
      const first = performThreeWayMerge(c.base, c.local, c.remote);
      const second = performThreeWayMerge(c.base, c.local, c.remote);
      assert.equal(second.mergedContent, first.mergedContent);
      assert.equal(second.conflictCount, first.conflictCount);
      const strip = (r: typeof first) =>
        r.conflicts.map((x) => ({
          startLine: x.startLine,
          endLine: x.endLine,
          localContent: x.localContent,
          remoteContent: x.remoteContent,
          baseContent: x.baseContent,
        }));
      assert.deepEqual(strip(second), strip(first));
    });
  }
});

describe('merge: degenerate / edge inputs', () => {
  it('empty local with non-empty base+remote deletes on the local side', () => {
    // Rule: base 'a\nb', local '' (deleted everything), remote unchanged 'a\nb'.
    // Only local changed, so the deletion wins => empty result, no conflict.
    const result = performThreeWayMerge('a\nb', '', 'a\nb');
    assert.equal(result.conflictCount, 0);
    assert.equal(result.mergedContent, '');
  });

  it('both sides delete everything — identical edit, no conflict, empty output', () => {
    const result = performThreeWayMerge('a\nb\nc', '', '');
    assert.equal(result.conflictCount, 0);
    assert.equal(result.mergedContent, '');
  });

  it('one side edits a line the other deletes — divergent, produces a conflict', () => {
    // base 'a\nb\nc'; local edits b->B; remote deletes b. These touch the same
    // base region divergently, so a conflict block must be produced.
    const result = performThreeWayMerge('a\nb\nc', 'a\nB\nc', 'a\nc');
    assert.equal(result.hasConflicts, true);
    assert.ok(result.mergedContent.includes(MARK_LOCAL));
  });
});
