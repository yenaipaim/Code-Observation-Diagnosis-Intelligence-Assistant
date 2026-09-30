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
    assert.ok(
      answer.code.length > 10,
      `${concept} answer code: ${answer.code}`
    );
    assert.ok(
      answer.explanation.length > 10,
      `${concept} explanation: ${answer.explanation}`
    );
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

test("demo off-by-one answer replaces the complete loop part", () => {
  const answer = demoAnswer("off_by_one", {
    message: "IndexError: list index out of range",
    errorLine: 2,
    code: [
      "for i in range(len(nums) + 1):",
      "    print(nums[i])"
    ].join("\n")
  });

  assert.equal(answer.startLine, 1);
  assert.equal(answer.endLine, 2);
  assert.match(answer.code, /^for i in range\(len\(nums\)\):/);
  assert.match(answer.code, /^    print/m);
});

test("demo key-error answer preserves the current statement and variable", () => {
  const answer = demoAnswer("key_error", {
    message: "KeyError: 'age'",
    errorLine: 2,
    code: [
      'user = {"name": "Alice"}',
      'print(user["age"])'
    ].join("\n")
  });

  assert.equal(answer.startLine, 2);
  assert.equal(answer.endLine, 2);
  assert.equal(answer.code, 'print(user.get("age", "unknown"))');
});

test("demo return-vs-print answer converts the real print expression", () => {
  const answer = demoAnswer("return_vs_print", {
    message: "'NoneType' object has no attribute 'upper'",
    errorLine: 5,
    code: [
      "def greet(name):",
      '    print("Hello " + name)',
      "",
      'result = greet("Alice")',
      "result.upper()"
    ].join("\n")
  });

  assert.equal(answer.code, '    return "Hello " + name');
  assert.equal(answer.startLine, 2);
  assert.equal(answer.endLine, 2);
});

test("demo type-mismatch answer converts the real operand", () => {
  const answer = demoAnswer("type_mismatch", {
    message: 'TypeError: can only concatenate str (not "int") to str',
    errorLine: 1,
    code: 'print("Age: " + age)'
  });

  assert.equal(answer.code, 'print("Age: " + str(age))');
});

test("demo name-error answer declares the missing name", () => {
  const answer = demoAnswer("name_error", {
    message: "NameError: name 'score' is not defined",
    errorLine: 1,
    code: "print(score)"
  });

  assert.equal(answer.code, "score = 0\nprint(score)");
  assert.equal(answer.startLine, 1);
  assert.equal(answer.endLine, 1);
});

test("demo syntax-error answer repairs the current statement", () => {
  const answer = demoAnswer("syntax_error", {
    message: "SyntaxError: expected ':'",
    errorLine: 1,
    code: "if score > 0"
  });

  assert.equal(answer.code, "if score > 0:");
});

test("demo value-error answer keeps the real conversion assignment", () => {
  const answer = demoAnswer("value_error", {
    message: "ValueError: invalid literal for int()",
    errorLine: 1,
    code: "number = int(text)"
  });

  assert.match(answer.code, /^try:/);
  assert.match(answer.code, /number = int\(text\)/);
  assert.match(answer.code, /except ValueError:/);
});

test("demo zero-division answer uses the real numerator and denominator", () => {
  const answer = demoAnswer("zero_division", {
    message: "ZeroDivisionError: division by zero",
    errorLine: 1,
    code: "result = total / count"
  });

  assert.equal(
    answer.code,
    "result = total / count if count else 0"
  );
});

test("demo attribute-error answer uses the real object and method", () => {
  const answer = demoAnswer("attribute_error", {
    message: "AttributeError: 'list' object has no attribute 'push'",
    errorLine: 1,
    code: "items.push(1)"
  });

  assert.equal(answer.code, "items.append(1)");
});

test("demo import-error answer names the missing module", () => {
  const answer = demoAnswer("import_error", {
    message: "ModuleNotFoundError: No module named 'requests'",
    errorLine: 1,
    code: "import requests"
  });

  assert.match(answer.code, /python -m pip install requests/);
  assert.match(answer.code, /^import requests$/m);
});

test("demo indentation-error answer indents the real block line", () => {
  const answer = demoAnswer("indentation_error", {
    message: "IndentationError: expected an indented block",
    errorLine: 2,
    code: "for i in range(3):\nprint(i)"
  });

  assert.equal(answer.code, "    print(i)");
  assert.equal(answer.startLine, 2);
  assert.equal(answer.endLine, 2);
});

test("demo null-reference answer adds optional access in JavaScript", () => {
  const answer = demoAnswer("null_reference", {
    language: "javascript",
    message: "TypeError: Cannot read properties of null (reading 'trim')",
    errorLine: 1,
    code: "value.trim();"
  });

  assert.equal(answer.code, "value?.trim();");
});

test("demo index-error answer checks the real Java collection", () => {
  const answer = demoAnswer("index_out_of_bounds", {
    language: "java",
    message: "ArrayIndexOutOfBoundsException",
    errorLine: 1,
    code: "int value = values[index];"
  });

  assert.equal(
    answer.code,
    "int value = (index >= 0 && index < values.length) ? values[index] : 0;"
  );
});

test("demo class-cast answer checks the real Java source value", () => {
  const answer = demoAnswer("class_cast_error", {
    language: "java",
    message: "ClassCastException",
    errorLine: 1,
    code: "String text = (String) value;"
  });

  assert.equal(
    answer.code,
    "String text = value instanceof String ? (String) value : null;"
  );
});

test("demo async-error answer catches the real JavaScript promise", () => {
  const answer = demoAnswer("async_error", {
    language: "javascript",
    message: "UnhandledPromiseRejection: Error: failed",
    errorLine: 1,
    code: "task();"
  });

  assert.equal(
    answer.code,
    "task().catch((error) => console.error(error));"
  );
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
