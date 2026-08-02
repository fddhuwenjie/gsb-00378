import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import type { Server } from 'node:http';
import app from '../../api/app.js';
import { parseConflictObjects } from '../../api/algorithms/conflictMarkers.js';

let server: Server;
let baseUrl: string;

await new Promise<void>((resolve) => {
  server = app.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address === 'object') {
      baseUrl = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error('Failed to bind ephemeral port');
    }
    resolve();
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function postJson<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T;
  return { status: response.status, data };
}

test('health endpoint reports ok', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const data = (await response.json()) as { success: boolean };
  assert.equal(data.success, true);
});

test('empty texts merge successfully instead of being rejected', async () => {
  const { status, data } = await postJson<{
    success: boolean;
    mergedContent: string;
    conflictCount: number;
    error?: string;
  }>('/api/merge', { base: '', local: '', remote: '' });

  assert.equal(status, 200, `empty files must return 200, got error: ${data.error ?? ''}`);
  assert.equal(data.success, true);
  assert.equal(data.mergedContent, '');
  assert.equal(data.conflictCount, 0);
});

test('empty local/remote with non-empty base deletes all base content (agreement)', async () => {
  const { status, data } = await postJson<{
    success: boolean;
    mergedContent: string;
    conflictCount: number;
  }>('/api/merge', { base: 'a\nb\nc', local: '', remote: '' });

  assert.equal(status, 200);
  assert.equal(data.success, true);
  assert.equal(data.mergedContent, '');
  assert.equal(data.conflictCount, 0);
});

test('one conflict can be resolved by choosing local via the HTTP API', async () => {
  const merge = await postJson<{
    success: boolean;
    mergedContent: string;
    conflicts: Array<{ id: string }>;
    conflictCount: number;
  }>('/api/merge', {
    base: 'shared',
    local: 'LOCAL-VERSION',
    remote: 'REMOTE-VERSION',
  });

  assert.equal(merge.status, 200);
  assert.equal(merge.data.conflictCount, 1);
  const conflictId = merge.data.conflicts[0].id;

  const resolve = await postJson<{
    success: boolean;
    mergedContent: string;
    conflictCount: number;
    hasConflicts: boolean;
  }>('/api/resolve', {
    mergedContent: merge.data.mergedContent,
    conflictId,
    resolution: 'local',
  });

  assert.equal(resolve.status, 200);
  assert.equal(resolve.data.success, true);
  assert.equal(resolve.data.mergedContent, 'LOCAL-VERSION');
  assert.equal(resolve.data.conflictCount, 0);
  assert.equal(resolve.data.hasConflicts, false);
});

test('manual resolution accepts handcrafted content and final result is downloadable clean text', async () => {
  const merge = await postJson<{
    success: boolean;
    mergedContent: string;
    conflicts: Array<{ id: string }>;
  }>('/api/merge', {
    base: 'color: red',
    local: 'color: blue',
    remote: 'color: green',
  });

  const conflictId = merge.data.conflicts[0].id;
  const resolve = await postJson<{
    success: boolean;
    mergedContent: string;
    conflictCount: number;
  }>('/api/resolve', {
    mergedContent: merge.data.mergedContent,
    conflictId,
    resolution: 'manual',
    customContent: 'color: purple',
  });

  assert.equal(resolve.status, 200);
  assert.equal(resolve.data.mergedContent, 'color: purple');
  assert.equal(resolve.data.conflictCount, 0);

  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.headers.get('content-type')?.includes('application/json'), true);
  const cleanText = resolve.data.mergedContent;
  assert.equal(cleanText.includes('<<<<<<<'), false);
  assert.equal(cleanText.includes('>>>>>>>'), false);
  assert.equal(cleanText.includes('======='), false);
});

test('unknown conflict id is rejected with 404 and does not alter content', async () => {
  const merge = await postJson<{
    success: boolean;
    mergedContent: string;
    conflicts: Array<{ id: string }>;
  }>('/api/merge', {
    base: 'a',
    local: 'L',
    remote: 'R',
  });

  const originalMerged = merge.data.mergedContent;
  const resolve = await postJson<{
    success: boolean;
    mergedContent?: string;
    error?: string;
  }>('/api/resolve', {
    mergedContent: originalMerged,
    conflictId: 'conflict-totally-unknown',
    resolution: 'manual',
    customContent: 'INJECTED CONTENT',
  });

  assert.equal(resolve.status, 404);
  assert.equal(resolve.data.success, false);
  assert.match(resolve.data.error ?? '', /not found/);
  assert.equal(
    resolve.data.mergedContent,
    undefined,
    'failed resolution must not return replacement content'
  );
});

test('resolving first of two conflicts leaves second with accurate positions (integration drift test)', async () => {
  const merge = await postJson<{
    success: boolean;
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

  const resolveFirst = await postJson<{
    success: boolean;
    mergedContent: string;
    conflicts: Array<{ id: string; startLine: number; endLine: number }>;
    conflictCount: number;
  }>('/api/resolve', {
    mergedContent: merge.data.mergedContent,
    conflictId: first.id,
    resolution: 'local',
  });

  assert.equal(resolveFirst.status, 200);
  assert.equal(resolveFirst.data.conflictCount, 1);
  assert.equal(resolveFirst.data.conflicts[0].id, second.id);

  const reparsed = parseConflictObjects(resolveFirst.data.mergedContent);
  assert.equal(reparsed.length, 1);
  assert.equal(reparsed[0].id, second.id);
  assert.equal(
    reparsed[0].startLine,
    resolveFirst.data.conflicts[0].startLine,
    'server-reported position must match the actual marker position'
  );

  const lines = resolveFirst.data.mergedContent.split('\n');
  assert.equal(lines[reparsed[0].startLine], `<<<<<<< local:${second.id}`);
  assert.equal(lines[reparsed[0].endLine], `>>>>>>> remote:${second.id}`);
});

test('repeated resolution of the same conflict id is rejected', async () => {
  const merge = await postJson<{
    success: boolean;
    mergedContent: string;
    conflicts: Array<{ id: string }>;
  }>('/api/merge', {
    base: 'x',
    local: 'L',
    remote: 'R',
  });

  const conflictId = merge.data.conflicts[0].id;
  const first = await postJson<{ success: boolean; mergedContent: string }>('/api/resolve', {
    mergedContent: merge.data.mergedContent,
    conflictId,
    resolution: 'local',
  });
  assert.equal(first.status, 200);

  const second = await postJson<{ success: boolean; error?: string }>('/api/resolve', {
    mergedContent: first.data.mergedContent,
    conflictId,
    resolution: 'remote',
  });
  assert.equal(second.status, 404);
  assert.equal(second.data.success, false);
});

test('missing required fields return 400 rather than 500', async () => {
  const missingMerge = await postJson<{ success: boolean }>('/api/merge', {
    base: 'a',
  });
  assert.equal(missingMerge.status, 400);
  assert.equal(missingMerge.data.success, false);

  const missingResolve = await postJson<{ success: boolean }>('/api/resolve', {
    mergedContent: 'whatever',
    resolution: 'local',
  });
  assert.equal(missingResolve.status, 400);
  assert.equal(missingResolve.data.success, false);
});

test('invalid resolution type is rejected', async () => {
  const response = await postJson<{ success: boolean; error?: string }>('/api/resolve', {
    mergedContent: 'text',
    conflictId: 'conflict-x',
    resolution: 'invalid-choice',
  });
  assert.equal(response.status, 400);
  assert.equal(response.data.success, false);
});
