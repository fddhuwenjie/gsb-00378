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

export function trimTrailingWhitespace(line: string): string {
  return line.replace(/\s+$/, '');
}

export function linesEqualIgnoreTrailingWhitespace(a: string, b: string): boolean {
  return trimTrailingWhitespace(a) === trimTrailingWhitespace(b);
}

export function getFileSize(text: string): number {
  return new Blob([text]).size;
}
