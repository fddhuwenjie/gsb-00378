import type { LineDiff, Conflict } from '@shared/types';

export interface MonacoDecoration {
  id: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  options: any;
}

export function createDiffDecorations(
  diffs: LineDiff[],
  editorType: 'local' | 'remote'
): MonacoDecoration[] {
  const decorations: MonacoDecoration[] = [];
  let counter = 0;

  diffs.forEach((diff) => {
    const lineNum = editorType === 'local' ? diff.newLineNum : diff.newLineNum;

    if (lineNum === null || lineNum === undefined) {
      if (diff.type === 'delete') {
        const oldLineNum = diff.oldLineNum;
        if (oldLineNum !== null && oldLineNum !== undefined) {
          decorations.push({
            id: `diff-delete-${counter++}`,
            range: {
              startLineNumber: oldLineNum + 1,
              startColumn: 1,
              endLineNumber: oldLineNum + 1,
              endColumn: 1,
            },
            options: {
              isWholeLine: true,
              className: 'line-delete',
              linesDecorationsClassName: 'line-gutter-delete',
              minimap: {
                color: 'rgba(255, 107, 107, 0.5)',
                position: 1,
              },
            },
          });
        }
      }
      return;
    }

    const lineNumber = lineNum + 1;

    switch (diff.type) {
      case 'insert':
        decorations.push({
          id: `diff-insert-${counter++}`,
          range: {
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: 'line-insert',
            linesDecorationsClassName: 'line-gutter-insert',
            minimap: {
              color: 'rgba(81, 207, 102, 0.5)',
              position: 1,
            },
          },
        });
        break;
      case 'delete':
        decorations.push({
          id: `diff-delete-${counter++}`,
          range: {
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: 'line-delete',
            linesDecorationsClassName: 'line-gutter-delete',
            minimap: {
              color: 'rgba(255, 107, 107, 0.5)',
              position: 1,
            },
          },
        });
        break;
      case 'modify':
        decorations.push({
          id: `diff-modify-${counter++}`,
          range: {
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: 'line-modify',
            linesDecorationsClassName: 'line-gutter-modify',
            minimap: {
              color: 'rgba(255, 212, 59, 0.5)',
              position: 1,
            },
          },
        });
        break;
    }
  });

  return decorations;
}

export function createConflictDecorations(
  conflicts: Conflict[]
): MonacoDecoration[] {
  const decorations: MonacoDecoration[] = [];
  let counter = 0;

  conflicts.forEach((conflict) => {
    if (conflict.resolved) return;

    const startLine = conflict.startLine + 1;
    const endLine = conflict.endLine + 1;

    decorations.push({
      id: `conflict-${conflict.id}-${counter++}`,
      range: {
        startLineNumber: startLine,
        startColumn: 1,
        endLineNumber: endLine,
        endColumn: 1,
      },
      options: {
        isWholeLine: true,
        className: 'conflict-block',
        linesDecorationsClassName: 'line-gutter-conflict',
        minimap: {
          color: 'rgba(255, 193, 7, 0.6)',
          position: 1,
        },
        after: {
          content: '',
        },
      },
    });
  });

  return decorations;
}

export function createInlineDiffDecorations(
  baseContent: string,
  targetContent: string,
  startLine: number,
  endLine: number
): MonacoDecoration[] {
  const decorations: MonacoDecoration[] = [];
  const baseLines = baseContent.split('\n');
  const targetLines = targetContent.split('\n');

  for (let i = startLine; i <= Math.min(endLine, targetLines.length - 1); i++) {
    const targetLine = targetLines[i];
    const baseLine = baseLines[i];

    if (!targetLine || !baseLine || targetLine === baseLine) continue;

    const changes = findInlineChanges(baseLine, targetLine);

    changes.forEach((change, idx) => {
      decorations.push({
        id: `inline-${i}-${idx}`,
        range: {
          startLineNumber: i + 1,
          startColumn: change.start + 1,
          endLineNumber: i + 1,
          endColumn: change.end + 1,
        },
        options: {
          inlineClassName: change.type === 'insert' ? 'inline-insert' : 'inline-delete',
        },
      });
    });
  }

  return decorations;
}

interface InlineChange {
  type: 'insert' | 'delete';
  start: number;
  end: number;
}

function findInlineChanges(oldStr: string, newStr: string): InlineChange[] {
  const changes: InlineChange[] = [];

  if (oldStr === newStr) return changes;

  const maxLen = Math.max(oldStr.length, newStr.length);
  let startIdx = 0;

  while (startIdx < maxLen && oldStr[startIdx] === newStr[startIdx]) {
    startIdx++;
  }

  let endOld = oldStr.length;
  let endNew = newStr.length;

  while (endOld > startIdx && endNew > startIdx && oldStr[endOld - 1] === newStr[endNew - 1]) {
    endOld--;
    endNew--;
  }

  if (startIdx < endOld) {
    changes.push({
      type: 'delete',
      start: startIdx,
      end: endOld,
    });
  }

  if (startIdx < endNew) {
    changes.push({
      type: 'insert',
      start: startIdx,
      end: endNew,
    });
  }

  return changes;
}

export const monacoEditorTheme = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', background: '0f172a', foreground: 'e2e8f0' },
    { token: 'keyword', foreground: '60a5fa' },
    { token: 'string', foreground: '86efac' },
    { token: 'number', foreground: 'fbbf24' },
    { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#0f172a',
    'editor.foreground': '#e2e8f0',
    'editor.lineNumbersBackground': '#1e293b',
    'editor.lineNumbersForeground': '#64748b',
    'editor.selectionBackground': '#334155',
    'editor.selectionHighlightBackground': '#334155',
    'editor.wordHighlightBackground': '#334155',
    'editorCursor.foreground': '#00d4aa',
    'editorWhitespace.foreground': '#334155',
    'editorIndentGuide.background': '#1e293b',
    'editorRuler.foreground': '#334155',
    'editorOverviewRuler.border': '#1e293b',
    'scrollbarSlider.background': '#334155',
    'scrollbarSlider.hoverBackground': '#475569',
    'scrollbarSlider.activeBackground': '#475569',
  },
};
