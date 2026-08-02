import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadSession, restoreSession } from '../../api/algorithms/session.js';
import { sha256Hex } from '../../api/utils/hash.js';

/**
 * Child-process worker used by session tests to verify that a saved session
 * can be restored after the in-memory state is gone (simulated process restart).
 *
 * Args: <sessionId> <sessionDir> <inputDir>
 * Input files: <inputDir>/base.txt, local.txt, remote.txt
 * Prints one JSON line to stdout:
 *   { conflictIds, resolvedMap, resolvedCount, pendingCount, outputHash, stale, algorithmVersion }
 */
const [, , sessionId, sessionDir, inputDir] = process.argv;

if (!sessionId || !sessionDir || !inputDir) {
  console.error('usage: _restart-worker <sessionId> <sessionDir> <inputDir>');
  process.exit(2);
}

try {
  const [base, local, remote] = await Promise.all([
    fs.readFile(path.join(inputDir, 'base.txt'), 'utf8'),
    fs.readFile(path.join(inputDir, 'local.txt'), 'utf8'),
    fs.readFile(path.join(inputDir, 'remote.txt'), 'utf8'),
  ]);

  const session = await loadSession(sessionId, sessionDir);
  if (!session) {
    console.error('session not found');
    process.exit(3);
  }

  const restored = restoreSession(session, base, local, remote);

  const result = {
    conflictIds: restored.conflicts.map((c) => c.id),
    resolvedMap: Object.fromEntries(restored.conflicts.map((c) => [c.id, c.resolved])),
    resolutionMap: Object.fromEntries(
      restored.conflicts.map((c) => [c.id, c.resolution]),
    ),
    resolvedCount: restored.resolvedCount,
    pendingCount: restored.pendingCount,
    outputHash: sha256Hex(restored.mergedContent),
    stale: restored.stale,
    inputMatches: restored.inputMatches,
    algorithmMatches: restored.algorithmMatches,
  };

  process.stdout.write(JSON.stringify(result));
} catch (err) {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
}
