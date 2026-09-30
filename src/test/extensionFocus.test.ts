import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function extensionSource(): Promise<string> {
  return readFile(
    path.resolve(__dirname, "..", "..", "src", "extension.ts"),
    "utf8"
  );
}

test("runtime analysis does not steal editor focus", async () => {
  const source = await extensionSource();
  const runtimeAnalyzer = source.slice(
    source.indexOf("const analyzeRuntimeOutput"),
    source.indexOf("const runCurrentFile")
  );

  assert.doesNotMatch(
    runtimeAnalyzer,
    /programmingCoach\.panel\.focus/
  );
});

test("the explicit open-panel command still focuses the panel", async () => {
  const source = await extensionSource();
  const openPanelCommand = source.slice(
    source.indexOf('vscode.commands.registerCommand("programmingCoach.openPanel"')
  );

  assert.match(
    openPanelCommand,
    /programmingCoach\.panel\.focus/
  );
});

test("editor diagnostics do not enter the coaching flow", async () => {
  const source = await extensionSource();

  assert.doesNotMatch(source, /onDidChangeDiagnostics/);
  assert.doesNotMatch(source, /extractPythonDiagnostics/);
  assert.doesNotMatch(source, /diagnosticListener/);
});

test("terminal execution supplies runtime errors", async () => {
  const source = await extensionSource();

  assert.match(source, /onDidStartTerminalShellExecution/);
  assert.match(source, /analyzeRuntimeOutput/);
});

test("a successful terminal Python run marks the code as fixed", async () => {
  const source = await extensionSource();
  const terminalEndHandler = source.slice(
    source.indexOf("vscode.window.onDidEndTerminalShellExecution")
  );

  assert.match(terminalEndHandler, /event\.exitCode !== 0/);
  assert.match(terminalEndHandler, /markCodeFixed/);
});

test("a successful explicit language run marks the code as fixed", async () => {
  const source = await extensionSource();
  const runCurrentFile = source.slice(
    source.indexOf("const runCurrentFile"),
    source.indexOf("context.subscriptions.push")
  );

  assert.match(runCurrentFile, /code === 0/);
  assert.match(runCurrentFile, /markCodeFixed/);
  assert.match(runCurrentFile, /createRuntimeCommand/);
  assert.match(runCurrentFile, /JAVA_TOOL_OPTIONS/);
});

test("viewing the answer requires confirmation", async () => {
  const source = await extensionSource();
  const revealAction = source.slice(
    source.indexOf("revealAnswer: async"),
    source.indexOf("skip: async")
  );

  assert.match(revealAction, /你确定查看答案吗？/);
  assert.match(revealAction, /controller\.revealAnswer/);
});

test("applying an answer replaces only the requested line range", async () => {
  const source = await extensionSource();
  const applyFix = source.slice(
    source.indexOf("const applyFix"),
    source.indexOf("panelProvider = new PanelProvider")
  );

  assert.match(applyFix, /startLine/);
  assert.match(applyFix, /endLine/);
  assert.match(applyFix, /new vscode\.Range/);
  assert.doesNotMatch(applyFix, /selection/);
});

test("terminal and CodeLens wiring support every runtime profile", async () => {
  const source = await extensionSource();

  assert.match(source, /runtimeProfileForLanguageId/);
  assert.match(source, /isRuntimeCommandLine/);
  assert.match(source, /javaCommandTargetsFile/);
  assert.match(source, /language: "java"/);
  assert.match(source, /language: "javascript"/);
});

test("API failures fall back to the demo services automatically", async () => {
  const source = await extensionSource();

  assert.match(source, /AutomaticRuntimeMode/);
  assert.match(source, /handleApiFailure\("错误分类"/);
  assert.match(source, /handleApiFailure\("提示生成"/);
  assert.match(source, /handleApiFailure\("答案生成"/);
  assert.match(source, /handleApiFailure\("理解判断"/);
  assert.match(source, /throwOnApiError: true/);
  assert.match(source, /demoHintGenerator\.generateAnswer/);
  assert.doesNotMatch(source, /请先配置 API/);
});
