import { useRef, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { MonacoDecoration } from '../utils/decorations';
import { monacoEditorTheme } from '../utils/decorations';

interface EditorPanelProps {
  title: string;
  subtitle?: string;
  content: string;
  language?: string;
  readOnly?: boolean;
  onMount?: (editor: editor.IStandaloneCodeEditor) => void;
  onChange?: (value: string) => void;
  decorations?: MonacoDecoration[];
  icon?: React.ReactNode;
  colorClass?: string;
}

const defaultOptions: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: true },
  fontSize: 13,
  fontFamily: '"JetBrains Mono", Menlo, Monaco, Consolas, monospace',
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection',
  wordWrap: 'off',
  automaticLayout: true,
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
  },
  padding: {
    top: 10,
    bottom: 10,
  },
  renderLineHighlight: 'all',
  cursorBlinking: 'smooth',
  smoothScrolling: true,
  folding: true,
  links: false,
  colorDecorators: false,
};

export default function EditorPanel({
  title,
  subtitle,
  content,
  language = 'plaintext',
  readOnly = false,
  onMount,
  onChange,
  decorations = [],
  icon,
  colorClass = 'text-slate-200',
}: EditorPanelProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const monacoRef = useRef<any>(null);

  const handleMount = useCallback(
    (editor: editor.IStandaloneCodeEditor, monaco: any) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      try {
        monaco.editor.defineTheme('merge-tool-theme', monacoEditorTheme);
      } catch (e) {
        // Theme may already be defined, ignore
      }

      if (onMount) {
        onMount(editor);
      }
    },
    [onMount]
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (onChange && value !== undefined) {
        onChange(value);
      }
    },
    [onChange]
  );

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco || decorations.length === 0) {
      if (decorationsRef.current.length > 0 && editor) {
        editor.deltaDecorations(decorationsRef.current, []);
        decorationsRef.current = [];
      }
      return;
    }

    const newDecorations = decorations.map((d) => ({
      range: new monaco.Range(
        d.range.startLineNumber,
        d.range.startColumn,
        d.range.endLineNumber,
        d.range.endColumn
      ),
      options: d.options,
    }));

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  }, [decorations]);

  useEffect(() => {
    return () => {
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-full border border-slate-700/50 rounded-xl overflow-hidden bg-slate-900/50 backdrop-blur-sm">
      <div className="editor-header">
        <div className="flex items-center gap-2">
          {icon && <span className={colorClass}>{icon}</span>}
          <span className="editor-title">{title}</span>
          {subtitle && (
            <span className="text-xs text-slate-400 font-normal">{subtitle}</span>
          )}
        </div>
        {readOnly && (
          <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-400">
            只读
          </span>
        )}
      </div>
      <div className="flex-1 relative">
        <Editor
          height="100%"
          language={language}
          value={content}
          theme="merge-tool-theme"
          options={{
            ...defaultOptions,
            readOnly,
            domReadOnly: readOnly,
          }}
          onMount={handleMount}
          onChange={handleChange}
          loading={
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-slate-400">加载编辑器...</span>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
