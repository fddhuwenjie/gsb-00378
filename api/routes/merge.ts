import { Router, type Request, type Response } from 'express';
import type { MergeRequest, MergeResponse, Conflict } from '@shared/types';
import { performThreeWayMerge } from '../algorithms/threeWayMerge.js';
import { resolveConflictById, ConflictNotFoundError } from '../algorithms/conflictMarkers.js';
import { isBinaryContent, toLF } from '../utils/lineUtils.js';

const router = Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

router.post('/merge', async (req: Request, res: Response): Promise<void> => {
  try {
    const { base, local, remote }: MergeRequest = req.body;

    if (base === undefined || local === undefined || remote === undefined) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: base, local, remote',
      });
      return;
    }

    if (typeof base !== 'string' || typeof local !== 'string' || typeof remote !== 'string') {
      res.status(400).json({
        success: false,
        error: 'All fields must be strings',
      });
      return;
    }

    const totalSize = Buffer.byteLength(base, 'utf8') +
      Buffer.byteLength(local, 'utf8') +
      Buffer.byteLength(remote, 'utf8');

    if (totalSize > MAX_FILE_SIZE * 3) {
      res.status(413).json({
        success: false,
        error: 'Total file size exceeds limit (30MB)',
      });
      return;
    }

    if (isBinaryContent(base) || isBinaryContent(local) || isBinaryContent(remote)) {
      res.status(400).json({
        success: false,
        error: 'Binary files are not supported',
      });
      return;
    }

    const baseLF = toLF(base);
    const localLF = toLF(local);
    const remoteLF = toLF(remote);

    const result = performThreeWayMerge(baseLF, localLF, remoteLF);

    const response: MergeResponse = {
      success: true,
      mergedContent: result.mergedContent,
      hasConflicts: result.hasConflicts,
      conflictCount: result.conflicts.length,
      conflicts: result.conflicts,
      diffs: result.diffs,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Merge error:', error);
    res.status(500).json({
      success: false,
      mergedContent: '',
      hasConflicts: false,
      conflictCount: 0,
      conflicts: [],
      diffs: { baseToLocal: [], baseToRemote: [] },
      error: error instanceof Error ? error.message : 'Unknown error during merge',
    });
  }
});

router.post('/resolve', async (req: Request, res: Response): Promise<void> => {
  try {
    const { mergedContent, conflictId, conflict, resolution, customContent } = req.body as {
      mergedContent: unknown;
      conflictId: unknown;
      conflict: { id?: unknown } | undefined;
      resolution: unknown;
      customContent: unknown;
    };

    if (typeof mergedContent !== 'string' || !isNonEmptyString(resolution)) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: mergedContent, resolution',
      });
      return;
    }

    if (!['local', 'remote', 'manual'].includes(resolution)) {
      res.status(400).json({
        success: false,
        error: 'Invalid resolution type. Must be one of: local, remote, manual',
      });
      return;
    }

    if (resolution === 'manual' && typeof customContent !== 'string') {
      res.status(400).json({
        success: false,
        error: 'customContent is required for manual resolution',
      });
      return;
    }

    let targetId: string;
    if (isNonEmptyString(conflictId)) {
      targetId = conflictId;
    } else if (conflict && isNonEmptyString(conflict.id)) {
      targetId = conflict.id;
    } else {
      res.status(400).json({
        success: false,
        error: 'Missing required field: conflictId',
      });
      return;
    }

    const result = resolveConflictById(
      mergedContent,
      targetId,
      resolution as 'local' | 'remote' | 'manual',
      typeof customContent === 'string' ? customContent : undefined
    );

    const remainingConflicts: Conflict[] = result.conflicts.map((c) => ({
      ...c,
      baseContent: [],
    }));

    res.status(200).json({
      success: true,
      mergedContent: result.mergedContent,
      resolvedId: result.resolvedId,
      conflicts: remainingConflicts,
      hasConflicts: remainingConflicts.length > 0,
      conflictCount: remainingConflicts.length,
    });
  } catch (error) {
    if (error instanceof ConflictNotFoundError) {
      res.status(404).json({
        success: false,
        error: error.message,
      });
      return;
    }
    console.error('Resolve conflict error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during conflict resolution',
    });
  }
});

export default router;
