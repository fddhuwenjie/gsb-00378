/**
 * 反例快照回归（git 对齐通道）：重放 counterexamples/ 中保存的最小反例，
 * 断言当前实现与夹具中捕获的 git merge-file 基准一致（冲突状态与无冲突内容）。
 *
 * 夹具由 gitMergeFile.differential.test.ts 发现新反例时写入（含 git 的退出码与输出）。
 * 注意：本测试属于 git 对齐可选通道（npm run test:differential），当前有 6 例已知分歧，
 * 不包含在根命令 npm test 的核心套件中。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'counterexamples');

interface Counterexample {
  seed: number;
  index: number;
  kind: string;
  base: string;
  local: string;
  remote: string;
  git: { exitCode: number; content: string };
}

function load(): Array<{ file: string; data: Counterexample }> {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, data: JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) }));
}

describe('最小反例回归（对照夹具中捕获的 git merge-file 基准）', () => {
  const cases = load();

  it('反例夹具目录存在且非空', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const { file, data } of cases) {
    it(`${file}（kind=${data.kind}）`, () => {
      const ours = performThreeWayMerge(data.base, data.local, data.remote);
      expect(ours.hasConflicts).toBe(data.git.exitCode > 0);
      if (!ours.hasConflicts) {
        expect(ours.mergedContent).toBe(data.git.content);
      }
    });
  }
});
