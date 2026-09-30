import assert from "node:assert/strict";
import test from "node:test";
import { inferCodePartRange } from "../codePart";

test("infers a complete Python loop as one error part", () => {
  const range = inferCodePartRange(
    [
      "nums = [1, 2, 3]",
      "for i in range(len(nums) + 1):",
      "    print(nums[i])"
    ].join("\n"),
    "python",
    3
  );

  assert.deepEqual(range, { startLine: 2, endLine: 3 });
});

test("infers a multiline Java expression as one error part", () => {
  const range = inferCodePartRange(
    [
      "int value = Integer.parseInt(",
      '    text',
      ");"
    ].join("\n"),
    "java",
    2
  );

  assert.deepEqual(range, { startLine: 1, endLine: 3 });
});

test("infers a complete JavaScript control block as one error part", () => {
  const range = inferCodePartRange(
    [
      "for (let i = 0; i <= values.length; i++) {",
      "  console.log(values[i]);",
      "}"
    ].join("\n"),
    "javascript",
    2
  );

  assert.deepEqual(range, { startLine: 1, endLine: 3 });
});
