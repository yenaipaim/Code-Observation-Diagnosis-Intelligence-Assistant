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

test("answer generation is allowed only through the explicit answer method", async () => {
  let systemPrompt = "";
  let userPrompt = "";
  const generator = new HintGenerator({
    completeJson: async <T>(system: string, user: string) => {
      systemPrompt = system;
      userPrompt = user;
      return {
        code: "for i in range(len(nums)):\n    print(nums[i])",
        explanation: "结束值应改为 len(nums)。"
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
  assert.match(systemPrompt, /code/);
  assert.match(systemPrompt, /explanation/);
  assert.match(userPrompt, /range\(len\(nums\) \+ 1\)/);
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
