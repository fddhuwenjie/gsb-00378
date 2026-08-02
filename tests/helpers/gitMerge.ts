/**
 * git merge-file 差分执行器：每个样本独立临时目录，支持并发池。
 * 依赖本机 git 可执行文件（本地开发工具，非外部服务、不占用端口）。
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface GitMergeResult {
  /** git merge-file 退出码：0=干净合并；>0=冲突个数 */
  exitCode: number;
  content: string;
}

export function checkGitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function gitMergeFile(base: string, local: string, remote: string): Promise<GitMergeResult> {
  const dir = mkdtempSync(path.join(tmpdir(), 'gmdiff-'));
  const fBase = path.join(dir, 'base.txt');
  const fLocal = path.join(dir, 'local.txt');
  const fRemote = path.join(dir, 'remote.txt');
  writeFileSync(fBase, base);
  writeFileSync(fLocal, local);
  writeFileSync(fRemote, remote);

  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['merge-file', '-L', 'local', '-L', 'base', '-L', 'remote', fLocal, fBase, fRemote],
      { stdio: 'pipe' },
      (error) => {
        try {
          const content = readFileSync(fLocal, 'utf8');
          // execFile 在非 0 退出码时回调 error；git merge-file 以冲突数作为退出码
          const exitCode = error && typeof (error as { code?: number }).code === 'number'
            ? (error as { code: number }).code
            : 0;
          resolve({ exitCode, content });
        } catch (e) {
          reject(e);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    );
  });
}

/** 简单并发池 */
export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, run);
  await Promise.all(runners);
  return results;
}
