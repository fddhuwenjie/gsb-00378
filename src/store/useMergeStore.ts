import { create } from 'zustand';
import type { Conflict, LineDiff, MergeResponse, ResolveResponse } from '@shared/types';
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
    const target = conflicts.find((c) => c.id === conflictId);

    if (!target || target.resolved) {
      set({
        error: target?.resolved
          ? `Conflict ${conflictId} is already resolved`
          : `Conflict ${conflictId} not found`,
      });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const result: ResolveResponse = await requestResolveConflict(
        mergedContent,
        conflictId,
        resolution,
        customContent
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to resolve conflict');
      }

      const previousConflicts = get().conflicts;
      const resolvedMap = new Map<string, Conflict>();
      const baseContentMap = new Map<string, string[]>();
      previousConflicts.forEach((c) => {
        baseContentMap.set(c.id, c.baseContent);
        if (c.id === result.resolvedId || c.resolved) {
          resolvedMap.set(c.id, c);
        }
      });

      const remaining: Conflict[] = result.conflicts.map((c) => ({
        ...c,
        baseContent: baseContentMap.get(c.id) ?? c.baseContent,
        resolved: false,
        resolution: null,
      }));

      for (const resolved of resolvedMap.values()) {
        if (remaining.every((c) => c.id !== resolved.id)) {
          remaining.push({
            ...resolved,
            resolved: true,
            resolution: resolved.resolution ?? resolution,
          });
        }
      }

      remaining.sort((a, b) => {
        if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
        return a.startLine - b.startLine;
      });

      set({
        mergedContent: result.mergedContent,
        conflicts: remaining,
        hasConflicts: remaining.some((c) => !c.resolved),
        conflictCount: remaining.filter((c) => !c.resolved).length,
        isLoading: false,
        currentConflictId: null,
      });
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
}));
