import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyConfidenceUpdate,
  challengeRepeatCount,
  confidenceDeltaFor,
  emptyLearnerModel,
  LearnerModelStore,
  MIN_POSITIVE_CONFIDENCE_DELTA,
  recordChallengeCompletion,
  recordOutcome,
  setConceptTracked
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
  assert.equal(model.concepts["python:off_by_one"]?.confidence, 0);
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

  const before = model.concepts["python:off_by_one"]?.confidence ?? 0;
  recordOutcome(model, {
    concept: "off_by_one",
    fixed: true,
    skipped: true,
    viewedAnswer: false,
    now: "2026-09-23T10:03:00.000Z"
  });

  assert.ok(
    Math.abs(
      (model.concepts["python:off_by_one"]?.confidence ?? 0) -
        before -
        0.05
    ) <
      1e-9
  );
});

test("viewing the answer adds only the minimum confidence delta", () => {
  assert.equal(
    confidenceDeltaFor({
      fixed: false,
      usedHint: true,
      skipped: false,
      viewedAnswer: true
    }),
    MIN_POSITIVE_CONFIDENCE_DELTA
  );
});

test("viewing the answer still respects the repeat multiplier", () => {
  assert.equal(
    confidenceDeltaFor({
      fixed: false,
      usedHint: true,
      skipped: false,
      viewedAnswer: true,
      scoreMultiplier: 0.5
    }),
    MIN_POSITIVE_CONFIDENCE_DELTA / 2
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
    model.trackedConcepts = ["python:type_mismatch"];
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
    assert.equal(
      loaded.concepts["python:type_mismatch"]?.confidence,
      0.15
    );
    assert.deepEqual(loaded.trackedConcepts, ["python:type_mismatch"]);
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

test("mastery is isolated by language and concept", () => {
  const model = emptyLearnerModel("student");

  recordOutcome(model, {
    language: "java",
    concept: "null_reference",
    fixed: true,
    judgment: "correct",
    now: "2026-09-28T10:00:00.000Z"
  });
  recordOutcome(model, {
    language: "javascript",
    concept: "null_reference",
    fixed: true,
    judgment: "correct",
    now: "2026-09-28T10:01:00.000Z"
  });

  assert.equal(
    model.concepts["java:null_reference"]?.confidence,
    0.15
  );
  assert.equal(
    model.concepts["javascript:null_reference"]?.confidence,
    0.15
  );
});

test("tracked mastery keeps stable language keys", () => {
  const model = emptyLearnerModel("student");

  setConceptTracked(model, "java:index_out_of_bounds", true);
  setConceptTracked(model, "javascript:async_error", true);

  assert.deepEqual(model.trackedConcepts, [
    "java:index_out_of_bounds",
    "javascript:async_error"
  ]);
});

test("learner model store migrates legacy Python keys", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coach-model-"));
  const filePath = path.join(directory, "model.json");
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        user_id: "legacy",
        concepts: {
          off_by_one: {
            attempts: 2,
            failures: 1,
            last_seen: "2026-09-23",
            confidence: 0.2,
            consecutive_skips: 0,
            consecutive_answers: 0
          }
        },
        challenges: {},
        trackedConcepts: ["off_by_one"]
      }),
      "utf8"
    );

    const loaded = await new LearnerModelStore(filePath).load();

    assert.equal(
      loaded.concepts["python:off_by_one"]?.confidence,
      0.2
    );
    assert.deepEqual(loaded.trackedConcepts, ["python:off_by_one"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
