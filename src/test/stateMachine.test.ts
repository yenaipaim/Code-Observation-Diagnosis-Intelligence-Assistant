import assert from "node:assert/strict";
import test from "node:test";
import { CoachStateMachine } from "../stateMachine";

test("state machine keeps the level when a direct fix misses", () => {
  const machine = CoachStateMachine.start(
    "off_by_one",
    "main.py",
    10,
    "2026-09-23T10:00:00.000Z"
  );

  machine.recordDirectFailure();
  assert.equal(machine.snapshot().attempts, 1);
  assert.equal(machine.snapshot().hintIndex, 2);
});

test("correct understanding moves the level into verification", () => {
  const machine = CoachStateMachine.start("type_mismatch", "main.py", 3);
  machine.submitJudgment("correct");
  assert.equal(machine.snapshot().status, "verifying");
});

test("a verified program completes after correct understanding", () => {
  const machine = CoachStateMachine.start("return_vs_print", "main.py", 5);
  machine.submitJudgment("correct");
  machine.markCodeFixed(true);
  assert.equal(machine.snapshot().status, "completed");
});

test("answer is available before any attempt", () => {
  const machine = CoachStateMachine.start("off_by_one", "main.py", 2);
  assert.equal(machine.canRevealAnswer(), true);
  assert.equal(machine.snapshot().answerRevealed, false);
});
