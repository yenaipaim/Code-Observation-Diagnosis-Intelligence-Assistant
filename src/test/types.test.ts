import assert from "node:assert/strict";
import test from "node:test";
import { clampConfidence, isMisconceptionId, sameLevel } from "../types";

test("clampConfidence keeps confidence inside zero and one", () => {
  assert.equal(clampConfidence(-0.2), 0);
  assert.equal(clampConfidence(1.2), 1);
  assert.equal(clampConfidence(0.42), 0.42);
});

test("isMisconceptionId accepts the expanded error set", () => {
  assert.equal(isMisconceptionId("off_by_one"), true);
  assert.equal(isMisconceptionId("name_error"), true);
  assert.equal(isMisconceptionId("syntax_error"), true);
  assert.equal(isMisconceptionId("key_error"), true);
  assert.equal(isMisconceptionId("value_error"), true);
  assert.equal(isMisconceptionId("zero_division"), true);
  assert.equal(isMisconceptionId("attribute_error"), true);
  assert.equal(isMisconceptionId("import_error"), true);
  assert.equal(isMisconceptionId("indentation_error"), true);
  assert.equal(isMisconceptionId("unknown"), false);
});

test("sameLevel detects nearby diagnostics in one file", () => {
  assert.equal(
    sameLevel(
      {
        concept: "off_by_one",
        file: "main.py",
        errorLine: 10,
        startedAt: "2026-09-23T10:00:00.000Z"
      },
      {
        concept: "type_mismatch",
        file: "main.py",
        errorLine: 14,
        startedAt: "2026-09-23T10:04:00.000Z"
      }
    ),
    true
  );
});
