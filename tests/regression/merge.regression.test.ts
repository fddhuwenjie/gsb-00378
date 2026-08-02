/**
 * [merge] 问题回归：空文件、重复行、行尾（CRLF/混合/无结尾换行）。
 * 期望值按合并语义手工推导（修改提取 → 闭区间分组 → ZEALOUS 细化 → 行拼接），
 * 不复制实现输出。
 */
import { describe, it, expect } from 'vitest';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge';
import type { Conflict } from '../../shared/types';

type ConflictShape = Pick<Conflict, 'startLine' | 'endLine' | 'localContent' | 'remoteContent' | 'baseContent'>;

interface MergeCase {
  name: string;
  base: string;
  local: string;
  remote: string;
  expectedContent: string;
  expectedConflicts: ConflictShape[];
}

const cases: MergeCase[] = [
  {
    name: '空文件：三方皆空 → 空结果无冲突',
    base: '',
    local: '',
    remote: '',
    expectedContent: '',
    expectedConflicts: [],
  },
  {
    name: '空文件：空 base 双边添加不同多行内容 → 一个冲突',
    base: '',
    local: 'l1\nl2\n',
    remote: 'r1\n',
    expectedContent: '<<<<<<< local\nl1\nl2\n=======\nr1\n>>>>>>> remote\n',
    expectedConflicts: [
      { startLine: 0, endLine: 5, localContent: ['l1', 'l2'], remoteContent: ['r1'], baseContent: [] },
    ],
  },
  {
    name: '空文件：local 删空、remote 不变 → 结果为空（只改单边）',
    base: 'a\nb\n',
    local: '',
    remote: 'a\nb\n',
    expectedContent: '',
    expectedConflicts: [],
  },
  {
    name: '空文件：双边同时删空 → 干净合并为空（双方同改）',
    base: 'a\n',
    local: '',
    remote: '',
    expectedContent: '',
    expectedConflicts: [],
  },
  {
    name: '重复行：remote 在重复行组末尾追加 → 只改单边无冲突',
    base: 'k\nk\n',
    local: 'k\nk\n',
    remote: 'k\nk\nk\n',
    expectedContent: 'k\nk\nk\n',
    expectedConflicts: [],
  },
  {
    name: '重复行：双边在同一重复行组后追加不同内容 → 冲突',
    base: 'k\nk\n',
    local: 'k\nk\nL\n',
    remote: 'k\nk\nR\n',
    expectedContent: 'k\nk\n<<<<<<< local\nL\n=======\nR\n>>>>>>> remote\n',
    expectedConflicts: [
      { startLine: 2, endLine: 6, localContent: ['L'], remoteContent: ['R'], baseContent: [] },
    ],
  },
  {
    name: '行尾：CRLF 输入统一规范化为 LF 后合并',
    base: 'a\r\nb\r\n',
    local: 'a\r\nB\r\n',
    remote: 'a\r\nb\r\n',
    expectedContent: 'a\nB\n',
    expectedConflicts: [],
  },
  {
    name: '行尾：CRLF 与 LF 混合表达同一文本 → 无修改无冲突',
    base: 'a\r\nb\n',
    local: 'a\nb\r\n',
    remote: 'a\r\nb\n',
    expectedContent: 'a\nb\n',
    expectedConflicts: [],
  },
  {
    name: '行尾：无结尾换行单边改末行 → 结果保持无结尾换行',
    base: 'a\nb',
    local: 'a\nB',
    remote: 'a\nb',
    expectedContent: 'a\nB',
    expectedConflicts: [],
  },
];

describe('[merge] 空文件 / 重复行 / 行尾回归', () => {
  for (const c of cases) {
    it(c.name, () => {
      const result = performThreeWayMerge(c.base, c.local, c.remote);
      expect(result.mergedContent).toBe(c.expectedContent);
      expect(result.hasConflicts).toBe(c.expectedConflicts.length > 0);
      expect(result.conflictCount).toBe(c.expectedConflicts.length);
      expect(
        result.conflicts.map((k) => ({
          startLine: k.startLine,
          endLine: k.endLine,
          localContent: k.localContent,
          remoteContent: k.remoteContent,
          baseContent: k.baseContent,
        }))
      ).toEqual(c.expectedConflicts);
    });
  }
});

describe('[merge] 重复执行确定性', () => {
  it('同一输入连续合并 5 次：合并文本与冲突（除随机 id）完全一致', () => {
    const base = '1\n2\n3\n4\n5\n';
    const local = '1\nL2\n3\n4\nL5\n';
    const remote = '1\nR2\n3\n4\nR5\n';
    const first = performThreeWayMerge(base, local, remote);
    expect(first.conflictCount).toBe(2);
    for (let i = 0; i < 5; i++) {
      const r = performThreeWayMerge(base, local, remote);
      expect(r.mergedContent).toBe(first.mergedContent);
      expect(r.conflicts.map(({ id: _id, ...rest }) => rest)).toEqual(
        first.conflicts.map(({ id: _id, ...rest }) => rest)
      );
    }
  });
});
