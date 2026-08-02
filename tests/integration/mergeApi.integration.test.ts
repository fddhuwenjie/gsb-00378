/**
 * Express API 集成测试：随机端口（listen(0)），不依赖外部服务，用例结束自动关闭服务。
 * 覆盖：空文本合并、一次冲突选择、手工内容、未知冲突 ID、多冲突过期行号解决与最终下载结果。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Conflict, MergeResponse } from '../../shared/types';
import app from '../../api/app';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve()); // 端口 0 = 操作系统分配随机端口
  });
  const { port } = server.address() as AddressInfo;
  expect(port).toBeGreaterThan(0);
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  // 自动关闭服务，避免句柄悬挂
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function postJson(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const ONE_CONFLICT = {
  base: 'a\nb\nc\n',
  local: 'a\nL\nc\n',
  remote: 'a\nR\nc\n',
};

const TWO_CONFLICTS = {
  base: '1\n2\n3\n4\n5\n6\n7\n8\n',
  local: '1\nL2\n3\n4\n5\n6\n7\nL8\n',
  remote: '1\nR2\n3\n4\n5\n6\n7\nR8\n',
};

describe('POST /api/merge', () => {
  it('空文本三方皆空：200 且合并结果为空、无冲突（空文件不被拒绝）', async () => {
    const { status, json } = await postJson('/api/merge', { base: '', local: '', remote: '' });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.mergedContent).toBe('');
    expect(json.hasConflicts).toBe(false);
    expect(json.conflictCount).toBe(0);
    expect(json.conflicts).toEqual([]);
  });

  it('空 base：双边添加不同内容 → 一个冲突', async () => {
    const { status, json } = await postJson('/api/merge', { base: '', local: 'l1\n', remote: 'r1\n' });
    expect(status).toBe(200);
    expect(json.hasConflicts).toBe(true);
    expect(json.conflictCount).toBe(1);
  });

  it('缺失字段（与空字符串不同）→ 400', async () => {
    const { status, json } = await postJson('/api/merge', { base: 'a', local: 'b' });
    expect(status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('无冲突场景：不相交修改同时保留', async () => {
    const { status, json } = await postJson('/api/merge', {
      base: 'a\nb\nc\nd\ne\n',
      local: 'A\nb\nc\nd\ne\n',
      remote: 'a\nb\nc\nd\nE\n',
    });
    expect(status).toBe(200);
    expect(json.mergedContent).toBe('A\nb\nc\nd\nE\n');
    expect(json.hasConflicts).toBe(false);
  });
});

describe('POST /api/resolve：一次冲突选择', () => {
  const cases: Array<{ name: string; resolution: 'local' | 'remote'; expected: string }> = [
    { name: '选择 local', resolution: 'local', expected: 'a\nL\nc\n' },
    { name: '选择 remote', resolution: 'remote', expected: 'a\nR\nc\n' },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const merge = await postJson('/api/merge', ONE_CONFLICT);
      expect(merge.json.conflictCount).toBe(1);
      const conflict: Conflict = merge.json.conflicts[0];

      const { status, json } = await postJson('/api/resolve', {
        mergedContent: merge.json.mergedContent,
        conflict,
        resolution: c.resolution,
      });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.mergedContent).toBe(c.expected);
    });
  }

  it('非法 resolution 取值 → 400', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const { status } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: merge.json.conflicts[0],
      resolution: 'theirs',
    });
    expect(status).toBe(400);
  });
});

describe('POST /api/resolve：手工内容', () => {
  it('manual 多行内容替换冲突块', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const { status, json } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: merge.json.conflicts[0],
      resolution: 'manual',
      customContent: '手工\n内容',
    });
    expect(status).toBe(200);
    expect(json.mergedContent).toBe('a\n手工\n内容\nc\n');
  });

  it('manual 缺少 customContent → 400', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const { status } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: merge.json.conflicts[0],
      resolution: 'manual',
    });
    expect(status).toBe(400);
  });
});

describe('POST /api/resolve：未知冲突 ID 不能替换任意文本', () => {
  it('未知 id + 编造内容 → 400，且不返回替换后的文本', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const real: Conflict = merge.json.conflicts[0];
    const forged = { ...real, id: 'conflict-does-not-exist', localContent: ['x'], remoteContent: ['y'] };

    const { status, json } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: forged,
      resolution: 'local',
    });
    expect(status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.mergedContent).toBeUndefined();
  });

  it('未知 id + 真实内容 + 指向普通文本的伪造位置：重定位到真实冲突块，普通文本不被替换', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const real: Conflict = merge.json.conflicts[0];
    const forged = { ...real, id: 'conflict-forged', startLine: 0, endLine: 0 };

    const { status, json } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: forged,
      resolution: 'local',
    });
    // 指向的第 0 行普通文本 'a' 原样保留，真实冲突块被解决
    expect(status).toBe(200);
    expect(json.mergedContent).toBe('a\nL\nc\n');
  });

  it('缺失 id 字段 → 400', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const real = merge.json.conflicts[0] as Record<string, unknown>;
    const { id: _omit, ...withoutId } = real;

    const { status } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: withoutId,
      resolution: 'local',
    });
    expect(status).toBe(400);
  });

  it('重复解决同一冲突：第一次 200，第二次 400（明确拒绝）', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const conflict: Conflict = merge.json.conflicts[0];

    const first = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict,
      resolution: 'local',
    });
    expect(first.status).toBe(200);

    const second = await postJson('/api/resolve', {
      mergedContent: first.json.mergedContent,
      conflict,
      resolution: 'local',
    });
    expect(second.status).toBe(400);
    expect(second.json.success).toBe(false);
  });
});

describe('多冲突全流程与最终下载结果', () => {
  it('两个冲突：解决前序后提交旧行号原始对象仍准确定位，最终内容即下载结果', async () => {
    const merge = await postJson('/api/merge', TWO_CONFLICTS);
    expect(merge.json.conflictCount).toBe(2);
    const [c1, c2]: Conflict[] = merge.json.conflicts;

    // 解决第一个冲突（local）
    const step1 = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: c1,
      resolution: 'local',
    });
    expect(step1.status).toBe(200);

    // 直接提交含旧绝对行号的原始 c2 对象（不做行号平移）
    const step2 = await postJson('/api/resolve', {
      mergedContent: step1.json.mergedContent,
      conflict: c2,
      resolution: 'remote',
    });
    expect(step2.status).toBe(200);

    // 最终内容 = 前端 downloadFile 写出的内容：无冲突标记残留，选择同时保留
    const download: string = step2.json.mergedContent;
    expect(download).toBe('1\nL2\n3\n4\n5\n6\n7\nR8\n');
    expect(download).not.toContain('<<<<<<<');
    expect(download).not.toContain('>>>>>>>');
  });

  it('无冲突合并的结果可直接作为下载内容（逐字节等于输入边）', async () => {
    const merge = await postJson('/api/merge', {
      base: 'a\nb\nc\n',
      local: 'a\nB\nc\n',
      remote: 'a\nb\nc\n',
    });
    expect(merge.status).toBe(200);
    expect(merge.json.hasConflicts).toBe(false);
    expect(merge.json.mergedContent).toBe('a\nB\nc\n');
  });
});
