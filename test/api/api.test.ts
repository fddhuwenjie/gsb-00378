import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import app from '../../api/app.js';
import type { Conflict } from '@shared/types';

const CONFLICT_MARKERS = ['<<<<<<< local', '=======', '>>>>>>> remote'];

function fakeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: 'conflict-totally-unknown',
    startLine: 0,
    endLine: 0,
    localContent: ['__no_such_local__'],
    remoteContent: ['__no_such_remote__'],
    baseContent: [],
    resolved: false,
    resolution: null,
    ...overrides,
  };
}

describe('api: Express integration (random port)', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP server address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function postJson(path: string, body: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let parsed: any = null;
    const text = await res.text();
    if (text) {
      parsed = JSON.parse(text);
    }
    return { status: res.status, ok: res.ok, body: parsed, contentType: res.headers.get('content-type') };
  }

  it('health endpoint responds ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  it('merges empty texts without rejecting them (empty-file fix)', async () => {
    const res = await postJson('/api/merge', { base: '', local: '', remote: '' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.mergedContent, '');
    assert.equal(res.body.hasConflicts, false);
    assert.equal(res.body.conflictCount, 0);
  });

  it('still rejects a missing field with 400', async () => {
    const res = await postJson('/api/merge', { base: 'a', local: 'a' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  it('produces one conflict and resolves it by selecting local', async () => {
    const mergeRes = await postJson('/api/merge', {
      base: 'a\nb',
      local: 'a\nL',
      remote: 'a\nR',
    });
    assert.equal(mergeRes.status, 200);
    assert.equal(mergeRes.body.hasConflicts, true);
    assert.equal(mergeRes.body.conflictCount, 1);
    const conflict: Conflict = mergeRes.body.conflicts[0];
    assert.deepEqual(conflict.localContent, ['L']);
    assert.deepEqual(conflict.remoteContent, ['R']);

    const resolveRes = await postJson('/api/resolve', {
      mergedContent: mergeRes.body.mergedContent,
      conflict,
      resolution: 'local',
    });
    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.body.success, true);
    assert.equal(resolveRes.body.mergedContent, 'a\nL');
    for (const marker of CONFLICT_MARKERS) {
      assert.ok(!resolveRes.body.mergedContent.includes(marker));
    }
  });

  it('resolves a conflict with manual custom content', async () => {
    const mergeRes = await postJson('/api/merge', {
      base: 'a\nb',
      local: 'a\nL',
      remote: 'a\nR',
    });
    const resolveRes = await postJson('/api/resolve', {
      mergedContent: mergeRes.body.mergedContent,
      conflict: mergeRes.body.conflicts[0],
      resolution: 'manual',
      customContent: 'MANUAL',
    });
    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.body.mergedContent, 'a\nMANUAL');
  });

  it('rejects an unknown conflict id with 400 and does not corrupt content', async () => {
    const mergeRes = await postJson('/api/merge', {
      base: 'a\nb\nc\nd',
      local: 'L\nb\nL2\nd',
      remote: 'R\nb\nR2\nd',
    });
    assert.equal(mergeRes.body.conflictCount, 2);
    const original = mergeRes.body.mergedContent;

    const malicious = fakeConflict({
      startLine: 5,
      endLine: 5,
      localContent: ['HACKED-LOCAL'],
      remoteContent: ['HACKED-REMOTE'],
    });
    const resolveRes = await postJson('/api/resolve', {
      mergedContent: original,
      conflict: malicious,
      resolution: 'manual',
      customContent: 'HACKED',
    });

    assert.equal(resolveRes.status, 400);
    assert.equal(resolveRes.body.success, false);
    assert.match(resolveRes.body.error, /conflict/i);
    assert.ok(!original.includes('HACKED'));
    assert.ok(original.includes('\nb\n'));
  });

  it('rejects resolving the same conflict twice (idempotent rejection)', async () => {
    const mergeRes = await postJson('/api/merge', {
      base: 'a\nb',
      local: 'a\nL',
      remote: 'a\nR',
    });
    const conflict: Conflict = mergeRes.body.conflicts[0];

    const first = await postJson('/api/resolve', {
      mergedContent: mergeRes.body.mergedContent,
      conflict,
      resolution: 'local',
    });
    assert.equal(first.status, 200);

    const second = await postJson('/api/resolve', {
      mergedContent: first.body.mergedContent,
      conflict,
      resolution: 'remote',
    });
    assert.equal(second.status, 400);
    assert.equal(second.body.success, false);
  });

  it('end-to-end downloadable result: resolves two drifted conflicts and returns clean final content', async () => {
    const mergeRes = await postJson('/api/merge', {
      base: 'a\nb\nc\nd\ne',
      local: 'L\nb\nL2\nd\ne',
      remote: 'R\nb\nR2\nd\ne',
    });
    assert.equal(mergeRes.body.conflictCount, 2);
    let content: string = mergeRes.body.mergedContent;
    const [c0, c1]: Conflict[] = mergeRes.body.conflicts;

    const first = await postJson('/api/resolve', {
      mergedContent: content,
      conflict: c0,
      resolution: 'local',
    });
    assert.equal(first.status, 200);
    content = first.body.mergedContent;
    assert.ok(content.includes('L2'));

    const second = await postJson('/api/resolve', {
      mergedContent: content,
      conflict: c1,
      resolution: 'remote',
    });
    assert.equal(second.status, 200);
    content = second.body.mergedContent;

    assert.equal(content, 'L\nb\nR2\nd\ne');
    for (const marker of CONFLICT_MARKERS) {
      assert.ok(!content.includes(marker), `final result must not contain ${marker}`);
    }

    const download = await postJson('/api/resolve', {
      mergedContent: content,
      conflict: c0,
      resolution: 'local',
    });
    assert.equal(download.status, 400);
  });

  it('returns 404 for unknown api routes', async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    assert.equal(res.status, 404);
  });
});
