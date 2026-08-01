import { useState } from 'react';
import {
  FileCode,
  AlertTriangle,
  CheckCircle,
  Download,
  Copy,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Check,
  Home,
  Sparkles,
} from 'lucide-react';
import { useMergeStore } from '../store/useMergeStore';
import { downloadFile, copyToClipboard } from '../services/mergeApi';
import { useNavigate } from 'react-router-dom';

interface ToolbarProps {
  onNavigateConflict: (direction: 'prev' | 'next') => void;
  currentConflictIndex: number | null;
}

export default function Toolbar({
  onNavigateConflict,
  currentConflictIndex,
}: ToolbarProps) {
  const navigate = useNavigate();
  const [copySuccess, setCopySuccess] = useState(false);
  const {
    conflicts,
    mergedContent,
    isLoading,
    localFileName,
    remoteFileName,
    reset,
    performMerge,
  } = useMergeStore();

  const unresolvedConflicts = conflicts.filter((c) => !c.resolved);
  const totalConflicts = conflicts.length;
  const resolvedCount = totalConflicts - unresolvedConflicts.length;

  const handleDownload = () => {
    const timestamp = new Date().toISOString().slice(0, 10);
    const baseName = localFileName || remoteFileName || 'merged';
    const fileName = `${baseName.replace(/\.[^/.]+$/, '')}_merged_${timestamp}.txt`;
    downloadFile(mergedContent, fileName);
  };

  const handleCopy = async () => {
    const success = await copyToClipboard(mergedContent);
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleReset = () => {
    if (confirm('确定要重置所有更改吗？这将清除当前合并状态。')) {
      reset();
      navigate('/');
    }
  };

  const handleReMerge = async () => {
    if (confirm('重新执行合并将覆盖当前的合并结果，确定继续吗？')) {
      await performMerge();
    }
  };

  const progress = totalConflicts > 0 ? (resolvedCount / totalConflicts) * 100 : 100;
  const allResolved = unresolvedConflicts.length === 0 && totalConflicts > 0;

  return (
    <div className="bg-slate-800/80 backdrop-blur-md border-b border-slate-700/50 px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 rounded-lg transition-all"
          >
            <Home size={16} />
            <span>首页</span>
          </button>

          <div className="h-6 w-px bg-slate-700" />

          <div className="flex items-center gap-3">
            <FileCode size={20} className="text-accent-500" />
            <div>
              <h1 className="text-lg font-semibold text-white">3-Way Merge 工作台</h1>
              <p className="text-xs text-slate-400">
                {localFileName && remoteFileName
                  ? `${localFileName} ←→ ${remoteFileName}`
                  : '正在合并文件'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {totalConflicts > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {allResolved ? (
                  <CheckCircle size={18} className="text-green-500" />
                ) : (
                  <AlertTriangle size={18} className="text-yellow-500" />
                )}
                <span className="text-sm text-slate-300">
                  <span className="font-semibold text-white">{resolvedCount}</span>
                  <span className="text-slate-500"> / </span>
                  <span>{totalConflicts}</span>
                  <span className="text-slate-400 ml-1">冲突已解决</span>
                </span>
              </div>

              <div className="w-32 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    allResolved ? 'bg-green-500' : 'bg-accent-500'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => onNavigateConflict('prev')}
                  disabled={currentConflictIndex === null || currentConflictIndex <= 0}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  title="上一个冲突"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-xs text-slate-500 w-12 text-center">
                  {currentConflictIndex !== null
                    ? `${currentConflictIndex + 1}/${unresolvedConflicts.length}`
                    : '-/-'}
                </span>
                <button
                  onClick={() => onNavigateConflict('next')}
                  disabled={
                    currentConflictIndex === null ||
                    currentConflictIndex >= unresolvedConflicts.length - 1
                  }
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  title="下一个冲突"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}

          <div className="h-6 w-px bg-slate-700" />

          <div className="flex items-center gap-2">
            <button
              onClick={handleReMerge}
              disabled={isLoading}
              className="btn btn-secondary flex items-center gap-2 text-sm"
              title="重新执行合并"
            >
              <Sparkles size={16} />
              <span>重新合并</span>
            </button>

            <button
              onClick={handleReset}
              disabled={isLoading}
              className="btn btn-secondary flex items-center gap-2 text-sm"
              title="重置"
            >
              <RotateCcw size={16} />
              <span>重置</span>
            </button>

            <button
              onClick={handleCopy}
              disabled={isLoading || !mergedContent}
              className="btn btn-secondary flex items-center gap-2 text-sm"
              title="复制到剪贴板"
            >
              {copySuccess ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
              <span>{copySuccess ? '已复制' : '复制'}</span>
            </button>

            <button
              onClick={handleDownload}
              disabled={isLoading || !mergedContent}
              className="btn btn-primary flex items-center gap-2 text-sm"
              title="下载合并结果"
            >
              <Download size={16} />
              <span>下载结果</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
