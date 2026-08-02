/**
 * 反例回归：重放 tests/differential/counterexamples/ 中保存的最小反例，
 * 断言当前实现在这些输入上与 git merge-file 一致（冲突状态与无冲突内容）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge';
import { checkGitAvailable, gitMergeFile } from '../helpers/gitMerge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'counterexamples');

interface Counterexample {
  seed: number;
  index: number;
  kind: string;
  base: string;
  local: string;
  remote: string;
}

function load(): Array<{ file: string; data: Counterexample }> {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, data: JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) }));
}

describe('最小反例回归（与 git merge-file 一致）', () => {
  const cases = load();

  beforeAll(() => {
    if (!checkGitAvailable()) {
      throw new Error('回归测试需要本机 git 可执行文件');
    }
  });

  it('反例夹具目录存在（可能为空，表示差分未发现新反例）', () => {
    expect(Array.isArray(cases)).toBe(true);
  });

  for (const { file, data } of cases) {
    it(
      `${file}（kind=${data.kind}）`,
      async () => {
        const ours = performThreeWayMerge(data.base, data.local, data.remote);
        const git = await gitMergeFile(data.base, data.local, data.remote);
        expect(ours.hasConflicts).toBe(git.exitCode > 0);
        if (!ours.hasConflicts) {
          expect(ours.mergedContent).toBe(git.content);
        }
      },
      30000
    );
  }
});
