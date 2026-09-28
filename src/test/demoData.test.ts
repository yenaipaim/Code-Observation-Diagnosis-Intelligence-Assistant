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
  LANGUAGE_CONCEPT_IDS,
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
    indentation_error: "IndentationError: expected an indented block",
    null_reference: "TypeError: Cannot read properties of null",
    index_out_of_bounds: "IndexError: list index out of range",
    class_cast_error: "ClassCastException: class A cannot be cast to class B",
    async_error: "UnhandledPromiseRejection: Error: failed"
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
    assert.equal(answer.startLine, 1);
    assert.equal(answer.endLine, 1);
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

test("demo answers use the target language syntax", () => {
  const javaAnswer = demoAnswer("null_reference", {
    language: "java",
    message: "java.lang.NullPointerException",
    errorLine: 1,
    code: "value.trim();"
  });
  const javaScriptAnswer = demoAnswer("null_reference", {
    language: "javascript",
    message: "TypeError: Cannot read properties of null",
    errorLine: 1,
    code: "value.trim();"
  });

  assert.match(javaAnswer.code, /!= null|instanceof/);
  assert.match(javaScriptAnswer.code, /\?\./);
});

test("demo answers avoid Python-only syntax for Java and JavaScript", () => {
  for (const concept of LANGUAGE_CONCEPT_IDS.java) {
    const answer = demoAnswer(concept, {
      ...sampleContext(concept),
      language: "java"
    });
    assert.doesNotMatch(
      answer.code,
      /\brange\(|\blen\(|\bprint\(|\bstr\(|\bNone\b|dict\.get|#/
    );
  }

  for (const concept of LANGUAGE_CONCEPT_IDS.javascript) {
    const answer = demoAnswer(concept, {
      ...sampleContext(concept),
      language: "javascript"
    });
    assert.doesNotMatch(
      answer.code,
      /\brange\(|\blen\(|\bprint\(|\bstr\(|\bNone\b|dict\.get|#/
    );
  }
});

test("demo hints avoid Python-only wording for Java and JavaScript", () => {
  for (const language of ["java", "javascript"] as const) {
    for (const concept of LANGUAGE_CONCEPT_IDS[language]) {
      for (const hintIndex of [1, 2, 3] as const) {
        const hint = demoHint(concept, hintIndex, {
          ...sampleContext(concept),
          language
        });
        assert.doesNotMatch(
          hint,
          /Python|range\(|str\(\)|int\(\)|ValueError|dict\.get|type\(value\)/
        );
      }
    }
  }
});

test("demo classification respects the diagnostic language", () => {
  assert.equal(
    demoClassify({
      language: "javascript",
      message: "UnhandledPromiseRejection: Error: failed",
      errorLine: 1,
      code: "task();"
    })?.concept,
    "async_error"
  );
  assert.equal(
    demoClassify({
      language: "java",
      message: "java.lang.ClassCastException: A cannot be cast to B",
      errorLine: 1,
      code: "B value = (B) item;"
    })?.concept,
    "class_cast_error"
  );
});
