import assert from "node:assert/strict";
import test from "node:test";
import {
  DiagnosticListener,
  buildDiagnosticSnapshot,
  extractPythonDiagnostics
} from "../diagnosticListener";

test("extractPythonDiagnostics keeps only Python errors and warnings", () => {
  const result = extractPythonDiagnostics("python", [
    { severity: 1, message: "unused import", range: { start: { line: 4 } } },
    { severity: 0, message: "IndexError", range: { start: { line: 3 } } },
    { severity: 3, message: "hint", range: { start: { line: 5 } } }
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].errorLine, 4);
  assert.equal(result[0].message, "IndexError");
});

test("buildDiagnosticSnapshot includes nearby code and one-based line", () => {
  const snapshot = buildDiagnosticSnapshot(
    "main.py",
    { severity: 0, message: "IndexError", range: { start: { line: 1 } } },
    "nums = [1]\nprint(nums[1])"
  );

  assert.equal(snapshot.file, "main.py");
  assert.equal(snapshot.errorLine, 2);
  assert.match(snapshot.code, /nums/);
});

test("listener ignores non-Python diagnostics", async () => {
  let handled = 0;
  const listener = new DiagnosticListener(async () => {
    handled += 1;
  });

  await listener.process({
    filePath: "main.js",
    languageId: "javascript",
    diagnostics: [
      { severity: 0, message: "TypeError", range: { start: { line: 0 } } }
    ],
    readFile: async () => "throw new Error()"
  });

  assert.equal(handled, 0);
});

test("listener forwards the first Python diagnostic", async () => {
  const handled: string[] = [];
  const listener = new DiagnosticListener(async (snapshot) => {
    handled.push(snapshot.message);
  });

  await listener.process({
    filePath: "main.py",
    languageId: "python",
    diagnostics: [
      { severity: 0, message: "IndexError", range: { start: { line: 2 } } }
    ],
    readFile: async () => "print([])"
  });

  assert.deepEqual(handled, ["IndexError"]);
});
