import assert from 'node:assert/strict';
import { test, describe, after } from 'node:test';
import type { Server } from 'node:http';
import app from '../../api/app.js';

let server: Server;
let baseUrl: string;

await new Promise<void>((resolve) => {
  server = app.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    } else {
      throw new Error('Failed to bind ephemeral port for API regression tests');
    }
    resolve();
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

describe('[REGRESSION][API] empty text acceptance (bug: empty files rejected)', () => {
  test('all three empty strings return 200 and empty merged content (regression)', async () => {
    const { status, data } = await post<{ success: boolean; mergedContent: string; conflictCount: number }>(
      '/api/merge',
      { base: '', local: '', remote: '' }
    );
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.mergedContent, '');
    assert.equal(data.conflictCount, 0);
  });

  test('empty base with content on both sides works (regression)', async () => {
    const { status, data } = await post<{ success: boolean; mergedContent: string; conflictCount: number }>(
      '/api/merge',
      { base: '', local: 'same', remote: 'same' }
    );
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.mergedContent, 'same');
  });

  test('both sides empty with non-empty base: agreed deletion (regression)', async () => {
    const { status, data } = await post<{ success: boolean; mergedContent: string }>(
      '/api/merge',
      { base: 'a\nb\nc', local: '', remote: '' }
    );
    assert.equal(status, 200);
    assert.equal(data.mergedContent, '');
  });
});

describe('[REGRESSION][API] invalid input and error responses', () => {
  test('missing required field returns 400 (regression)', async () => {
    const { status, data } = await post<{ success: boolean; error?: string }>(
      '/api/merge',
      { base: 'a' }
    );
    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.match(data.error ?? '', /missing required field/i);
  });

  test('non-string field returns 400 (regression)', async () => {
    const { status, data } = await post<{ success: boolean; error?: string }>(
      '/api/merge',
      { base: 123, local: 'a', remote: 'b' }
    );
    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.match(data.error ?? '', /must be strings/i);
  });

  test('resolve with invalid resolution type returns 400 (regression)', async () => {
    const { status, data } = await post<{ success: boolean; error?: string }>(
      '/api/resolve',
      { mergedContent: 'x', conflictId: 'cid', resolution: 'invalid-choice' }
    );
    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.match(data.error ?? '', /invalid resolution type/i);
  });

  test('manual resolution without customContent returns 400 (regression)', async () => {
    const { status, data } = await post<{ success: boolean; error?: string }>(
      '/api/resolve',
      { mergedContent: 'x', conflictId: 'cid', resolution: 'manual' }
    );
    assert.equal(status, 400);
    assert.match(data.error ?? '', /customContent is required/i);
  });

  test('resolve without conflictId returns 400 (regression)', async () => {
    const { status, data } = await post<{ success: boolean; error?: string }>(
      '/api/resolve',
      { mergedContent: 'x', resolution: 'local' }
    );
    assert.equal(status, 400);
    assert.match(data.error ?? '', /conflictId/i);
  });

  test('unknown conflict ID returns 404 and does not alter content (regression)', async () => {
    const merge = await post<{ success: boolean; mergedContent: string; conflicts: Array<{ id: string }> }>(
      '/api/merge',
      { base: 'a', local: 'L', remote: 'R' }
    );
    const original = merge.data.mergedContent;
    const { status, data } = await post<{ success: boolean; mergedContent?: string; error?: string }>(
      '/api/resolve',
      { mergedContent: original, conflictId: 'conflict-does-not-exist', resolution: 'local' }
    );
    assert.equal(status, 404);
    assert.equal(data.success, false);
    assert.match(data.error ?? '', /not found/i);
    assert.equal(data.mergedContent, undefined);
  });
});

describe('[REGRESSION][API] conflict resolution end-to-end and repeated calls', () => {
  test('choose local for one conflict via HTTP (regression)', async () => {
    const merge = await post<{
      success: boolean;
      mergedContent: string;
      conflicts: Array<{ id: string }>;
      conflictCount: number;
    }>('/api/merge', { base: 'shared', local: 'LOCAL', remote: 'REMOTE' });
    assert.equal(merge.data.conflictCount, 1);
    const id = merge.data.conflicts[0].id;

    const resolve = await post<{
      success: boolean;
      mergedContent: string;
      conflictCount: number;
    }>('/api/resolve', {
      mergedContent: merge.data.mergedContent,
      conflictId: id,
      resolution: 'local',
    });
    assert.equal(resolve.status, 200);
    assert.equal(resolve.data.mergedContent, 'LOCAL');
    assert.equal(resolve.data.conflictCount, 0);
  });

  test('manual resolution produces clean downloadable text without markers (regression)', async () => {
    const merge = await post<{
      mergedContent: string;
      conflicts: Array<{ id: string }>;
    }>('/api/merge', { base: 'color: red', local: 'color: blue', remote: 'color: green' });

    const resolve = await post<{ mergedContent: string; conflictCount: number }>(
      '/api/resolve',
      {
        mergedContent: merge.data.mergedContent,
        conflictId: merge.data.conflicts[0].id,
        resolution: 'manual',
        customContent: 'color: purple',
      }
    );
    assert.equal(resolve.data.mergedContent, 'color: purple');
    assert.equal(resolve.data.mergedContent.includes('<<<<<<<'), false);
    assert.equal(resolve.data.mergedContent.includes('>>>>>>>'), false);
    assert.equal(resolve.data.mergedContent.includes('======='), false);
  });

  test('repeated resolution of same conflict ID returns 404 (idempotency regression)', async () => {
    const merge = await post<{
      mergedContent: string;
      conflicts: Array<{ id: string }>;
    }>('/api/merge', { base: 'x', local: 'L', remote: 'R' });
    const id = merge.data.conflicts[0].id;

    const first = await post<{ success: boolean; mergedContent: string }>(
      '/api/resolve',
      { mergedContent: merge.data.mergedContent, conflictId: id, resolution: 'local' }
    );
    assert.equal(first.status, 200);

    const second = await post<{ success: boolean; error?: string }>(
      '/api/resolve',
      { mergedContent: first.data.mergedContent, conflictId: id, resolution: 'remote' }
    );
    assert.equal(second.status, 404);
    assert.equal(second.data.success, false);
  });

  test('multi-conflict drift: after first resolution, second stays accurate via HTTP (regression)', async () => {
    const merge = await post<{
      mergedContent: string;
      conflicts: Array<{ id: string; startLine: number; endLine: number }>;
      conflictCount: number;
    }>('/api/merge', {
      base: '1\n2\n3\n4\n5',
      local: 'L1\n2\n3\n4\nL5',
      remote: 'R1\n2\n3\n4\nR5',
    });
    assert.equal(merge.data.conflictCount, 2);
    const [first, second] = merge.data.conflicts;

    const step1 = await post<{
      mergedContent: string;
      conflicts: Array<{ id: string; startLine: number; endLine: number }>;
      conflictCount: number;
    }>('/api/resolve', {
      mergedContent: merge.data.mergedContent,
      conflictId: first.id,
      resolution: 'local',
    });
    assert.equal(step1.status, 200);
    assert.equal(step1.data.conflictCount, 1);
    assert.equal(step1.data.conflicts[0].id, second.id);

    const lines = step1.data.mergedContent.split('\n');
    assert.equal(lines[step1.data.conflicts[0].startLine], `<<<<<<< local:${second.id}`);
    assert.equal(lines[step1.data.conflicts[0].endLine], `>>>>>>> remote:${second.id}`);
  });

  test('repeated identical merge calls produce same structure (regression)', async () => {
    const body = { base: 'a\nb', local: 'L\nb', remote: 'R\nb' };
    const r1 = await post<{ conflicts: Array<{ id: string }>; conflictCount: number }>(
      '/api/merge',
      body
    );
    const r2 = await post<{ conflicts: Array<{ id: string }>; conflictCount: number }>(
      '/api/merge',
      body
    );
    assert.equal(r1.data.conflictCount, r2.data.conflictCount);
    assert.equal(r1.data.conflicts.length, r2.data.conflicts.length);
    assert.notEqual(r1.data.conflicts[0].id, r2.data.conflicts[0].id, 'IDs must be unique per merge');
  });
});

describe('[REGRESSION][API] additional invalid input and error responses', () => {
  test('non-string conflictId is rejected with 400 (regression)', async () => {
    const merge = await post<{ mergedContent: string }>('/api/merge', {
      base: 'a',
      local: 'L',
      remote: 'R',
    });
    const { status, data } = await post<{ success: boolean; error?: string }>('/api/resolve', {
      mergedContent: merge.data.mergedContent,
      conflictId: 12345,
      resolution: 'local',
    });
    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.match(data.error ?? '', /conflictId/i);
  });

  test('missing mergedContent field is rejected with 400 (regression)', async () => {
    const { status, data } = await post<{ success: boolean; error?: string }>('/api/resolve', {
      conflictId: 'conflict-x',
      resolution: 'local',
    });
    assert.equal(status, 400);
    assert.equal(data.success, false);
  });

  test('empty mergedContent with unknown ID returns 404 (conflict not found) (regression)', async () => {
    const { status, data } = await post<{ success: boolean; error?: string }>('/api/resolve', {
      mergedContent: '',
      conflictId: 'conflict-x',
      resolution: 'local',
    });
    assert.equal(status, 404);
    assert.equal(data.success, false);
    assert.match(data.error ?? '', /not found/i);
  });

  test('oversized total payload returns 413 and does not 500 (regression)', async () => {
    const part = 'x'.repeat(9 * 1024 * 1024);
    const { status, data } = await post<{ success: boolean; error?: string }>('/api/merge', {
      base: part,
      local: part,
      remote: part,
    });
    assert.equal(status, 413);
    assert.equal(data.success, false);
    assert.match(data.error ?? '', /payload|too large|size|limit/i);
  });

  test('unknown API route returns 404 JSON (regression)', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    const data = (await res.json()) as { success: boolean };
    assert.equal(data.success, false);
  });

  test('resolution result is repeatable: resolving with same choice on fresh merge yields same content (regression)', async () => {
    const body = { base: 'shared', local: 'LOCAL', remote: 'REMOTE' };
    const run = async () => {
      const merge = await post<{ mergedContent: string; conflicts: Array<{ id: string }> }>(
        '/api/merge',
        body
      );
      const resolve = await post<{ mergedContent: string; conflictCount: number }>(
        '/api/resolve',
        {
          mergedContent: merge.data.mergedContent,
          conflictId: merge.data.conflicts[0].id,
          resolution: 'local',
        }
      );
      return resolve;
    };
    const a = await run();
    const b = await run();
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.data.mergedContent, b.data.mergedContent);
    assert.equal(a.data.mergedContent, 'LOCAL');
    assert.equal(a.data.conflictCount, 0);
    assert.equal(b.data.conflictCount, 0);
  });

  test('resolving both conflicts sequentially via HTTP leaves no markers (repeatable end-to-end) (regression)', async () => {
    const merge = await post<{
      mergedContent: string;
      conflicts: Array<{ id: string }>;
      conflictCount: number;
    }>('/api/merge', {
      base: '1\n2\n3\n4\n5',
      local: 'L1\n2\n3\n4\nL5',
      remote: 'R1\n2\n3\n4\nR5',
    });
    assert.equal(merge.data.conflictCount, 2);

    const step1 = await post<{
      mergedContent: string;
      conflicts: Array<{ id: string }>;
      conflictCount: number;
    }>('/api/resolve', {
      mergedContent: merge.data.mergedContent,
      conflictId: merge.data.conflicts[0].id,
      resolution: 'local',
    });
    assert.equal(step1.status, 200);
    assert.equal(step1.data.conflictCount, 1);

    const step2 = await post<{
      mergedContent: string;
      conflictCount: number;
    }>('/api/resolve', {
      mergedContent: step1.data.mergedContent,
      conflictId: step1.data.conflicts[0].id,
      resolution: 'remote',
    });
    assert.equal(step2.status, 200);
    assert.equal(step2.data.conflictCount, 0);
    assert.equal(step2.data.mergedContent, 'L1\n2\n3\n4\nR5');
    assert.equal(step2.data.mergedContent.includes('<<<<<<<'), false);
  });
});
