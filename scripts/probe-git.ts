/**
 * 探针2：git merge-file 的 ZEALOUS 冲突细化 / 区间合并行为。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function gitMergeFile(base: string, local: string, remote: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'probe-'));
  const fBase = path.join(dir, 'base.txt');
  const fLocal = path.join(dir, 'local.txt');
  const fRemote = path.join(dir, 'remote.txt');
  writeFileSync(fBase, base);
  writeFileSync(fLocal, local);
  writeFileSync(fRemote, remote);
  let exitCode = 0;
  try {
    execFileSync('git', ['merge-file', '-L', 'local', '-L', 'base', '-L', 'remote', fLocal, fBase, fRemote], { stdio: 'pipe' });
  } catch (e: any) {
    exitCode = e.status ?? -1;
  }
  const content = readFileSync(fLocal, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { exitCode, content };
}

const cases: Array<[string, string, string, string]> = [
  ['重叠修改含共同后缀 Z',
    'a\nb\nc\n', 'a\nX\nZ\nc\n', 'a\nY\nZ\nc\n'],
  ['重叠修改含共同前缀 Z',
    'a\nb\nc\n', 'a\nZ\nX\nc\n', 'a\nZ\nY\nc\n'],
  ['部分重叠区间 local[1,3) remote[2,4)',
    '1\n2\n3\n4\n5\n', '1\nA\n4\n5\n', '1\n2\nB\n5\n'],
  ['两个相距 1 行的冲突',
    '1\n2\n3\n4\n5\n6\n7\n8\n', '1\nL2\n3\n4\n5\n6\n7\nL8\n', '1\nR2\n3\n4\n5\n6\n7\nR8\n'],
  ['相邻不相交修改 local[1,2) remote[2,3)',
    'a\nb\nc\n', 'a\nb2\nc\n', 'a\nb\nc2\n'],
  ['insert-at-end-boundary 但内容等于被改前行',
    'a\nb\nc\n', 'a\nb\nc\nx\n', 'a\nB\nc\n'],
  ['remote 修改紧贴 local 插入之后',
    'a\nb\nc\nd\n', 'a\nx\nb\nc\nd\n', 'a\nb\nC\nd\n'],
  ['local 删除紧贴 remote 修改之后(删 c, 改 b)',
    'a\nb\nc\nd\n', 'a\nb\nd\n', 'a\nB\nc\nd\n'],
  ['双方删除有共同部分 local删[1,3) remote删[2,4)',
    '1\n2\n3\n4\n5\n', '1\n4\n5\n', '1\n2\n5\n'],
  ['完全相同的多行修改',
    '1\n2\n3\n', '1\nA\nB\n', '1\nA\nB\n'],
  ['一边修改完全包含另一边 local改[1,4) remote改[2,3)',
    '1\n2\n3\n4\n5\n', '1\nA\n5\n', '1\n2\nB\n4\n5\n'],
  ['重叠但 local 内容是 remote 子串前缀',
    'a\nb\nc\n', 'a\nX\nY\nc\n', 'a\nX\nc\n'],
];

for (const [name, base, local, remote] of cases) {
  const { exitCode, content } = gitMergeFile(base, local, remote);
  console.log('=== ' + name + ' (exit=' + exitCode + ')');
  console.log(JSON.stringify(content));
}
