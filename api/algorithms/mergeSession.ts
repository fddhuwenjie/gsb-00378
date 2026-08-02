/**
 * 可保存的合并会话。
 *
 * 会话文件只保存：输入 base/local/remote 的内容哈希（SHA-256，LF 归一化后）、
 * 算法版本、冲突决定（稳定冲突 ID + 解决方式 + 手工内容）、应用决定后的输出哈希。
 * 不保存输入原文，也不保存任何可漂移的绝对行号。
 *
 * 重新打开（restore）时：对调用方提供的（可能已变化的）输入重新合并，
 * 按稳定冲突 ID 精确匹配并重放决定 —— 内容不同的冲突 ID 必然不同，
 * 旧决定绝不会套到相似但不同的文本上；失效决定被识别并要求重新确认。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Conflict } from '@shared/types';
import { performThreeWayMerge, resolveConflict } from './threeWayMerge';
import { toLF } from '../utils/lineUtils';

/** 会话文件格式版本（结构变更时递增） */
export const SESSION_FORMAT_VERSION = 1;
/** 合并算法版本（合并/解决语义变更时递增，使旧会话决定整体失效） */
export const ALGORITHM_VERSION = 'threeway-2026.08.1';

export type Resolution = 'local' | 'remote' | 'manual';

export interface ConflictDecision {
  conflictId: string;
  resolution: Resolution;
  customContent?: string;
}

export interface MergeSessionData {
  formatVersion: number;
  algorithmVersion: string;
  inputHashes: { base: string; local: string; remote: string };
  decisions: ConflictDecision[];
  /** 应用全部已记录决定后的输出内容哈希 */
  outputHash: string;
}

/** 输入内容哈希（LF 归一化后计算，CRLF/LF 表述同一内容时哈希一致） */
export function hashInput(text: string): string {
  return createHash('sha256').update(toLF(text), 'utf8').digest('hex');
}

/** 输出内容哈希（原样计算，不做行尾归一化） */
export function hashOutput(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface SessionState {
  data: MergeSessionData;
  /** 当前工作内容（已应用决定后） */
  content: string;
  /** 合并产生的冲突（稳定 ID），resolved 标记当前决定状态 */
  conflicts: Conflict[];
}

/** 新建会话：执行合并并初始化空决定列表 */
export function createSession(base: string, local: string, remote: string): SessionState {
  const merge = performThreeWayMerge(base, local, remote);
  return {
    data: {
      formatVersion: SESSION_FORMAT_VERSION,
      algorithmVersion: ALGORITHM_VERSION,
      inputHashes: { base: hashInput(base), local: hashInput(local), remote: hashInput(remote) },
      decisions: [],
      outputHash: hashOutput(merge.mergedContent),
    },
    content: merge.mergedContent,
    conflicts: merge.conflicts.map((c) => ({ ...c })),
  };
}

/**
 * 记录一个冲突决定并应用到工作内容。
 * 冲突必须存在且未解决；同一冲突以相同决定重复提交为幂等（不重复记录），
 * 以不同决定重复提交则明确拒绝（抛错）。
 */
export function decide(
  state: SessionState,
  conflictId: string,
  resolution: Resolution,
  customContent?: string
): void {
  if (resolution !== 'local' && resolution !== 'remote' && resolution !== 'manual') {
    throw new Error(`无效解决方式：${String(resolution)}（必须是 local/remote/manual）`);
  }
  if (resolution === 'manual' && typeof customContent !== 'string') {
    throw new Error('manual 解决方式必须提供手工内容 customContent');
  }

  const conflict = state.conflicts.find((c) => c.id === conflictId);
  if (!conflict) {
    throw new Error(`未知冲突 ID：${conflictId}（不能对不存在的冲突记录决定）`);
  }

  const existing = state.data.decisions.find((d) => d.conflictId === conflictId);
  if (existing) {
    if (existing.resolution === resolution && existing.customContent === customContent) {
      return; // 相同决定重复提交：幂等
    }
    throw new Error(`冲突 ${conflictId} 已有不同决定，不能重复解决`);
  }

  state.content = resolveConflict(state.content, conflict, resolution, customContent);
  conflict.resolved = true;
  conflict.resolution = resolution;
  state.data.decisions.push({ conflictId, resolution, customContent });
  state.data.outputHash = hashOutput(state.content);
}

/** 保存会话到指定目录，返回会话文件完整路径（内容确定，无时间戳） */
export function saveSession(dir: string, data: MergeSessionData, fileName = 'merge-session.json'): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return file;
}

/** 从会话文件加载（仅解析与形状校验，不触碰输入内容） */
export function loadSession(file: string): MergeSessionData {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as MergeSessionData;
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof raw.formatVersion !== 'number' ||
    typeof raw.algorithmVersion !== 'string' ||
    typeof raw.inputHashes?.base !== 'string' ||
    typeof raw.inputHashes?.local !== 'string' ||
    typeof raw.inputHashes?.remote !== 'string' ||
    !Array.isArray(raw.decisions) ||
    typeof raw.outputHash !== 'string'
  ) {
    throw new Error('会话文件损坏或格式非法');
  }
  return raw;
}

export interface RestoreResult {
  /** 重放决定后的最终内容 */
  mergedContent: string;
  /** 最终内容哈希 */
  outputHash: string;
  /** 新鲜合并的冲突；resolved/resolution 反映决定重放结果 */
  conflicts: Conflict[];
  /** 成功重放的决定 */
  replayedDecisions: ConflictDecision[];
  /** 失效决定：找不到内容完全一致的现存冲突（或算法版本变更）→ 必须重新确认 */
  invalidDecisions: ConflictDecision[];
  /** 没有任何决定的现存冲突 */
  pendingConflicts: Conflict[];
  /** 输入内容哈希与会话不一致 */
  inputsChanged: boolean;
  /** 算法/格式版本与会话不一致（此时全部决定失效，不做任何重放） */
  algorithmChanged: boolean;
  /** 是否存在必须重新确认的失效决定 */
  requireReconfirmation: boolean;
}

/**
 * 重新打开会话：对（可能已变化的）输入重新合并，按稳定冲突 ID 重放决定。
 * 决定只重放到 ID 精确匹配的冲突上 —— ID 由冲突内容哈希构成，
 * 文本变化导致冲突内容不同时 ID 必然不同，旧决定不会被误用。
 */
export function restoreSession(data: MergeSessionData, base: string, local: string, remote: string): RestoreResult {
  const merge = performThreeWayMerge(base, local, remote);
  const conflicts = merge.conflicts.map((c) => ({ ...c }));

  const inputsChanged =
    data.inputHashes.base !== hashInput(base) ||
    data.inputHashes.local !== hashInput(local) ||
    data.inputHashes.remote !== hashInput(remote);
  const algorithmChanged =
    data.formatVersion !== SESSION_FORMAT_VERSION || data.algorithmVersion !== ALGORITHM_VERSION;

  let content = merge.mergedContent;
  const replayedDecisions: ConflictDecision[] = [];
  const invalidDecisions: ConflictDecision[] = [];

  if (!algorithmChanged) {
    for (const decision of data.decisions) {
      const target = conflicts.find((c) => c.id === decision.conflictId && !c.resolved);
      if (!target) {
        invalidDecisions.push(decision);
        continue;
      }
      // target 携新鲜内容，resolveConflict 内部按内容重定位，与旧行号无关
      content = resolveConflict(content, target, decision.resolution, decision.customContent);
      target.resolved = true;
      target.resolution = decision.resolution;
      replayedDecisions.push(decision);
    }
  } else {
    invalidDecisions.push(...data.decisions);
  }

  const pendingConflicts = conflicts.filter((c) => !c.resolved);

  return {
    mergedContent: content,
    outputHash: hashOutput(content),
    conflicts,
    replayedDecisions,
    invalidDecisions,
    pendingConflicts,
    inputsChanged,
    algorithmChanged,
    requireReconfirmation: algorithmChanged || invalidDecisions.length > 0,
  };
}

/** 会话文件是否存在于指定路径 */
export function sessionFileExists(file: string): boolean {
  return existsSync(file);
}
