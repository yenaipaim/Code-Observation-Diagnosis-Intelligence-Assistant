import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  javaCommandTargetsFile,
  extractScriptPath,
  createRuntimeCommand,
  isRuntimeCommandLine,
  parseJavaRuntimeError,
  parseJavaScriptRuntimeError,
  resolveRuntimeErrorPath
} from "../languageRuntime";

test("recognizes Java and JavaScript runtime commands", () => {
  assert.equal(isRuntimeCommandLine("java Main.java", "java"), true);
  assert.equal(
    isRuntimeCommandLine("cd src && java .\\Main.java", "java"),
    true
  );
  assert.equal(isRuntimeCommandLine("javac Main.java", "java"), false);
  assert.equal(isRuntimeCommandLine("node app.js", "javascript"), true);
  assert.equal(
    isRuntimeCommandLine("cd src && node .\\app.mjs", "javascript"),
    true
  );
  assert.equal(isRuntimeCommandLine("npm run start", "javascript"), false);
});

test("extracts Java and JavaScript script paths", () => {
  assert.equal(
    extractScriptPath('java "C:\\work dir\\Main.java"', "java"),
    "C:\\work dir\\Main.java"
  );
  assert.equal(
    extractScriptPath("node ./demo.mjs --verbose", "javascript"),
    "./demo.mjs"
  );
  assert.equal(
    extractScriptPath("node --enable-source-maps app.cjs", "javascript"),
    "app.cjs"
  );
});

test("matches Java class commands to the current source file", () => {
  const sourceFile = path.resolve(
    path.sep,
    "tmp",
    "coach",
    "src",
    "Main.java"
  );

  assert.equal(
    javaCommandTargetsFile("java -cp out Main", sourceFile),
    true
  );
  assert.equal(
    javaCommandTargetsFile("java -cp out com.example.Main --verbose", sourceFile),
    true
  );
  assert.equal(
    javaCommandTargetsFile("java -cp out Other", sourceFile),
    false
  );
});

test("parses Java compile errors", () => {
  const parsed = parseJavaRuntimeError([
    "C:\\work\\Main.java:3: error: ';' expected",
    "    System.out.println(\"hello\")",
    "                              ^",
    "1 error"
  ].join("\n"));

  assert.deepEqual(parsed, {
    language: "java",
    file: "C:\\work\\Main.java",
    errorLine: 3,
    message: "';' expected"
  });
});

test("parses localized Java compile errors", () => {
  const parsed = parseJavaRuntimeError([
    "C:\\work\\Main.java:3: 错误: 需要';'",
    "    System.out.println(\"hello\")",
    "                              ^",
    "1 个错误"
  ].join("\n"));

  assert.deepEqual(parsed, {
    language: "java",
    file: "C:\\work\\Main.java",
    errorLine: 3,
    message: "需要';'"
  });
});

test("parses Java runtime exceptions", () => {
  const parsed = parseJavaRuntimeError([
    "Exception in thread \"main\" java.lang.NullPointerException: Cannot invoke method",
    "\tat Main.main(Main.java:5)"
  ].join("\n"));

  assert.equal(parsed?.file, "Main.java");
  assert.equal(parsed?.errorLine, 5);
  assert.match(parsed?.message ?? "", /NullPointerException/);
});

test("parses Node syntax errors", () => {
  const parsed = parseJavaScriptRuntimeError([
    "C:\\work\\app.js:3",
    "console.log(",
    "            ^",
    "SyntaxError: missing ) after argument list"
  ].join("\n"));

  assert.deepEqual(parsed, {
    language: "javascript",
    file: "C:\\work\\app.js",
    errorLine: 3,
    message: "SyntaxError: missing ) after argument list"
  });
});

test("parses Node runtime stacks", () => {
  const parsed = parseJavaScriptRuntimeError([
    "C:\\work\\app.js:4",
    "  missing();",
    "  ^",
    "ReferenceError: missing is not defined",
    "    at Object.<anonymous> (C:\\work\\app.js:4:3)",
    "    at Module._compile (node:internal/modules/cjs/loader:1358:14)"
  ].join("\n"));

  assert.equal(parsed?.file, "C:\\work\\app.js");
  assert.equal(parsed?.errorLine, 4);
  assert.match(parsed?.message ?? "", /ReferenceError/);
});

test("parses Node errors with error codes", () => {
  const parsed = parseJavaScriptRuntimeError([
    "C:\\work\\app.js:1",
    "import missing from \"missing\";",
    "^",
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'missing'",
    "    at Object.<anonymous> (C:\\work\\app.js:1:1)"
  ].join("\n"));

  assert.equal(parsed?.file, "C:\\work\\app.js");
  assert.equal(parsed?.errorLine, 1);
  assert.match(parsed?.message ?? "", /ERR_MODULE_NOT_FOUND/);
});

test("normalizes Node ESM file URLs in syntax errors", () => {
  const filePath = path.resolve(path.sep, "tmp", "coach", "app.mjs");
  const parsed = parseJavaScriptRuntimeError([
    `${pathToFileURL(filePath).href}:3`,
    "console.log(",
    "            ^",
    "SyntaxError: missing ) after argument list"
  ].join("\n"));

  assert.equal(parsed?.file, filePath);
  assert.equal(parsed?.errorLine, 3);
});

test("normalizes Node ESM file URLs in runtime stacks", () => {
  const filePath = path.resolve(path.sep, "tmp", "coach", "app.mjs");
  const fileUrl = pathToFileURL(filePath).href;
  const parsed = parseJavaScriptRuntimeError([
    `${fileUrl}:4`,
    "  missing();",
    "  ^",
    "ReferenceError: missing is not defined",
    `    at ${fileUrl}:4:3`,
    "    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)"
  ].join("\n"));

  assert.equal(parsed?.file, filePath);
  assert.equal(parsed?.errorLine, 4);
});

test("parses unhandled Node promise rejections", () => {
  const parsed = parseJavaScriptRuntimeError([
    "node:internal/process/promises:394",
    "    triggerUncaughtException(err, true /* fromPromise */);",
    "    ^",
    "Error: failed",
    "    at C:\\work\\app.js:7:9"
  ].join("\n"));

  assert.equal(parsed?.file, "C:\\work\\app.js");
  assert.equal(parsed?.errorLine, 7);
  assert.match(parsed?.message ?? "", /Error: failed/);
});

test("builds single-file runtime commands", () => {
  assert.deepEqual(
    createRuntimeCommand("java", "C:\\work\\Main.java", "java"),
    {
      executable: "java",
      args: ["C:\\work\\Main.java"]
    }
  );
  assert.deepEqual(
    createRuntimeCommand("javascript", "C:\\work\\app.mjs", "node"),
    {
      executable: "node",
      args: ["C:\\work\\app.mjs"]
    }
  );
});

test("resolves Java stack files against the running source directory", () => {
  const workspace = path.resolve(path.sep, "tmp", "coach");
  const runningFile = path.join(workspace, "src", "Main.java");

  assert.equal(
    resolveRuntimeErrorPath(
      "Main.java",
      workspace,
      "java",
      runningFile
    ),
    runningFile
  );
});

test("resolves non-Java relative files against the terminal cwd", () => {
  const workspace = path.resolve(path.sep, "tmp", "coach");
  const runningFile = path.join(workspace, "src", "app.js");

  assert.equal(
    resolveRuntimeErrorPath(
      "app.js",
      workspace,
      "javascript",
      runningFile
    ),
    path.join(workspace, "app.js")
  );
});
