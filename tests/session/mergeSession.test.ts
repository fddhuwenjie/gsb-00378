/**
 * REGRESSION SUITE — category: session (saveable merge sessions)
 *
 * Verifies that a merge session can be saved to a repo-local temp directory and
 * replayed to the exact same result, that a fresh process (new store instance
 * reading from disk) reproduces it, that tampering with the input invalidates
 * the affected decisions instead of applying them to different text, and that
 * saving repeatedly is idempotent. Comparisons are made directly on conflict
 * IDs, resolved status and output hashes.
 *
 * All temp session files are removed in `after()`. Run alone with
 * `npm run test:session`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performThreeWayMerge } from '../../api/algorithms/threeWayMerge.ts';
import { sha256 } from '../../api/utils/lineUtils.ts';
import {
  createSession,
  replaySession,
  SessionStore,
  type ConflictDecision,
  type MergeSession,
} from '../../api/sessions/sessionStore.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A repo-local scratch directory. Everything the suite writes lives under here.
const BASE_DIR = path.join(__dirname, '..', '.tmp-sessions');
// A per-run subdirectory keeps concurrent runs from colliding.
const TMP_DIR = path.join(BASE_DIR, `run-${process.pid}-${Date.now()}`);

async function purgeBaseDir(): Promise<void> {
  // Remove the entire scratch tree — including any stray atomic-write ".tmp"
  // files or leftover run dirs from a previously interrupted run — so tests
  // never leave session files behind.
  await fs.rm(BASE_DIR, { recursive: true, force: true });
}

before(async () => {
  await purgeBaseDir();
  await fs.mkdir(TMP_DIR, { recursive: true });
});

after(async () => {
  await purgeBaseDir();
});

const TWO_CONFLICT_INPUT = {
  base: 'a\nb\nc\nd\ne',
  local: 'A1\nb\nc\nd\nE1',
  remote: 'A2\nb\nc\nd\nE2',
};

/** Fully resolve via replay and return the merged text for a set of decisions. */
function resolvedOutput(input: typeof TWO_CONFLICT_INPUT, decisions: ConflictDecision[]) {
  const session = createSession(input, decisions);
  return replaySession(session, input);
}

describe('session: deterministic conflict ids', () => {
  it('produces identical conflict ids for identical inputs across merges', () => {
    const a = performThreeWayMerge(TWO_CONFLICT_INPUT.base, TWO_CONFLICT_INPUT.local, TWO_CONFLICT_INPUT.remote);
    const b = performThreeWayMerge(TWO_CONFLICT_INPUT.base, TWO_CONFLICT_INPUT.local, TWO_CONFLICT_INPUT.remote);
    assert.deepEqual(
      b.conflicts.map((c) => c.id),
      a.conflicts.map((c) => c.id)
    );
  });

  it('gives distinct ids to duplicate-content conflicts (occurrence index)', () => {
    // Both the first and third lines conflict with the SAME payloads
    // (local 'A' vs remote 'B'). Ids must still be distinct so decisions are
    // addressable individually.
    const merge = performThreeWayMerge('x\ny\nx', 'A\ny\nA', 'B\ny\nB');
    assert.equal(merge.conflictCount, 2);
    const ids = merge.conflicts.map((c) => c.id);
    assert.equal(new Set(ids).size, 2, 'ids must be distinct');
  });

  it('changes the id when the conflicting text changes', () => {
    const original = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const changed = performThreeWayMerge('a\nb\nc', 'a\nX2\nc', 'a\nY\nc');
    assert.notEqual(original.conflicts[0].id, changed.conflicts[0].id);
  });
});

describe('session: save and restore', () => {
  it('replays decisions to the same output without touching disk', () => {
    const merge = performThreeWayMerge(
      TWO_CONFLICT_INPUT.base,
      TWO_CONFLICT_INPUT.local,
      TWO_CONFLICT_INPUT.remote
    );
    const decisions: ConflictDecision[] = [
      { conflictId: merge.conflicts[0].id, resolution: 'local' },
      { conflictId: merge.conflicts[1].id, resolution: 'remote' },
    ];

    const replay = resolvedOutput(TWO_CONFLICT_INPUT, decisions);
    // Hand-derived: conflict1 -> local (A1), conflict2 -> remote (E2).
    assert.equal(replay.mergedContent, 'A1\nb\nc\nd\nE2');
    assert.equal(replay.requiresReconfirmation, false);
    assert.equal(replay.staleDecisions.length, 0);
    assert.equal(replay.unresolvedConflicts.length, 0);
    assert.equal(replay.outputHash, sha256('A1\nb\nc\nd\nE2'));
  });

  it('round-trips through the filesystem store preserving decisions', async () => {
    const store = new SessionStore(TMP_DIR);
    const merge = performThreeWayMerge(
      TWO_CONFLICT_INPUT.base,
      TWO_CONFLICT_INPUT.local,
      TWO_CONFLICT_INPUT.remote
    );
    const decisions: ConflictDecision[] = [
      { conflictId: merge.conflicts[0].id, resolution: 'local' },
      { conflictId: merge.conflicts[1].id, resolution: 'manual', customContent: 'HAND' },
    ];
    const session = createSession(TWO_CONFLICT_INPUT, decisions, { sessionId: 'roundtrip' });

    await store.save(session);
    const loaded = await store.load('roundtrip');

    assert.deepEqual(loaded.decisions, session.decisions);
    assert.deepEqual(loaded.hashes, session.hashes);
    assert.equal(loaded.algorithmVersion, session.algorithmVersion);

    const replay = replaySession(loaded, TWO_CONFLICT_INPUT);
    // conflict1 -> local (A1); conflict2 -> manual ('HAND').
    assert.equal(replay.mergedContent, 'A1\nb\nc\nd\nHAND');
    assert.equal(replay.requiresReconfirmation, false);
  });

  it('preserves manual custom content across save/restore', async () => {
    const store = new SessionStore(TMP_DIR);
    const merge = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const session = createSession(
      { base: 'a\nb\nc', local: 'a\nX\nc', remote: 'a\nY\nc' },
      [{ conflictId: merge.conflicts[0].id, resolution: 'manual', customContent: 'M1\nM2' }],
      { sessionId: 'manual-content' }
    );
    await store.save(session);
    const loaded = await store.load('manual-content');
    const replay = replaySession(loaded, { base: 'a\nb\nc', local: 'a\nX\nc', remote: 'a\nY\nc' });
    assert.equal(replay.mergedContent, 'a\nM1\nM2\nc');
  });
});

describe('session: process restart (reload from disk into a fresh store)', () => {
  it('a brand-new store instance reproduces identical ids, status and output hash', async () => {
    const writer = new SessionStore(TMP_DIR);
    const merge = performThreeWayMerge(
      TWO_CONFLICT_INPUT.base,
      TWO_CONFLICT_INPUT.local,
      TWO_CONFLICT_INPUT.remote
    );
    const decisions: ConflictDecision[] = [
      { conflictId: merge.conflicts[0].id, resolution: 'local' },
      { conflictId: merge.conflicts[1].id, resolution: 'remote' },
    ];
    const session = createSession(TWO_CONFLICT_INPUT, decisions, { sessionId: 'restart' });

    const before = replaySession(session, TWO_CONFLICT_INPUT);
    await writer.save(session);

    // Simulate a process restart: nothing in memory, a fresh store reads the
    // file from disk.
    const rebooted = new SessionStore(TMP_DIR);
    const reloaded = await rebooted.load('restart');
    const after = replaySession(reloaded, TWO_CONFLICT_INPUT);

    // Direct before/after comparison of the three things that matter.
    assert.deepEqual(
      after.appliedDecisions.map((d) => d.conflictId).sort(),
      before.appliedDecisions.map((d) => d.conflictId).sort(),
      'conflict ids differ after restart'
    );
    assert.equal(after.unresolvedConflicts.length, before.unresolvedConflicts.length, 'resolved status differs');
    assert.equal(after.staleDecisions.length, 0);
    assert.equal(after.outputHash, before.outputHash, 'output hash differs after restart');
    assert.equal(after.mergedContent, 'A1\nb\nc\nd\nE2');
  });
});

describe('session: content tampering invalidates affected decisions', () => {
  it('flags the decision whose conflict text changed and does NOT apply it', () => {
    const merge = performThreeWayMerge(
      TWO_CONFLICT_INPUT.base,
      TWO_CONFLICT_INPUT.local,
      TWO_CONFLICT_INPUT.remote
    );
    const decisions: ConflictDecision[] = [
      { conflictId: merge.conflicts[0].id, resolution: 'local' },
      { conflictId: merge.conflicts[1].id, resolution: 'remote' },
    ];
    const session = createSession(TWO_CONFLICT_INPUT, decisions, { sessionId: 'tamper' });

    // Tamper: change the local side of the FIRST conflict only.
    const tampered = { ...TWO_CONFLICT_INPUT, local: 'A1-CHANGED\nb\nc\nd\nE1' };
    const replay = replaySession(session, tampered);

    // The changed conflict's id no longer matches => its decision is stale.
    assert.equal(replay.requiresReconfirmation, true);
    assert.deepEqual(
      replay.staleDecisions.map((d) => d.conflictId),
      [merge.conflicts[0].id]
    );
    // The untouched second decision still applies.
    assert.deepEqual(
      replay.appliedDecisions.map((d) => d.conflictId),
      [merge.conflicts[1].id]
    );
    // Crucially, the stale decision is NOT applied to the new text: the first
    // conflict block is still present (unresolved), never silently overwritten.
    assert.ok(replay.mergedContent.includes('<<<<<<< local'));
    assert.ok(replay.mergedContent.includes('A1-CHANGED'));
    // Content-hash guard also reports the local input diverged.
    assert.equal(replay.contentMatches.local, false);
    assert.equal(replay.contentMatches.base, true);
    assert.equal(replay.contentMatches.remote, true);
  });

  it('detects an on-disk file tampered so its hash no longer matches content', async () => {
    const store = new SessionStore(TMP_DIR);
    const merge = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const input = { base: 'a\nb\nc', local: 'a\nX\nc', remote: 'a\nY\nc' };
    const session = createSession(
      input,
      [{ conflictId: merge.conflicts[0].id, resolution: 'local' }],
      { sessionId: 'disk-tamper' }
    );
    await store.save(session);

    // Tamper with the persisted file: overwrite the stored hashes with garbage.
    const loaded = await store.load('disk-tamper');
    const corrupted: MergeSession = {
      ...loaded,
      hashes: { ...loaded.hashes, local: 'deadbeef' },
    };
    const replay = replaySession(corrupted, input);

    // Hash no longer matches the (unchanged) content => flagged for re-confirm
    // via contentMatches, even though the conflict id still resolves.
    assert.equal(replay.contentMatches.local, false);
  });

  it('does not apply a saved decision to similar-but-different text', () => {
    // Save a decision for base a/b/c with local 'X'. Replay against content
    // where the conflict payload is 'X2' (similar but different) -> no match.
    const original = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const session = createSession(
      { base: 'a\nb\nc', local: 'a\nX\nc', remote: 'a\nY\nc' },
      [{ conflictId: original.conflicts[0].id, resolution: 'local' }],
      { sessionId: 'similar' }
    );

    const replay = replaySession(session, { base: 'a\nb\nc', local: 'a\nX2\nc', remote: 'a\nY\nc' });
    assert.equal(replay.appliedDecisions.length, 0);
    assert.equal(replay.staleDecisions.length, 1);
    assert.equal(replay.requiresReconfirmation, true);
    // The similar conflict is left unresolved for the user to re-confirm.
    assert.ok(replay.mergedContent.includes('X2'));
    assert.ok(replay.mergedContent.includes('<<<<<<< local'));
  });
});

describe('session: duplicate / repeated saves are idempotent', () => {
  it('saving the same session twice leaves exactly one file with identical bytes', async () => {
    const store = new SessionStore(TMP_DIR);
    const merge = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const session = createSession(
      { base: 'a\nb\nc', local: 'a\nX\nc', remote: 'a\nY\nc' },
      [{ conflictId: merge.conflicts[0].id, resolution: 'local' }],
      { sessionId: 'dupe-save', createdAt: '2020-01-01T00:00:00.000Z' }
    );

    const p1 = await store.save(session);
    const bytes1 = await fs.readFile(p1, 'utf8');
    const p2 = await store.save(session);
    const bytes2 = await fs.readFile(p2, 'utf8');

    assert.equal(p1, p2, 'same session id must map to the same file');
    assert.equal(bytes2, bytes1, 'repeated save must be byte-identical');

    const ids = await store.list();
    assert.equal(ids.filter((id) => id === 'dupe-save').length, 1, 'must not duplicate the file');
  });

  it('replaying the same session repeatedly yields a stable output hash', () => {
    const merge = performThreeWayMerge(
      TWO_CONFLICT_INPUT.base,
      TWO_CONFLICT_INPUT.local,
      TWO_CONFLICT_INPUT.remote
    );
    const session = createSession(TWO_CONFLICT_INPUT, [
      { conflictId: merge.conflicts[0].id, resolution: 'local' },
      { conflictId: merge.conflicts[1].id, resolution: 'remote' },
    ]);
    const first = replaySession(session, TWO_CONFLICT_INPUT).outputHash;
    const second = replaySession(session, TWO_CONFLICT_INPUT).outputHash;
    const third = replaySession(session, TWO_CONFLICT_INPUT).outputHash;
    assert.equal(second, first);
    assert.equal(third, first);
  });

  it('delete is idempotent and removes the file', async () => {
    const store = new SessionStore(TMP_DIR);
    const session = createSession(
      { base: 'a', local: 'a', remote: 'a' },
      [],
      { sessionId: 'to-delete' }
    );
    await store.save(session);
    assert.equal(await store.exists('to-delete'), true);
    await store.delete('to-delete');
    assert.equal(await store.exists('to-delete'), false);
    // Second delete must not throw.
    await store.delete('to-delete');
  });
});

describe('session: algorithm version guard', () => {
  it('marks all decisions stale when the saved algorithm version differs', () => {
    const merge = performThreeWayMerge('a\nb\nc', 'a\nX\nc', 'a\nY\nc');
    const input = { base: 'a\nb\nc', local: 'a\nX\nc', remote: 'a\nY\nc' };
    const session = createSession(input, [
      { conflictId: merge.conflicts[0].id, resolution: 'local' },
    ]);
    // Simulate a session saved under a future/incompatible algorithm version.
    const fromOtherVersion: MergeSession = { ...session, algorithmVersion: session.algorithmVersion + 1 };
    const replay = replaySession(fromOtherVersion, input);

    assert.equal(replay.algorithmVersionMatches, false);
    assert.equal(replay.appliedDecisions.length, 0);
    assert.equal(replay.staleDecisions.length, 1);
    assert.equal(replay.requiresReconfirmation, true);
  });
});
