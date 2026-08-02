import { createHash } from 'node:crypto';

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function detectLineEnding(text: string): 'LF' | 'CRLF' | 'CR' {
  if (text.includes('\r\n')) {
    return 'CRLF';
  }
  if (text.includes('\r')) {
    return 'CR';
  }
  return 'LF';
}

export function toLF(text: string): string {
  return normalizeLineEndings(text);
}

export function isBinaryContent(text: string): boolean {
  for (let i = 0; i < Math.min(text.length, 1024); i++) {
    const code = text.charCodeAt(i);
    if (code === 0) return true;
    if (code < 0x08 || (code > 0x0D && code < 0x20) && code !== 0x1B) return true;
  }
  return false;
}

export function generateId(): string {
  return 'conflict-' + Math.random().toString(36).substring(2, 11);
}

/**
 * SHA-256 hex digest of a string. Used to fingerprint file contents and to
 * derive stable conflict ids so a saved session can be replayed byte-for-byte.
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Derive a DETERMINISTIC conflict id from the conflict's own payload (the local,
 * remote and base line groups) plus an occurrence index that disambiguates two
 * conflicts that happen to carry identical content. The id deliberately depends
 * only on content — never on absolute line numbers — so it survives edits that
 * shift positions but is invalidated the moment the conflicting text changes.
 */
export function deriveConflictId(
  localContent: string[],
  remoteContent: string[],
  baseContent: string[],
  occurrence: number
): string {
  // NUL separators cannot appear in text lines, so the join is unambiguous.
  const payload = [
    localContent.join('\n'),
    remoteContent.join('\n'),
    baseContent.join('\n'),
    String(occurrence),
  ].join('\u0000');
  return 'conflict-' + sha256(payload).slice(0, 16);
}


export function trimTrailingWhitespace(line: string): string {
  return line.replace(/\s+$/, '');
}

export function linesEqualIgnoreTrailingWhitespace(a: string, b: string): boolean {
  return trimTrailingWhitespace(a) === trimTrailingWhitespace(b);
}

export function getFileSize(text: string): number {
  return new Blob([text]).size;
}
