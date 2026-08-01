import { Check, X, Edit3 } from 'lucide-react';
import type { Conflict } from '@shared/types';

interface ConflictBlockProps {
  conflict: Conflict;
  onResolve: (resolution: 'local' | 'remote' | 'manual') => void;
  onFocus: () => void;
  isActive: boolean;
}

export default function ConflictBlock({
  conflict,
  onResolve,
  onFocus,
  isActive,
}: ConflictBlockProps) {
  if (conflict.resolved) return null;

  return (
    <div
      className={`absolute right-4 z-20 flex flex-col gap-2 p-3 rounded-xl shadow-2xl backdrop-blur-md transition-all duration-300 ${
        isActive
          ? 'bg-slate-800/95 border-2 border-yellow-500/50 scale-100'
          : 'bg-slate-800/80 border border-slate-600/50 scale-95 opacity-80 hover:opacity-100 hover:scale-100'
      }`}
      style={{
        top: '10px',
        maxWidth: '320px',
      }}
      onMouseEnter={onFocus}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
          <span className="text-sm font-semibold text-yellow-400">冲突区域</span>
        </div>
        <span className="text-xs text-slate-500">
          行 {conflict.startLine + 1} - {conflict.endLine + 1}
        </span>
      </div>

      <div className="text-xs text-slate-400 mb-1">
        Base 修改区域（{conflict.baseContent.length} 行）
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-blue-400">Local 版本</span>
          <div className="text-xs text-slate-300 bg-blue-900/30 px-2 py-1 rounded border border-blue-800/50 font-mono max-h-20 overflow-y-auto">
            {conflict.localContent.length > 0 ? (
              conflict.localContent.slice(0, 3).map((line, i) => (
                <div key={i} className="truncate">
                  {line || <span className="text-slate-600">{'<空行>'}</span>}
                </div>
              ))
            ) : (
              <span className="text-slate-500 italic">（空）</span>
            )}
            {conflict.localContent.length > 3 && (
              <div className="text-slate-500">... +{conflict.localContent.length - 3} 行</div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-green-400">Remote 版本</span>
          <div className="text-xs text-slate-300 bg-green-900/30 px-2 py-1 rounded border border-green-800/50 font-mono max-h-20 overflow-y-auto">
            {conflict.remoteContent.length > 0 ? (
              conflict.remoteContent.slice(0, 3).map((line, i) => (
                <div key={i} className="truncate">
                  {line || <span className="text-slate-600">{'<空行>'}</span>}
                </div>
              ))
            ) : (
              <span className="text-slate-500 italic">（空）</span>
            )}
            {conflict.remoteContent.length > 3 && (
              <div className="text-slate-500">... +{conflict.remoteContent.length - 3} 行</div>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onResolve('local')}
          className="conflict-btn conflict-btn-local flex-1 flex items-center justify-center gap-1"
          title="使用 Local 版本"
        >
          <Check size={14} />
          <span>使用 Local</span>
        </button>
        <button
          onClick={() => onResolve('remote')}
          className="conflict-btn conflict-btn-remote flex-1 flex items-center justify-center gap-1"
          title="使用 Remote 版本"
        >
          <Check size={14} />
          <span>使用 Remote</span>
        </button>
        <button
          onClick={() => onResolve('manual')}
          className="conflict-btn bg-slate-600 hover:bg-slate-500 text-white flex items-center justify-center"
          title="手动编辑"
        >
          <Edit3 size={14} />
        </button>
      </div>
    </div>
  );
}
