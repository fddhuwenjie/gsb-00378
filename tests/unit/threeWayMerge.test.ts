/**
 * 三方合并表驱动测试。
 * 涉及合并语义的期望值均先用 git merge-file 探针确认（见 scripts/probe-git.ts），
 * 覆盖：空文件、无结尾换行、CRLF、重复行、Unicode、只增、只删、同改、不相交修改。
 */
import { describe, it, expect } from 'vitest';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge';
import { computeLineDiff } from '../../api/algorithms/myersDiff';
import type { Conflict } from '../../shared/types';

interface MergeCase {
  name: string;
  base: string;
  local: string;
  remote: string;
  expectedContent: string;
  /** 期望冲突（忽略 id 与 resolved/resolution 字段），按出现顺序 */
  expectedConflicts?: Array<Pick<Conflict, 'startLine' | 'endLine' | 'localContent' | 'remoteContent' | 'baseContent'>>;
}

const cases: MergeCase[] = [
  {
    name: '空文件三方皆空',
    base: '',
    local: '',
    remote: '',
    expectedContent: '',
    expectedConflicts: [],
  },
  {
    name: '空 base：仅 local 添加（只增单边）',
    base: '',
    local: 'l1\nl2\n',
    remote: '',
    expectedContent: 'l1\nl2\n',
    expectedConflicts: [],
  },
  {
    name: '空 base：仅 remote 添加',
    base: '',
    local: '',
    remote: 'r1\n',
    expectedContent: 'r1\n',
    expectedConflicts: [],
  },
  {
    name: '空 base：双边同位置添加不同内容 → 冲突',
    base: '',
    local: 'l1\n',
    remote: 'r1\n',
    expectedContent: '<<<<<<< local\nl1\n=======\nr1\n>>>>>>> remote\n',
    expectedConflicts: [
      { startLine: 0, endLine: 4, localContent: ['l1'], remoteContent: ['r1'], baseContent: [] },
    ],
  },
  {
    name: '空 base：双边添加相同内容 → 干净合并',
    base: '',
    local: 'same\n',
    remote: 'same\n',
    expectedContent: 'same\n',
    expectedConflicts: [],
  },
  {
    name: '只改单边（local 插入）：结果等于 local',
    base: 'a\nb\nc\n',
    local: 'a\nX\nb\nc\n',
    remote: 'a\nb\nc\n',
    expectedContent: 'a\nX\nb\nc\n',
    expectedConflicts: [],
  },
  {
    name: '只改单边（remote 删除）：结果等于 remote',
    base: 'a\nb\nc\n',
    local: 'a\nb\nc\n',
    remote: 'a\nc\n',
    expectedContent: 'a\nc\n',
    expectedConflicts: [],
  },
  {
    name: '同改：两边改成相同内容 → 干净合并',
    base: 'a\nb\nc\n',
    local: 'a\nB\nc\n',
    remote: 'a\nB\nc\n',
    expectedContent: 'a\nB\nc\n',
    expectedConflicts: [],
  },
  {
    name: '同改：两边多行改成相同内容 → 干净合并',
    base: '1\n2\n3\n',
    local: '1\nA\nB\n',
    remote: '1\nA\nB\n',
    expectedContent: '1\nA\nB\n',
    expectedConflicts: [],
  },
  {
    name: '同改：两边删除相同行 → 干净合并',
    base: 'a\nb\nc\n',
    local: 'a\nc\n',
    remote: 'a\nc\n',
    expectedContent: 'a\nc\n',
    expectedConflicts: [],
  },
  {
    name: '同改同一行但内容不同 → 冲突（位置精确）',
    base: 'a\nb\nc\n',
    local: 'a\nL\nc\n',
    remote: 'a\nR\nc\n',
    expectedContent: 'a\n<<<<<<< local\nL\n=======\nR\n>>>>>>> remote\nc\n',
    expectedConflicts: [
      { startLine: 1, endLine: 5, localContent: ['L'], remoteContent: ['R'], baseContent: ['b'] },
    ],
  },
  {
    name: '不相交修改：两边改动同时保留',
    base: 'a\nb\nc\nd\ne\n',
    local: 'A\nb\nc\nd\ne\n',
    remote: 'a\nb\nc\nd\nE\n',
    expectedContent: 'A\nb\nc\nd\nE\n',
    expectedConflicts: [],
  },
  {
    name: '相接修改区间（touching）→ 冲突（git 闭区间语义）',
    base: 'a\nb\nc\n',
    local: 'a\nb2\nc\n',
    remote: 'a\nb\nc2\n',
    expectedContent: 'a\n<<<<<<< local\nb2\nc\n=======\nb\nc2\n>>>>>>> remote\n',
    expectedConflicts: [
      { startLine: 1, endLine: 7, localContent: ['b2', 'c'], remoteContent: ['b', 'c2'], baseContent: ['b', 'c'] },
    ],
  },
  {
    name: '插入紧贴对方修改之前 → 冲突',
    base: 'a\nb\nc\n',
    local: 'a\nx\nb\nc\n',
    remote: 'a\nB\nc\n',
    expectedContent: 'a\n<<<<<<< local\nx\nb\n=======\nB\n>>>>>>> remote\nc\n',
    expectedConflicts: [
      { startLine: 1, endLine: 6, localContent: ['x', 'b'], remoteContent: ['B'], baseContent: ['b'] },
    ],
  },
  {
    name: '插入紧贴对方修改之后 → 冲突',
    base: 'a\nb\nc\n',
    local: 'a\nB\nc\n',
    remote: 'a\nb\nx\nc\n',
    expectedContent: 'a\n<<<<<<< local\nB\n=======\nb\nx\n>>>>>>> remote\nc\n',
    expectedConflicts: [
      { startLine: 1, endLine: 6, localContent: ['B'], remoteContent: ['b', 'x'], baseContent: ['b'] },
    ],
  },
  {
    name: '插入与对方修改之间隔着未修改行 → 干净合并',
    base: 'a\nb\nc\nd\n',
    local: 'a\nx\nb\nc\nd\n',
    remote: 'a\nb\nC\nd\n',
    expectedContent: 'a\nx\nb\nC\nd\n',
    expectedConflicts: [],
  },
  {
    name: '冲突两侧共同后缀行被移出冲突（ZEALOUS 细化）',
    base: 'a\nb\nc\n',
    local: 'a\nX\nZ\nc\n',
    remote: 'a\nY\nZ\nc\n',
    expectedContent: 'a\n<<<<<<< local\nX\n=======\nY\n>>>>>>> remote\nZ\nc\n',
    expectedConflicts: [
      { startLine: 1, endLine: 5, localContent: ['X'], remoteContent: ['Y'], baseContent: ['b'] },
    ],
  },
  {
    name: '冲突两侧共同前缀行被移出冲突',
    base: 'a\nb\nc\n',
    local: 'a\nZ\nX\nc\n',
    remote: 'a\nZ\nY\nc\n',
    expectedContent: 'a\nZ\n<<<<<<< local\nX\n=======\nY\n>>>>>>> remote\nc\n',
    expectedConflicts: [
      { startLine: 2, endLine: 6, localContent: ['X'], remoteContent: ['Y'], baseContent: ['b'] },
    ],
  },
  {
    name: '部分重叠区间：并集构成一个冲突',
    base: '1\n2\n3\n4\n5\n',
    local: '1\nA\n4\n5\n',
    remote: '1\n2\nB\n5\n',
    expectedContent: '1\n<<<<<<< local\nA\n4\n=======\n2\nB\n>>>>>>> remote\n5\n',
    expectedConflicts: [
      { startLine: 1, endLine: 7, localContent: ['A', '4'], remoteContent: ['2', 'B'], baseContent: ['2', '3', '4'] },
    ],
  },
  {
    name: '一边修改完全包含另一边 → 冲突',
    base: '1\n2\n3\n4\n5\n',
    local: '1\nA\n5\n',
    remote: '1\n2\nB\n4\n5\n',
    expectedContent: '1\n<<<<<<< local\nA\n=======\n2\nB\n4\n>>>>>>> remote\n5\n',
    expectedConflicts: [
      { startLine: 1, endLine: 7, localContent: ['A'], remoteContent: ['2', 'B', '4'], baseContent: ['2', '3', '4'] },
    ],
  },
  {
    name: '双方删除有共同部分 → 冲突（各自剩余行）',
    base: '1\n2\n3\n4\n5\n',
    local: '1\n4\n5\n',
    remote: '1\n2\n5\n',
    expectedContent: '1\n<<<<<<< local\n4\n=======\n2\n>>>>>>> remote\n5\n',
    expectedConflicts: [
      { startLine: 1, endLine: 5, localContent: ['4'], remoteContent: ['2'], baseContent: ['2', '3', '4'] },
    ],
  },
  {
    name: 'local 删行 vs remote 改同一行 → 冲突（local 侧为空）',
    base: 'a\nb\nc\n',
    local: 'a\nc\n',
    remote: 'a\nB\nc\n',
    expectedContent: 'a\n<<<<<<< local\n=======\nB\n>>>>>>> remote\nc\n',
    expectedConflicts: [
      { startLine: 1, endLine: 4, localContent: [], remoteContent: ['B'], baseContent: ['b'] },
    ],
  },
  {
    name: '同位置双插相同内容 → 干净合并（不重复插入）',
    base: 'a\nb\n',
    local: 'a\nX\nb\n',
    remote: 'a\nX\nb\n',
    expectedContent: 'a\nX\nb\n',
    expectedConflicts: [],
  },
  {
    name: '同位置双插不同内容 → 冲突',
    base: 'a\nb\n',
    local: 'a\nX\nb\n',
    remote: 'a\nY\nb\n',
    expectedContent: 'a\n<<<<<<< local\nX\n=======\nY\n>>>>>>> remote\nb\n',
    expectedConflicts: [
      { startLine: 1, endLine: 5, localContent: ['X'], remoteContent: ['Y'], baseContent: [] },
    ],
  },
  {
    name: '重复行：local 在重复行组中插入，remote 改行组首行 → 干净合并（slide-down 锚定）',
    base: 'x\nx\n',
    local: 'x\nx\nx\n',
    remote: 'y\nx\n',
    expectedContent: 'y\nx\nx\n',
    expectedConflicts: [],
  },
  {
    name: '重复行：local 删除重复行组中一行，remote 修改不相邻行 → 干净合并',
    base: 'x\nx\nA\nB\n',
    local: 'x\nA\nB\n',
    remote: 'x\nx\nA\nC\n',
    expectedContent: 'x\nA\nC\n',
    expectedConflicts: [],
  },
  {
    name: 'CRLF 输入：统一规范化为 LF 后合并',
    base: 'a\r\nb\r\n',
    local: 'a\r\nB\r\n',
    remote: 'a\r\nb\r\n',
    expectedContent: 'a\nB\n',
    expectedConflicts: [],
  },
  {
    name: 'CRLF 与 LF 混合输入',
    base: 'a\r\nb\r\nc\r\n',
    local: 'a\nb\nc\n',
    remote: 'a\r\nB\r\nc\r\n',
    expectedContent: 'a\nB\nc\n',
    expectedConflicts: [],
  },
  {
    name: '无结尾换行：单边修改末行 → 结果保持无结尾换行',
    base: 'a\nb',
    local: 'a\nB',
    remote: 'a\nb',
    expectedContent: 'a\nB',
    expectedConflicts: [],
  },
  {
    name: 'Unicode：中文与 emoji，单边插入',
    base: '中文\n🚀\n',
    local: '中文\n🎉\n🚀\n',
    remote: '中文\n🚀\n',
    expectedContent: '中文\n🎉\n🚀\n',
    expectedConflicts: [],
  },
  {
    name: 'Unicode：双边改同一中文行 → 冲突',
    base: '中文\n',
    local: '甲\n',
    remote: '乙\n',
    expectedContent: '<<<<<<< local\n甲\n=======\n乙\n>>>>>>> remote\n',
    expectedConflicts: [
      { startLine: 0, endLine: 4, localContent: ['甲'], remoteContent: ['乙'], baseContent: ['中文'] },
    ],
  },
  {
    name: '空行删除：local 删除空行，remote 不变',
    base: 'a\n\nb\n',
    local: 'a\nb\n',
    remote: 'a\n\nb\n',
    expectedContent: 'a\nb\n',
    expectedConflicts: [],
  },
  {
    name: '两个相距 1 行的独立冲突 → 两个冲突块',
    base: '1\n2\n3\n4\n5\n6\n7\n8\n',
    local: '1\nL2\n3\n4\n5\n6\n7\nL8\n',
    remote: '1\nR2\n3\n4\n5\n6\n7\nR8\n',
    expectedContent:
      '1\n<<<<<<< local\nL2\n=======\nR2\n>>>>>>> remote\n3\n4\n5\n6\n7\n<<<<<<< local\nL8\n=======\nR8\n>>>>>>> remote\n',
    expectedConflicts: [
      { startLine: 1, endLine: 5, localContent: ['L2'], remoteContent: ['R2'], baseContent: ['2'] },
      { startLine: 11, endLine: 15, localContent: ['L8'], remoteContent: ['R8'], baseContent: ['8'] },
    ],
  },
];

describe('ThreeWayMerge 表驱动用例', () => {
  for (const c of cases) {
    it(c.name, () => {
      const result = performThreeWayMerge(c.base, c.local, c.remote);
      expect(result.mergedContent).toBe(c.expectedContent);
      const expected = c.expectedConflicts ?? [];
      expect(result.hasConflicts).toBe(expected.length > 0);
      expect(result.conflictCount).toBe(expected.length);
      expect(
        result.conflicts.map((k) => ({
          startLine: k.startLine,
          endLine: k.endLine,
          localContent: k.localContent,
          remoteContent: k.remoteContent,
          baseContent: k.baseContent,
        }))
      ).toEqual(expected);
    });
  }
});

describe('ThreeWayMerge 结构性不变量', () => {
  it('冲突 startLine/endLine 精确指向合并文本中的标记行', () => {
    const result = performThreeWayMerge('a\nb\nc\n', 'a\nL\nc\n', 'a\nR\nc\n');
    const lines = result.mergedContent.split('\n');
    for (const k of result.conflicts) {
      expect(lines[k.startLine]).toBe('<<<<<<< local');
      expect(lines[k.endLine]).toBe('>>>>>>> remote');
      // 两侧内容与标记间区域一致
      expect(lines.slice(k.startLine + 1, k.startLine + 1 + k.localContent.length)).toEqual(k.localContent);
      const sep = k.startLine + 1 + k.localContent.length;
      expect(lines[sep]).toBe('=======');
      expect(lines.slice(sep + 1, k.endLine)).toEqual(k.remoteContent);
    }
  });

  it('交换 local/remote：无冲突时结果完全相同', () => {
    const r1 = performThreeWayMerge('a\nb\nc\nd\ne\n', 'A\nb\nc\nd\ne\n', 'a\nb\nc\nd\nE\n');
    const r2 = performThreeWayMerge('a\nb\nc\nd\ne\n', 'a\nb\nc\nd\nE\n', 'A\nb\nc\nd\ne\n');
    expect(r1.mergedContent).toBe(r2.mergedContent);
  });

  it('交换 local/remote：冲突时仅两侧内容互换', () => {
    const r1 = performThreeWayMerge('a\nb\nc\n', 'a\nL\nc\n', 'a\nR\nc\n');
    const r2 = performThreeWayMerge('a\nb\nc\n', 'a\nR\nc\n', 'a\nL\nc\n');
    expect(r2.conflicts[0].localContent).toEqual(r1.conflicts[0].remoteContent);
    expect(r2.conflicts[0].remoteContent).toEqual(r1.conflicts[0].localContent);
    expect(r2.conflicts[0].startLine).toBe(r1.conflicts[0].startLine);
    expect(r2.conflicts[0].endLine).toBe(r1.conflicts[0].endLine);
  });

  it('diffs 字段与 computeLineDiff 输出一致，且新侧可还原', () => {
    const base = 'a\nb\nc\n';
    const local = 'a\nL\nc\n';
    const remote = 'a\nb\nc\nR\n';
    const result = performThreeWayMerge(base, local, remote);
    expect(result.diffs.baseToLocal).toEqual(computeLineDiff(base.split('\n'), local.split('\n')));
    expect(result.diffs.baseToRemote).toEqual(computeLineDiff(base.split('\n'), remote.split('\n')));
    // 新侧还原（modify 的 content 是新行内容）
    const reconstructNew = (diffs: typeof result.diffs.baseToLocal) =>
      diffs.filter((d) => d.type !== 'delete').map((d) => d.content);
    expect(reconstructNew(result.diffs.baseToLocal)).toEqual(local.split('\n'));
    expect(reconstructNew(result.diffs.baseToRemote)).toEqual(remote.split('\n'));
  });
});
