/**
 * 与 git merge-file 的差分测试（固定种子 20260802，600 个样本，并发 8）。
 *
 * 对每个随机场景双向断言：
 *  - 我方无冲突 ⇔ git 退出码 0（两个方向都算反例）
 *  - 双方都无冲突时，合并结果必须逐字节一致
 *
 * 失败时自动缩小反例（逐行贪心删减）并保存到 tests/differential/counterexamples/。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge';
import { mulberry32 } from '../helpers/prng';
import { genDiffScenario, type Scenario } from '../helpers/textGen';
import { checkGitAvailable, gitMergeFile, runPool } from '../helpers/gitMerge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COUNTEREXAMPLE_DIR = path.join(__dirname, 'counterexamples');

const SEED = 20260802;
const SAMPLES = 600;
const CONCURRENCY = 8;

interface Mismatch {
  index: number;
  kind: 'conflict-status' | 'content';
  scenario: Scenario;
  oursContent: string;
  oursHasConflicts: boolean;
  gitContent: string;
  gitExitCode: number;
}

function compare(scenario: Scenario, git: { exitCode: number; content: string }): Omit<Mismatch, 'scenario'> | null {
  const ours = performThreeWayMerge(scenario.base, scenario.local, scenario.remote);
  const gitHasConflicts = git.exitCode > 0;
  if (ours.hasConflicts !== gitHasConflicts) {
    return {
      index: -1,
      kind: 'conflict-status',
      oursContent: ours.mergedContent,
      oursHasConflicts: ours.hasConflicts,
      gitContent: git.content,
      gitExitCode: git.exitCode,
    };
  }
  if (!ours.hasConflicts && ours.mergedContent !== git.content) {
    return {
      index: -1,
      kind: 'content',
      oursContent: ours.mergedContent,
      oursHasConflicts: ours.hasConflicts,
      gitContent: git.content,
      gitExitCode: git.exitCode,
    };
  }
  return null;
}

/** 贪心缩小：逐行删减三份输入，保持反例性质不变 */
async function shrink(m: Mismatch): Promise<Mismatch> {
  let { base, local, remote } = m.scenario;
  const stillMismatch = async (b: string, l: string, r: string): Promise<{ exitCode: number; content: string } | null> => {
    const git = await gitMergeFile(b, l, r);
    const bad = compare({ base: b, local: l, remote: r }, git);
    return bad ? git : null;
  };

  let improved = true;
  let rounds = 0;
  while (improved && rounds < 12) {
    improved = false;
    rounds++;
    for (const which of ['base', 'local', 'remote'] as const) {
      const get = () => (which === 'base' ? base : which === 'local' ? local : remote);
      const lines = get().split('\n');
      for (let i = 0; i < lines.length; i++) {
        const candidate = lines.filter((_, idx) => idx !== i).join('\n');
        if (candidate === get()) continue;
        const trial =
          which === 'base'
            ? { base: candidate, local, remote }
            : which === 'local'
              ? { base, local: candidate, remote }
              : { base, local, remote: candidate };
        const git = await stillMismatch(trial.base, trial.local, trial.remote);
        if (git) {
          base = trial.base;
          local = trial.local;
          remote = trial.remote;
          improved = true;
          break;
        }
      }
    }
  }

  const git = await gitMergeFile(base, local, remote);
  const bad = compare({ base, local, remote }, git)!;
  return {
    index: m.index,
    kind: bad.kind,
    scenario: { base, local, remote },
    oursContent: bad.oursContent,
    oursHasConflicts: bad.oursHasConflicts,
    gitContent: git.content,
    gitExitCode: git.exitCode,
  };
}

describe('与 git merge-file 差分（种子 20260802，600 样本）', () => {
  beforeAll(() => {
    if (!checkGitAvailable()) {
      throw new Error('差分测试需要本机 git 可执行文件（git merge-file），当前环境不可用');
    }
    mkdirSync(COUNTEREXAMPLE_DIR, { recursive: true });
  });

  it(
    '600 个随机场景双向比对',
    async () => {
      const rng = mulberry32(SEED);
      const scenarios: Scenario[] = Array.from({ length: SAMPLES }, () => genDiffScenario(rng));

      const mismatches = (
        await runPool(scenarios, CONCURRENCY, async (scenario, index) => {
          const git = await gitMergeFile(scenario.base, scenario.local, scenario.remote);
          const bad = compare(scenario, git);
          return bad ? { ...bad, index, scenario } : null;
        })
      ).filter((m): m is Mismatch => m !== null);

      if (mismatches.length > 0) {
        // 缩小并保存最小反例
        const saved: string[] = [];
        for (const m of mismatches.slice(0, 10)) {
          const minimal = await shrink(m);
          const file = path.join(COUNTEREXAMPLE_DIR, `seed-${SEED}-${String(m.index).padStart(4, '0')}.json`);
          writeFileSync(
            file,
            JSON.stringify(
              {
                seed: SEED,
                index: m.index,
                kind: minimal.kind,
                base: minimal.scenario.base,
                local: minimal.scenario.local,
                remote: minimal.scenario.remote,
                ours: { mergedContent: minimal.oursContent, hasConflicts: minimal.oursHasConflicts },
                git: { exitCode: minimal.gitExitCode, content: minimal.gitContent },
              },
              null,
              2
            )
          );
          saved.push(path.basename(file));
        }
        const first = mismatches[0];
        throw new Error(
          `差分发现 ${mismatches.length}/${SAMPLES} 个反例（已保存最小反例：${saved.join(', ')}）。\n` +
            `首个：index=${first.index} kind=${first.kind}\n` +
            `base=${JSON.stringify(first.scenario.base)}\nlocal=${JSON.stringify(first.scenario.local)}\nremote=${JSON.stringify(first.scenario.remote)}\n` +
            `ours(hasConflicts=${first.oursHasConflicts})=${JSON.stringify(first.oursContent)}\n` +
            `git(exit=${first.gitExitCode})=${JSON.stringify(first.gitContent)}`
        );
      }
    },
    300000
  );
});

// 供报告使用：导出常量
export const DIFFERENTIAL_META = { SEED, SAMPLES, CONCURRENCY };
