import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { editor } from 'monaco-editor';
import * as monaco from 'monaco-editor';
import { FileCode, GitBranch, ArrowRightLeft, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import EditorPanel from './EditorPanel';
import Toolbar from './Toolbar';
import ConflictBlock from './ConflictBlock';
import { useMergeStore } from '../store/useMergeStore';
import { useScrollSync } from '../hooks/useScrollSync';
import {
  createDiffDecorations,
  createConflictDecorations,
  type MonacoDecoration,
} from '../utils/decorations';

type EditorKey = 'base' | 'local' | 'merged' | 'remote';

export default function MergeWorkspace() {
  const navigate = useNavigate();
  const [editors, setEditors] = useState<Record<EditorKey, editor.IStandaloneCodeEditor | null>>({
    base: null,
    local: null,
    merged: null,
    remote: null,
  });
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const [currentConflictIndex, setCurrentConflictIndex] = useState<number | null>(null);

  const {
    baseContent,
    localContent,
    remoteContent,
    mergedContent,
    conflicts,
    diffs,
    isLoading,
    error,
    updateMergedContent,
    resolveConflict,
    markConflictResolved,
    setCurrentConflict,
  } = useMergeStore();

  useScrollSync({ editors, enabled: true });

  useEffect(() => {
    if (!baseContent && !localContent && !remoteContent) {
      navigate('/');
    }
  }, [baseContent, localContent, remoteContent, navigate]);

  const handleEditorMount = useCallback((key: EditorKey) => (editor: editor.IStandaloneCodeEditor) => {
    setEditors((prev) => ({ ...prev, [key]: editor }));
  }, []);

  const handleMergedChange = useCallback(
    (value: string) => {
      updateMergedContent(value);
    },
    [updateMergedContent]
  );

  const handleResolveConflict = useCallback(
    async (conflictId: string, resolution: 'local' | 'remote' | 'manual') => {
      await resolveConflict(conflictId, resolution);
      setActiveConflictId(null);
    },
    [resolveConflict]
  );

  const handleResolveConflictLocal = useCallback(
    (conflictId: string) => {
      markConflictResolved(conflictId, 'local');
      setActiveConflictId(null);
    },
    [markConflictResolved]
  );

  const handleResolveConflictRemote = useCallback(
    (conflictId: string) => {
      markConflictResolved(conflictId, 'remote');
      setActiveConflictId(null);
    },
    [markConflictResolved]
  );

  const handleNavigateConflict = useCallback(
    (direction: 'prev' | 'next') => {
      const unresolved = conflicts.filter((c) => !c.resolved);
      if (unresolved.length === 0) return;

      let newIndex: number;
      if (currentConflictIndex === null) {
        newIndex = 0;
      } else {
        newIndex =
          direction === 'prev'
            ? Math.max(0, currentConflictIndex - 1)
            : Math.min(unresolved.length - 1, currentConflictIndex + 1);
      }

      const conflict = unresolved[newIndex];
      setCurrentConflictIndex(newIndex);
      setActiveConflictId(conflict.id);
      setCurrentConflict(conflict.id);

      const lineToReveal = conflict.startLine + 2;
      Object.values(editors).forEach((editor) => {
        if (editor) {
          editor.revealLineInCenter(lineToReveal, 0);
        }
      });
    },
    [conflicts, currentConflictIndex, editors, setCurrentConflict]
  );

  const localDecorations = useMemo<MonacoDecoration[]>(() => {
    return createDiffDecorations(diffs.baseToLocal, 'local');
  }, [diffs.baseToLocal]);

  const remoteDecorations = useMemo<MonacoDecoration[]>(() => {
    return createDiffDecorations(diffs.baseToRemote, 'remote');
  }, [diffs.baseToRemote]);

  const mergedDecorations = useMemo<MonacoDecoration[]>(() => {
    return createConflictDecorations(conflicts);
  }, [conflicts]);

  const unresolvedConflicts = conflicts.filter((c) => !c.resolved);

  const getConflictAtTop = useCallback((): {
    conflict: typeof conflicts[0] | null;
    top: number;
  } => {
    const mergedEditor = editors.merged;
    if (!mergedEditor || unresolvedConflicts.length === 0) {
      return { conflict: null, top: 0 };
    }

    const scrollTop = mergedEditor.getScrollTop();
    const lineHeight = mergedEditor.getOption(monaco.editor.EditorOption.lineHeight) || 18;
    const firstVisibleLine = Math.floor(scrollTop / lineHeight) + 1;

    let closestConflict = null;
    let minDistance = Infinity;
    let conflictTop = 0;

    for (const conflict of unresolvedConflicts) {
      const conflictLine = conflict.startLine + 1;
      const distance = Math.abs(conflictLine - firstVisibleLine);
      if (distance < minDistance) {
        minDistance = distance;
        closestConflict = conflict;
        conflictTop = (conflictLine - firstVisibleLine) * lineHeight;
      }
    }

    return { conflict: closestConflict, top: Math.max(10, conflictTop) };
  }, [editors.merged, unresolvedConflicts]);

  const visibleConflict = useMemo(() => {
    const { conflict } = getConflictAtTop();
    return conflict;
  }, [getConflictAtTop]);

  if (!baseContent || !localContent || !remoteContent) {
    return null;
  }

  if (isLoading && !mergedContent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={48} className="text-accent-500 animate-spin" />
          <p className="text-slate-300 text-lg">正在执行 3-way 合并...</p>
          <p className="text-slate-500 text-sm">正在计算差异和检测冲突</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Toolbar
        onNavigateConflict={handleNavigateConflict}
        currentConflictIndex={currentConflictIndex}
      />

      {error && (
        <div className="bg-red-900/30 border-b border-red-700/50 px-6 py-3 flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-400" />
          <span className="text-red-300">{error}</span>
        </div>
      )}

      {!isLoading && mergedContent && conflicts.length === 0 && (
        <div className="bg-green-900/30 border-b border-green-700/50 px-6 py-3 flex items-center gap-3">
          <CheckCircle size={18} className="text-green-400" />
          <span className="text-green-300">
            自动合并成功！无冲突，所有修改已自动合并。
          </span>
        </div>
      )}

      <div className="flex-1 p-4 overflow-hidden">
        <div className="h-full grid grid-cols-4 gap-3 relative">
          <EditorPanel
            title="Base"
            subtitle="共同祖先"
            content={baseContent}
            readOnly
            onMount={handleEditorMount('base')}
            icon={<FileCode size={16} />}
            colorClass="text-slate-400"
          />

          <EditorPanel
            title="Local"
            subtitle="当前分支"
            content={localContent}
            readOnly
            onMount={handleEditorMount('local')}
            decorations={localDecorations}
            icon={<GitBranch size={16} />}
            colorClass="text-blue-400"
          />

          <div className="relative h-full">
            <EditorPanel
              title="Merged"
              subtitle="合并结果"
              content={mergedContent}
              readOnly={false}
              onMount={handleEditorMount('merged')}
              onChange={handleMergedChange}
              decorations={mergedDecorations}
              icon={<ArrowRightLeft size={16} />}
              colorClass="text-accent-400"
            />

            {visibleConflict && (
              <ConflictBlock
                conflict={visibleConflict}
                onResolve={(resolution) => {
                  if (resolution === 'local') {
                    handleResolveConflictLocal(visibleConflict.id);
                  } else if (resolution === 'remote') {
                    handleResolveConflictRemote(visibleConflict.id);
                  } else {
                    handleResolveConflict(visibleConflict.id, 'manual');
                  }
                }}
                onFocus={() => setActiveConflictId(visibleConflict.id)}
                isActive={activeConflictId === visibleConflict.id}
              />
            )}
          </div>

          <EditorPanel
            title="Remote"
            subtitle="目标分支"
            content={remoteContent}
            readOnly
            onMount={handleEditorMount('remote')}
            decorations={remoteDecorations}
            icon={<GitBranch size={16} />}
            colorClass="text-green-400"
          />
        </div>
      </div>

      <style>{`
        .line-insert {
          background: rgba(81, 207, 102, 0.15) !important;
          border-left: 3px solid rgba(81, 207, 102, 0.6) !important;
        }
        .line-delete {
          background: rgba(255, 107, 107, 0.15) !important;
          border-left: 3px solid rgba(255, 107, 107, 0.6) !important;
        }
        .line-modify {
          background: rgba(255, 212, 59, 0.15) !important;
          border-left: 3px solid rgba(255, 212, 59, 0.6) !important;
        }
        .conflict-block {
          background: rgba(255, 193, 7, 0.1) !important;
          border-top: 2px solid rgba(255, 193, 7, 0.5) !important;
          border-bottom: 2px solid rgba(255, 193, 7, 0.5) !important;
        }
        .line-gutter-insert {
          border-left: 3px solid rgba(81, 207, 102, 0.6) !important;
        }
        .line-gutter-delete {
          border-left: 3px solid rgba(255, 107, 107, 0.6) !important;
        }
        .line-gutter-modify {
          border-left: 3px solid rgba(255, 212, 59, 0.6) !important;
        }
        .line-gutter-conflict {
          border-left: 3px solid rgba(255, 193, 7, 0.8) !important;
          background: rgba(255, 193, 7, 0.1) !important;
        }
        .inline-insert {
          background: rgba(81, 207, 102, 0.3) !important;
          border-radius: 2px;
        }
        .inline-delete {
          background: rgba(255, 107, 107, 0.3) !important;
          text-decoration: line-through;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
