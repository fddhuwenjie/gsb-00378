/**
 * 行尾规范化与内容检测工具表驱动测试。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeLineEndings,
  detectLineEnding,
  toLF,
  isBinaryContent,
  trimTrailingWhitespace,
  linesEqualIgnoreTrailingWhitespace,
  getFileSize,
} from '../../api/utils/lineUtils';

describe('normalizeLineEndings / toLF', () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    { name: '空串', input: '', expected: '' },
    { name: '纯 LF 不变', input: 'a\nb\n', expected: 'a\nb\n' },
    { name: 'CRLF → LF', input: 'a\r\nb\r\n', expected: 'a\nb\n' },
    { name: '孤立 CR → LF', input: 'a\rb\rc', expected: 'a\nb\nc' },
    { name: '混合 CRLF / CR / LF', input: 'a\r\nb\rc\nd\r\n', expected: 'a\nb\nc\nd\n' },
    { name: 'CRLF 不可分割（\\r\\n 不变成两个换行）', input: 'a\r\nb', expected: 'a\nb' },
    { name: 'Unicode 内容不受影响', input: '中文\r\n🚀\r\n', expected: '中文\n🚀\n' },
    { name: '仅换行符', input: '\r\n', expected: '\n' },
  ];
  for (const { name, input, expected } of cases) {
    it(name, () => {
      expect(normalizeLineEndings(input)).toBe(expected);
      expect(toLF(input)).toBe(expected);
    });
  }
});

describe('detectLineEnding', () => {
  const cases: Array<{ input: string; expected: 'LF' | 'CRLF' | 'CR' }> = [
    { input: '', expected: 'LF' },
    { input: 'a\nb', expected: 'LF' },
    { input: 'a\r\nb', expected: 'CRLF' },
    { input: 'a\rb', expected: 'CR' },
    { input: 'a\r\nb\rc', expected: 'CRLF' }, // CRLF 优先
  ];
  for (const { input, expected } of cases) {
    it(JSON.stringify(input) + ' → ' + expected, () => {
      expect(detectLineEnding(input)).toBe(expected);
    });
  }
});

describe('isBinaryContent', () => {
  const cases: Array<{ name: string; input: string; expected: boolean }> = [
    { name: '空串不是二进制', input: '', expected: false },
    { name: '普通文本', input: 'hello world\n', expected: false },
    { name: 'Unicode 文本', input: '中文 🚀 línea\n', expected: false },
    { name: 'NUL 是二进制', input: 'a\u0000b', expected: true },
    { name: '0x01 控制字符是二进制', input: 'a\u0001b', expected: true },
    { name: '制表符不是二进制', input: 'a\tb', expected: false },
    { name: '换行不是二进制', input: 'a\nb\r\nc', expected: false },
    { name: 'ESC(0x1B) 放行（终端配色文本）', input: 'a\u001Bb', expected: false },
    { name: '0x1F 是二进制', input: 'a\u001Fb', expected: true },
    { name: '二进制字节在 1024 字节采样窗口之后 → 不判为二进制', input: 'a'.repeat(1024) + '\u0000', expected: false },
    { name: '二进制字节在采样窗口内（第 1023 字节）', input: 'a'.repeat(1023) + '\u0000', expected: true },
  ];
  for (const { name, input, expected } of cases) {
    it(name, () => {
      expect(isBinaryContent(input)).toBe(expected);
    });
  }
});

describe('trimTrailingWhitespace / linesEqualIgnoreTrailingWhitespace', () => {
  it('trimTrailingWhitespace 表驱动', () => {
    const cases: Array<[string, string]> = [
      ['', ''],
      ['abc', 'abc'],
      ['abc  ', 'abc'],
      ['abc\t\n', 'abc'],
      ['  abc', '  abc'], // 前导空白保留
    ];
    for (const [input, expected] of cases) {
      expect(trimTrailingWhitespace(input)).toBe(expected);
    }
  });

  it('linesEqualIgnoreTrailingWhitespace 表驱动', () => {
    expect(linesEqualIgnoreTrailingWhitespace('abc ', 'abc')).toBe(true);
    expect(linesEqualIgnoreTrailingWhitespace('abc', 'abc\t')).toBe(true);
    expect(linesEqualIgnoreTrailingWhitespace('abc', 'abd')).toBe(false);
    expect(linesEqualIgnoreTrailingWhitespace(' abc', 'abc ')).toBe(false);
  });
});

describe('getFileSize（UTF-8 字节数）', () => {
  const cases: Array<[string, number]> = [
    ['', 0],
    ['abc', 3],
    ['中文', 6],
    ['🚀', 4],
    ['a\nb', 3],
  ];
  for (const [input, expected] of cases) {
    it(JSON.stringify(input) + ' → ' + expected, () => {
      expect(getFileSize(input)).toBe(expected);
    });
  }
});
