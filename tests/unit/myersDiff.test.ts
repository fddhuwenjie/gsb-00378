/**
 * Myers diff 表驱动测试。
 * 每个用例除了精确断言操作序列外，还必须满足通用不变量：
 *   - equal+delete 的内容按序还原旧文本
 *   - equal+insert 的内容按序还原新文本
 *   - 行号单调连续
 */
import { describe, it, expect } from 'vitest';
import { diffLines, splitLines, joinLines, computeLineDiff, MyersDiff } from '../../api/algorithms/myersDiff';
import type { DiffOperation } from '../../shared/types';

type OpTuple = [type: 'equal' | 'insert' | 'delete', content: string, oldLineNum: number | null, newLineNum: number | null];

function toTuples(ops: DiffOperation[]): OpTuple[] {
  return ops.map((o) => [o.type, o.content, o.oldLineNum, o.newLineNum]);
}

/** 通用不变量：diff 结果必须能双向还原两个文本 */
function assertRoundTrip(a: string, b: string, ops: DiffOperation[]) {
  const oldSide = ops.filter((o) => o.type !== 'insert').map((o) => o.content);
  const newSide = ops.filter((o) => o.type !== 'delete').map((o) => o.content);
  expect(oldSide).toEqual(splitLines(a));
  expect(newSide).toEqual(splitLines(b));

  // 行号连续性：old 侧行号覆盖 0..N-1，new 侧覆盖 0..M-1
  const oldNums = ops.filter((o) => o.oldLineNum !== null).map((o) => o.oldLineNum);
  const newNums = ops.filter((o) => o.newLineNum !== null).map((o) => o.newLineNum);
  expect(oldNums).toEqual([...Array(splitLines(a).length).keys()]);
  expect(newNums).toEqual([...Array(splitLines(b).length).keys()]);
}

const cases: Array<{ name: string; a: string; b: string; expected: OpTuple[] }> = [
  {
    name: '空文件 vs 空文件',
    a: '',
    b: '',
    expected: [],
  },
  {
    name: '只增：空文件 → 两行（含结尾换行产生的空行）',
    a: '',
    b: 'a\nb\n',
    expected: [
      ['insert', 'a', null, 0],
      ['insert', 'b', null, 1],
      ['insert', '', null, 2],
    ],
  },
  {
    name: '只删：两行 → 空文件',
    a: 'a\nb\n',
    b: '',
    expected: [
      ['delete', 'a', 0, null],
      ['delete', 'b', 1, null],
      ['delete', '', 2, null],
    ],
  },
  {
    name: '完全相同（含结尾换行）',
    a: 'a\nb\n',
    b: 'a\nb\n',
    expected: [
      ['equal', 'a', 0, 0],
      ['equal', 'b', 1, 1],
      ['equal', '', 2, 2],
    ],
  },
  {
    name: '完全相同：无结尾换行',
    a: 'a\nb',
    b: 'a\nb',
    expected: [
      ['equal', 'a', 0, 0],
      ['equal', 'b', 1, 1],
    ],
  },
  {
    name: '无结尾换行追加一行',
    a: 'a\nb',
    b: 'a\nb\nc',
    expected: [
      ['equal', 'a', 0, 0],
      ['equal', 'b', 1, 1],
      ['insert', 'c', null, 2],
    ],
  },
  {
    name: '补上结尾换行 = 插入一个空行',
    a: 'a\nb',
    b: 'a\nb\n',
    expected: [
      ['equal', 'a', 0, 0],
      ['equal', 'b', 1, 1],
      ['insert', '', null, 2],
    ],
  },
  {
    name: 'CRLF：原始 diff 不做行尾规范化（\\r 是行内容一部分）',
    a: 'a\r\nb\r\n',
    b: 'a\r\nb\r\n',
    expected: [
      ['equal', 'a\r', 0, 0],
      ['equal', 'b\r', 1, 1],
      ['equal', '', 2, 2],
    ],
  },
  {
    name: 'CRLF vs LF：行内容不同，整行替换',
    a: 'a\r\nb',
    b: 'a\nb',
    expected: [
      ['delete', 'a\r', 0, null],
      ['insert', 'a', null, 0],
      ['equal', 'b', 1, 1],
    ],
  },
  {
    name: '重复行：在重复行组中插入，锚定在行组最末（git slide-down 语义）',
    a: 'x\nx\n',
    b: 'x\nx\nx\n',
    expected: [
      ['equal', 'x', 0, 0],
      ['equal', 'x', 1, 1],
      ['insert', 'x', null, 2],
      ['equal', '', 2, 3],
    ],
  },
  {
    name: '重复行：从重复行组中删除，锚定在行组最末',
    a: 'x\nx\nx\n',
    b: 'x\nx\n',
    expected: [
      ['equal', 'x', 0, 0],
      ['equal', 'x', 1, 1],
      ['delete', 'x', 2, null],
      ['equal', '', 3, 2],
    ],
  },
  {
    name: 'Unicode：中文与 emoji 行的插入',
    a: '中文\n🚀\n',
    b: '中文\n🎉\n🚀\n',
    expected: [
      ['equal', '中文', 0, 0],
      ['insert', '🎉', null, 1],
      ['equal', '🚀', 1, 2],
      ['equal', '', 2, 3],
    ],
  },
  {
    name: '只增：中间插入一行',
    a: 'a\nc\n',
    b: 'a\nb\nc\n',
    expected: [
      ['equal', 'a', 0, 0],
      ['insert', 'b', null, 1],
      ['equal', 'c', 1, 2],
      ['equal', '', 2, 3],
    ],
  },
  {
    name: '只删：中间删除一行',
    a: 'a\nb\nc\n',
    b: 'a\nc\n',
    expected: [
      ['equal', 'a', 0, 0],
      ['delete', 'b', 1, null],
      ['equal', 'c', 2, 1],
      ['equal', '', 3, 2],
    ],
  },
  {
    name: '同改：单行替换',
    a: 'a\nb\nc\n',
    b: 'a\nB\nc\n',
    expected: [
      ['equal', 'a', 0, 0],
      ['delete', 'b', 1, null],
      ['insert', 'B', null, 1],
      ['equal', 'c', 2, 2],
      ['equal', '', 3, 3],
    ],
  },
  {
    name: '不相交修改：首尾各改一行',
    a: '1\n2\n3\n4\n5\n',
    b: 'A\n2\n3\n4\nE\n',
    expected: [
      ['delete', '1', 0, null],
      ['insert', 'A', null, 0],
      ['equal', '2', 1, 1],
      ['equal', '3', 2, 2],
      ['equal', '4', 3, 3],
      ['delete', '5', 4, null],
      ['insert', 'E', null, 4],
      ['equal', '', 5, 5],
    ],
  },
  {
    name: '整体替换：两行全换',
    a: 'a\nb\n',
    b: 'x\ny\n',
    expected: [
      ['delete', 'a', 0, null],
      ['delete', 'b', 1, null],
      ['insert', 'x', null, 0],
      ['insert', 'y', null, 1],
      ['equal', '', 2, 2],
    ],
  },
];

describe('MyersDiff diffLines 表驱动用例', () => {
  for (const { name, a, b, expected } of cases) {
    it(name, () => {
      const ops = diffLines(a, b);
      expect(toTuples(ops)).toEqual(expected);
      assertRoundTrip(a, b, ops);
    });
  }
});

describe('MyersDiff 通用不变量（批量衍生用例）', () => {
  const derived: Array<[string, string]> = [];
  for (const { a, b } of cases) {
    derived.push([b, a]); // 逆向 diff 也必须成立
  }
  for (const [a, b] of derived) {
    it(`双向还原: ${JSON.stringify(a)} ↔ ${JSON.stringify(b)}`, () => {
      assertRoundTrip(a, b, diffLines(a, b));
    });
  }
});

describe('splitLines / joinLines 行尾语义', () => {
  const splitCases: Array<{ name: string; text: string; lines: string[] }> = [
    { name: '空串 → 零行', text: '', lines: [] },
    { name: '单个换行 → 一个空行加一个结尾空行', text: '\n', lines: ['', ''] },
    { name: '无结尾换行', text: 'a\nb', lines: ['a', 'b'] },
    { name: '有结尾换行', text: 'a\nb\n', lines: ['a', 'b', ''] },
    { name: '连续空行', text: 'a\n\n\nb\n', lines: ['a', '', '', 'b', ''] },
  ];
  for (const { name, text, lines } of splitCases) {
    it(name, () => {
      expect(splitLines(text)).toEqual(lines);
      expect(joinLines(lines)).toBe(text); // split/join 必须互逆
    });
  }
});

describe('computeLineDiff（展示层配对 delete+insert → modify）', () => {
  it('单行替换配成 modify', () => {
    const diffs = computeLineDiff(splitLines('a\nb\nc\n'), splitLines('a\nB\nc\n'));
    expect(diffs.map((d) => [d.type, d.content, d.oldLineNum, d.newLineNum])).toEqual([
      ['equal', 'a', 0, 0],
      ['modify', 'B', 1, 1],
      ['equal', 'c', 2, 2],
      ['equal', '', 3, 3],
    ]);
  });

  it('纯插入不成对', () => {
    const diffs = computeLineDiff(splitLines('a\n'), splitLines('a\nb\n'));
    expect(diffs.map((d) => [d.type, d.content])).toEqual([
      ['equal', 'a'],
      ['insert', 'b'],
      ['equal', ''],
    ]);
  });

  it('纯删除不成对', () => {
    const diffs = computeLineDiff(splitLines('a\nb\n'), splitLines('a\n'));
    expect(diffs.map((d) => [d.type, d.content])).toEqual([
      ['equal', 'a'],
      ['delete', 'b'],
      ['equal', ''],
    ]);
  });
});

describe('MyersDiff 编辑距离最小性', () => {
  it('操作数（insert+delete）不超过 N+M，且等于已知最小编辑距离', () => {
    // 已知最小编辑距离用例：'kitten' 按行级别类比
    const a = ['a', 'b', 'c', 'd', 'e'];
    const b = ['a', 'x', 'c', 'y', 'e'];
    const ops = new MyersDiff(a, b).computeDiff();
    const edits = ops.filter((o) => o.type !== 'equal');
    // b→x 替换 + d→y 替换 = 2 删 2 插 = 4
    expect(edits.length).toBe(4);
  });
});
