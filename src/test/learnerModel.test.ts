import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyConfidenceUpdate,
  challengeRepeatCount,
  confidenceDeltaFor,
  emptyLearnerModel,
  LearnerModelStore,
  recordChallengeCompletion,
  recordOutcome
} from "../learnerModel";

test("correct understanding with a fixed program adds 0.15", () => {
  assert.equal(
    confidenceDeltaFor({
      judgment: "correct",
      fixed: true,
      usedHint: false,
      skipped: false,
      viewedAnswer: false
    }),
    0.15
  );
});

test("partial understanding with a fixed program adds 0.08", () => {
  assert.equal(
    confidenceDeltaFor({
      judgment: "partial",
      fixed: true,
      usedHint: false,
      skipped: false,
      viewedAnswer: false
    }),
    0.08
  );
});

test("wrong judgment subtracts 0.10 and never goes below zero", () => {
  const model = emptyLearnerModel("local");
  applyConfidenceUpdate(model, "off_by_one", -0.1, "2026-09-23");
  assert.equal(model.concepts.off_by_one?.confidence, 0);
});

test("consecutive skips reduce the next skip reward", () => {
  const model = emptyLearnerModel("local");
  recordOutcome(model, {
    concept: "off_by_one",
    fixed: true,
    skipped: true,
    viewedAnswer: false,
    now: "2026-09-23T10:00:00.000Z"
  });
  recordOutcome(model, {
    concept: "off_by_one",
    fixed: true,
    skipped: true,
    viewedAnswer: false,
    now: "2026-09-23T10:01:00.000Z"
  });
  recordOutcome(model, {
    concept: "off_by_one",
    fixed: true,
    skipped: true,
    viewedAnswer: false,
    now: "2026-09-23T10:02:00.000Z"
  });

  const before = model.concepts.off_by_one?.confidence ?? 0;
  recordOutcome(model, {
    concept: "off_by_one",
    fixed: true,
    skipped: true,
    viewedAnswer: false,
    now: "2026-09-23T10:03:00.000Z"
  });

  assert.ok(
    Math.abs((model.concepts.off_by_one?.confidence ?? 0) - before - 0.05) <
      1e-9
  );
});

test("viewing the answer does not change confidence", () => {
  assert.equal(
    confidenceDeltaFor({
      fixed: false,
      usedHint: true,
      skipped: false,
      viewedAnswer: true
    }),
    0
  );
});

test("repeat score multiplier halves the reward", () => {
  assert.equal(
    confidenceDeltaFor({
      judgment: "correct",
      fixed: true,
      usedHint: false,
      skipped: false,
      viewedAnswer: false,
      scoreMultiplier: 0.5
    }),
    0.075
  );
});

test("learner model store round-trips JSON", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coach-model-"));
  try {
    const store = new LearnerModelStore(path.join(directory, "model.json"));
    const model = emptyLearnerModel("student");
    model.trackedConcepts = ["type_mismatch"];
    recordOutcome(model, {
      concept: "type_mismatch",
      fixed: true,
      judgment: "correct",
      usedHint: false,
      now: "2026-09-23T10:00:00.000Z"
    });
    await store.save(model);
    const loaded = await store.load();

    assert.equal(loaded.user_id, "student");
    assert.equal(loaded.concepts.type_mismatch?.confidence, 0.15);
    assert.deepEqual(loaded.trackedConcepts, ["type_mismatch"]);
    assert.deepEqual(loaded.challenges, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("challenge completion history survives timeline deletion", () => {
  const model = emptyLearnerModel("student");

  recordChallengeCompletion(model, "main.py:off_by_one", "2026-09-24T10:00:00.000Z");
  recordChallengeCompletion(model, "main.py:off_by_one", "2026-09-24T10:01:00.000Z");

  assert.equal(
    challengeRepeatCount(model, "main.py:off_by_one"),
    2
  );
});
