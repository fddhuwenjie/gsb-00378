/**
 * 进程重启测试驱动：在全新进程中从磁盘读取会话与输入，重放决定并输出结果。
 * 用法：tsx replayDriver.ts <sessionFile> <baseFile> <localFile> <remoteFile>
 */
import { readFileSync } from 'node:fs';
import { loadSession, restoreSession } from '../../api/algorithms/mergeSession';

const [sessionFile, baseFile, localFile, remoteFile] = process.argv.slice(2);
const data = loadSession(sessionFile);
const result = restoreSession(
  data,
  readFileSync(baseFile, 'utf8'),
  readFileSync(localFile, 'utf8'),
  readFileSync(remoteFile, 'utf8')
);

process.stdout.write(
  JSON.stringify({
    conflictIds: result.conflicts.map((c) => c.id),
    resolved: result.conflicts.map((c) => c.resolved),
    resolutions: result.conflicts.map((c) => c.resolution),
    replayedCount: result.replayedDecisions.length,
    invalidCount: result.invalidDecisions.length,
    requireReconfirmation: result.requireReconfirmation,
    inputsChanged: result.inputsChanged,
    outputHash: result.outputHash,
    mergedContent: result.mergedContent,
  })
);
