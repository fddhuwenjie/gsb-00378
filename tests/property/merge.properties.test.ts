/**
 * 固定种子属性测试（每条不变量 300 次迭代，种子固定可复现）：
 *  P1 merge(base, x, x) = x 且无冲突
 *  P2 只改单边 → 无冲突且结果等于被改边
 *  P3 不相交修改 → 无冲突且两边修改同时保留
 *  P4 交换 local/remote → 只允许冲突两侧互换
 *
 * 种子：P1=0x9E3779B9 P2=0x85EBCA6B P3=0xC2B2AE35 P4=0x27D4EB2F
 */
import { describe, it, expect } from 'vitest';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge';
import { toLF } from '../../api/utils/lineUtils';
import { mulberry32, randInt } from '../helpers/prng';
import { genRandomLines, linesToText, applyRandomEdits, genDisjointScenario } from '../helpers/textGen';

const ITERATIONS = 300;

/** 把合并文本中的冲突块两侧内容互换（用于 P4 对称性断言） */
function swapConflictSides(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === '<<<<<<< local') {
      const start = i;
      let sep = -1;
      let end = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (sep === -1 && lines[j] === '=======') sep = j;
        if (lines[j] === '>>>>>>> remote') {
          end = j;
          break;
        }
      }
      if (sep === -1 || end === -1) throw new Error('冲突标记不完整');
      const localSide = lines.slice(start + 1, sep);
      const remoteSide = lines.slice(sep + 1, end);
      out.push('<<<<<<< local', ...remoteSide, '=======', ...localSide, '>>>>>>> remote');
      i = end + 1;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join('\n');
}

describe('P1: merge(base, x, x) = x 且无冲突（种子 0x9E3779B9）', () => {
  it('300 次随机迭代', () => {
    const rng = mulberry32(0x9e3779b9);
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const base = linesToText(genRandomLines(rng, 24));
      const x = linesToText(genRandomLines(rng, 24));
      const result = performThreeWayMerge(base, x, x);
      expect(result.hasConflicts, `iter=${iter} base=${JSON.stringify(base)} x=${JSON.stringify(x)}`).toBe(false);
      expect(result.mergedContent, `iter=${iter}`).toBe(toLF(x));
    }
  });

  it('x 为无结尾换行文本时也成立', () => {
    const rng = mulberry32(0x9e3779b9);
    for (let iter = 0; iter < 100; iter++) {
      const base = linesToText(genRandomLines(rng, 12));
      const xLines = genRandomLines(rng, 12);
      const x = xLines.join('\n'); // 无结尾换行
      const result = performThreeWayMerge(base, x, x);
      expect(result.hasConflicts, `iter=${iter}`).toBe(false);
      expect(result.mergedContent, `iter=${iter}`).toBe(toLF(x));
    }
  });
});

describe('P2: 只改单边 → 无冲突且结果等于被改边（种子 0x85EBCA6B）', () => {
  it('local 单边修改 300 次', () => {
    const rng = mulberry32(0x85ebca6b);
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const baseLines = genRandomLines(rng, 24);
      const base = linesToText(baseLines);
      const local = linesToText(applyRandomEdits(rng, baseLines).lines);
      const result = performThreeWayMerge(base, local, base);
      expect(result.hasConflicts, `iter=${iter} base=${JSON.stringify(base)} local=${JSON.stringify(local)}`).toBe(false);
      expect(result.mergedContent, `iter=${iter}`).toBe(toLF(local));
    }
  });

  it('remote 单边修改 300 次', () => {
    const rng = mulberry32(0x85ebca6b);
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const baseLines = genRandomLines(rng, 24);
      const base = linesToText(baseLines);
      const remote = linesToText(applyRandomEdits(rng, baseLines).lines);
      const result = performThreeWayMerge(base, base, remote);
      expect(result.hasConflicts, `iter=${iter}`).toBe(false);
      expect(result.mergedContent, `iter=${iter}`).toBe(toLF(remote));
    }
  });
});

describe('P3: 不相交修改 → 两边修改同时保留（种子 0xC2B2AE35）', () => {
  it('300 次随机迭代', () => {
    const rng = mulberry32(0xc2b2ae35);
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const { base, local, remote, expectedMerged } = genDisjointScenario(rng);
      const result = performThreeWayMerge(base, local, remote);
      expect(
        result.hasConflicts,
        `iter=${iter} base=${JSON.stringify(base)} local=${JSON.stringify(local)} remote=${JSON.stringify(remote)}`
      ).toBe(false);
      expect(result.mergedContent, `iter=${iter}`).toBe(expectedMerged);
    }
  });
});

describe('P4: 交换 local/remote 只允许冲突两侧互换（种子 0x27D4EB2F）', () => {
  it('300 次随机迭代', () => {
    const rng = mulberry32(0x27d4eb2f);
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const baseLines = genRandomLines(rng, 20);
      const base = linesToText(baseLines);
      const local = linesToText(applyRandomEdits(rng, baseLines).lines);
      const remote = linesToText(applyRandomEdits(rng, baseLines).lines);

      const r1 = performThreeWayMerge(base, local, remote);
      const r2 = performThreeWayMerge(base, remote, local);

      const ctx = `iter=${iter} base=${JSON.stringify(base)} local=${JSON.stringify(local)} remote=${JSON.stringify(remote)}`;
      expect(r2.conflictCount, ctx).toBe(r1.conflictCount);
      if (!r1.hasConflicts) {
        expect(r2.mergedContent, ctx).toBe(r1.mergedContent);
      } else {
        // 合并文本仅允许冲突两侧互换
        expect(swapConflictSides(r2.mergedContent), ctx).toBe(r1.mergedContent);
        for (let k = 0; k < r1.conflicts.length; k++) {
          expect(r2.conflicts[k].localContent, ctx).toEqual(r1.conflicts[k].remoteContent);
          expect(r2.conflicts[k].remoteContent, ctx).toEqual(r1.conflicts[k].localContent);
          expect(r2.conflicts[k].startLine, ctx).toBe(r1.conflicts[k].startLine);
          expect(r2.conflicts[k].endLine, ctx).toBe(r1.conflicts[k].endLine);
        }
      }
    }
  });
});

describe('P5: 合并结果可重复（确定性）', () => {
  it('同一输入两次合并结果逐字节一致（除冲突 id）', () => {
    const rng = mulberry32(0x1234abcd);
    for (let iter = 0; iter < 50; iter++) {
      const baseLines = genRandomLines(rng, 12);
      const base = linesToText(baseLines);
      const local = linesToText(applyRandomEdits(rng, baseLines).lines);
      const remote = linesToText(applyRandomEdits(rng, baseLines).lines);
      const r1 = performThreeWayMerge(base, local, remote);
      const r2 = performThreeWayMerge(base, local, remote);
      expect(r1.mergedContent).toBe(r2.mergedContent);
      expect(r1.conflictCount).toBe(r2.conflictCount);
      expect(randInt(rng, 0, 1)).toBeGreaterThanOrEqual(0); // 消耗 rng 保持序列推进
    }
  });
});
