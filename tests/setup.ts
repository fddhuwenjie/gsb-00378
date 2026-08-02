// 前端测试需要 React act 环境标志；node 测试不受影响。
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
