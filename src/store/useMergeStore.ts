import { create } from 'zustand';
import type { Conflict, LineDiff, MergeResponse } from '@shared/types';
import { requestMerge, requestResolveConflict } from '../services/mergeApi';

interface MergeState {
  baseContent: string;
  localContent: string;
  remoteContent: string;
  mergedContent: string;
  baseFileName: string;
  localFileName: string;
  remoteFileName: string;
  conflicts: Conflict[];
  currentConflictId: string | null;
  isLoading: boolean;
  error: string | null;
  diffs: {
    baseToLocal: LineDiff[];
    baseToRemote: LineDiff[];
  };
  hasConflicts: boolean;
  conflictCount: number;
  setBaseContent: (content: string, fileName?: string) => void;
  setLocalContent: (content: string, fileName?: string) => void;
  setRemoteContent: (content: string, fileName?: string) => void;
  performMerge: () => Promise<void>;
  resolveConflict: (
    conflictId: string,
    resolution: 'local' | 'remote' | 'manual',
    customContent?: string
  ) => Promise<void>;
  updateMergedContent: (content: string) => void;
  setCurrentConflict: (id: string | null) => void;
  reset: () => void;
  getUnresolvedCount: () => number;
  markConflictResolved: (conflictId: string, resolution: 'local' | 'remote' | 'manual') => void;
}

const initialState = {
  baseContent: '',
  localContent: '',
  remoteContent: '',
  mergedContent: '',
  baseFileName: '',
  localFileName: '',
  remoteFileName: '',
  conflicts: [],
  currentConflictId: null,
  isLoading: false,
  error: null,
  diffs: {
    baseToLocal: [],
    baseToRemote: [],
  },
  hasConflicts: false,
  conflictCount: 0,
};

export const useMergeStore = create<MergeState>((set, get) => ({
  ...initialState,

  setBaseContent: (content: string, fileName?: string) =>
    set({ baseContent: content, baseFileName: fileName || get().baseFileName }),

  setLocalContent: (content: string, fileName?: string) =>
    set({ localContent: content, localFileName: fileName || get().localFileName }),

  setRemoteContent: (content: string, fileName?: string) =>
    set({ remoteContent: content, remoteFileName: fileName || get().remoteFileName }),

  performMerge: async () => {
    set({ isLoading: true, error: null });

    try {
      const { baseContent, localContent, remoteContent } = get();
      const result: MergeResponse = await requestMerge(baseContent, localContent, remoteContent);

      set({
        mergedContent: result.mergedContent,
        conflicts: result.conflicts,
        diffs: result.diffs,
        hasConflicts: result.hasConflicts,
        conflictCount: result.conflictCount,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Merge failed',
        isLoading: false,
      });
    }
  },

  resolveConflict: async (
    conflictId: string,
    resolution: 'local' | 'remote' | 'manual',
    customContent?: string
  ) => {
    const { mergedContent, conflicts } = get();
    const conflict = conflicts.find((c) => c.id === conflictId);

    if (!conflict) return;

    set({ isLoading: true, error: null });

    try {
      const result = await requestResolveConflict(mergedContent, conflict, resolution, customContent);

      if (result.success) {
        const newMergedContent = result.mergedContent;
        const lineOffset = calculateLineOffset(conflict, resolution, customContent);

        const updatedConflicts = conflicts
          .map((c) => {
            if (c.id === conflictId) {
              return { ...c, resolved: true, resolution };
            }
            if (c.startLine > conflict.startLine) {
              return {
                ...c,
                startLine: c.startLine + lineOffset,
                endLine: c.endLine + lineOffset,
              };
            }
            return c;
          })
          .filter((c) => c.id !== conflictId || c.resolved);

        set({
          mergedContent: newMergedContent,
          conflicts: updatedConflicts,
          hasConflicts: updatedConflicts.some((c) => !c.resolved),
          conflictCount: updatedConflicts.filter((c) => !c.resolved).length,
          isLoading: false,
          currentConflictId: null,
        });
      } else {
        throw new Error(result.error || 'Failed to resolve conflict');
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Conflict resolution failed',
        isLoading: false,
      });
    }
  },

  updateMergedContent: (content: string) => set({ mergedContent: content }),

  setCurrentConflict: (id: string | null) => set({ currentConflictId: id }),

  reset: () => set(initialState),

  getUnresolvedCount: () => {
    return get().conflicts.filter((c) => !c.resolved).length;
  },

  markConflictResolved: (conflictId: string, resolution: 'local' | 'remote' | 'manual') => {
    const { mergedContent, conflicts } = get();
    const conflict = conflicts.find((c) => c.id === conflictId);
    if (!conflict) return;

    const resolutionContent =
      resolution === 'local'
        ? conflict.localContent.join('\n')
        : resolution === 'remote'
          ? conflict.remoteContent.join('\n')
          : '';

    const lines = mergedContent.split('\n');
    const conflictLength = conflict.endLine - conflict.startLine + 1;
    const newContentLines = resolution === 'manual' ? [] : resolutionContent.split('\n');
    lines.splice(conflict.startLine, conflictLength, ...newContentLines);
    const newMergedContent = lines.join('\n');

    const lineOffset = newContentLines.length - conflictLength;

    const updatedConflicts = conflicts
      .map((c) => {
        if (c.id === conflictId) {
          return { ...c, resolved: true, resolution };
        }
        if (c.startLine > conflict.startLine) {
          return {
            ...c,
            startLine: c.startLine + lineOffset,
            endLine: c.endLine + lineOffset,
          };
        }
        return c;
      })
      .filter((c) => c.id !== conflictId || c.resolved);

    set({
      mergedContent: newMergedContent,
      conflicts: updatedConflicts,
      hasConflicts: updatedConflicts.some((c) => !c.resolved),
      conflictCount: updatedConflicts.filter((c) => !c.resolved).length,
      currentConflictId: null,
    });
  },
}));

function calculateLineOffset(
  conflict: Conflict,
  resolution: 'local' | 'remote' | 'manual',
  customContent?: string
): number {
  const conflictLength = conflict.endLine - conflict.startLine + 1;
  let newLength: number;

  if (resolution === 'local') {
    newLength = conflict.localContent.length;
  } else if (resolution === 'remote') {
    newLength = conflict.remoteContent.length;
  } else {
    newLength = customContent ? customContent.split('\n').length : 0;
  }

  return newLength - conflictLength;
}
