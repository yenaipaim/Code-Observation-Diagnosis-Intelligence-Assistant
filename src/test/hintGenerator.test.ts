import assert from "node:assert/strict";
import test from "node:test";
import {
  HintGenerator,
  judgeByKeywords,
  judgeUnderstanding
} from "../hintGenerator";

test("keyword fallback recognizes a correct off-by-one explanation", () => {
  assert.equal(
    judgeByKeywords("off_by_one", "循环多跑了一次，range 结束值不对"),
    "correct"
  );
});

test("keyword fallback separates partial and wrong answers", () => {
  assert.equal(judgeByKeywords("type_mismatch", "类型看起来不对"), "partial");
  assert.equal(judgeByKeywords("type_mismatch", "应该是变量名写错了"), "wrong");
});

test("hint generator includes the fixed direction and concrete code", async () => {
  let systemPrompt = "";
  let userPrompt = "";
  const generator = new HintGenerator({
    completeJson: async <T>(system: string, user: string) => {
      systemPrompt = system;
      userPrompt = user;
      return { hint: "观察这个循环最后一次执行时 i 的值。" } as T;
    }
  });

  const hint = await generator.generateHint(
    {
      message: "IndexError: list index out of range",
      errorLine: 2,
      code: "for i in range(len(nums) + 1):\n    print(nums[i])"
    },
    "off_by_one",
    1
  );

  assert.match(hint, /最后一次/);
  assert.match(systemPrompt, /定位循环边界/);
  assert.match(userPrompt, /range\(len\(nums\) \+ 1\)/);
  assert.match(userPrompt, /IndexError/);
});

test("understanding judge falls back when the client fails", async () => {
  const result = await judgeUnderstanding(
    "return_vs_print",
    "函数要 return 给调用者，不是只 print",
    {
      completeJson: async () => {
        throw new Error("offline");
      }
    }
  );

  assert.equal(result.judgment, "correct");
  assert.match(result.reason, /关键词兜底/);
});

test("understanding judge can surface API errors for automatic fallback", async () => {
  await assert.rejects(
    () =>
      judgeUnderstanding(
        "off_by_one",
        "结束值多了一次",
        {
          completeJson: async () => {
            throw new Error("offline");
          }
        },
        undefined,
        undefined,
        undefined,
        { throwOnApiError: true }
      ),
    /offline/
  );
});

test("answer generation is allowed only through the explicit answer method", async () => {
  let systemPrompt = "";
  let userPrompt = "";
  const generator = new HintGenerator({
    completeJson: async <T>(system: string, user: string) => {
      systemPrompt = system;
      userPrompt = user;
      return {
        code: "for i in range(len(nums)):\n    print(nums[i])",
        explanation: "结束值应改为 len(nums)。",
        startLine: 1,
        endLine: 2
      } as T;
    }
  });

  const answer = await generator.generateAnswer(
    {
      message: "IndexError: list index out of range",
      errorLine: 2,
      code: "for i in range(len(nums) + 1):\n    print(nums[i])"
    },
    "off_by_one"
  );

  assert.match(answer.code, /range\(len\(nums\)\)/);
  assert.match(answer.explanation, /len\(nums\)/);
  assert.equal(answer.startLine, 1);
  assert.equal(answer.endLine, 2);
  assert.match(systemPrompt, /code/);
  assert.match(systemPrompt, /explanation/);
  assert.match(systemPrompt, /完整代码部分/);
  assert.match(systemPrompt, /不能只截取报错行/);
  assert.match(systemPrompt, /startLine/);
  assert.match(userPrompt, /range\(len\(nums\) \+ 1\)/);
  assert.match(userPrompt, /1: for i/);
});

test("answer generation expands a line fallback to the complete error part", async () => {
  const generator = new HintGenerator({
    completeJson: async <T>() =>
      ({
        code: "    print(nums[i])",
        explanation: "只修正当前缩进行。",
        startLine: 99,
        endLine: 100
      }) as T
  });

  const answer = await generator.generateAnswer(
    {
      message: "IndexError: list index out of range",
      errorLine: 2,
      code: "for i in range(len(nums) + 1):\n    print(nums[i])"
    },
    "off_by_one"
  );

  assert.match(answer.code, /^for i in range\(len\(nums\) \+ 1\):/);
  assert.match(answer.code, /^    print/m);
  assert.equal(answer.startLine, 1);
  assert.equal(answer.endLine, 2);
});

test("answer generation accepts a complete part without line numbers", async () => {
  const generator = new HintGenerator({
    completeJson: async <T>() =>
      ({
        code: [
          "for i in range(len(nums)):",
          "    print(nums[i])"
        ].join("\n"),
        explanation: "修正完整循环部分。"
      }) as T
  });

  const answer = await generator.generateAnswer(
    {
      message: "IndexError: list index out of range",
      errorLine: 2,
      code: [
        "for i in range(len(nums) + 1):",
        "    print(nums[i])"
      ].join("\n")
    },
    "off_by_one"
  );

  assert.equal(
    answer.code,
    "for i in range(len(nums)):\n    print(nums[i])"
  );
  assert.equal(answer.startLine, 1);
  assert.equal(answer.endLine, 2);
});

test("answer generation trims a full-code response to the complete error part", async () => {
  const generator = new HintGenerator({
    completeJson: async <T>() =>
      ({
        code: [
          "nums = [1, 2, 3]",
          "for i in range(len(nums)):",
          "    print(nums[i])"
        ].join("\n"),
        explanation: "只改循环边界。",
        startLine: 2,
        endLine: 2
      }) as T
  });

  const answer = await generator.generateAnswer(
    {
      message: "IndexError: list index out of range",
      errorLine: 2,
      code: [
        "nums = [1, 2, 3]",
        "for i in range(len(nums) + 1):",
        "    print(nums[i])"
      ].join("\n")
    },
    "off_by_one"
  );

  assert.equal(
    answer.code,
    "for i in range(len(nums)):\n    print(nums[i])"
  );
  assert.equal(answer.startLine, 2);
  assert.equal(answer.endLine, 3);
});

test("answer generation strips language-tagged code fences", async () => {
  const generator = new HintGenerator({
    completeJson: async <T>() =>
      ({
        code: "```java\nint count = 0;\n```",
        explanation: "先初始化对象。",
        startLine: 3,
        endLine: 3
      }) as T
  });

  const answer = await generator.generateAnswer(
    {
      language: "java",
      message: "java.lang.NullPointerException",
      errorLine: 3,
      code: "count.trim();"
    },
    "null_reference"
  );

  assert.equal(answer.code, "int count = 0;");
});

test("hint generation rejects an answer-shaped code block", async () => {
  const generator = new HintGenerator({
    completeJson: async <T>() =>
      ({
        hint: "把代码改成：\n```python\nfor i in range(len(nums)):\n    print(nums[i])\n```"
      }) as T
  });

  await assert.rejects(
    () =>
      generator.generateHint(
        {
          message: "IndexError: list index out of range",
          errorLine: 2,
          code: "for i in range(len(nums) + 1):\n    print(nums[i])"
        },
        "off_by_one",
        1
      ),
    /完整修复代码/
  );
});

test("understanding judgment includes the diagnostic context", async () => {
  let userPrompt = "";
  await judgeUnderstanding(
    "off_by_one",
    "结束值多跑了一次",
    {
      completeJson: async <T>(_system: string, user: string) => {
        userPrompt = user;
        return { judgment: "correct", reason: "ok" } as T;
      }
    },
    {
      message: "IndexError: list index out of range",
      errorLine: 2,
      code: "for i in range(len(nums) + 1):\n    print(nums[i])"
    }
  );

  assert.match(userPrompt, /IndexError/);
  assert.match(userPrompt, /range\(len\(nums\) \+ 1\)/);
});

test("hint prompts identify the target language", async () => {
  let systemPrompt = "";
  let userPrompt = "";
  const generator = new HintGenerator({
    completeJson: async <T>(system: string, user: string) => {
      systemPrompt = system;
      userPrompt = user;
      return { hint: "先确认对象是否可能为空。" } as T;
    }
  });

  await generator.generateHint(
    {
      language: "java",
      message: "java.lang.NullPointerException",
      errorLine: 3,
      code: "value.trim();"
    },
    "null_reference",
    1
  );

  assert.match(systemPrompt, /Java/);
  assert.match(userPrompt, /Java/);
});

test("understanding judgment identifies the target language", async () => {
  let systemPrompt = "";
  await judgeUnderstanding(
    "null_reference",
    "使用前需要判空",
    {
      completeJson: async <T>(system: string) => {
        systemPrompt = system;
        return { judgment: "correct", reason: "ok" } as T;
      }
    },
    {
      language: "javascript",
      message: "TypeError: Cannot read properties of null",
      errorLine: 2,
      code: "value.name"
    }
  );

  assert.match(systemPrompt, /JavaScript/);
});
