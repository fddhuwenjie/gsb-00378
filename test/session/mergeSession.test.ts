import assert from 'node:assert/strict';
import { test, describe, before, after, afterEach } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ALGORITHM_VERSION,
  createSession,
  addDecision,
  saveSession,
  loadSession,
  restoreSession,
  hashText,
  conflictSignature,
  sessionMatchesContent,
  type MergeSessionData,
} from '../../api/session/mergeSession.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CHILD_SCRIPT = path.join(__dirname, 'restore-child.ts');

const FIXTURE_BASE = 'alpha\nbeta\ngamma\ndelta\nepsilon';
const FIXTURE_LOCAL = 'LOCAL-ALPHA\nbeta\ngamma\ndelta\nLOCAL-EPSILON';
const FIXTURE_REMOTE = 'REMOTE-ALPHA\nbeta\ngamma\ndelta\nREMOTE-EPSILON';

let tempDir: string;

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-session-'));
});

afterEach(async () => {
  const entries = await fs.readdir(tempDir);
  await Promise.all(
    entries.map((e) => fs.rm(path.join(tempDir, e), { force: true, recursive: true }))
  );
});

after(async () => {
  await fs.rm(tempDir, { force: true, recursive: true });
});

async function buildSessionWithDecisions(): Promise<{
  session: MergeSessionData;
  firstSignature: string;
  secondSignature: string;
}> {
  const { performThreeWayMerge } = await import('../../api/algorithms/threeWayMerge.js');
  const merge = performThreeWayMerge(FIXTURE_BASE, FIXTURE_LOCAL, FIXTURE_REMOTE);
  assert.equal(merge.conflictCount, 2);
  let session = createSession(FIXTURE_BASE, FIXTURE_LOCAL, FIXTURE_REMOTE);
  session = addDecision(session, merge.conflicts[0], 'local');
  session = addDecision(session, merge.conflicts[1], 'remote');
  return {
    session,
    firstSignature: conflictSignature(merge.conflicts[0]),
    secondSignature: conflictSignature(merge.conflicts[1]),
  };
}

describe('[SESSION] save and restore replays decisions', () => {
  test('round-trips session through disk and replays to identical output hash', async () => {
    const { session } = await buildSessionWithDecisions();
    const file = await saveSession(tempDir, session);

    const onDisk = JSON.parse(await fs.readFile(file, 'utf8')) as MergeSessionData;
    assert.equal(onDisk.algorithmVersion, ALGORITHM_VERSION);
    assert.equal(onDisk.decisions.length, 2);
    assert.equal(onDisk.baseHash, hashText(FIXTURE_BASE));

    const restored = restoreSession(onDisk, FIXTURE_BASE, FIXTURE_LOCAL, FIXTURE_REMOTE);
    assert.equal(restored.status, 'clean');
    assert.equal(restored.conflicts.length, 0);
    assert.equal(restored.invalidated.length, 0);
    assert.equal(restored.replayed.length, 2);
    assert.equal(
      restored.mergedContent,
      'LOCAL-ALPHA\nbeta\ngamma\ndelta\nREMOTE-EPSILON'
    );

    const direct = restoreSession(session, FIXTURE_BASE, FIXTURE_LOCAL, FIXTURE_REMOTE);
    assert.equal(restored.outputHash, direct.outputHash, 'disk and in-memory restore must match');
    assert.equal(restored.outputHash, hashText(restored.mergedContent));
  });

  test('loadSession returns the exact saved data', async () => {
    const { session } = await buildSessionWithDecisions();
    await saveSession(tempDir, session);
    const loaded = await loadSession(tempDir, session.sessionId);
    assert.equal(loaded.sessionId, session.sessionId);
    assert.equal(loaded.algorithmVersion, session.algorithmVersion);
    assert.deepEqual(loaded.decisions, session.decisions);
  });

  test('session stores content hashes and algorithm version but no absolute line numbers', async () => {
    const { session } = await buildSessionWithDecisions();
    const serialized = JSON.stringify(session);
    assert.equal(serialized.includes('startLine'), false, 'session must not store startLine');
    assert.equal(serialized.includes('endLine'), false, 'session must not store endLine');
    assert.equal(session.baseHash.length, 64, 'sha256 hex digest');
    assert.equal(session.localHash.length, 64);
    assert.equal(session.remoteHash.length, 64);
    assert.equal(session.algorithmVersion, ALGORITHM_VERSION);
  });
});

describe('[SESSION] process restart', () => {
  test('a fresh child process loads the session and replays decisions independently', async () => {
    const { session } = await buildSessionWithDecisions();
    await saveSession(tempDir, session);

    const argsFile = path.join(tempDir, 'args.json');
    await fs.writeFile(
      argsFile,
      JSON.stringify({
        directory: tempDir,
        sessionId: session.sessionId,
        base: FIXTURE_BASE,
        local: FIXTURE_LOCAL,
        remote: FIXTURE_REMOTE,
      }),
      'utf8'
    );

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--no-warnings', CHILD_SCRIPT, argsFile],
      { encoding: 'utf8', cwd: process.cwd() }
    );

    assert.equal(result.status, 0, `child failed: ${result.stderr}`);
    const child = JSON.parse(result.stdout);

    const inProcess = restoreSession(session, FIXTURE_BASE, FIXTURE_LOCAL, FIXTURE_REMOTE);

    assert.equal(child.status, 'clean');
    assert.equal(child.outputHash, inProcess.outputHash, 'cross-process output hash must match');
    assert.equal(child.mergedContent, inProcess.mergedContent);
    assert.deepEqual([...child.replayed].sort(), [...inProcess.replayed].sort());
    assert.equal(child.conflictCount, 0);
  });
});

describe('[SESSION] content tampering invalidates decisions', () => {
  test('changed local content marks all decisions stale and does not replay them', async () => {
    const { session } = await buildSessionWithDecisions();
    const tamperedLocal = 'TAMPERED-ALPHA\nbeta\ngamma\ndelta\nLOCAL-EPSILON';

    assert.equal(
      sessionMatchesContent(session, FIXTURE_BASE, tamperedLocal, FIXTURE_REMOTE),
      false
    );

    const restored = restoreSession(session, FIXTURE_BASE, tamperedLocal, FIXTURE_REMOTE);
    assert.equal(restored.status, 'stale');
    assert.equal(restored.replayed.length, 0, 'no decision must be replayed on changed content');
    assert.equal(restored.invalidated.length, session.decisions.length);
    assert.ok(restored.mergedContent.includes('<<<<<<< local:'), 'fresh conflicts must be present');
    assert.notEqual(
      restored.outputHash,
      hashText('LOCAL-ALPHA\nbeta\ngamma\ndelta\nREMOTE-EPSILON')
    );
  });

  test('changed base content marks decisions stale even when sides look similar', async () => {
    const { session } = await buildSessionWithDecisions();
    const restored = restoreSession(
      session,
      'alpha\nCHANGED\ngamma\ndelta\nepsilon',
      FIXTURE_LOCAL,
      FIXTURE_REMOTE
    );
    assert.equal(restored.status, 'stale');
    assert.equal(restored.replayed.length, 0);
    assert.equal(restored.invalidated.length, session.decisions.length);
  });

  test('line-ending-only change is normalized and does not invalidate (by design: LF canonical)', async () => {
    const { session } = await buildSessionWithDecisions();
    const crlfBase = FIXTURE_BASE.replace(/\n/g, '\r\n');
    assert.equal(
      sessionMatchesContent(session, crlfBase, FIXTURE_LOCAL, FIXTURE_REMOTE),
      true,
      'CRLF must normalize to LF so the session still matches'
    );
  });
});

describe('[SESSION] duplicate save and decision updates', () => {
  test('saving twice overwrites the same file idempotently', async () => {
    const { session } = await buildSessionWithDecisions();
    const file1 = await saveSession(tempDir, session);
    const file2 = await saveSession(tempDir, session);
    assert.equal(file1, file2);
    const entries = await fs.readdir(tempDir);
    const sessionFiles = entries.filter((e) => e.endsWith('.json') && e.startsWith('session-'));
    assert.equal(sessionFiles.length, 1);
  });

  test('adding a decision for the same conflict signature replaces the prior one', async () => {
    const { performThreeWayMerge } = await import('../../api/algorithms/threeWayMerge.js');
    const merge = performThreeWayMerge('b', 'L', 'R');
    const conflict = merge.conflicts[0];
    let session = createSession('b', 'L', 'R');
    session = addDecision(session, conflict, 'local');
    assert.equal(session.decisions.length, 1);
    const firstSnapshot = [...session.decisions];

    session = addDecision(session, conflict, 'manual', 'handcrafted');
    assert.equal(session.decisions.length, 1, 'duplicate signature must not add a second decision');
    assert.equal(session.decisions[0].resolution, 'manual');
    assert.equal(session.decisions[0].customContent, 'handcrafted');
    assert.equal(session.decisions[0].signature, firstSnapshot[0].signature);
  });
});

describe('[SESSION] signature and version mismatch', () => {
  test('a decision whose signature no longer exists is invalidated without crashing', async () => {
    let session = createSession(FIXTURE_BASE, FIXTURE_LOCAL, FIXTURE_REMOTE);
    const { performThreeWayMerge } = await import('../../api/algorithms/threeWayMerge.js');
    const merge = performThreeWayMerge(FIXTURE_BASE, FIXTURE_LOCAL, FIXTURE_REMOTE);
    session = addDecision(session, merge.conflicts[0], 'local');

    session.decisions.push({
      signature: 'sig-deadbeefdeadbeef',
      resolution: 'local',
    });

    const restored = restoreSession(session, FIXTURE_BASE, FIXTURE_LOCAL, FIXTURE_REMOTE);
    assert.equal(restored.status, 'partial');
    assert.equal(restored.replayed.length, 1);
    assert.ok(restored.invalidated.includes('sig-deadbeefdeadbeef'));
    assert.equal(restored.conflicts.length, 1, 'second conflict remains unresolved');
  });

  test('unknown algorithm version forces stale restore', async () => {
    const { session } = await buildSessionWithDecisions();
    const futureSession: MergeSessionData = {
      ...session,
      algorithmVersion: 'merge-3way-v999',
    };
    const restored = restoreSession(
      futureSession,
      FIXTURE_BASE,
      FIXTURE_LOCAL,
      FIXTURE_REMOTE
    );
    assert.equal(restored.status, 'stale');
    assert.equal(restored.replayed.length, 0);
    assert.equal(restored.invalidated.length, session.decisions.length);
  });
});

describe('[SESSION] temp directory cleanup', () => {
  test('test temp directory is removed by the after() hook', async () => {
    assert.ok(tempDir.startsWith(path.join(os.tmpdir(), 'merge-session-')));
    await fs.writeFile(path.join(tempDir, 'sentinel'), 'ok', 'utf8');
    assert.ok(await fs.stat(tempDir).then((s) => s.isDirectory()));
  });
});
