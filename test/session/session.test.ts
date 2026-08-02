import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  ALGORITHM_VERSION,
  createSession,
  recordDecision,
  saveSession,
  loadSession,
  deleteSession,
  restoreSession,
  applyDecisions,
  computeInputHashes,
} from '../../api/algorithms/session';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge';
import { sha256Hex } from '../../api/utils/hash';

const REPO_ROOT = process.cwd();
const TEMP_DIR = path.join(REPO_ROOT, 'test', `.tmp-sessions-${process.pid}`);
const WORKER = path.join(REPO_ROOT, 'test', 'session', '_restart-worker.ts');

const BASE = 'a\nb\nc\nd\ne';
const LOCAL = 'L\nb\nL2\nd\ne';
const REMOTE = 'R\nb\nR2\nd\ne';

async function writeInputs(dir: string, base: string, local: string, remote: string) {
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(dir, 'base.txt'), base, 'utf8'),
    fs.writeFile(path.join(dir, 'local.txt'), local, 'utf8'),
    fs.writeFile(path.join(dir, 'remote.txt'), remote, 'utf8'),
  ]);
}

function runRestartWorker(sessionId: string, sessionDir: string, inputDir: string) {
  const stdout = execFileSync(
    process.execPath,
    ['--import', 'tsx', WORKER, sessionId, sessionDir, inputDir],
    { encoding: 'utf8', cwd: REPO_ROOT },
  );
  return JSON.parse(stdout);
}

before(async () => {
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });
});

after(async () => {
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
});

describe('session: deterministic stable conflict IDs', () => {
  it('re-merging identical inputs yields identical conflict ids', () => {
    const first = performThreeWayMerge(BASE, LOCAL, REMOTE);
    const second = performThreeWayMerge(BASE, LOCAL, REMOTE);
    assert.equal(first.conflicts.length, 2);
    assert.deepEqual(
      first.conflicts.map((c) => c.id),
      second.conflicts.map((c) => c.id),
    );
  });

  it('ids are distinct across different conflicts in the same merge', () => {
    const { conflicts } = performThreeWayMerge(BASE, LOCAL, REMOTE);
    assert.equal(new Set(conflicts.map((c) => c.id)).size, 2);
  });

  it('changing one side changes the affected conflict id', () => {
    const original = performThreeWayMerge(BASE, LOCAL, REMOTE);
    const changed = performThreeWayMerge(BASE, 'CHANGED\nb\nL2\nd\ne', REMOTE);
    assert.notEqual(original.conflicts[0].id, changed.conflicts[0].id);
  });
});

describe('session: shape — no drift-prone line numbers are persisted', () => {
  it('decisions contain only conflictId, resolution and customContent', () => {
    const session = createSession(BASE, LOCAL, REMOTE);
    const { conflicts } = performThreeWayMerge(BASE, LOCAL, REMOTE);
    recordDecision(session, conflicts[0].id, 'local');
    recordDecision(session, conflicts[1].id, 'manual', 'HAND');

    for (const d of session.decisions) {
      assert.equal('startLine' in d, false);
      assert.equal('endLine' in d, false);
      assert.equal(typeof d.conflictId, 'string');
      if (d.resolution === 'manual') {
        assert.deepEqual(Object.keys(d).sort(), ['conflictId', 'customContent', 'resolution']);
      } else {
        assert.deepEqual(Object.keys(d).sort(), ['conflictId', 'resolution']);
      }
    }
    // Manual decision carries customContent.
    const manual = session.decisions.find((d) => d.resolution === 'manual')!;
    assert.equal(manual.customContent, 'HAND');
  });

  it('serialized session JSON contains no startLine/endLine in decisions', async () => {
    const session = createSession(BASE, LOCAL, REMOTE);
    const { conflicts } = performThreeWayMerge(BASE, LOCAL, REMOTE);
    recordDecision(session, conflicts[0].id, 'remote');

    const file = await saveSession(session, TEMP_DIR);
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.algorithmVersion, ALGORITHM_VERSION);
    assert.ok(parsed.inputHashes.base && parsed.inputHashes.local && parsed.inputHashes.remote);
    assert.equal(raw.includes('startLine'), false, 'session file must not store startLine');
    assert.equal(raw.includes('endLine'), false, 'session file must not store endLine');
  });
});

describe('session: save and in-process restore', () => {
  it('replays decisions and reproduces the same output hash', async () => {
    const session = createSession(BASE, LOCAL, REMOTE);
    const { conflicts } = performThreeWayMerge(BASE, LOCAL, REMOTE);
    assert.equal(conflicts.length, 2);

    recordDecision(session, conflicts[0].id, 'local');
    recordDecision(session, conflicts[1].id, 'remote');

    // Expected output computed directly.
    const expected = applyDecisions(BASE, LOCAL, REMOTE, session.decisions);
    const expectedHash = sha256Hex(expected.mergedContent);
    const expectedIds = expected.conflicts.map((c) => ({
      id: c.id,
      resolved: c.resolved,
      resolution: c.resolution,
    }));

    await saveSession(session, TEMP_DIR);
    const loaded = await loadSession(session.sessionId, TEMP_DIR);
    assert.ok(loaded);
    const restored = restoreSession(loaded!, BASE, LOCAL, REMOTE);

    assert.equal(restored.stale, false);
    assert.equal(restored.resolvedCount, 2);
    assert.equal(restored.pendingCount, 0);
    assert.equal(sha256Hex(restored.mergedContent), expectedHash);
    assert.deepEqual(
      restored.conflicts.map((c) => ({ id: c.id, resolved: c.resolved, resolution: c.resolution })),
      expectedIds,
    );
    assert.equal(restored.mergedContent, 'L\nb\nR2\nd\ne');
  });

  it('leaves unrecorded conflicts pending', async () => {
    const session = createSession(BASE, LOCAL, REMOTE);
    const { conflicts } = performThreeWayMerge(BASE, LOCAL, REMOTE);
    recordDecision(session, conflicts[0].id, 'local');

    await saveSession(session, TEMP_DIR);
    const loaded = await loadSession(session.sessionId, TEMP_DIR);
    const restored = restoreSession(loaded!, BASE, LOCAL, REMOTE);

    assert.equal(restored.resolvedCount, 1);
    assert.equal(restored.pendingCount, 1);
    assert.equal(restored.conflicts[0].resolved, true);
    assert.equal(restored.conflicts[1].resolved, false);
    assert.ok(restored.mergedContent.includes('<<<<<<< local'));
  });
});

describe('session: process restart restore', () => {
  it('a separate process loads the saved session and reproduces the same result', async () => {
    const session = createSession(BASE, LOCAL, REMOTE);
    const { conflicts } = performThreeWayMerge(BASE, LOCAL, REMOTE);
    recordDecision(session, conflicts[0].id, 'local');
    recordDecision(session, conflicts[1].id, 'manual', 'CUSTOM');

    const inProcess = restoreSession(session, BASE, LOCAL, REMOTE);
    const expected = {
      conflictIds: inProcess.conflicts.map((c) => c.id),
      resolvedMap: Object.fromEntries(inProcess.conflicts.map((c) => [c.id, c.resolved])),
      resolutionMap: Object.fromEntries(inProcess.conflicts.map((c) => [c.id, c.resolution])),
      resolvedCount: inProcess.resolvedCount,
      pendingCount: inProcess.pendingCount,
      outputHash: sha256Hex(inProcess.mergedContent),
      stale: false,
    };

    await saveSession(session, TEMP_DIR);
    const inputDir = path.join(TEMP_DIR, 'inputs-restart');
    await writeInputs(inputDir, BASE, LOCAL, REMOTE);

    const fromWorker = runRestartWorker(session.sessionId, TEMP_DIR, inputDir);

    assert.equal(fromWorker.stale, false);
    assert.equal(fromWorker.inputMatches, true);
    assert.equal(fromWorker.algorithmMatches, true);
    assert.deepEqual(fromWorker.conflictIds, expected.conflictIds, 'conflict ids must survive restart');
    assert.deepEqual(fromWorker.resolvedMap, expected.resolvedMap, 'resolved status must survive restart');
    assert.deepEqual(fromWorker.resolutionMap, expected.resolutionMap, 'resolution choice must survive restart');
    assert.equal(fromWorker.resolvedCount, expected.resolvedCount);
    assert.equal(fromWorker.pendingCount, expected.pendingCount);
    assert.equal(fromWorker.outputHash, expected.outputHash, 'output hash must match after restart');
  });
});

describe('session: content tampering and invalidation', () => {
  it('marks the session stale when an input changes and applies no decisions', async () => {
    const session = createSession(BASE, LOCAL, REMOTE);
    const { conflicts } = performThreeWayMerge(BASE, LOCAL, REMOTE);
    recordDecision(session, conflicts[0].id, 'local');
    recordDecision(session, conflicts[1].id, 'remote');
    await saveSession(session, TEMP_DIR);

    const loaded = await loadSession(session.sessionId, TEMP_DIR);
    // local text is similar but changed in a non-conflicting region.
    const tamperedLocal = 'L\nb\nL2\nd\nCHANGED';
    const restored = restoreSession(loaded!, BASE, tamperedLocal, REMOTE);

    assert.equal(restored.stale, true);
    assert.equal(restored.inputMatches, false);
    assert.equal(restored.resolvedCount, 0, 'no old decisions may be auto-applied');
    assert.equal(restored.pendingCount, restored.conflicts.length);
    for (const c of restored.conflicts) {
      assert.equal(c.resolved, false);
    }
    assert.deepEqual(restored.appliedDecisionIds, []);
    assert.deepEqual(restored.staleDecisionIds.sort(), session.decisions.map((d) => d.conflictId).sort());
  });

  it('does not apply old decisions to similar-but-different text', async () => {
    const session = createSession('a\nb', 'a\nL', 'a\nR');
    const { conflicts } = performThreeWayMerge('a\nb', 'a\nL', 'a\nR');
    recordDecision(session, conflicts[0].id, 'local');

    // Same shape, but the conflicting content is different — old decision must not apply.
    const restored = restoreSession(session, 'a\nb', 'a\nL-DIFFERENT', 'a\nR-DIFFERENT');
    assert.equal(restored.stale, true);
    assert.equal(restored.mergedContent.includes('L-DIFFERENT'), true);
    assert.equal(restored.mergedContent.includes('<<<<<<< local'), true, 'conflict must remain unresolved');
    assert.equal(restored.resolvedCount, 0);
  });

  it('treats line-ending-only differences as unchanged (normalized hashes)', () => {
    const lf = computeInputHashes('a\nb', 'a\nL', 'a\nR');
    const crlf = computeInputHashes('a\r\nb', 'a\r\nL', 'a\r\nR');
    assert.deepEqual(lf, crlf);
  });

  it('marks stale when algorithm version differs (even with identical content)', async () => {
    const session = createSession(BASE, LOCAL, REMOTE);
    const { conflicts } = performThreeWayMerge(BASE, LOCAL, REMOTE);
    recordDecision(session, conflicts[0].id, 'local');
    (session as unknown as { algorithmVersion: string }).algorithmVersion = '0.0.1-old';
    await saveSession(session, TEMP_DIR);

    const loaded = await loadSession(session.sessionId, TEMP_DIR);
    const restored = restoreSession(loaded!, BASE, LOCAL, REMOTE);
    assert.equal(restored.stale, true);
    assert.equal(restored.algorithmMatches, false);
    assert.equal(restored.inputMatches, true);
    assert.equal(restored.resolvedCount, 0);
  });
});

describe('session: repeated save and lifecycle', () => {
  it('overwrites the same file and accumulates decisions across saves', async () => {
    const session = createSession(BASE, LOCAL, REMOTE);
    const { conflicts } = performThreeWayMerge(BASE, LOCAL, REMOTE);

    recordDecision(session, conflicts[0].id, 'local');
    const file1 = await saveSession(session, TEMP_DIR);
    const stat1 = await fs.stat(file1);

    recordDecision(session, conflicts[1].id, 'remote');
    const file2 = await saveSession(session, TEMP_DIR);

    assert.equal(file1, file2, 'repeated save must write the same session file');
    const reloaded = await loadSession(session.sessionId, TEMP_DIR);
    assert.equal(reloaded!.decisions.length, 2);
    assert.ok(new Date(reloaded!.updatedAt) >= new Date(stat1.mtime));

    const restored = restoreSession(reloaded!, BASE, LOCAL, REMOTE);
    assert.equal(restored.resolvedCount, 2);
    assert.equal(restored.mergedContent, 'L\nb\nR2\nd\ne');
  });

  it('recording the same conflict twice replaces the prior decision', () => {
    const session = createSession(BASE, LOCAL, REMOTE);
    const { conflicts } = performThreeWayMerge(BASE, LOCAL, REMOTE);
    recordDecision(session, conflicts[0].id, 'local');
    recordDecision(session, conflicts[0].id, 'remote');

    assert.equal(session.decisions.length, 1);
    assert.equal(session.decisions[0].resolution, 'remote');

    const restored = restoreSession(session, BASE, LOCAL, REMOTE);
    assert.equal(restored.conflicts[0].resolution, 'remote');
    assert.equal(restored.mergedContent.startsWith('R'), true);
  });

  it('loadSession returns null for an unknown id', async () => {
    const loaded = await loadSession('does-not-exist-id', TEMP_DIR);
    assert.equal(loaded, null);
  });

  it('deleteSession removes the file and returns false when already gone', async () => {
    const session = createSession('a\nb', 'a\nL', 'a\nR');
    await saveSession(session, TEMP_DIR);
    assert.equal(await deleteSession(session.sessionId, TEMP_DIR), true);
    assert.equal(await deleteSession(session.sessionId, TEMP_DIR), false);
    assert.equal(await loadSession(session.sessionId, TEMP_DIR), null);
  });
});

describe('session: cleanup of temporary files', () => {
  it('all session files created during the run live under the repo temp dir', async () => {
    const entries = await fs.readdir(TEMP_DIR);
    const sessionFiles = entries.filter((e) => e.endsWith('.json'));
    assert.ok(sessionFiles.length > 0, 'expected at least one saved session file');
    for (const f of sessionFiles) {
      const full = path.join(TEMP_DIR, f);
      const stat = await fs.stat(full);
      assert.ok(stat.isFile());
      assert.ok(full.startsWith(REPO_ROOT), 'session files must be inside the repo temp dir');
    }
  });
});
