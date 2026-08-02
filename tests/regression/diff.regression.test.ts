/**
 * [diff] 问题回归：重复行锚定、行尾（CRLF/无结尾换行）、空文件。
 * 期望值由 diff 规则手工推导（前缀/后缀修剪 + slide-down 锚定 + 行号重排），
 * 不复制实现输出；每例附加双向还原与行号连续性不变量。
 */
import { describe, it, expect } from 'vitest';
import { diffLines, splitLines } from '../../api/algorithms/myersDiff';
import type { DiffOperation } from '../../shared/types';

type OpTuple = [type: 'equal' | 'insert' | 'delete', content: string, oldLineNum: number | null, newLineNum: number | null];

function toTuples(ops: DiffOperation[]): OpTuple[] {
  return ops.map((o) => [o.type, o.content, o.oldLineNum, o.newLineNum]);
}

/** 通用不变量：equal+delete 还原旧文本，equal+insert 还原新文本，行号各自连续 */
function assertRoundTrip(a: string, b: string, ops: DiffOperation[]) {
  expect(ops.filter((o) => o.type !== 'insert').map((o) => o.content)).toEqual(splitLines(a));
  expect(ops.filter((o) => o.type !== 'delete').map((o) => o.content)).toEqual(splitLines(b));
  expect(ops.filter((o) => o.oldLineNum !== null).map((o) => o.oldLineNum)).toEqual(
    [...Array(splitLines(a).length).keys()]
  );
  expect(ops.filter((o) => o.newLineNum !== null).map((o) => o.newLineNum)).toEqual(
    [...Array(splitLines(b).length).keys()]
  );
}

describe('[diff] 重复行锚定回归', () => {
  const cases: Array<{ name: string; a: string; b: string; expected: OpTuple[] }> = [
    {
      name: '重复行组中插入唯一行：锚定位置精确，不滑动',
      a: 'x\nx\nx\n',
      b: 'x\ny\nx\nx\n',
      expected: [
        ['equal', 'x', 0, 0],
        ['insert', 'y', null, 1],
        ['equal', 'x', 1, 2],
        ['equal', 'x', 2, 3],
        ['equal', '', 3, 4],
      ],
    },
    {
      name: '重复空行：再插入一个空行，锚定在重复组最末',
      a: 'a\n\na\n',
      b: 'a\n\n\na\n',
      expected: [
        ['equal', 'a', 0, 0],
        ['equal', '', 1, 1],
        ['insert', '', null, 2],
        ['equal', 'a', 2, 3],
        ['equal', '', 3, 4],
      ],
    },
    {
      name: '重复行组末尾追加一行：插入锚定在组末（slide-down 语义）',
      a: 'a\nx\nx\nb\n',
      b: 'a\nx\nx\nx\nb\n',
      expected: [
        ['equal', 'a', 0, 0],
        ['equal', 'x', 1, 1],
        ['equal', 'x', 2, 2],
        ['insert', 'x', null, 3],
        ['equal', 'b', 3, 4],
        ['equal', '', 4, 5],
      ],
    },
    {
      name: '文件末尾重复行追加：插入锚定在结尾空行之前',
      a: 'x\ny\nx\nx\n',
      b: 'x\ny\nx\nx\nx\n',
      expected: [
        ['equal', 'x', 0, 0],
        ['equal', 'y', 1, 1],
        ['equal', 'x', 2, 2],
        ['equal', 'x', 3, 3],
        ['insert', 'x', null, 4],
        ['equal', '', 4, 5],
      ],
    },
  ];
  for (const { name, a, b, expected } of cases) {
    it(name, () => {
      const ops = diffLines(a, b);
      expect(toTuples(ops)).toEqual(expected);
      assertRoundTrip(a, b, ops);
    });
  }
});

describe('[diff] 行尾与空文件回归', () => {
  const cases: Array<{ name: string; a: string; b: string; expected: OpTuple[] }> = [
    {
      name: 'CRLF：原始 diff 不做行尾规范化，整行替换保留 \\r',
      a: 'a\r\nb\r\nc\r\n',
      b: 'a\r\nB\r\nc\r\n',
      expected: [
        ['equal', 'a\r', 0, 0],
        ['delete', 'b\r', 1, null],
        ['insert', 'B\r', null, 1],
        ['equal', 'c\r', 2, 2],
        ['equal', '', 3, 3],
      ],
    },
    {
      name: '无结尾换行：删除最后一行',
      a: 'a\nb\nc',
      b: 'a\nb',
      expected: [
        ['equal', 'a', 0, 0],
        ['equal', 'b', 1, 1],
        ['delete', 'c', 2, null],
      ],
    },
    {
      name: '单行文本补上结尾换行 = 插入一个空行',
      a: 'x',
      b: 'x\n',
      expected: [
        ['equal', 'x', 0, 0],
        ['insert', '', null, 1],
      ],
    },
    {
      name: '空文件 vs 空文件：零操作',
      a: '',
      b: '',
      expected: [],
    },
    {
      name: '空文件 → 单行（无结尾换行）',
      a: '',
      b: 'only',
      expected: [['insert', 'only', null, 0]],
    },
  ];
  for (const { name, a, b, expected } of cases) {
    it(name, () => {
      const ops = diffLines(a, b);
      expect(toTuples(ops)).toEqual(expected);
      assertRoundTrip(a, b, ops);
    });
  }
});

describe('[diff] 重复执行确定性', () => {
  it('同一输入连续计算 5 次，操作序列逐字节一致', () => {
    const a = 'x\nx\ny\n\nz\r\n';
    const b = 'x\ny\ny\nz\n';
    const first = toTuples(diffLines(a, b));
    for (let i = 0; i < 5; i++) {
      expect(toTuples(diffLines(a, b))).toEqual(first);
    }
  });
});
