/**
 * REGRESSION SUITE — category: api (Express HTTP endpoints)
 *
 * Exercises the real app over HTTP on an OS-assigned random port (listen(0));
 * no fixed port, no external service, server always closed in `after`. Migrates
 * the previous happy-path integration tests and adds invalid-input and
 * error-response coverage. Expected status codes are hand-derived from the
 * route contract in api/routes/merge.ts (400 bad request, 409 unresolvable
 * conflict, 413 too large, 404 unknown route). Run alone with
 * `npm run test:api`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import app from '../../api/app.ts';

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

describe('api: health check', () => {
  it('reports ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
  });
});

describe('api: POST /api/merge — happy paths', () => {
  it('accepts empty text on every side (empty files are valid)', async () => {
    const { status, json } = await postJson('/api/merge', {
      base: '',
      local: '',
      remote: '',
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.success, true);
    assert.equal(json.mergedContent, '');
    assert.equal(json.conflictCount, 0);
    assert.equal(json.hasConflicts, false);
  });

  it('accepts an empty base with additions on both sides', async () => {
    const { status, json } = await postJson('/api/merge', {
      base: '',
      local: 'a\nb',
      remote: 'a\nb',
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.mergedContent, 'a\nb');
    assert.equal(json.conflictCount, 0);
  });

  it('returns a conflict when both sides change the same line', async () => {
    const { status, json } = await postJson('/api/merge', {
      base: 'a\nb\nc',
      local: 'a\nX\nc',
      remote: 'a\nY\nc',
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.hasConflicts, true);
    assert.equal(json.conflictCount, 1);
    assert.match(json.mergedContent, /<<<<<<< local/);
  });
});

describe('api: POST /api/merge — invalid input & errors', () => {
  it('rejects a request missing a field with 400', async () => {
    const { status, json } = await postJson('/api/merge', { base: 'a', local: 'b' });
    assert.equal(status, 400);
    assert.equal(json.success, false);
  });

  it('rejects non-string fields with 400', async () => {
    // Contract: "All fields must be strings".
    const { status, json } = await postJson('/api/merge', {
      base: 'a',
      local: 123,
      remote: 'b',
    });
    assert.equal(status, 400, JSON.stringify(json));
    assert.equal(json.success, false);
  });

  it('rejects binary content with 400', async () => {
    // Contract: "Binary files are not supported" — a NUL byte marks binary.
    const { status, json } = await postJson('/api/merge', {
      base: 'a\u0000b',
      local: 'a',
      remote: 'a',
    });
    assert.equal(status, 400, JSON.stringify(json));
    assert.equal(json.success, false);
    assert.match(json.error, /[Bb]inary/);
  });

  it('rejects an empty JSON body with 400 (no fields present)', async () => {
    const { status, json } = await postJson('/api/merge', {});
    assert.equal(status, 400);
    assert.equal(json.success, false);
  });
});

describe('api: POST /api/resolve — happy paths', () => {
  it('resolves a conflict by choosing local', async () => {
    const merge = await postJson('/api/merge', {
      base: 'a\nb\nc',
      local: 'a\nX\nc',
      remote: 'a\nY\nc',
    });
    const conflict = merge.json.conflicts[0];

    const { status, json } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict,
      resolution: 'local',
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.success, true);
    assert.equal(json.mergedContent, 'a\nX\nc');
  });

  it('applies manual content to a conflict', async () => {
    const merge = await postJson('/api/merge', {
      base: 'a\nb\nc',
      local: 'a\nX\nc',
      remote: 'a\nY\nc',
    });
    const conflict = merge.json.conflicts[0];

    const { status, json } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict,
      resolution: 'manual',
      customContent: 'HAND-WRITTEN',
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.mergedContent, 'a\nHAND-WRITTEN\nc');
  });

  it('resolves multiple conflicts sequentially without positional drift', async () => {
    const merge = await postJson('/api/merge', {
      base: 'a\nb\nc\nd\ne',
      local: 'A1\nb\nc\nd\nE1',
      remote: 'A2\nb\nc\nd\nE2',
    });
    assert.equal(merge.json.conflictCount, 2);
    const [first, second] = merge.json.conflicts;

    const afterFirst = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: first,
      resolution: 'local',
    });
    assert.equal(afterFirst.status, 200);

    const afterSecond = await postJson('/api/resolve', {
      mergedContent: afterFirst.json.mergedContent,
      conflict: second,
      resolution: 'remote',
    });
    assert.equal(afterSecond.status, 200, JSON.stringify(afterSecond.json));
    assert.equal(afterSecond.json.mergedContent, 'A1\nb\nc\nd\nE2');
  });
});

describe('api: POST /api/resolve — invalid input & errors', () => {
  it('rejects an unknown conflict id with 409 instead of mutating text', async () => {
    const merge = await postJson('/api/merge', {
      base: 'a\nb\nc',
      local: 'a\nX\nc',
      remote: 'a\nY\nc',
    });

    const { status, json } = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: {
        id: 'ghost',
        startLine: 1,
        endLine: 5,
        localContent: ['ZZZ'],
        remoteContent: ['QQQ'],
        baseContent: ['b'],
        resolved: false,
        resolution: null,
      },
      resolution: 'local',
    });
    assert.equal(status, 409, JSON.stringify(json));
    assert.equal(json.success, false);
  });

  it('re-resolving an already-resolved conflict returns 409', async () => {
    const merge = await postJson('/api/merge', {
      base: 'a\nb\nc',
      local: 'a\nX\nc',
      remote: 'a\nY\nc',
    });
    const conflict = merge.json.conflicts[0];

    const first = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict,
      resolution: 'local',
    });
    assert.equal(first.status, 200);

    // The block is gone from `first.mergedContent`; a repeat must be rejected.
    const second = await postJson('/api/resolve', {
      mergedContent: first.json.mergedContent,
      conflict,
      resolution: 'local',
    });
    assert.equal(second.status, 409, JSON.stringify(second.json));
    assert.equal(second.json.success, false);
  });

  it('rejects a missing resolution field with 400', async () => {
    const { status, json } = await postJson('/api/resolve', {
      mergedContent: 'a\nb\nc',
      conflict: { id: 'x', startLine: 0, endLine: 0, localContent: [], remoteContent: [], baseContent: [], resolved: false, resolution: null },
    });
    assert.equal(status, 400, JSON.stringify(json));
    assert.equal(json.success, false);
  });

  it('rejects an invalid resolution type with 400', async () => {
    // Contract: resolution must be one of local | remote | manual.
    const { status, json } = await postJson('/api/resolve', {
      mergedContent: 'a\nb\nc',
      conflict: { id: 'x', startLine: 0, endLine: 0, localContent: [], remoteContent: [], baseContent: [], resolved: false, resolution: null },
      resolution: 'sideways',
    });
    assert.equal(status, 400, JSON.stringify(json));
    assert.equal(json.success, false);
  });

  it('rejects manual resolution missing customContent with 400', async () => {
    // Contract: customContent (string) is required for manual resolution.
    const { status, json } = await postJson('/api/resolve', {
      mergedContent: 'a\nb\nc',
      conflict: { id: 'x', startLine: 0, endLine: 0, localContent: [], remoteContent: [], baseContent: [], resolved: false, resolution: null },
      resolution: 'manual',
    });
    assert.equal(status, 400, JSON.stringify(json));
    assert.equal(json.success, false);
  });
});

describe('api: unknown routes', () => {
  it('returns 404 for an unknown API path', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`, { method: 'POST' });
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.success, false);
  });
});

describe('api: download the merged result', () => {
  it('produces mergedContent that a client can download verbatim', async () => {
    const merge = await postJson('/api/merge', {
      base: 'title\nbody\nfooter',
      local: 'title\nBODY-LOCAL\nfooter',
      remote: 'title\nBODY-REMOTE\nfooter',
    });
    const resolved = await postJson('/api/resolve', {
      mergedContent: merge.json.mergedContent,
      conflict: merge.json.conflicts[0],
      resolution: 'local',
    });
    assert.equal(resolved.status, 200);

    const downloaded = resolved.json.mergedContent as string;
    assert.equal(downloaded, 'title\nBODY-LOCAL\nfooter');
    assert.ok(!downloaded.includes('<<<<<<<'));
    assert.ok(!downloaded.includes('======='));
    assert.ok(!downloaded.includes('>>>>>>>'));
    assert.equal(Buffer.byteLength(downloaded, 'utf8'), downloaded.length);
  });
});
