/**
 * [API] 问题回归：空文件处理、无效输入、错误响应结构、重复执行、冲突定位全流程。
 * 随机端口（listen(0)），不依赖外部服务，用例结束自动关闭服务。
 * 期望值按 API 契约手工推导，不复制实现输出。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Conflict } from '../../shared/types';
import app from '../../api/app';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  expect(port).toBeGreaterThan(0);
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
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

const ONE_CONFLICT = { base: 'a\nb\nc\n', local: 'a\nL\nc\n', remote: 'a\nR\nc\n' };
const TWO_CONFLICTS = {
  base: '1\n2\n3\n4\n5\n6\n7\n8\n',
  local: '1\nL2\n3\n4\n5\n6\n7\nL8\n',
  remote: '1\nR2\n3\n4\n5\n6\n7\nR8\n',
};

describe('[API] 空文件回归', () => {
  it('三方皆空 → 200，空结果无冲突', async () => {
    const { status, json } = await postJson('/api/merge', { base: '', local: '', remote: '' });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.mergedContent).toBe('');
    expect(json.conflictCount).toBe(0);
  });

  it('空 base 双边添加 → 200 且一个冲突（空文件不被拒绝）', async () => {
    const { status, json } = await postJson('/api/merge', { base: '', local: 'l1\n', remote: 'r1\n' });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.conflictCount).toBe(1);
  });
});

describe('[API] 无效输入与错误响应', () => {
  const invalidMergeBodies: Array<{ name: string; body: unknown }> = [
    { name: '缺 remote 字段', body: { base: 'a', local: 'b' } },
    { name: 'base 为非字符串', body: { base: 123, local: 'b', remote: 'c' } },
    { name: 'local 为 null', body: { base: 'a', local: null, remote: 'c' } },
  ];
  for (const { name, body } of invalidMergeBodies) {
    it(`merge ${name} → 400 且错误结构完整`, async () => {
      const { status, json } = await postJson('/api/merge', body);
      expect(status).toBe(400);
      expect(json.success).toBe(false);
      expect(typeof json.error).toBe('string');
      expect(json.error.length).toBeGreaterThan(0);
    });
  }

  it('resolve 非法 resolution → 400', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const { status, json } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: merge.json.conflicts[0],
      resolution: 'theirs',
    });
    expect(status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/Invalid resolution/);
  });

  it('resolve manual 缺 customContent → 400', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const { status, json } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: merge.json.conflicts[0],
      resolution: 'manual',
    });
    expect(status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/customContent/);
  });

  it('resolve 冲突对象缺 id → 400', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const { id: _omit, ...withoutId } = merge.json.conflicts[0] as Record<string, unknown>;
    const { status, json } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: withoutId,
      resolution: 'local',
    });
    expect(status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/Invalid conflict/);
  });

  it('resolve 冲突内容非数组 → 400', async () => {
    const merge = await postJson('/api/merge', ONE_CONFLICT);
    const bad = { ...(merge.json.conflicts[0] as object), localContent: 'not-an-array' };
    const { status } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: bad,
      resolution: 'local',
    });
    expect(status).toBe(400);
  });

  it('未知冲突 ID + 编造内容 → 400，不返回替换后文本', async () => {
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

  it('未注册路由 → 404 且错误结构完整', async () => {
    const res = await fetch(`${baseUrl}/api/not-exists`);
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toBe('API not found');
  });
});

describe('[API] 重复执行确定性', () => {
  it('同一合并请求连续 3 次：除随机冲突 id 外响应完全一致', async () => {
    const strip = (json: any) => ({
      ...json,
      conflicts: (json.conflicts as Array<Record<string, unknown>>).map(({ id: _id, ...rest }) => rest),
    });
    const first = strip((await postJson('/api/merge', TWO_CONFLICTS)).json);
    for (let i = 0; i < 3; i++) {
      const r = await postJson('/api/merge', TWO_CONFLICTS);
      expect(r.status).toBe(200);
      expect(strip(r.json)).toEqual(first);
    }
  });
});

describe('[API] 冲突定位全流程与下载结果回归', () => {
  it('双冲突：旧行号原始对象依次解决，最终下载内容逐字节精确', async () => {
    const merge = await postJson('/api/merge', TWO_CONFLICTS);
    expect(merge.json.conflictCount).toBe(2);
    const [c1, c2]: Conflict[] = merge.json.conflicts;

    const step1 = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: c1,
      resolution: 'local',
    });
    expect(step1.status).toBe(200);

    const step2 = await postJson('/api/resolve', {
      mergedContent: step1.json.mergedContent,
      conflict: c2,
      resolution: 'remote',
    });
    expect(step2.status).toBe(200);

    const download: string = step2.json.mergedContent;
    expect(download).toBe('1\nL2\n3\n4\n5\n6\n7\nR8\n');
    expect(download).not.toContain('<<<<<<<');
    expect(download).not.toContain('>>>>>>>');
  });

  it('重复解决同一冲突：第一次 200，第二次 400', async () => {
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
