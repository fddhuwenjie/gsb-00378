/**
 * 冲突解决（resolveConflict）表驱动测试：
 *  - local/remote/manual 三种选择
 *  - 多冲突：解决前序冲突后，其余冲突仍准确定位
 *    （客户端手动平移行号可以；直接提交含旧绝对行号的原始冲突对象也可以 —— 内容重定位）
 *  - 重复解决同一冲突 → 明确拒绝
 *  - 伪造/未知冲突（内容与任何真实冲突块都不匹配）→ 明确拒绝，不能替换任意文本
 *  - 内容真实但行号失效的冲突对象 → 重定位到真实冲突块解决，绝不触碰块外文本
 */
import { describe, it, expect } from 'vitest';
import { performThreeWayMerge, resolveConflict } from '../../api/algorithms/threeWayMerge';
import type { Conflict } from '../../shared/types';

function twoConflictScenario() {
  // base 行 1..8，第 2、8 行双方各改不同内容 → 两个冲突
  const base = '1\n2\n3\n4\n5\n6\n7\n8\n';
  const local = '1\nL2\n3\n4\n5\n6\n7\nL8\n';
  const remote = '1\nR2\n3\n4\n5\n6\n7\nR8\n';
  return performThreeWayMerge(base, local, remote);
}

function threeConflictScenario() {
  const base = '1\n2\n3\n4\n5\n6\n7\n8\n9\na\n';
  const local = '1\nL2\n3\n4\nL5\n6\n7\n8\n9\nLa\n';
  const remote = '1\nR2\n3\n4\nR5\n6\n7\n8\n9\nRa\n';
  return performThreeWayMerge(base, local, remote);
}

describe('resolveConflict 三种解决方式', () => {
  const scenarios: Array<{
    name: string;
    resolution: 'local' | 'remote' | 'manual';
    customContent?: string;
    expected: string;
  }> = [
    {
      name: '选择 local',
      resolution: 'local',
      expected: 'a\nL\nc\n',
    },
    {
      name: '选择 remote',
      resolution: 'remote',
      expected: 'a\nR\nc\n',
    },
    {
      name: '手工内容（单行）',
      resolution: 'manual',
      customContent: 'hand-written',
      expected: 'a\nhand-written\nc\n',
    },
    {
      name: '手工内容（多行）',
      resolution: 'manual',
      customContent: 'line1\nline2',
      expected: 'a\nline1\nline2\nc\n',
    },
    {
      name: '手工内容（空串 = 删除整个冲突块）',
      resolution: 'manual',
      customContent: '',
      expected: 'a\nc\n',
    },
  ];

  for (const s of scenarios) {
    it(s.name, () => {
      const merged = performThreeWayMerge('a\nb\nc\n', 'a\nL\nc\n', 'a\nR\nc\n');
      const conflict = merged.conflicts[0];
      const out = resolveConflict(merged.mergedContent, conflict, s.resolution, s.customContent);
      expect(out).toBe(s.expected);
    });
  }
});

describe('多冲突定位：解决前序冲突后其余冲突仍准确定位', () => {
  it('解决第一个冲突（local）后，第二个冲突可按新位置解决', () => {
    const merged = twoConflictScenario();
    expect(merged.conflicts).toHaveLength(2);
    const [c1, c2] = merged.conflicts;

    // 解决 c1：localContent 1 行替换 5 行冲突块 → 行偏移 1 - 5 = -4
    const after1 = resolveConflict(merged.mergedContent, c1, 'local');
    expect(after1).toBe(
      '1\nL2\n3\n4\n5\n6\n7\n<<<<<<< local\nL8\n=======\nR8\n>>>>>>> remote\n'
    );

    // c2 位置必须平移 -4，用平移后的位置解决 c2
    const shiftedC2: Conflict = { ...c2, startLine: c2.startLine - 4, endLine: c2.endLine - 4 };
    const after2 = resolveConflict(after1, shiftedC2, 'remote');
    expect(after2).toBe('1\nL2\n3\n4\n5\n6\n7\nR8\n');
  });

  it('解决第一个冲突（manual 多行，正偏移）后，第二个冲突仍准确定位', () => {
    const merged = twoConflictScenario();
    const [c1, c2] = merged.conflicts;

    // manual 3 行替换 5 行冲突块 → 偏移 3 - 5 = -2
    const after1 = resolveConflict(merged.mergedContent, c1, 'manual', 'm1\nm2\nm3');
    const shiftedC2: Conflict = { ...c2, startLine: c2.startLine - 2, endLine: c2.endLine - 2 };
    const after2 = resolveConflict(after1, shiftedC2, 'local');
    expect(after2).toBe('1\nm1\nm2\nm3\n3\n4\n5\n6\n7\nL8\n');
  });

  it('先解决后面的冲突，前面冲突位置不受影响', () => {
    const merged = twoConflictScenario();
    const [c1, c2] = merged.conflicts;

    const after1 = resolveConflict(merged.mergedContent, c2, 'remote');
    const after2 = resolveConflict(after1, c1, 'local');
    expect(after2).toBe('1\nL2\n3\n4\n5\n6\n7\nR8\n');
  });
});

describe('多冲突定位：过期行号的原始冲突对象经内容重定位后仍可解决', () => {
  it('解决第一个冲突后，直接提交原始（旧行号）c2 对象仍准确定位', () => {
    const merged = twoConflictScenario();
    const [c1, c2] = merged.conflicts;

    const after1 = resolveConflict(merged.mergedContent, c1, 'local');
    // 不做任何行号平移：c2 仍是旧绝对行号，服务端按内容重定位
    const after2 = resolveConflict(after1, c2, 'remote');
    expect(after2).toBe('1\nL2\n3\n4\n5\n6\n7\nR8\n');
  });

  it('manual 解决产生正偏移后，原始 c2 对象仍准确定位', () => {
    const merged = twoConflictScenario();
    const [c1, c2] = merged.conflicts;

    const after1 = resolveConflict(merged.mergedContent, c1, 'manual', 'm1\nm2\nm3\nm4\nm5\nm6\nm7');
    const after2 = resolveConflict(after1, c2, 'local');
    expect(after2).toBe('1\nm1\nm2\nm3\nm4\nm5\nm6\nm7\n3\n4\n5\n6\n7\nL8\n');
  });

  it('三个冲突：按旧行号依次解决前两个后，第三个仍准确定位', () => {
    const merged = threeConflictScenario();
    expect(merged.conflicts).toHaveLength(3);
    const [c1, c2, c3] = merged.conflicts;

    const after1 = resolveConflict(merged.mergedContent, c1, 'local');
    const after2 = resolveConflict(after1, c2, 'remote');
    const after3 = resolveConflict(after2, c3, 'manual', 'hand');
    expect(after3).toBe('1\nL2\n3\n4\nR5\n6\n7\n8\n9\nhand\n');
  });

  it('乱序解决：中 → 前 → 后，全部使用原始冲突对象', () => {
    const merged = threeConflictScenario();
    const [c1, c2, c3] = merged.conflicts;

    const after1 = resolveConflict(merged.mergedContent, c2, 'remote');
    const after2 = resolveConflict(after1, c1, 'local');
    const after3 = resolveConflict(after2, c3, 'local');
    expect(after3).toBe('1\nL2\n3\n4\nR5\n6\n7\n8\n9\nLa\n');
  });

  it('重定位不触碰冲突块之外的字节', () => {
    const merged = twoConflictScenario();
    const [c1, c2] = merged.conflicts;
    const after1 = resolveConflict(merged.mergedContent, c1, 'local');
    const linesBefore = after1.split('\n');
    const after2 = resolveConflict(after1, c2, 'remote');
    const linesAfter = after2.split('\n');
    // 冲突块（索引 7..11 的 5 行 → 1 行）之外的前缀逐字节一致
    expect(linesAfter.slice(0, 7)).toEqual(linesBefore.slice(0, 7));
    expect(linesAfter).toEqual(['1', 'L2', '3', '4', '5', '6', '7', 'R8', '']);
  });
});

describe('重复解决同一冲突 → 明确拒绝', () => {
  it('对已解决后的文本再次提交同一 conflict 应抛错（标记已不存在）', () => {
    const merged = performThreeWayMerge('a\nb\nc\n', 'a\nL\nc\n', 'a\nR\nc\n');
    const conflict = merged.conflicts[0];
    const after = resolveConflict(merged.mergedContent, conflict, 'local');
    expect(() => resolveConflict(after, conflict, 'local')).toThrow(/无效|不?匹配|标记/i);
  });

  it('对原始文本重复提交同一 conflict 幂等性：同一输入重复调用结果一致', () => {
    const merged = performThreeWayMerge('a\nb\nc\n', 'a\nL\nc\n', 'a\nR\nc\n');
    const conflict = merged.conflicts[0];
    const r1 = resolveConflict(merged.mergedContent, conflict, 'remote');
    const r2 = resolveConflict(merged.mergedContent, conflict, 'remote');
    expect(r1).toBe(r2); // 纯函数：同输入同输出
  });
});

describe('伪造内容 / 未知冲突 → 明确拒绝，不能替换任意文本', () => {
  const merged = performThreeWayMerge('a\nb\nc\nd\ne\n', 'a\nL\nc\nd\ne\n', 'a\nR\nc\nd\ne\n');
  const real = merged.conflicts[0];

  const forgedCases: Array<{ name: string; conflict: Conflict }> = [
    {
      name: '位置指向冲突块但 localContent 被篡改',
      conflict: { ...real, localContent: ['FORGED'] },
    },
    {
      name: '位置指向冲突块但 remoteContent 被篡改',
      conflict: { ...real, remoteContent: ['FORGED'] },
    },
    {
      name: '完全编造的冲突（未知 id + 编造内容）',
      conflict: { ...real, id: 'conflict-does-not-exist', localContent: ['x'], remoteContent: ['y'] },
    },
    {
      name: '内容恰好等于普通文本行但无冲突标记（企图替换普通行）',
      conflict: { ...real, startLine: 0, endLine: 2, localContent: ['a'], remoteContent: ['b'] },
    },
    {
      name: '空 id + 编造内容',
      conflict: { ...real, id: '', localContent: ['a'], remoteContent: ['a'] },
    },
  ];

  for (const { name, conflict } of forgedCases) {
    it(name, () => {
      expect(() => resolveConflict(merged.mergedContent, conflict, 'local')).toThrow(
        /无效|不?匹配|标记|越界|定位失败/i
      );
    });
  }

  it('合法 conflict（内容逐行匹配标记区）可以正常解决', () => {
    const out = resolveConflict(merged.mergedContent, real, 'local');
    expect(out).toBe('a\nL\nc\nd\ne\n');
  });
});

describe('内容真实但行号失效（过期/被篡改位置）→ 重定位到真实冲突块，块外文本不受影响', () => {
  const merged = performThreeWayMerge('a\nb\nc\nd\ne\n', 'a\nL\nc\nd\ne\n', 'a\nR\nc\nd\ne\n');
  const real = merged.conflicts[0];

  // 这些对象的 local/remote 内容与真实冲突完全一致，仅位置失效：
  // 旧规格按绝对行号 splice（位置漂移缺陷），新规格重定位到真实冲突块。
  const stalePositionCases: Array<{ name: string; conflict: Conflict }> = [
    {
      name: '位置指向普通文本行（解决真实冲突而非删除前两行）',
      conflict: { ...real, startLine: 0, endLine: 1 },
    },
    {
      name: 'startLine/endLine 整体偏移 1 行',
      conflict: { ...real, startLine: real.startLine + 1, endLine: real.endLine + 1 },
    },
    {
      name: 'endLine 越界（不会删除到文件末尾）',
      conflict: { ...real, endLine: 100 },
    },
    {
      name: 'startLine 为负数',
      conflict: { ...real, startLine: -1 },
    },
    {
      name: 'startLine > endLine',
      conflict: { ...real, startLine: real.endLine, endLine: real.startLine },
    },
  ];

  for (const { name, conflict } of stalePositionCases) {
    it(name, () => {
      const out = resolveConflict(merged.mergedContent, conflict, 'local');
      // 结果与精确位置解决完全一致：真实冲突被解决，其余文本逐字节保留
      expect(out).toBe('a\nL\nc\nd\ne\n');
    });
  }
});

describe('resolveConflict 不修改无关文本', () => {
  it('冲突块之外的内容逐字节保留（含 Unicode 与空行）', () => {
    const base = 'α\n\nβ\nc\n';
    const local = 'α\n\nL\nc\n';
    const remote = 'α\n\nR\nc\n';
    const merged = performThreeWayMerge(base, local, remote);
    const out = resolveConflict(merged.mergedContent, merged.conflicts[0], 'remote');
    expect(out).toBe('α\n\nR\nc\n');
  });
});
