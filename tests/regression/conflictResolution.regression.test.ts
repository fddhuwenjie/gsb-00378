/**
 * [冲突解决] 问题回归：多冲突定位（旧绝对行号漂移）、重复解决、未知/伪造冲突、无效输入。
 * 期望值按冲突块结构与解决语义手工推导，不复制实现输出。
 */
import { describe, it, expect } from 'vitest';
import { performThreeWayMerge, resolveConflict, ConflictValidationError } from '../../api/algorithms/threeWayMerge';
import type { Conflict } from '../../shared/types';

function twoConflictScenario() {
  // 第 2、8 行双方各改不同内容 → 两个独立冲突
  return performThreeWayMerge(
    '1\n2\n3\n4\n5\n6\n7\n8\n',
    '1\nL2\n3\n4\n5\n6\n7\nL8\n',
    '1\nR2\n3\n4\n5\n6\n7\nR8\n'
  );
}

function threeConflictScenario() {
  // 第 2、5、a 行双方各改不同内容 → 三个独立冲突
  return performThreeWayMerge(
    '1\n2\n3\n4\n5\n6\n7\n8\n9\na\n',
    '1\nL2\n3\n4\nL5\n6\n7\n8\n9\nLa\n',
    '1\nR2\n3\n4\nR5\n6\n7\n8\n9\nRa\n'
  );
}

describe('[冲突解决] 多冲突定位：旧绝对行号漂移后仍准确定位', () => {
  it('两个冲突：顺序解决，后续冲突持原始（过期行号）对象', () => {
    const merged = twoConflictScenario();
    expect(merged.conflicts).toHaveLength(2);
    const [c1, c2] = merged.conflicts;

    const after1 = resolveConflict(merged.mergedContent, c1, 'local');
    expect(after1).toBe('1\nL2\n3\n4\n5\n6\n7\n<<<<<<< local\nL8\n=======\nR8\n>>>>>>> remote\n');

    // c2 行号已漂移（5 行块 → 1 行，偏移 -4），直接提交原始对象由内容重定位
    const after2 = resolveConflict(after1, c2, 'remote');
    expect(after2).toBe('1\nL2\n3\n4\n5\n6\n7\nR8\n');
  });

  it('三个冲突：乱序解决（中 → 前 → 后），全部持原始对象', () => {
    const merged = threeConflictScenario();
    expect(merged.conflicts).toHaveLength(3);
    const [c1, c2, c3] = merged.conflicts;

    const after1 = resolveConflict(merged.mergedContent, c2, 'remote');
    const after2 = resolveConflict(after1, c1, 'local');
    const after3 = resolveConflict(after2, c3, 'local');
    expect(after3).toBe('1\nL2\n3\n4\nR5\n6\n7\n8\n9\nLa\n');
  });

  it('manual 产生正偏移后，后续冲突仍按内容重定位', () => {
    const merged = twoConflictScenario();
    const [c1, c2] = merged.conflicts;
    const after1 = resolveConflict(merged.mergedContent, c1, 'manual', 'm1\nm2\nm3');
    const after2 = resolveConflict(after1, c2, 'local');
    expect(after2).toBe('1\nm1\nm2\nm3\n3\n4\n5\n6\n7\nL8\n');
  });
});

describe('[冲突解决] 重复解决：幂等或明确拒绝', () => {
  it('对已解决文本再次提交同一冲突 → 明确拒绝（ConflictValidationError）', () => {
    const merged = performThreeWayMerge('a\nb\nc\n', 'a\nL\nc\n', 'a\nR\nc\n');
    const conflict = merged.conflicts[0];
    const after = resolveConflict(merged.mergedContent, conflict, 'local');
    expect(after).toBe('a\nL\nc\n');
    expect(() => resolveConflict(after, conflict, 'local')).toThrow(ConflictValidationError);
    expect(() => resolveConflict(after, conflict, 'local')).toThrow(/定位失败|无效|不?匹配/);
  });

  it('同一输入重复调用：纯函数幂等，输出逐字节一致', () => {
    const merged = twoConflictScenario();
    const c1 = merged.conflicts[0];
    const first = resolveConflict(merged.mergedContent, c1, 'remote');
    for (let i = 0; i < 3; i++) {
      expect(resolveConflict(merged.mergedContent, c1, 'remote')).toBe(first);
    }
  });
});

describe('[冲突解决] 未知 / 伪造冲突不能替换任意文本', () => {
  const merged = performThreeWayMerge('a\nb\nc\nd\ne\n', 'a\nL\nc\nd\ne\n', 'a\nR\nc\nd\ne\n');
  const real = merged.conflicts[0];

  it('未知 id + 编造内容 → ConflictValidationError', () => {
    const forged: Conflict = { ...real, id: 'conflict-does-not-exist', localContent: ['x'], remoteContent: ['y'] };
    expect(() => resolveConflict(merged.mergedContent, forged, 'local')).toThrow(ConflictValidationError);
  });

  it('内容被篡改（位置指向真实冲突块）→ ConflictValidationError', () => {
    const forged: Conflict = { ...real, localContent: ['FORGED'] };
    expect(() => resolveConflict(merged.mergedContent, forged, 'remote')).toThrow(ConflictValidationError);
  });

  it('伪造位置 + 真实内容 → 重定位到真实冲突块，普通文本逐字节保留', () => {
    const stale: Conflict = { ...real, startLine: 0, endLine: 0 };
    const out = resolveConflict(merged.mergedContent, stale, 'local');
    expect(out).toBe('a\nL\nc\nd\ne\n');
  });

  it('localContent 非数组 → ConflictValidationError（无效输入）', () => {
    const bad = { ...real, localContent: null } as unknown as Conflict;
    expect(() => resolveConflict(merged.mergedContent, bad, 'local')).toThrow(/无效|缺失/);
  });
});

describe('[冲突解决] 无效输入', () => {
  it('非法 resolution 取值 → ConflictValidationError', () => {
    const merged = performThreeWayMerge('a\nb\nc\n', 'a\nL\nc\n', 'a\nR\nc\n');
    const conflict = merged.conflicts[0];
    expect(() =>
      resolveConflict(merged.mergedContent, conflict, 'theirs' as 'local')
    ).toThrow(ConflictValidationError);
    expect(() => resolveConflict(merged.mergedContent, conflict, 'theirs' as 'local')).toThrow(/无效解决方式/);
  });
});
