/**
 * 合并会话测试：保存恢复、进程重启、内容篡改、重复保存。
 * 持久化使用仓库内临时目录 tests/.tmp/sessions，测试结束后整体清理。
 * 恢复前后直接比较：冲突 ID、已解决状态、输出哈希。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Conflict } from '../../shared/types';
import {
  ALGORITHM_VERSION,
  SESSION_FORMAT_VERSION,
  createSession,
  decide,
  saveSession,
  loadSession,
  restoreSession,
  hashOutput,
  type MergeSessionData,
  type SessionState,
} from '../../api/algorithms/mergeSession';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.join(__dirname, '..', '.tmp');

const BASE = '1\n2\n3\n4\n5\n6\n7\n8\n';
const LOCAL = '1\nL2\n3\n4\n5\n6\n7\nL8\n';
const REMOTE = '1\nR2\n3\n4\n5\n6\n7\nR8\n';

let workDir: string;

beforeAll(() => {
  mkdirSync(TMP_ROOT, { recursive: true });
  workDir = mkdtempSync(path.join(TMP_ROOT, 'sessions-'));
});

afterAll(() => {
  // 清理临时会话文件（含临时根目录；Windows 删除可能瞬时失败，需重试）
  rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(TMP_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  expect(existsSync(workDir)).toBe(false);
  expect(existsSync(TMP_ROOT)).toBe(false);
});

/** 建好两个冲突并分别做 local / manual 决定的会话，返回会话状态与保存路径 */
function decidedSession(): { state: SessionState; file: string } {
  const state = createSession(BASE, LOCAL, REMOTE);
  expect(state.conflicts).toHaveLength(2);
  const [c1, c2] = state.conflicts;
  decide(state, c1.id, 'local');
  decide(state, c2.id, 'manual', 'hand-8');
  const file = saveSession(workDir, state.data);
  return { state, file };
}

describe('会话保存与恢复', () => {
  it('保存后不残留绝对行号，包含哈希/算法版本/决定/手工内容', () => {
    const { file } = decidedSession();
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const text = readFileSync(file, 'utf8');

    expect(raw.formatVersion).toBe(SESSION_FORMAT_VERSION);
    expect(raw.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(typeof (raw.inputHashes as any).base).toBe('string');
    expect(typeof raw.outputHash).toBe('string');
    expect(Array.isArray(raw.decisions)).toBe(true);
    // 决定含稳定冲突 ID 与手工内容，且全文不含行号字段
    const decisions = raw.decisions as Array<Record<string, unknown>>;
    expect(decisions).toHaveLength(2);
    expect(decisions[0].resolution).toBe('local');
    expect(decisions[1].resolution).toBe('manual');
    expect(decisions[1].customContent).toBe('hand-8');
    expect(text).not.toContain('startLine');
    expect(text).not.toContain('endLine');
    expect(text).not.toContain(BASE); // 不保存输入原文
  });

  it('恢复同一输入：冲突 ID、已解决状态、输出哈希与保存前完全一致', () => {
    const { state, file } = decidedSession();
    const preIds = state.conflicts.map((c) => c.id);
    const preResolved = state.conflicts.map((c) => c.resolved);
    const preHash = state.data.outputHash;

    const result = restoreSession(loadSession(file), BASE, LOCAL, REMOTE);

    expect(result.inputsChanged).toBe(false);
    expect(result.algorithmChanged).toBe(false);
    expect(result.requireReconfirmation).toBe(false);
    expect(result.conflicts.map((c) => c.id)).toEqual(preIds);
    expect(result.conflicts.map((c) => c.resolved)).toEqual(preResolved);
    expect(result.conflicts.map((c) => c.resolution)).toEqual(['local', 'manual']);
    expect(result.outputHash).toBe(preHash);
    expect(result.replayedDecisions).toHaveLength(2);
    expect(result.invalidDecisions).toHaveLength(0);
    expect(result.pendingConflicts).toHaveLength(0);
    expect(result.mergedContent).toBe(state.content);
    expect(result.mergedContent).not.toContain('<<<<<<<');
  });

  it('未解决完的会话：恢复后保留未决冲突待处理', () => {
    const state = createSession(BASE, LOCAL, REMOTE);
    decide(state, state.conflicts[0].id, 'remote');
    const file = saveSession(workDir, state.data, 'partial.json');

    const result = restoreSession(loadSession(file), BASE, LOCAL, REMOTE);
    expect(result.replayedDecisions).toHaveLength(1);
    expect(result.pendingConflicts).toHaveLength(1);
    expect(result.pendingConflicts[0].id).toBe(state.conflicts[1].id);
    expect(result.conflicts.map((c) => c.resolved)).toEqual([true, false]);
  });
});

describe('进程重启后恢复', () => {
  it('全新进程从磁盘恢复：冲突 ID、已解决状态、输出哈希与重启前一致', () => {
    const { state, file } = decidedSession();

    // 输入写入临时文件（会话不保存原文，重启后由调用方提供输入）
    const baseFile = path.join(workDir, 'base.txt');
    const localFile = path.join(workDir, 'local.txt');
    const remoteFile = path.join(workDir, 'remote.txt');
    writeFileSync(baseFile, BASE);
    writeFileSync(localFile, LOCAL);
    writeFileSync(remoteFile, REMOTE);

    const driver = path.join(__dirname, 'replayDriver.ts');
    const proc = spawnSync(
      process.execPath,
      ['--import', 'tsx', driver, file, baseFile, localFile, remoteFile],
      { encoding: 'utf8', timeout: 60000 }
    );
    expect(proc.status).toBe(0);
    expect(proc.stderr).toBe('');
    const out = JSON.parse(proc.stdout);

    expect(out.conflictIds).toEqual(state.conflicts.map((c) => c.id));
    expect(out.resolved).toEqual([true, true]);
    expect(out.resolutions).toEqual(['local', 'manual']);
    expect(out.replayedCount).toBe(2);
    expect(out.invalidCount).toBe(0);
    expect(out.inputsChanged).toBe(false);
    expect(out.outputHash).toBe(state.data.outputHash);
    expect(out.mergedContent).toBe(state.content);
  });
});

describe('内容篡改识别', () => {
  it('输入冲突区被修改：旧决定全部失效并要求重新确认，绝不套到相似文本', () => {
    const { state, file } = decidedSession();
    // 篡改 local 的冲突行：L2→L2x，相似但不同
    const tamperedLocal = LOCAL.replace('L2', 'L2x');
    expect(tamperedLocal).not.toBe(LOCAL);

    const result = restoreSession(loadSession(file), BASE, tamperedLocal, REMOTE);

    expect(result.inputsChanged).toBe(true);
    expect(result.requireReconfirmation).toBe(true);
    // 篡改改变了第一个冲突的内容 → 其 ID 变化 → 对应决定失效
    expect(result.invalidDecisions.length).toBeGreaterThanOrEqual(1);
    expect(result.invalidDecisions.map((d) => d.conflictId)).toContain(state.conflicts[0].id);
    // 旧输出绝不能复现（旧决定没有被套到相似文本上）
    expect(result.outputHash).not.toBe(state.data.outputHash);
    expect(result.mergedContent).not.toBe(state.content);
    // 仍有未决冲突需要重新确认
    expect(result.pendingConflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('输入在非冲突区被修改：内容一致的冲突决定仍可精确重放', () => {
    const { state, file } = decidedSession();
    // 篡改第 4 行（非冲突区）：'4' → '4x'
    const tamperedBase = BASE.replace('4', '4x');
    const tamperedLocal = LOCAL.replace('4', '4x');
    const tamperedRemote = REMOTE.replace('4', '4x');

    const result = restoreSession(loadSession(file), tamperedBase, tamperedLocal, tamperedRemote);

    expect(result.inputsChanged).toBe(true);
    // 两个冲突内容未变 → ID 不变 → 决定全部有效重放，无失效
    expect(result.invalidDecisions).toHaveLength(0);
    expect(result.requireReconfirmation).toBe(false);
    expect(result.conflicts.map((c) => c.id)).toEqual(state.conflicts.map((c) => c.id));
    // 输出包含被篡改的非冲突行，哈希自然不同于旧输出
    expect(result.mergedContent).toContain('4x');
    expect(result.mergedContent).not.toContain('<<<<<<<');
  });

  it('会话文件被篡改（决定指向不存在的冲突 ID）：该决定失效', () => {
    const { file } = decidedSession();
    const data = loadSession(file) as MergeSessionData;
    data.decisions[0] = { ...data.decisions[0], conflictId: 'conflict-tampered' };
    const tamperedFile = path.join(workDir, 'tampered.json');
    writeFileSync(tamperedFile, JSON.stringify(data, null, 2));

    const result = restoreSession(loadSession(tamperedFile), BASE, LOCAL, REMOTE);
    expect(result.invalidDecisions).toHaveLength(1);
    expect(result.invalidDecisions[0].conflictId).toBe('conflict-tampered');
    expect(result.replayedDecisions).toHaveLength(1);
    expect(result.requireReconfirmation).toBe(true);
  });

  it('会话文件算法版本被篡改：全部决定失效，不做任何重放', () => {
    const { file } = decidedSession();
    const data = loadSession(file) as MergeSessionData;
    data.algorithmVersion = 'threeway-1999.01.0';
    const tamperedFile = path.join(workDir, 'old-version.json');
    writeFileSync(tamperedFile, JSON.stringify(data, null, 2));

    const result = restoreSession(loadSession(tamperedFile), BASE, LOCAL, REMOTE);
    expect(result.algorithmChanged).toBe(true);
    expect(result.replayedDecisions).toHaveLength(0);
    expect(result.invalidDecisions).toHaveLength(2);
    expect(result.requireReconfirmation).toBe(true);
    expect(result.pendingConflicts).toHaveLength(2);
  });

  it('损坏的会话文件：loadSession 明确报错', () => {
    const badFile = path.join(workDir, 'corrupt.json');
    writeFileSync(badFile, '{"formatVersion":"oops"}');
    expect(() => loadSession(badFile)).toThrow(/损坏|非法/);
  });
});

describe('重复保存与重复决定', () => {
  it('重复保存：两次写入内容逐字节一致，加载结果相同', () => {
    const { state } = decidedSession();
    const f1 = saveSession(workDir, state.data, 'repeat.json');
    const first = readFileSync(f1, 'utf8');
    const f2 = saveSession(workDir, state.data, 'repeat.json');
    const second = readFileSync(f2, 'utf8');
    expect(f2).toBe(f1);
    expect(second).toBe(first);
    expect(loadSession(f2)).toEqual(loadSession(f1));
  });

  it('相同决定重复提交：幂等，不重复记录', () => {
    const state = createSession(BASE, LOCAL, REMOTE);
    const c1 = state.conflicts[0];
    decide(state, c1.id, 'local');
    decide(state, c1.id, 'local');
    expect(state.data.decisions).toHaveLength(1);
    expect(state.content).toContain('L2');
  });

  it('不同决定重复提交同一冲突：明确拒绝', () => {
    const state = createSession(BASE, LOCAL, REMOTE);
    const c1 = state.conflicts[0];
    decide(state, c1.id, 'local');
    expect(() => decide(state, c1.id, 'remote')).toThrow(/不能重复解决/);
  });

  it('未知冲突 ID 记录决定：明确拒绝', () => {
    const state = createSession(BASE, LOCAL, REMOTE);
    expect(() => decide(state, 'conflict-does-not-exist', 'local')).toThrow(/未知冲突 ID/);
  });

  it('manual 缺手工内容：明确拒绝', () => {
    const state = createSession(BASE, LOCAL, REMOTE);
    expect(() => decide(state, state.conflicts[0].id, 'manual')).toThrow(/customContent/);
  });
});

describe('输出哈希独立校验', () => {
  it('恢复输出哈希等于对最终内容独立计算的 SHA-256', () => {
    const { file } = decidedSession();
    const result = restoreSession(loadSession(file), BASE, LOCAL, REMOTE);
    expect(result.outputHash).toBe(hashOutput(result.mergedContent));
    expect(result.outputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
