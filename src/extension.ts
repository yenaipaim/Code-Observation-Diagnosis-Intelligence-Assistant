import { spawn } from "node:child_process";
import path from "node:path";
import * as vscode from "vscode";
import {
  CoachController,
  HintService,
  JudgmentService
} from "./coachController";
import {
  ChatCompletionsClient,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_MODEL
} from "./chatClient";
import {
  demoAnswer,
  demoClassify,
  demoHint,
  demoJudgment
} from "./demoData";
import {
  HintGenerator,
  JsonCompleter,
  judgeUnderstanding
} from "./hintGenerator";
import {
  LearningLogStore,
  sortTimeline,
  summarizeConceptOptions,
  summarizeProgress
} from "./learningLog";
import {
  LearnerModelStore
} from "./learnerModel";
import {
  classifyMisconception
} from "./misconceptionClassifier";
import {
  LearningLogProvider,
  PanelProvider
} from "./panelProvider";
import {
  createRuntimeCommand,
  javaCommandTargetsFile,
  isRuntimeCommandLine,
  ParsedRuntimeError,
  resolveRuntimeErrorPath,
  runtimeProfileForLanguage,
  runtimeProfileForLanguageId
} from "./languageRuntime";
import {
  Classification,
  DiagnosticSnapshot,
  LANGUAGE_CONCEPT_IDS,
  LANGUAGE_LABELS,
  PanelState,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
  isMisconceptionId,
  languageConceptKey,
  parseLanguageConceptKey
} from "./types";

const API_KEY_SECRET = "programmingCoach.deepseekApiKey";

class ConfiguredChatCompleter implements JsonCompleter {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async completeJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const apiKey = await this.secrets.get(API_KEY_SECRET);
    if (!apiKey) {
      throw new Error(
        "API Key 未配置。请执行“调试教练：设置 API”。"
      );
    }
    const configuration =
      vscode.workspace.getConfiguration("programmingCoach");
    const baseUrl =
      configuration.get<string>("apiBaseUrl") ?? DEFAULT_API_BASE_URL;
    const model =
      configuration.get<string>("apiModel") ?? DEFAULT_API_MODEL;

    return new ChatCompletionsClient(
      apiKey,
      fetch,
      baseUrl,
      model
    ).completeJson<T>(
      systemPrompt,
      userPrompt
    );
  }
}

function initialPanelState(demoMode: boolean): PanelState {
  return {
    stage: "empty",
    message: "等待 Python、Java 或 JavaScript 报错。",
    attempts: 0,
    hintIndex: 1,
    canRevealAnswer: false,
    canSkipUnderstanding: false,
    answerLabel: "查看答案",
    confidence: 0,
    apiKeyConfigured: false,
    demoMode
  };
}

function validateApiBaseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Base URL 必须使用 http 或 https。";
    }
  } catch {
    return "请输入有效的 API Base URL。";
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("编程学习助手");
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
  const modelStore = new LearnerModelStore(
    path.join(context.globalStorageUri.fsPath, "learner-model.json")
  );
  const logStore = new LearningLogStore(
    path.join(context.globalStorageUri.fsPath, "learning-log.json")
  );
  const completer = new ConfiguredChatCompleter(context.secrets);
  let apiKeyConfigured = false;
  let panelProvider: PanelProvider | undefined;
  let learningLogProvider: LearningLogProvider | undefined;

  const isDemoMode = (): boolean =>
    vscode.workspace
      .getConfiguration("programmingCoach")
      .get<boolean>("demoMode", false);

  const hintService: HintService = {
    generateHint: (snapshot, concept, hintIndex) =>
      new HintGenerator(
        completer,
        demoHint,
        isDemoMode(),
        demoAnswer
      ).generateHint(snapshot, concept, hintIndex),
    generateAnswer: (snapshot, concept) =>
      new HintGenerator(
        completer,
        demoHint,
        isDemoMode(),
        demoAnswer
      ).generateAnswer(snapshot, concept)
  };

  const judgmentService: JudgmentService = async (
    concept,
    attempt,
    snapshot,
    referenceAnswer
  ) => {
    if (isDemoMode()) {
      if (attempt.codeFixed && attempt.code) {
        return {
          judgment: "correct",
          reason: "演示模式：代码运行成功。",
          closeness: 0.9
        };
      }
      return demoJudgment(concept, attempt.text ?? "");
    }
    return judgeUnderstanding(
      concept,
      attempt.text ?? "",
      completer,
      snapshot,
      referenceAnswer,
      attempt.code
    );
  };

  const controller = new CoachController({
    classifier: async (snapshot) =>
      classifyMisconception(snapshot, async (input) =>
        classifyWithChatApi(completer, input, isDemoMode())
      ),
    hintService,
    judgmentService,
    modelStore,
    logStore,
    hasApiKey: async () => Boolean(await context.secrets.get(API_KEY_SECRET)),
    demoMode: isDemoMode,
    publish: (state) => {
      panelProvider?.postState(state, apiKeyConfigured);
      if (
        state.stage === "completed" ||
        state.stage === "diagnose"
      ) {
        void learningLogProvider?.refresh();
      }
    }
  });

  const focusLearningLog = async (entryId?: string): Promise<void> => {
    await vscode.commands.executeCommand("programmingCoach.learningLog.focus");
    if (entryId) {
      await learningLogProvider?.focusEntry(entryId);
    } else {
      await learningLogProvider?.refresh();
    }
  };

  const confirmDestructive = async (
    message: string,
    confirmLabel: string
  ): Promise<boolean> =>
    (await vscode.window.showWarningMessage(
      message,
      { modal: true },
      confirmLabel
    )) === confirmLabel;

  const clearTimeline = async (): Promise<void> => {
    if (
      !(await confirmDestructive(
        "确定清除全部历史时间线吗？掌握度会保留。",
        "清除时间线"
      ))
    ) {
      return;
    }
    await logStore.clear();
  };

  const clearAllLearningData = async (): Promise<void> => {
    if (
      !(await confirmDestructive(
        "确定一键清除学习日志和掌握度吗？此操作不可撤销。",
        "一键清除"
      ))
    ) {
      return;
    }
    await Promise.all([
      logStore.clear(),
      controller.resetLearningData()
    ]);
  };

  const deleteLearningEntry = async (entryId: string): Promise<void> => {
    if (
      !(await confirmDestructive(
        "确定删除这条学习记录吗？",
        "删除"
      ))
    ) {
      return;
    }
    await logStore.remove(entryId);
  };

  const copyAnswer = async (code: string): Promise<void> => {
    if (!code.trim()) {
      return;
    }
    await vscode.env.clipboard.writeText(code);
    await vscode.window.showInformationMessage("答案代码已复制。");
  };

  const applyFix = async (
    code: string,
    startLine?: number,
    endLine?: number
  ): Promise<void> => {
    if (!code.trim()) {
      return;
    }

    const state = await controller.currentState();
    const currentFile = controller.currentFile();
    const levelLanguage = state.level?.language;
    const matchesCurrentFile = (editor: vscode.TextEditor): boolean => {
      if (!currentFile) {
        const profile = runtimeProfileForLanguageId(
          editor.document.languageId
        );
        return Boolean(
          profile &&
            (!levelLanguage || profile.language === levelLanguage)
        );
      }
      const left = path.resolve(editor.document.uri.fsPath);
      const right = path.resolve(currentFile);
      return process.platform === "win32"
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
    };
    const targetEditor =
      vscode.window.visibleTextEditors.find(matchesCurrentFile) ??
      (currentFile
        ? undefined
        : vscode.window.activeTextEditor &&
            matchesCurrentFile(vscode.window.activeTextEditor)
          ? vscode.window.activeTextEditor
          : undefined);
    if (!targetEditor) {
      await vscode.window.showWarningMessage("请先打开发生错误的文件。");
      return;
    }

    const document = targetEditor.document;
    const fallbackLine = Math.min(
      Math.max(1, state.level?.errorLine ?? 1),
      document.lineCount
    );
    const validLine = (
      value: number | undefined,
      fallback: number
    ): number =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= document.lineCount
        ? value
        : fallback;
    const firstLine = validLine(startLine, fallbackLine);
    const lastLine = Math.max(
      firstLine,
      validLine(endLine, firstLine)
    );
    const targetRange = new vscode.Range(
      firstLine - 1,
      0,
      lastLine - 1,
      document.lineAt(lastLine - 1).text.length
    );
    const applied = await targetEditor.edit((edit) => {
      edit.replace(targetRange, code);
    });
    if (!applied) {
      await vscode.window.showWarningMessage("修正当前代码片段失败。");
      return;
    }
    await vscode.window.showInformationMessage("已修正当前错误代码片段。");
  };

  panelProvider = new PanelProvider(
    context.extensionUri,
    {
      start: async () => void (await controller.startChallenge()),
      submit: async (value) => void (await controller.submitUnderstanding(value)),
      hint: async () => void (await controller.requestHint(true)),
      revealAnswer: async () => {
        if (
          !(await confirmDestructive(
            "你确定查看答案吗？",
            "查看答案"
          ))
        ) {
          return;
        }
        await controller.revealAnswer();
      },
      skip: async () => void (await controller.skipUnderstanding()),
      configureApiKey: async () => {
        await vscode.commands.executeCommand(
          "programmingCoach.configureApiKey"
        );
      },
      openLearningLog: focusLearningLog,
      copyAnswer,
      applyFix,
      openLogEntry: focusLearningLog,
      treatDuplicateAsNew: async () => {
        await controller.treatDuplicateAsNew();
      }
    },
    initialPanelState(isDemoMode())
  );

  learningLogProvider = new LearningLogProvider(
    context.extensionUri,
    async () => {
      const [timeline, model] = await Promise.all([
        logStore.load(),
        modelStore.load()
      ]);
      return {
        timeline: sortTimeline(timeline),
        progress: summarizeProgress(model),
        conceptOptions: summarizeConceptOptions(model)
      };
    },
    {
      clearTimeline,
      clearAll: clearAllLearningData,
      deleteEntry: deleteLearningEntry,
      toggleConcept: async (concept, checked) => {
        const parsed = parseLanguageConceptKey(concept);
        if (parsed) {
          await controller.setTrackedConcept(
            languageConceptKey(parsed.language, parsed.concept),
            checked
          );
        }
      }
    }
  );

  const decorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor(
      "inputValidation.errorBackground"
    ),
    overviewRulerColor: new vscode.ThemeColor("errorForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    gutterIconPath: vscode.Uri.joinPath(mediaRoot, "question.svg"),
    gutterIconSize: "contain"
  });

  const activeDiagnostics = new Map<
    string,
    { errorLine: number }
  >();
  const codeLensChanged = new vscode.EventEmitter<void>();

  const clearActiveDiagnostic = (uri: vscode.Uri): void => {
    activeDiagnostics.delete(uri.toString());
    codeLensChanged.fire();
  };

  const clearDecoration = (editor: vscode.TextEditor): void => {
    editor.setDecorations(decorationType, []);
    clearActiveDiagnostic(editor.document.uri);
  };

  const decorate = (
    editor: vscode.TextEditor,
    errorLine: number
  ): void => {
    const line = Math.max(0, errorLine - 1);
    const range = new vscode.Range(line, 0, line, 0);
    editor.setDecorations(decorationType, [{ range }]);
    activeDiagnostics.set(editor.document.uri.toString(), {
      errorLine
    });
    codeLensChanged.fire();
  };

  const analyzeRuntimeOutput = async (
    runtimeOutput: string,
    cwd: string | undefined,
    language: SupportedLanguage,
    runningFile?: string
  ): Promise<boolean> => {
    const parsed: ParsedRuntimeError | undefined =
      runtimeProfileForLanguage(language).parseRuntimeError(
        runtimeOutput
      );
    if (!parsed) {
      return false;
    }

    const filePath = resolveRuntimeErrorPath(
      parsed.file,
      cwd ??
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      language,
      runningFile
    );
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(filePath)
      );
    } catch {
      return false;
    }
    const snapshot: DiagnosticSnapshot = {
      language: parsed.language,
      file: filePath,
      message: parsed.message,
      errorLine: parsed.errorLine,
      code: document.getText(),
      severity: 0,
      source: `${parsed.language}-runtime`
    };
    const state = await controller.openDiagnostic(snapshot);
    const editor = vscode.window.visibleTextEditors.find(
      (candidate) => sameFile(candidate.document.uri.fsPath, filePath)
    );
    if (editor) {
      decorate(editor, state.level?.errorLine ?? parsed.errorLine);
    }
    return true;
  };

  const runCurrentFile = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const profile = editor
      ? runtimeProfileForLanguageId(editor.document.languageId)
      : undefined;
    if (!editor || !profile) {
      await vscode.window.showWarningMessage(
        "请先打开 Python、Java 或 JavaScript 文件。"
      );
      return;
    }

    await editor.document.save();
    const configuredExecutable =
      vscode.workspace
        .getConfiguration(profile.runtimePathSection)
        .get<string>(profile.runtimePathSetting) ?? "";
    const executable =
      configuredExecutable.trim() || profile.defaultExecutable;
    const filePath = editor.document.uri.fsPath;
    const command = createRuntimeCommand(
      profile.language,
      filePath,
      executable
    );
    const cwd =
      vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath ??
      path.dirname(filePath);
    const environment =
      profile.language === "java"
        ? {
            ...process.env,
            JAVA_TOOL_OPTIONS: [
              process.env.JAVA_TOOL_OPTIONS,
              "-Duser.language=en",
              "-Duser.country=US"
            ]
              .filter(Boolean)
              .join(" ")
          }
        : process.env;
    let runtimeOutput = "";
    let completed = false;

    await new Promise<void>((resolve) => {
      const child = spawn(command.executable, command.args, {
        cwd,
        windowsHide: true,
        env: environment
      });
      child.stdout.on("data", (data: Buffer) => {
        runtimeOutput += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        runtimeOutput += data.toString();
      });
      child.on("error", async (error) => {
        completed = true;
        output.appendLine(`[runtime] ${error.message}`);
        output.show(true);
        await vscode.window.showErrorMessage(
          `${profile.displayName} 启动失败：${error.message}`
        );
        resolve();
      });
      child.on("close", async (code) => {
        if (completed) {
          resolve();
          return;
        }
        completed = true;
        if (code === 0) {
          clearDecoration(editor);
          if (
            controller.currentFile() &&
            sameFile(controller.currentFile() ?? "", filePath)
          ) {
            await controller.markCodeFixed(editor.document.getText());
          }
          await vscode.window.showInformationMessage(
            `${profile.displayName} 程序运行完成，没有检测到异常。`
          );
          resolve();
          return;
        }

        const analyzed = await analyzeRuntimeOutput(
          runtimeOutput,
          cwd,
          profile.language,
          filePath
        );
        if (!analyzed) {
          output.appendLine(runtimeOutput);
          output.show(true);
          await vscode.window.showWarningMessage(
            `${profile.displayName} 程序执行失败，但没有解析到可识别的错误。`
          );
        }
        resolve();
      });
    });
  };

  const terminalRuns = new Map<
    vscode.TerminalShellExecution,
    {
      runtimeOutput: string;
      commandLine: string;
      cwd?: string;
      language: SupportedLanguage;
      readDone: Promise<void>;
    }
  >();

  const resolveTerminalFile = (
    scriptPath: string,
    cwd?: string
  ): string =>
    path.resolve(
      cwd ??
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
        process.cwd(),
      scriptPath
    );

  const sameFile = (left: string, right: string): boolean => {
    const normalizedLeft = path.resolve(left);
    const normalizedRight = path.resolve(right);
    return process.platform === "win32"
      ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
      : normalizedLeft === normalizedRight;
  };

  context.subscriptions.push(
    decorationType,
    output,
    vscode.window.registerWebviewViewProvider(
      "programmingCoach.panel",
      panelProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.window.registerWebviewViewProvider(
      "programmingCoach.learningLog",
      learningLogProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.languages.registerCodeLensProvider(
      [
        { language: "python", scheme: "file" },
        { language: "java", scheme: "file" },
        { language: "javascript", scheme: "file" }
      ],
      {
        onDidChangeCodeLenses: codeLensChanged.event,
        provideCodeLenses: (document) => {
          const active = activeDiagnostics.get(document.uri.toString());
          if (!active) {
            return [];
          }

          const line = Math.max(0, active.errorLine - 1);
          return [
            new vscode.CodeLens(
              new vscode.Range(line, 0, line, 0),
              {
                title: "? 打开闯关界面",
                command: "programmingCoach.openPanel"
              }
            )
          ];
        }
      }
    ),
    codeLensChanged,
    vscode.commands.registerCommand(
      "programmingCoach.configureApiKey",
      async () => {
        const configuration =
          vscode.workspace.getConfiguration("programmingCoach");
        const currentBaseUrl =
          configuration.get<string>("apiBaseUrl") ?? DEFAULT_API_BASE_URL;
        const currentModel =
          configuration.get<string>("apiModel") ?? DEFAULT_API_MODEL;

        const baseUrlInput = await vscode.window.showInputBox({
          title: "设置 API Base URL",
          prompt: "OpenAI 兼容接口地址。扩展会自动补 /chat/completions。",
          value: currentBaseUrl,
          placeHolder: DEFAULT_API_BASE_URL,
          ignoreFocusOut: true,
          validateInput: validateApiBaseUrl
        });
        if (baseUrlInput === undefined) {
          return;
        }
        const baseUrl = baseUrlInput.trim().replace(/\/+$/, "");

        const modelInput = await vscode.window.showInputBox({
          title: "设置 Chat 模型",
          prompt: "请填写支持 Chat Completions 的模型 ID。",
          value: currentModel,
          placeHolder: DEFAULT_API_MODEL,
          ignoreFocusOut: true,
          validateInput: (value) =>
            value.trim() ? undefined : "模型 ID 不能为空。"
        });
        if (modelInput === undefined) {
          return;
        }
        const model = modelInput.trim();

        const keyInput = await vscode.window.showInputBox({
          title: "设置 API Key",
          prompt: "Key 保存在操作系统密钥链中；留空会清除已保存的 Key。",
          placeHolder: "sk-...",
          password: true,
          ignoreFocusOut: true
        });
        if (keyInput === undefined) {
          return;
        }
        const key = keyInput.trim();

        await configuration.update(
          "apiBaseUrl",
          baseUrl,
          vscode.ConfigurationTarget.Global
        );
        await configuration.update(
          "apiModel",
          model,
          vscode.ConfigurationTarget.Global
        );

        if (key) {
          await context.secrets.store(API_KEY_SECRET, key);
          apiKeyConfigured = true;
          await vscode.window.showInformationMessage(
            `API 已配置：${model}`
          );
        } else {
          await context.secrets.delete(API_KEY_SECRET);
          apiKeyConfigured = false;
          await vscode.window.showInformationMessage(
            "API Key 已清除。"
          );
        }

        if (controller.currentFile() && apiKeyConfigured) {
          await controller.requestHint();
        } else {
          panelProvider?.postState(
            await controller.currentState(),
            apiKeyConfigured
          );
        }
      }
    ),
    vscode.commands.registerCommand("programmingCoach.openPanel", async () => {
      await vscode.commands.executeCommand("programmingCoach.panel.focus");
    }),
    vscode.commands.registerCommand(
      "programmingCoach.runCurrentFile",
      runCurrentFile
    ),
    vscode.commands.registerCommand(
      "programmingCoach.runPythonFile",
      runCurrentFile
    ),
    vscode.commands.registerCommand(
      "programmingCoach.openLearningLog",
      focusLearningLog
    ),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      const demoModeChanged = event.affectsConfiguration(
        "programmingCoach.demoMode"
      );
      const apiSettingsChanged =
        event.affectsConfiguration("programmingCoach.apiBaseUrl") ||
        event.affectsConfiguration("programmingCoach.apiModel");
      if (!demoModeChanged && !apiSettingsChanged) {
        return;
      }
      if (demoModeChanged && controller.currentFile()) {
        await controller.requestHint(false);
      } else {
        panelProvider?.postState(
          await controller.currentState(),
          apiKeyConfigured
        );
      }
    }),
    vscode.window.onDidStartTerminalShellExecution((event) => {
      const commandLine = event.execution.commandLine.value;
      const profile = SUPPORTED_LANGUAGES.map(
        runtimeProfileForLanguage
      ).find((candidate) =>
        isRuntimeCommandLine(commandLine, candidate.language)
      );
      if (!profile) {
        return;
      }

      let resolveRead: () => void = () => {};
      const readDone = new Promise<void>((resolve) => {
        resolveRead = resolve;
      });
      terminalRuns.set(event.execution, {
        runtimeOutput: "",
        commandLine,
        cwd: event.execution.cwd?.fsPath,
        language: profile.language,
        readDone
      });

      void (async () => {
        try {
          const run = terminalRuns.get(event.execution);
          if (!run) {
            return;
          }
          for await (const chunk of event.execution.read()) {
            run.runtimeOutput += chunk;
          }
        } finally {
          resolveRead();
        }
      })();
    }),
    vscode.window.onDidEndTerminalShellExecution(async (event) => {
      const run = terminalRuns.get(event.execution);
      if (!run) {
        return;
      }
      terminalRuns.delete(event.execution);
      await run.readDone;

      const profile = runtimeProfileForLanguage(run.language);
      const scriptPath = profile.extractScriptPath(run.commandLine);
      let runningFile = scriptPath
        ? resolveTerminalFile(scriptPath, run.cwd)
        : undefined;
      if (
        !runningFile &&
        run.language === "java" &&
        controller.currentFile() &&
        javaCommandTargetsFile(
          run.commandLine,
          controller.currentFile() ?? ""
        )
      ) {
        runningFile = controller.currentFile();
      }
      const analyzed = await analyzeRuntimeOutput(
        run.runtimeOutput,
        run.cwd,
        run.language,
        runningFile
      );
      if (analyzed) {
        return;
      }
      if (event.exitCode !== 0) {
        return;
      }

      if (!runningFile) {
        return;
      }
      const filePath = runningFile;
      if (
        !controller.currentFile() ||
        !sameFile(controller.currentFile() ?? "", filePath)
      ) {
        return;
      }

      const editor = vscode.window.visibleTextEditors.find(
        (candidate) =>
          sameFile(candidate.document.uri.fsPath, filePath)
      );
      if (editor) {
        clearDecoration(editor);
      } else {
        clearActiveDiagnostic(vscode.Uri.file(filePath));
      }
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(filePath)
      );
      await controller.markCodeFixed(document.getText());
    })
  );

  void (async () => {
    apiKeyConfigured = Boolean(await context.secrets.get(API_KEY_SECRET));
    panelProvider?.postState(await controller.currentState(), apiKeyConfigured);
  })();
}

async function classifyWithChatApi(
  completer: JsonCompleter,
  snapshot: DiagnosticSnapshot,
  demoMode: boolean
): Promise<Classification | undefined> {
  if (demoMode) {
    return demoClassify(snapshot);
  }

  const language = snapshot.language ?? "python";
  const conceptIds = LANGUAGE_CONCEPT_IDS[language];
  try {
    const result = await completer.completeJson<{
      concept_id?: string;
      confidence?: number;
    }>(
      [
        `将 ${LANGUAGE_LABELS[language]} 初学者报错归类为以下之一：`,
        conceptIds.join("、"),
        "无法判断时 concept_id 返回 null。",
        "只输出 JSON：{\"concept_id\":\"...\",\"confidence\":0.0}"
      ].join("\n"),
      [
        `报错：${snapshot.message}`,
        `行号：${snapshot.errorLine}`,
        "代码：",
        snapshot.code
      ].join("\n")
    );

    if (
      isMisconceptionId(result.concept_id) &&
      conceptIds.includes(result.concept_id)
    ) {
      return {
        concept: result.concept_id,
        confidence:
          typeof result.confidence === "number"
            ? Math.max(0, Math.min(1, result.confidence))
            : 0.7,
        source: "llm"
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function deactivate(): void {}
