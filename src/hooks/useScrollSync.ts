import { useEffect, useRef, useCallback } from 'react';
import type { editor } from 'monaco-editor';

type EditorKey = 'base' | 'local' | 'merged' | 'remote';

interface UseScrollSyncProps {
  editors: Record<EditorKey, editor.IStandaloneCodeEditor | null>;
  enabled?: boolean;
}

export function useScrollSync({ editors, enabled = true }: UseScrollSyncProps) {
  const isScrolling = useRef<EditorKey | null>(null);
  const scrollListeners = useRef<Map<EditorKey, () => void>>(new Map());
  const cursorListeners = useRef<Map<EditorKey, () => void>>(new Map());

  const syncScroll = useCallback(
    (source: EditorKey, scrollTop: number, scrollLeft: number) => {
      if (!enabled) return;

      Object.entries(editors).forEach(([key, editor]) => {
        if (key !== source && editor) {
          const targetEditor = editor as editor.IStandaloneCodeEditor;
          targetEditor.setScrollTop(scrollTop);
          targetEditor.setScrollLeft(scrollLeft);
        }
      });
    },
    [editors, enabled]
  );

  const syncCursor = useCallback(
    (source: EditorKey, lineNumber: number, column: number) => {
      if (!enabled) return;

      Object.entries(editors).forEach(([key, editor]) => {
        if (key !== source && editor) {
          const targetEditor = editor as editor.IStandaloneCodeEditor;
          targetEditor.revealPositionInCenter(
            { lineNumber, column },
            0
          );
        }
      });
    },
    [editors, enabled]
  );

  const removeListeners = useCallback(() => {
    Object.entries(editors).forEach(([key, editor]) => {
      if (!editor) return;

      const scrollListener = scrollListeners.current.get(key as EditorKey);
      const cursorListener = cursorListeners.current.get(key as EditorKey);

      if (scrollListener) {
        editor.onDidScrollChange;
        scrollListeners.current.delete(key as EditorKey);
      }
      if (cursorListener) {
        editor.onDidChangeCursorPosition;
        cursorListeners.current.delete(key as EditorKey);
      }
    });
  }, [editors]);

  const setupListeners = useCallback(() => {
    if (!enabled) return;

    removeListeners();

    Object.entries(editors).forEach(([key, editor]) => {
      if (!editor) return;

      const editorKey = key as EditorKey;

      const handleScroll = () => {
        if (isScrolling.current === null || isScrolling.current === editorKey) {
          isScrolling.current = editorKey;
          const scrollTop = editor.getScrollTop();
          const scrollLeft = editor.getScrollLeft();
          syncScroll(editorKey, scrollTop, scrollLeft);

          setTimeout(() => {
            if (isScrolling.current === editorKey) {
              isScrolling.current = null;
            }
          }, 100);
        }
      };

      const handleCursorChange = () => {
        if (isScrolling.current === null || isScrolling.current === editorKey) {
          const position = editor.getPosition();
          if (position) {
            syncCursor(editorKey, position.lineNumber, position.column);
          }
        }
      };

      const scrollDisposable = editor.onDidScrollChange(handleScroll);
      const cursorDisposable = editor.onDidChangeCursorPosition(handleCursorChange);

      scrollListeners.current.set(editorKey, () => scrollDisposable.dispose());
      cursorListeners.current.set(editorKey, () => cursorDisposable.dispose());
    });
  }, [editors, enabled, syncScroll, syncCursor, removeListeners]);

  useEffect(() => {
    setupListeners();
    return () => {
      scrollListeners.current.forEach((dispose) => dispose());
      cursorListeners.current.forEach((dispose) => dispose());
      scrollListeners.current.clear();
      cursorListeners.current.clear();
    };
  }, [setupListeners]);

  const syncToLine = useCallback(
    (lineNumber: number) => {
      Object.values(editors).forEach((editor) => {
        if (editor) {
          editor.revealLineInCenter(lineNumber, 0);
        }
      });
    },
    [editors]
  );

  return {
    syncToLine,
    isScrolling: isScrolling.current,
  };
}
