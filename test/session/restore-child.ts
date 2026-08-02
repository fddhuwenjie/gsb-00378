import { promises as fs } from 'node:fs';
import { loadSession, restoreSession } from '../../api/session/mergeSession.js';

interface ChildArgs {
  directory: string;
  sessionId: string;
  base: string;
  local: string;
  remote: string;
}

async function main(): Promise<void> {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error('child restart script requires a JSON args file path');
  }
  const argsJson = await fs.readFile(raw, 'utf8');
  const args = JSON.parse(argsJson) as ChildArgs;

  const session = await loadSession(args.directory, args.sessionId);
  const result = restoreSession(session, args.base, args.local, args.remote);

  process.stdout.write(
    JSON.stringify({
      status: result.status,
      outputHash: result.outputHash,
      mergedContent: result.mergedContent,
      replayed: result.replayed,
      invalidated: result.invalidated,
      conflictCount: result.conflicts.length,
      conflictSignatures: result.conflicts.map((c) => c.signature),
    })
  );
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
