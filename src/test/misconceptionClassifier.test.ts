import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyByRules,
  classifyMisconception
} from "../misconceptionClassifier";

test("classifies IndexError with len and range as off_by_one", () => {
  const result = classifyByRules({
    message: "IndexError: list index out of range",
    errorLine: 4,
    code: [
      "nums = [1, 2, 3]",
      "for i in range(len(nums) + 1):",
      "    print(nums[i])"
    ].join("\n")
  });

  assert.equal(result?.concept, "off_by_one");
});

test("classifies TypeError between str and int as type_mismatch", () => {
  const result = classifyByRules({
    message: "TypeError: can only concatenate str (not \"int\") to str",
    errorLine: 2,
    code: ["age = 18", "print(\"age: \" + age)"].join("\n")
  });

  assert.equal(result?.concept, "type_mismatch");
});

test("classifies a print-only function that returns None", () => {
  const result = classifyByRules({
    message: "AttributeError: 'NoneType' object has no attribute 'append'",
    errorLine: 7,
    code: [
      "def make_list():",
      "    values = []",
      "    print(values)",
      "",
      "result = make_list()",
      "print(result)",
      "result.append(1)"
    ].join("\n")
  });

  assert.equal(result?.concept, "return_vs_print");
});

test("classifies an unrelated None attribute error as attribute_error", () => {
  const result = classifyByRules({
    message: "AttributeError: 'NoneType' object has no attribute 'append'",
    errorLine: 8,
    code: [
      "def log_values():",
      "    print('debug')",
      "",
      "def get_values():",
      "    return None",
      "",
      "values = get_values()",
      "values.append(1)"
    ].join("\n")
  });

  assert.equal(result?.concept, "attribute_error");
});

test("uses the LLM fallback only when rule matching has no result", async () => {
  let calls = 0;
  const result = await classifyMisconception(
    {
      message: "RuntimeError: unknown state",
      errorLine: 1,
      code: "print('x')"
    },
    async () => {
      calls += 1;
      return {
        concept: "type_mismatch",
        confidence: 0.72,
        source: "llm"
      };
    }
  );

  assert.equal(calls, 1);
  assert.equal(result?.concept, "type_mismatch");
});

test("classifies common Python runtime error families", () => {
  const cases = [
    ["NameError: name 'score' is not defined", "name_error"],
    ["SyntaxError: expected ':'", "syntax_error"],
    ["KeyError: 'age'", "key_error"],
    ["ValueError: invalid literal for int() with base 10: 'abc'", "value_error"],
    ["ZeroDivisionError: division by zero", "zero_division"],
    ["AttributeError: 'str' object has no attribute 'push'", "attribute_error"],
    ["ModuleNotFoundError: No module named 'requests'", "import_error"],
    ["IndentationError: expected an indented block", "indentation_error"]
  ] as const;

  for (const [message, concept] of cases) {
    assert.equal(
      classifyByRules({
        message,
        errorLine: 1,
        code: "print('example')"
      })?.concept,
      concept
    );
  }
});

test("classifies common Java runtime error families", () => {
  const cases = [
    [
      "java.lang.NullPointerException: Cannot invoke method",
      "null_reference"
    ],
    [
      "java.lang.ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 3",
      "index_out_of_bounds"
    ],
    [
      "java.lang.ClassCastException: class A cannot be cast to class B",
      "class_cast_error"
    ],
    [
      "java.lang.ArithmeticException: / by zero",
      "zero_division"
    ],
    [
      "java.lang.NumberFormatException: For input string: \"abc\"",
      "value_error"
    ],
    ["cannot find symbol", "name_error"],
    ["incompatible types: String cannot be converted to int", "type_mismatch"],
    ["java.lang.ClassNotFoundException: Missing", "import_error"],
    ["';' expected", "syntax_error"]
  ] as const;

  for (const [message, concept] of cases) {
    assert.equal(
      classifyByRules({
        language: "java",
        message,
        errorLine: 1,
        code: "class Main {}"
      })?.concept,
      concept
    );
  }
});

test("classifies common JavaScript runtime error families", () => {
  const cases = [
    ["ReferenceError: score is not defined", "name_error"],
    ["TypeError: Cannot read properties of null (reading 'name')", "null_reference"],
    ["RangeError: Invalid array length", "index_out_of_bounds"],
    ["TypeError: value.toFixed is not a function", "attribute_error"],
    ["SyntaxError: Unexpected token ')'", "syntax_error"],
    ["Error [ERR_MODULE_NOT_FOUND]: Cannot find module './missing.js'", "import_error"],
    ["UnhandledPromiseRejection: Error: failed", "async_error"]
  ] as const;

  for (const [message, concept] of cases) {
    assert.equal(
      classifyByRules({
        language: "javascript",
        message,
        errorLine: 1,
        code: "const value = null;"
      })?.concept,
      concept
    );
  }
});

test("rejects fallback concepts that are invalid for the language", async () => {
  const result = await classifyMisconception(
    {
      language: "java",
      message: "Unknown failure",
      errorLine: 1,
      code: "class Main {}"
    },
    async () => ({
      concept: "async_error",
      confidence: 0.8,
      source: "llm"
    })
  );

  assert.equal(result, undefined);
});
