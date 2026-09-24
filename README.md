# CODIA

CODIA（Code Observation, Diagnosis, Intelligence & Assistant）是一个嵌入 VS Code 的 Python 调试教练。它监听运行后的终端报错，但不会直接替用户修改代码，而是按“诊断 -> 引导 -> 验证 -> 通关”的流程逐步提问，并把学习结果写入本地学习日志。

## 功能

- 只接受显式运行或 VSCode 终端运行产生的 Python traceback，不接入编辑器静态 diagnostics。
- 运行报错后在对应代码行显示整行高亮、行首 `?` 图标和可点击的 `? 打开闯关界面` 入口，不在代码行内插入文字。
- 识别差一错误、返回值 vs 打印、类型混淆、未定义名称、语法错误、字典键错误、值转换错误、除零错误、属性错误、导入错误和缩进错误。
- 规则匹配优先，无法覆盖时使用 OpenAI 兼容的 Chat Completions API 兜底，默认使用 DeepSeek `deepseek-chat`。
- 每类误概念有 3 个固定引导方向，具体提示结合当前代码和报错动态生成。
- 对理解和运行代码与标准答案的接近度执行 `correct`、`partial`、`wrong` 三档判断，并在 API 失败时使用关键词兜底。
- 维护学习者模型、confidence、尝试次数、跳过次数和学习时间线。
- 掌握度默认不统计任何项；用户可以手动勾选，运行报错时也会自动勾选对应错误类型。
- 答案不再要求固定尝试次数；点击后先确认，再展示完整可运行代码和解释，查看答案不加分。
- 同一关卡可重复练习，但每次完成后得分减半：`1`、`0.5`、`0.25`。
- 学习日志支持删除单条记录、只清除时间线，以及一键清除日志和掌握度。
- API Base URL、模型 ID 和 API Key 均可自定义；Key 使用 `vscode.SecretStorage` 保存。
- 提供完全离线的演示模式。

## 环境

- Node.js 18 或更高版本
- VS Code 1.90 或更高版本
- Python 解释器
- OpenAI 兼容服务的 API Key（演示模式不需要）

## 开发

```powershell
npm install
npm run compile
npm run test
```

在 VS Code 中按 `F5`，会启动一个加载本扩展的 Extension Development Host。

生成 VSIX：

```powershell
npm run package
```

安装包输出到 `artifacts/programming-coach.vsix`。

## 使用

1. 打开一个 Python 文件并运行，故意触发受支持的报错。
2. 左侧活动栏点击“编程学习助手”，打开“调试教练”。
3. 也可以点击报错行上方的 `? 打开闯关界面`，或编辑器标题栏的 `?` 按钮。
4. 命令面板执行 `调试教练：设置 API`，依次填写 Base URL、Chat 模型和 API Key。
5. 需要断网演示时，在设置中开启 `programmingCoach.demoMode`。

运行 Python 时优先使用编辑器右上角的“运行当前 Python 文件并分析”，或命令面板执行 `调试教练：运行当前 Python 文件并分析`。该命令会捕获运行时 traceback。

普通终端运行 Python 时，扩展也会尝试通过 VSCode shell integration 捕获 traceback。若终端没有启用 shell integration，请使用上面的调试教练运行命令。

编辑器里的波浪线、语言服务器诊断和未运行的静态报错不会触发闯关。扩展只处理运行后终端或调试教练运行命令输出中的 Python traceback。

修好代码后，在 VSCode 终端重新运行同一个 Python 文件；命令退出码为 `0` 且没有 traceback 时，面板会识别为“代码跑通”。

未配置 API Key 时，面板会提示配置入口，但不会阻塞代码编辑。默认配置为：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `programmingCoach.apiBaseUrl` | `https://api.deepseek.com` | OpenAI 兼容 API 基础地址 |
| `programmingCoach.apiModel` | `deepseek-chat` | Chat Completions 模型 ID |

自定义服务必须提供 OpenAI 兼容的 `/chat/completions` 接口，并优先选择 Chat 模型。Base URL 可以填写到服务根路径或 `/v1`，扩展会自动补全 `/chat/completions`；如果填入完整端点也不会重复拼接。

同一文件、误概念、报错原文和错误代码窗口会生成稳定关卡指纹。再次运行同一关卡不会拦截，而是正常开题并按历史完成次数降低本次得分。

运行结果分析只更新面板状态，不会自动抢走编辑器焦点；只有点击 `?`、CodeLens 或显式命令时才打开面板。

静态诊断消失不等于程序已修好。显式运行或终端运行必须退出码为 `0`，并且终端命令对应当前关卡文件，才会判定代码跑通。

学习日志的删除操作都需要二次确认。`清除历史时间线` 只删除日志，掌握度和关卡重复次数保持不变；`一键清除` 同时清除日志、掌握度和关卡历史；单条删除只影响该条日志。时间线条目可以展开查看错误行、报错原文和代码片段。

## 数据文件

数据写入 VSCode 为此扩展分配的全局存储目录：

- `learner-model.json`
- `learning-log.json`

关卡重复次数保存在 `learner-model.json` 中，防止清除时间线后重置得分倍率。

掌握度勾选状态也保存在 `learner-model.json` 中。默认列表为空，用户勾选或运行触发对应错误后，该项才会出现并开始统计。

API Key 不进入 JSON 或 `settings.json`，只保存在操作系统密钥链。Base URL 和模型 ID 保存在 VS Code 设置中。

## 第一版边界

- 只支持 Python。
- 支持当前规则分类器覆盖的 Python 初学者常见错误类型。
- 只展示学习日志的第一层时间线，并附带一个基础掌握度概览。
- 不做云端同步。
- 不自动修改用户代码。

完整产品规格与实施计划分别位于：

- `docs/plans/2026-09-23-programming-coach-mvp.md`
- `docs/DEVELOPMENT_LOG.md`

## 项目结构

```text
.github/
  workflows/
    ci.yml                       GitHub Actions 测试流程
docs/
  DEVELOPMENT_LOG.md             大阶段开发日志
  plans/
    2026-09-23-programming-coach-mvp.md
src/
  extension.ts                 VSCode 入口、命令、终端运行捕获和密钥存储
  diagnosticListener.ts        诊断数据解析工具，不接入触发流程
  misconceptionClassifier.ts   误概念规则匹配与 LLM 兜底接口
  chatClient.ts                OpenAI 兼容 Chat Completions 调用
  hintGenerator.ts             动态提示、答案生成、理解判断
  runtimeDiagnostics.ts        Python 终端 traceback 解析
  learnerModel.ts              学习者模型、confidence 和持久化
  stateMachine.ts              闯关状态机
  coachController.ts           业务编排
  learningLog.ts               时间线与掌握度
  demoData.ts                  离线演示数据
  panelProvider.ts             WebviewView Provider
  test/                        编译后执行的 Node 单元测试
media/
  codia-icon.png               扩展品牌图标
  panel.html
  panel.css
  panel.js
  question.svg
  coach.svg                    左侧活动栏图标
```

历史 VSIX 和本地打包产物统一放在被 Git 忽略的 `artifacts/` 目录，不进入源码仓库。
