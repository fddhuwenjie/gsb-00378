/**
 * 随机文本/编辑脚本生成器：小字母表面孔以制造重复行，覆盖空行、Unicode、空白行。
 */
import { randInt, pick } from './prng';

/** 行池：刻意小，迫使重复行出现；不含冲突标记整行，避免干扰标记解析 */
export const LINE_POOL: readonly string[] = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'x',
  'y',
  '',
  ' ',
  'foo bar',
  '  indented',
  'tab\there',
  'trailing ',
  '中文行',
  'emoji 🚀',
  'línea acentuada',
  '=== not a marker',
  'long ' + 'z'.repeat(60),
];

export interface Scenario {
  base: string;
  local: string;
  remote: string;
}

export function genRandomLines(rng: () => number, maxLen = 30): string[] {
  const n = randInt(rng, 0, maxLen);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(pick(rng, LINE_POOL));
  }
  return lines;
}

/** 以固定换行语义生成文本：非空行数组以 \n 连接并带结尾换行；空数组为空串 */
export function linesToText(lines: string[]): string {
  if (lines.length === 0) return '';
  return lines.join('\n') + '\n';
}

export interface EditOp {
  pos: number;
  delCount: number;
  insert: string[];
}

/** 对行数组应用一组随机编辑（位置升序、互不重叠） */
export function applyRandomEdits(
  rng: () => number,
  baseLines: string[],
  maxEdits = 4
): { lines: string[]; ops: EditOp[] } {
  const lines = [...baseLines];
  const editCount = randInt(rng, 0, maxEdits);
  const ops: EditOp[] = [];
  let cursor = 0;
  for (let e = 0; e < editCount; e++) {
    if (lines.length === 0 && cursor > 0) break;
    const pos = randInt(rng, cursor, lines.length);
    const delCount = randInt(rng, 0, Math.min(2, Math.max(0, lines.length - pos)));
    const insCount = randInt(rng, 0, 2);
    if (delCount === 0 && insCount === 0) continue;
    const insert: string[] = [];
    for (let k = 0; k < insCount; k++) insert.push(pick(rng, LINE_POOL));
    lines.splice(pos, delCount, ...insert);
    ops.push({ pos, delCount, insert });
    cursor = pos + insert.length + 1; // 保证下一次编辑不与本次重叠
  }
  return { lines, ops };
}

/**
 * 不相交修改场景：base 使用唯一哨兵行，local/remote 各改一个窗口，
 * 两个窗口之间至少隔 1 行未修改行（按 git 语义，相接即冲突）。
 */
export function genDisjointScenario(rng: () => number): {
  base: string;
  local: string;
  remote: string;
  expectedMerged: string;
} {
  const n = randInt(rng, 6, 24);
  const baseLines = Array.from({ length: n }, (_, i) => `L${i}`);
  // 窗口1: [s1, e1)，窗口2: [s2, e2)，要求 e1 < s2（至少 1 行间隔）
  const s1 = randInt(rng, 0, n - 4);
  const e1 = randInt(rng, s1, Math.min(s1 + 2, n - 3));
  const s2 = randInt(rng, e1 + 1, n - 1);
  const e2 = randInt(rng, s2 + 1, n);

  const localInsert = Array.from({ length: randInt(rng, 0, 2) }, (_, i) => `loc-${i}-${s1}`);
  const remoteInsert = Array.from({ length: randInt(rng, 0, 2) }, (_, i) => `rem-${i}-${s2}`);

  const localLines = [...baseLines];
  localLines.splice(s1, e1 - s1, ...localInsert);
  const remoteLines = [...baseLines];
  remoteLines.splice(s2, e2 - s2, ...remoteInsert);
  const mergedLines = [...baseLines];
  mergedLines.splice(s2, e2 - s2, ...remoteInsert);
  mergedLines.splice(s1, e1 - s1, ...localInsert);

  return {
    base: linesToText(baseLines),
    local: linesToText(localLines),
    remote: linesToText(remoteLines),
    expectedMerged: linesToText(mergedLines),
  };
}

/** 差分语料：base/local/remote 三份随机文本（local/remote 由 base 编辑而来） */
export function genDiffScenario(rng: () => number, maxBaseLen = 24): Scenario {
  const baseLines = genRandomLines(rng, maxBaseLen);
  const local = applyRandomEdits(rng, baseLines).lines;
  const remote = applyRandomEdits(rng, baseLines).lines;
  return {
    base: linesToText(baseLines),
    local: linesToText(local),
    remote: linesToText(remote),
  };
}
