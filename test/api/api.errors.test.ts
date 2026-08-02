import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import app from '../../api/app.js';
import type { Conflict } from '@shared/types';

function fakeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: 'conflict-unknown',
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

describe('api: invalid input and error responses (random port)', () => {
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
    if (text) parsed = JSON.parse(text);
    return { status: res.status, ok: res.ok, body: parsed };
  }

  async function mergeOnce(base: string, local: string, remote: string) {
    return postJson('/api/merge', { base, local, remote });
  }

  describe('api: /merge validation errors', () => {
    it('returns 400 when remote is missing (undefined)', async () => {
      const res = await postJson('/api/merge', { base: 'a', local: 'a' });
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.error, /missing required fields/i);
    });

    it('returns 400 when a field is explicitly null', async () => {
      const res = await postJson('/api/merge', { base: 'a', local: null, remote: 'a' });
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    it('returns 400 when a field is a number instead of a string', async () => {
      const res = await postJson('/api/merge', { base: 'a', local: 123, remote: 'a' });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /must be strings/i);
    });

    it('returns 400 when a field is an object instead of a string', async () => {
      const res = await postJson('/api/merge', { base: {}, local: 'a', remote: 'a' });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /must be strings/i);
    });

    it('returns 400 when a field is an array instead of a string', async () => {
      const res = await postJson('/api/merge', { base: ['a'], local: 'a', remote: 'a' });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /must be strings/i);
    });

    it('returns 400 for binary content containing a NUL byte', async () => {
      const res = await postJson('/api/merge', {
        base: 'a\x00b',
        local: 'a\x00b',
        remote: 'a\x00b',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /binary/i);
    });

    it('accepts empty strings for all three fields (regression)', async () => {
      const res = await mergeOnce('', '', '');
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.mergedContent, '');
      assert.equal(res.body.conflictCount, 0);
    });

    it('accepts an empty local side against an unchanged remote', async () => {
      const res = await mergeOnce('a', 'a', '');
      assert.equal(res.status, 200);
      assert.equal(res.body.conflictCount, 0);
      assert.equal(res.body.mergedContent, '');
    });
  });

  describe('api: /resolve validation errors', () => {
    it('returns 400 when mergedContent is missing', async () => {
      const res = await postJson('/api/resolve', {
        conflict: fakeConflict(),
        resolution: 'local',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /missing required fields/i);
    });

    it('returns 400 when mergedContent is not a string (number)', async () => {
      const res = await postJson('/api/resolve', {
        mergedContent: 42,
        conflict: fakeConflict(),
        resolution: 'local',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /mergedContent must be a string/i);
    });

    it('returns 400 when conflict is not an object (array)', async () => {
      const res = await postJson('/api/resolve', {
        mergedContent: 'a',
        conflict: ['not', 'an', 'object'],
        resolution: 'local',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /conflict must be an object/i);
    });

    it('returns 400 when conflict is null (treated as missing)', async () => {
      const res = await postJson('/api/resolve', {
        mergedContent: 'a',
        conflict: null,
        resolution: 'local',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /missing required fields/i);
    });

    it('returns 400 for an invalid resolution type', async () => {
      const res = await postJson('/api/resolve', {
        mergedContent: 'a',
        conflict: fakeConflict(),
        resolution: 'take-theirs',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /invalid resolution type/i);
    });

    it('returns 400 when manual resolution omits customContent', async () => {
      const res = await postJson('/api/resolve', {
        mergedContent: 'a',
        conflict: fakeConflict(),
        resolution: 'manual',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /customContent is required/i);
    });

    it('returns 400 for an unknown conflict in non-empty content', async () => {
      const res = await postJson('/api/resolve', {
        mergedContent: '<<<<<<< local\nL\n=======\nR\n>>>>>>> remote',
        conflict: fakeConflict(),
        resolution: 'local',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /conflict/i);
    });

    it('returns 400 (not "missing fields") when mergedContent is empty', async () => {
      const res = await postJson('/api/resolve', {
        mergedContent: '',
        conflict: fakeConflict(),
        resolution: 'local',
      });
      assert.equal(res.status, 400);
      assert.doesNotMatch(res.body.error, /missing required fields/i);
      assert.match(res.body.error, /conflict/i);
    });

    it('returns 400 for a malformed conflict object (missing content arrays)', async () => {
      const res = await postJson('/api/resolve', {
        mergedContent: '<<<<<<< local\nL\n=======\nR\n>>>>>>> remote',
        conflict: { id: 'broken' },
        resolution: 'local',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /conflict/i);
    });
  });

  describe('api: repeated calls are deterministic', () => {
    it('repeating the same merge returns identical results', async () => {
      const first = await mergeOnce('a\nb\nc', 'a\nB\nc', 'a\nb\nC');
      for (let run = 0; run < 3; run++) {
        const again = await mergeOnce('a\nb\nc', 'a\nB\nc', 'a\nb\nC');
        assert.equal(again.status, 200);
        assert.equal(again.body.mergedContent, first.body.mergedContent);
        assert.equal(again.body.conflictCount, first.body.conflictCount);
      }
    });

    it('repeating health check always returns 200', async () => {
      for (let run = 0; run < 3; run++) {
        const res = await fetch(`${baseUrl}/api/health`);
        assert.equal(res.status, 200);
      }
    });

    it('unknown api route always returns 404', async () => {
      for (let run = 0; run < 2; run++) {
        const res = await fetch(`${baseUrl}/api/does-not-exist`);
        assert.equal(res.status, 404);
      }
    });
  });
});
