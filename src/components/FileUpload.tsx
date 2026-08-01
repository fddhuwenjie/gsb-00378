import { useState, useCallback, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, X, FileCode, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { readFileAsText } from '../services/mergeApi';
import { useMergeStore } from '../store/useMergeStore';
import { formatFileSize } from '@shared/utils';

type FileSlot = 'base' | 'local' | 'remote';

interface FileInfo {
  name: string;
  size: number;
  content: string;
}

const SAMPLE_FILES = {
  base: `line 1: Hello World
line 2: This is the base version
line 3: Third line unchanged
line 4: Function calculate(a, b) {
line 5:   return a + b;
line 6: }
line 7: End of file`,
  local: `line 1: Hello World
line 2: This is the LOCAL version with changes
line 3: Third line unchanged
line 4: Function calculate(a, b) {
line 5:   // Local added comment
line 5.5:   const result = a + b;
line 6:   return result * 2;  // Local modified
line 7: }
line 8: End of file - local added`,
  remote: `line 1: Hello World (remote modified)
line 2: This is the REMOTE version
line 3: Third line unchanged
line 4: Function calculate(a, b, c) {  // Remote added param
line 5:   return a + b + c;
line 6: }
line 7: End of file`,
};

export default function FileUpload() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<Record<FileSlot, FileInfo | null>>({
    base: null,
    local: null,
    remote: null,
  });
  const [dragOver, setDragOver] = useState<FileSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const fileInputRefs = {
    base: useRef<HTMLInputElement>(null),
    local: useRef<HTMLInputElement>(null),
    remote: useRef<HTMLInputElement>(null),
  };

  const { setBaseContent, setLocalContent, setRemoteContent, performMerge } = useMergeStore();

  const validateFile = (file: File): string | null => {
    if (file.size > 10 * 1024 * 1024) {
      return '文件大小不能超过 10MB';
    }
    if (file.type && file.type.startsWith('image/')) {
      return '不支持图片文件';
    }
    return null;
  };

  const handleFileSelect = useCallback(
    async (slot: FileSlot, file: File) => {
      setError(null);

      const validationError = validateFile(file);
      if (validationError) {
        setError(`${file.name}: ${validationError}`);
        return;
      }

      try {
        const content = await readFileAsText(file);

        setFiles((prev) => ({
          ...prev,
          [slot]: {
            name: file.name,
            size: file.size,
            content,
          },
        }));
      } catch {
        setError(`读取 ${file.name} 失败，请确保是 UTF-8 编码的文本文件`);
      }
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, slot: FileSlot) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(slot);
    },
    []
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, slot: FileSlot) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(null);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        await handleFileSelect(slot, files[0]);
      }
    },
    [handleFileSelect]
  );

  const handleInputChange = useCallback(
    async (slot: FileSlot, e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        await handleFileSelect(slot, files[0]);
      }
    },
    [handleFileSelect]
  );

  const handleRemoveFile = useCallback((slot: FileSlot) => {
    setFiles((prev) => ({ ...prev, [slot]: null }));
    if (fileInputRefs[slot].current) {
      fileInputRefs[slot].current!.value = '';
    }
  }, []);

  const loadSampleFiles = useCallback(() => {
    setFiles({
      base: {
        name: 'base_sample.txt',
        size: new Blob([SAMPLE_FILES.base]).size,
        content: SAMPLE_FILES.base,
      },
      local: {
        name: 'local_sample.txt',
        size: new Blob([SAMPLE_FILES.local]).size,
        content: SAMPLE_FILES.local,
      },
      remote: {
        name: 'remote_sample.txt',
        size: new Blob([SAMPLE_FILES.remote]).size,
        content: SAMPLE_FILES.remote,
      },
    });
    setError(null);
  }, []);

  const handleMerge = async () => {
    if (!files.base || !files.local || !files.remote) {
      setError('请上传全部三个文件');
      return;
    }

    setIsMerging(true);
    setError(null);

    try {
      setBaseContent(files.base.content, files.base.name);
      setLocalContent(files.local.content, files.local.name);
      setRemoteContent(files.remote.content, files.remote.name);

      await performMerge();
      navigate('/merge');
    } catch (err) {
      setError(err instanceof Error ? err.message : '合并失败，请重试');
    } finally {
      setIsMerging(false);
    }
  };

  const allFilesReady = files.base && files.local && files.remote;

  const slotConfig: Record<
    FileSlot,
    { title: string; description: string; color: string; icon: React.ReactNode }
  > = {
    base: {
      title: 'Base 版本',
      description: '共同祖先版本',
      color: 'border-slate-500',
      icon: <FileCode size={32} className="text-slate-400" />,
    },
    local: {
      title: 'Local 版本',
      description: '当前分支修改',
      color: 'border-blue-500',
      icon: <FileCode size={32} className="text-blue-400" />,
    },
    remote: {
      title: 'Remote 版本',
      description: '目标分支修改',
      color: 'border-green-500',
      icon: <FileCode size={32} className="text-green-400" />,
    },
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-800/60 backdrop-blur-sm border-b border-slate-700/50 px-8 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-primary-500 flex items-center justify-center">
              <FileCode size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">3-Way Merge Tool</h1>
              <p className="text-xs text-slate-400">可视化 Git 风格代码合并工具</p>
            </div>
          </div>
          <button
            onClick={loadSampleFiles}
            className="btn btn-secondary flex items-center gap-2 text-sm"
          >
            <Sparkles size={16} />
            <span>加载示例文件</span>
          </button>
        </div>
      </header>

      <main className="flex-1 px-8 py-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 animate-fade-in">
            <h2 className="text-3xl font-bold text-white mb-3">上传三个文件以开始合并</h2>
            <p className="text-slate-400 max-w-xl mx-auto">
              上传 Base（共同祖先）、Local（当前分支）和 Remote（目标分支）三个文件，系统将自动执行
              3-way 合并并可视化展示冲突
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-900/30 border border-red-700/50 rounded-xl flex items-center gap-3 animate-fade-in">
              <AlertCircle size={20} className="text-red-400 flex-shrink-0" />
              <span className="text-red-300">{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-auto text-red-400 hover:text-red-300"
              >
                <X size={18} />
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {(Object.keys(slotConfig) as FileSlot[]).map((slot) => {
              const config = slotConfig[slot];
              const file = files[slot];
              const isDragOver = dragOver === slot;

              return (
                <div key={slot} className="animate-fade-in" style={{ animationDelay: `${['base', 'local', 'remote'].indexOf(slot) * 100}ms` }}>
                  <div
                    className={`drop-zone h-64 flex flex-col items-center justify-center cursor-pointer relative ${
                      isDragOver ? 'drag-over' : ''
                    } ${file ? 'border-solid border-2 ' + config.color : ''}`}
                    onDragOver={(e) => handleDragOver(e, slot)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, slot)}
                    onClick={() => fileInputRefs[slot].current?.click()}
                  >
                    <input
                      ref={fileInputRefs[slot]}
                      type="file"
                      accept=".txt,.json,.js,.ts,.jsx,.tsx,.py,.java,.cpp,.c,.h,.md,.html,.css,.scss,.yaml,.yml,.xml,.csv"
                      className="hidden"
                      onChange={(e) => handleInputChange(slot, e)}
                    />

                    {file ? (
                      <div className="flex flex-col items-center gap-3 w-full">
                        <div
                          className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
                            slot === 'base'
                              ? 'bg-slate-700/50'
                              : slot === 'local'
                                ? 'bg-blue-900/30'
                                : 'bg-green-900/30'
                          }`}
                        >
                          {config.icon}
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-white truncate max-w-[200px]">
                            {file.name}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-green-400 text-sm">
                          <CheckCircle size={16} />
                          <span>已上传</span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFile(slot);
                          }}
                          className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-700/80 text-slate-400 hover:text-white hover:bg-slate-600/80 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center">
                          <Upload size={28} className="text-slate-500" />
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-slate-300 mb-1">{config.title}</p>
                          <p className="text-xs text-slate-500">{config.description}</p>
                        </div>
                        <p className="text-xs text-slate-600 mt-2">
                          拖拽或点击上传文本文件
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-center">
            <button
              onClick={handleMerge}
              disabled={!allFilesReady || isMerging}
              className={`btn btn-primary text-lg px-10 py-3 flex items-center gap-3 ${
                !allFilesReady || isMerging
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:shadow-lg hover:shadow-accent-500/20'
              }`}
            >
              {isMerging ? (
                <>
                  <div className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                  <span>正在合并...</span>
                </>
              ) : (
                <>
                  <FileText size={20} />
                  <span>开始合并</span>
                </>
              )}
            </button>
          </div>

          {!allFilesReady && (
            <p className="text-center text-slate-500 text-sm mt-4">
              请上传全部三个文件以继续
            </p>
          )}
        </div>
      </main>

      <footer className="px-8 py-6 border-t border-slate-800/50">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-slate-500">
          <p>基于 Myers Diff 算法实现的 3-way 合并工具</p>
          <p>支持 UTF-8 文本文件 · 最大单文件 10MB</p>
        </div>
      </footer>
    </div>
  );
}
