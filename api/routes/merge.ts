import { Router, type Request, type Response } from 'express';
import type { MergeRequest, MergeResponse } from '@shared/types';
import { performThreeWayMerge, resolveConflict } from '../algorithms/threeWayMerge.js';
import { isBinaryContent, toLF } from '../utils/lineUtils.js';

const router = Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024;

router.post('/merge', async (req: Request, res: Response): Promise<void> => {
  try {
    const { base, local, remote }: MergeRequest = req.body;

    if (!base || !local || !remote) {
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
    const { mergedContent, conflict, resolution, customContent } = req.body;

    if (!mergedContent || !conflict || !resolution) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: mergedContent, conflict, resolution',
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

    const newMergedContent = resolveConflict(
      mergedContent,
      conflict,
      resolution,
      customContent
    );

    res.status(200).json({
      success: true,
      mergedContent: newMergedContent,
    });
  } catch (error) {
    console.error('Resolve conflict error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during conflict resolution',
    });
  }
});

export default router;
