# CODIA

**CODIA**（Code Observation, Diagnosis, Intelligence & Assistant）是一个面向 Python、Java 和 JavaScript 初学者的 VS Code 调试学习助手。

它不会直接替用户修改代码，而是捕获实际运行产生的 Python traceback、Java 编译或运行时异常、JavaScript 语法或运行时异常，按照“诊断、引导、验证、通关”的流程帮助用户理解问题，并将学习过程记录到本地。

## 核心功能

- 仅接收显式运行或终端运行产生的运行时错误，不接入编辑器静态 diagnostics。
- 在报错行提供整行高亮、行首标记和可点击的关卡入口。
- 支持 Python、Java 和 JavaScript 的常见编译、语法及运行时错误。
- 支持差一错误、返回值与打印混淆、类型不匹配、未定义名称、语法错误、字典键错误、值转换错误、除零错误、属性错误、导入错误、缩进错误、空引用、越界、类转换和异步错误等类别。
- 优先使用本地规则分类，规则无法覆盖时调用 OpenAI 兼容的 Chat Completions API。
- 每类误概念提供固定引导方向和结合当前代码生成的动态提示。
- 对用户理解和代码修复程度执行 `correct`、`partial`、`wrong` 三档判断。
- 维护学习者模型、confidence、尝试次数、跳过次数和学习时间线。
- 掌握度默认不统计任何项，支持用户手动选择或由运行错误自动勾选。
- 同一关卡支持重复练习，完成次数越多，本次得分越低。
- 学习日志支持单条删除、清除时间线和一键清除。
- 提供无需外部 API 的离线演示模式。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| VS Code | 1.90 或更高版本 |
| Node.js | 18 或更高版本；运行 JavaScript 和开发扩展时需要 |
| Java | JDK 11 或更高版本，`java` 可在 `PATH` 中使用 |
| Python | 可用的 Python 解释器；运行 Python 文件时需要 |
| API 服务 | OpenAI 兼容的 Chat Completions 接口，演示模式不需要 |

## 安装

扩展已经发布到 VS Code Marketplace ，可在扩展面板搜索 `CODIA` 安装。

本地安装时，在扩展面板右上角选择 `Install from VSIX...`，然后选择：

```text
output/packages/programming-coach-0.5.1.vsix
```

## 项目结构

```text
.
├─ src/                        扩展源码与单元测试
├─ media/                      Webview、图标等运行资源
├─ docs/                       开发日志和历史实施计划
├─ scripts/                    本地开发与打包脚本
├─ output/
│  ├─ packages/               按版本保存的 VSIX
│  ├─ docs/                   本地生成的交付文档
│  └─ templates/              本地文档模板
├─ dist/                       编译产物，可删除后重新生成
├─ node_modules/               本地依赖，可重新安装
├─ package.json
└─ README.md
```

## 意见交流

群号：873223130

<img src="img/QQ.png" alt="CODIA 意见交流群" width="33%" />



## 快速开始

1. 打开一个 Python、Java 或 JavaScript 文件。
2. 在命令面板执行 `调试教练：设置 API`。
3. 依次配置 API Base URL、Chat 模型和 API Key。
4. 使用编辑器右上角的“运行当前文件并分析”，或命令面板中的 `调试教练：运行当前文件并分析`。
5. 运行失败后，根据报错行入口或左侧面板中的提示完成关卡。
6. 修复代码后重新运行。退出码为 `0` 且没有运行时错误时，扩展会判定代码已修复。

需要完全离线运行时，可在 VS Code 设置中启用：

```text
programmingCoach.demoMode
```

## API 配置

默认配置使用 DeepSeek：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `programmingCoach.apiBaseUrl` | `https://api.deepseek.com` | OpenAI 兼容 API 基础地址 |
| `programmingCoach.apiModel` | `deepseek-chat` | Chat Completions 模型 ID |
| `programmingCoach.javaRuntimePath` | `java` | Java 可执行文件路径；默认从 `PATH` 查找 |
| `programmingCoach.javascriptRuntimePath` | `node` | Node.js 可执行文件路径；默认从 `PATH` 查找 |
| API Key | 无 | 通过 `vscode.SecretStorage` 保存 |

执行 `调试教练：设置 API` 后，可以配置：

- 任意 OpenAI 兼容服务的 Base URL。
- 支持 Chat Completions 协议的语言模型。
- 对应服务的 API Key。

Base URL 可以填写服务根路径、版本路径或完整端点。扩展会自动补全 `/chat/completions`，不会重复拼接已有端点。

示例：

```text
https://api.deepseek.com
https://api.openai.com/v1
https://your-provider.example/v1/chat/completions
```

自定义服务应优先选择 Chat 模型，并确保接口兼容 OpenAI Chat Completions 请求与响应格式。

API Key 不会写入学习数据或 VS Code 设置文件，只保存在操作系统密钥链中。

## 运行检测机制

扩展只处理程序实际运行后产生的异常：

- 显式执行“运行当前文件并分析”命令。
- 在启用 shell integration 的 VS Code 终端中运行 Python、Java 或 JavaScript 单文件程序。

编辑器中的波浪线、语言服务器提示和静态 diagnostics 不会触发关卡。

终端命令退出码为 `0` 且没有对应语言的运行时错误时，扩展才会判定代码运行成功。

运行命令如下：

| 语言 | 运行命令 |
| --- | --- |
| Python | 当前文件的 Python 解释器命令 |
| Java | `java <file>.java`（扩展显式运行时固定使用英文诊断 locale） |
| JavaScript | `node <file>.js`、`node <file>.mjs` 或 `node <file>.cjs` |

Java 和 Node.js 可执行文件需位于 `PATH`，也可以通过 `programmingCoach.javaRuntimePath` 和 `programmingCoach.javascriptRuntimePath` 指定。

## 学习与评分

关卡会根据文件、误概念、报错原文和错误代码窗口生成稳定标识。

评分规则如下：

- 理解和修复正确时获得完整奖励。
- 部分正确时获得部分奖励。
- 判断错误时会降低 confidence。
- 重复完成同一关卡时，奖励依次减半：`1`、`0.5`、`0.25`。
- 查看答案前需要确认，查看答案只增加最小档理解度（`confidence +0.05`），不会触发通关。

同一关卡可以重复练习，但历史完成次数会被保留，用于防止重复刷分。

## 学习数据与隐私

学习数据保存在 VS Code 为扩展分配的全局存储中：

- `learner-model.json`
- `learning-log.json`

学习者模型包含按语言隔离的掌握度、confidence 和关卡重复完成记录。学习日志包含语言、时间线、错误位置、报错原文和错误代码片段。

学习日志删除操作均需要二次确认：

- `清除历史时间线`：清除时间线，保留掌握度和关卡历史。
- `一键清除`：清除日志、掌握度和关卡历史。
- 单条删除：仅删除选中的日志记录。

启用外部 API 后，扩展会向所选服务发送完成分类、提示、答案和判断所需的报错信息及代码内容。扩展不会自行进行云端同步。

## 开发与打包

安装依赖并执行完整校验：

```powershell
npm ci
npm test
```

重新生成版本化 VSIX：

```powershell
npm run package
```

输出文件为 `output/packages/programming-coach-<version>.vsix`。旧版本文件不会被覆盖。

只清理编译产物：

```powershell
npm run clean
```

`dist/` 和 `node_modules/` 都可以重新生成，不进入版本控制。`output/packages/` 用于保留发布包，不参与源码提交。

## 当前边界

- 仅支持 Python、Java 和 JavaScript 单文件运行；HTML、TypeScript、JSX、Maven、Gradle 和 `package.json` scripts 暂不支持。
- Java 暂不支持多文件、模块和复杂 classpath。
- JavaScript 仅支持 Node.js 单文件脚本。
- 仅覆盖规则分类器支持的常见错误类型。
- 学习日志以基础时间线和掌握度概览为主。
- 不提供云端同步。
- 不自动修改用户代码。

## 许可证

本项目使用 MIT License。
