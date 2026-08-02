import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge';
import { toLF } from '../../api/utils/lineUtils';

describe('merge property: merge(base, x, x) === x', () => {
  const cases = [
    { name: 'both empty', base: '', x: '' },
    { name: 'identical single line', base: 'a', x: 'a' },
    { name: 'both sides apply the same modification', base: 'a\nb\nc', x: 'a\nB\nc' },
    { name: 'both sides add a trailing newline', base: 'a', x: 'a\n' },
    { name: 'both sides remove a trailing newline', base: 'a\n', x: 'a' },
    { name: 'CRLF inputs normalize to LF and match', base: 'a\r\nb\r\n', x: 'a\r\nB\r\n' },
    { name: 'unicode content same on both sides', base: '你好\n世界', x: '你好\nworld' },
    { name: 'duplicate lines edited identically', base: 'x\nx\nx\n', x: 'y\nx\nz\n' },
    { name: 'both sides replace the whole file identically', base: 'old\ncontent', x: 'brand\nnew\ncontent' },
  ];

  for (const tc of cases) {
    it(tc.name, () => {
      const result = performThreeWayMerge(tc.base, tc.x, tc.x);
      assert.equal(result.conflictCount, 0, 'identical sides must not conflict');
      assert.equal(result.hasConflicts, false);
      assert.equal(result.mergedContent, toLF(tc.x));
    });
  }
});

describe('merge property: changing only one side never conflicts and yields that side', () => {
  const localChanges = [
    { name: 'local appends a line', base: 'a\nb', local: 'a\nb\nc', remote: 'a\nb' },
    { name: 'local deletes a line', base: 'a\nb\nc', local: 'a\nc', remote: 'a\nb\nc' },
    { name: 'local edits with no trailing newline', base: 'a', local: 'A', remote: 'a' },
    { name: 'local changes unicode line', base: '你好\n世界', local: '你好\n地球', remote: '你好\n世界' },
    { name: 'local changes a duplicate line', base: 'x\nx\nx', local: 'x\nY\nx', remote: 'x\nx\nx' },
  ];
  for (const tc of localChanges) {
    it(`local only: ${tc.name}`, () => {
      const result = performThreeWayMerge(tc.base, tc.local, tc.remote);
      assert.equal(result.conflictCount, 0);
      assert.equal(result.mergedContent, toLF(tc.local));
    });
  }

  const remoteChanges = [
    { name: 'remote prepends a line', base: 'b\nc', local: 'b\nc', remote: 'a\nb\nc' },
    { name: 'remote modifies a line', base: 'a\nb\nc', local: 'a\nb\nc', remote: 'a\nB\nc' },
    { name: 'remote empties the file', base: 'a\nb', local: 'a\nb', remote: '' },
    { name: 'remote CRLF edit', base: 'a\r\nb', local: 'a\r\nb', remote: 'a\r\nB' },
  ];
  for (const tc of remoteChanges) {
    it(`remote only: ${tc.name}`, () => {
      const result = performThreeWayMerge(tc.base, tc.local, tc.remote);
      assert.equal(result.conflictCount, 0);
      assert.equal(result.mergedContent, toLF(tc.remote));
    });
  }
});

describe('merge property: disjoint modifications are both preserved', () => {
  const cases = [
    {
      name: 'local edits top, remote edits bottom',
      base: 'a\nb\nc\nd',
      local: 'A\nb\nc\nd',
      remote: 'a\nb\nc\nD',
      expected: 'A\nb\nc\nD',
      mustContain: ['A', 'D', 'b', 'c'],
    },
    {
      name: 'local inserts at start, remote appends at end',
      base: 'middle',
      local: 'top\nmiddle',
      remote: 'middle\nbottom',
      expected: 'top\nmiddle\nbottom',
      mustContain: ['top', 'middle', 'bottom'],
    },
    {
      name: 'disjoint edits among duplicate lines',
      base: 'x\nx\nx\nx',
      local: 'Y\nx\nx\nx',
      remote: 'x\nx\nx\nZ',
      expected: 'Y\nx\nx\nZ',
      mustContain: ['Y', 'Z'],
    },
    {
      name: 'disjoint edits with unicode regions',
      base: '一花\n二叶\n三根\n四枝',
      local: '鲜花\n二叶\n三根\n四枝',
      remote: '一花\n二叶\n三根\n枯枝',
      expected: '鲜花\n二叶\n三根\n枯枝',
      mustContain: ['鲜花', '枯枝', '二叶'],
    },
  ];

  for (const tc of cases) {
    it(tc.name, () => {
      const result = performThreeWayMerge(tc.base, tc.local, tc.remote);
      assert.equal(result.conflictCount, 0, 'disjoint changes must not conflict');
      assert.equal(result.hasConflicts, false);
      assert.equal(result.mergedContent, tc.expected);
      for (const fragment of tc.mustContain) {
        assert.ok(result.mergedContent.includes(fragment), `expected result to contain "${fragment}"`);
      }
    });
  }
});
