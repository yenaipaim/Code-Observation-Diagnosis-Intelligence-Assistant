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
    source.indexOf("const runPythonFile")
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

test("a successful explicit Python run marks the code as fixed", async () => {
  const source = await extensionSource();
  const runPythonFile = source.slice(
    source.indexOf("const runPythonFile"),
    source.indexOf("context.subscriptions.push")
  );

  assert.match(runPythonFile, /code === 0/);
  assert.match(runPythonFile, /markCodeFixed/);
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
