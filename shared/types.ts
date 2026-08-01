export type DiffOperationType = 'equal' | 'insert' | 'delete';

export interface DiffOperation {
  type: DiffOperationType;
  content: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

export interface LineDiff {
  type: 'equal' | 'insert' | 'delete' | 'modify';
  content: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

export interface Conflict {
  id: string;
  startLine: number;
  endLine: number;
  localContent: string[];
  remoteContent: string[];
  baseContent: string[];
  resolved: boolean;
  resolution: 'local' | 'remote' | 'manual' | null;
}

export interface MergeRequest {
  base: string;
  local: string;
  remote: string;
}

export interface MergeResponse {
  success: boolean;
  mergedContent: string;
  hasConflicts: boolean;
  conflictCount: number;
  conflicts: Conflict[];
  diffs: {
    baseToLocal: LineDiff[];
    baseToRemote: LineDiff[];
  };
  error?: string;
}

export interface FileContent {
  base: string;
  local: string;
  remote: string;
}

export interface EditorInstance {
  base: any;
  local: any;
  merged: any;
  remote: any;
}

export interface Decoration {
  id: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  options: any;
}
