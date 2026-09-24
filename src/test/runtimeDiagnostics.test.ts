import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPythonScriptPath,
  isPythonCommandLine,
  parsePythonRuntimeError,
  stripAnsi
} from "../runtimeDiagnostics";

test("strips ANSI escape sequences from terminal output", () => {
  assert.equal(stripAnsi("\u001b[31mTypeError\u001b[0m"), "TypeError");
});

test("parses a Python traceback file line and exception", () => {
  const parsed = parsePythonRuntimeError([
    "Traceback (most recent call last):",
    "  File \"C:\\work\\main.py\", line 1, in <module>",
    "    L = list(1,2,3,6,4)",
    "TypeError: list expected at most 1 argument, got 5"
  ].join("\n"));

  assert.equal(parsed?.file, "C:\\work\\main.py");
  assert.equal(parsed?.errorLine, 1);
  assert.equal(
    parsed?.message,
    "TypeError: list expected at most 1 argument, got 5"
  );
});

test("ignores ordinary terminal output", () => {
  assert.equal(parsePythonRuntimeError("program finished"), undefined);
});

test("extracts the Python script path from terminal commands", () => {
  assert.equal(
    extractPythonScriptPath('python "C:\\work dir\\main.py"'),
    "C:\\work dir\\main.py"
  );
  assert.equal(
    extractPythonScriptPath("python3 ./demo.py --verbose"),
    "./demo.py"
  );
  assert.equal(
    extractPythonScriptPath("py -3 .\\main.py"),
    ".\\main.py"
  );
  assert.equal(
    extractPythonScriptPath("python -m unittest"),
    undefined
  );
});

test("recognizes only Python interpreter commands", () => {
  assert.equal(isPythonCommandLine("python main.py"), true);
  assert.equal(isPythonCommandLine("python3.11 ./demo.py"), true);
  assert.equal(isPythonCommandLine('& "C:\\Program Files\\Python\\python.exe" main.py'), true);
  assert.equal(isPythonCommandLine("py -3 .\\main.py"), true);
  assert.equal(
    isPythonCommandLine("cd C:\\work && python .\\main.py"),
    true
  );
  assert.equal(isPythonCommandLine("cat main.py"), false);
  assert.equal(isPythonCommandLine("cat main.py && echo done"), false);
  assert.equal(isPythonCommandLine("somepython main.py"), false);
});
