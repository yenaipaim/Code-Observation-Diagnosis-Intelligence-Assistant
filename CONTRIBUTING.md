# 贡献指南

## 环境

- Node.js 18 或更高版本
- VS Code 1.90 或更高版本

## 开发流程

```powershell
npm ci
npm test
npm run package
```

提交前请确保：

- TypeScript 编译通过。
- 全部单元测试通过。
- VSIX 打包命令可以正常执行。
- 不提交 `node_modules/`、`dist/`、`artifacts/` 或 `*.vsix`。
- 不提交 API Key、访问令牌或其他本地凭据。

业务逻辑修改应同时补充或更新 `src/test/` 下的回归测试。
