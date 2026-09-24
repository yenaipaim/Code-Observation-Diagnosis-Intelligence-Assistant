import assert from "node:assert/strict";
import test from "node:test";
import {
  demoAnswer,
  demoClassify,
  demoHint,
  demoJudgment
} from "../demoData";
import {
  DiagnosticSnapshot,
  MISCONCEPTION_IDS,
  MisconceptionId
} from "../types";

function sampleContext(concept: MisconceptionId): DiagnosticSnapshot {
  const messages: Record<MisconceptionId, string> = {
    off_by_one: "IndexError: list index out of range",
    return_vs_print: "'NoneType' object has no attribute 'append'",
    type_mismatch: "TypeError: can only concatenate str (not \"int\") to str",
    name_error: "NameError: name 'score' is not defined",
    syntax_error: "SyntaxError: expected ':'",
    key_error: "KeyError: 'age'",
    value_error: "ValueError: invalid literal for int() with base 10: 'abc'",
    zero_division: "ZeroDivisionError: division by zero",
    attribute_error: "AttributeError: 'str' object has no attribute 'push'",
    import_error: "ModuleNotFoundError: No module named 'requests'",
    indentation_error: "IndentationError: expected an indented block"
  };

  return {
    message: messages[concept],
    errorLine: 2,
    code: "example code"
  };
}

test("demo data covers every concept and hint direction", () => {
  for (const concept of MISCONCEPTION_IDS) {
    for (const hintIndex of [1, 2, 3] as const) {
      assert.ok(demoHint(concept, hintIndex, sampleContext(concept)).length > 10);
    }
  }
});

test("demo judgment returns all three result kinds without an API", () => {
  assert.equal(
    demoJudgment("off_by_one", "循环结束值多跑了一次").judgment,
    "correct"
  );
  assert.equal(demoJudgment("type_mismatch", "类型有问题").judgment, "partial");
  assert.equal(
    demoJudgment("return_vs_print", "变量名写错了").judgment,
    "wrong"
  );
});

test("demo answer is available offline for every concept", () => {
  for (const concept of MISCONCEPTION_IDS) {
    const answer = demoAnswer(concept, sampleContext(concept));
    assert.ok(answer.code.length > 10);
    assert.ok(answer.explanation.length > 10);
  }
});

test("demo classification works without an API", () => {
  assert.equal(
    demoClassify({
      message: "IndexError: list index out of range",
      errorLine: 1,
      code: "print(nums[2])"
    })?.concept,
    "off_by_one"
  );
  assert.equal(
    demoClassify({
      message: "AttributeError: 'NoneType' object has no attribute 'append'",
      errorLine: 1,
      code: "result.append(1)"
    })?.concept,
    "return_vs_print"
  );
});

test("demo hint uses the code feature in its cached variant", () => {
  const hint = demoHint("off_by_one", 1, {
    message: "IndexError: list index out of range",
    errorLine: 2,
    code: "while i <= len(nums):\n    print(nums[i])"
  });

  assert.match(hint, /while/);
});
