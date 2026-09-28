import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendLearningLog,
  challengeCompletionCount,
  createChallengeKey,
  createLearningLogEntry,
  deleteLearningLogEntry,
  findDuplicateLearningLogEntry,
  LearningLogStore,
  scoreMultiplierForRepeat,
  sortTimeline,
  summarizeConceptOptions,
  summarizeProgress
} from "../learningLog";
import { emptyLearnerModel, recordOutcome } from "../learnerModel";
import { LearningLogEntry } from "../types";

function entry(timestamp: string): LearningLogEntry {
  return {
    id: timestamp,
    timestamp,
    fileName: "main.py",
    concept: "off_by_one",
    resolution: "independent",
    understandingSummary: "结束值多加了 1",
    confidenceDelta: 0.15,
    hintIndex: 1,
    attempts: 1
  };
}

test("timeline sorts newest entries first", () => {
  const timeline = sortTimeline([
    entry("2026-09-23T09:00:00.000Z"),
    entry("2026-09-23T10:00:00.000Z")
  ]);

  assert.equal(timeline[0].timestamp, "2026-09-23T10:00:00.000Z");
});

test("append creates a JSON-safe entry", () => {
  const item = createLearningLogEntry({
    fileName: "utils.py",
    concept: "type_mismatch",
    resolution: "after_hint",
    understandingSummary: "int 和 str 不能直接加",
    confidenceDelta: 0.05,
    hintIndex: 2,
    attempts: 3,
    now: "2026-09-23T11:00:00.000Z"
  });

  const result = appendLearningLog([], item);
  assert.equal(result.length, 1);
  assert.equal(result[0].concept, "type_mismatch");
  assert.equal(result[0].resolution, "after_hint");
});

test("deleting one timeline entry keeps the rest", () => {
  const first = entry("2026-09-23T09:00:00.000Z");
  const second = entry("2026-09-23T10:00:00.000Z");

  const result = deleteLearningLogEntry([first, second], first.id);

  assert.deepEqual(result, [second]);
});

test("duplicate matching requires the same location and code window", () => {
  const previous = {
    ...entry("2026-09-23T09:00:00.000Z"),
    errorLine: 2,
    errorMessage: "IndexError: list index out of range",
    errorCode: "nums = [1]\nprint(nums[1])"
  };

  const duplicate = findDuplicateLearningLogEntry([previous], {
    file: "main.py",
    errorLine: 2,
    code: "nums = [1]\nprint(nums[1])",
    concept: "off_by_one"
  });
  const differentCode = findDuplicateLearningLogEntry([previous], {
    file: "main.py",
    errorLine: 2,
    code: "nums = [1, 2]\nprint(nums[9])",
    concept: "off_by_one"
  });
  const differentLine = findDuplicateLearningLogEntry([previous], {
    file: "main.py",
    errorLine: 4,
    code: "nums = [1]\nprint(nums[1])",
    concept: "off_by_one"
  });
  const differentConcept = findDuplicateLearningLogEntry([previous], {
    file: "main.py",
    errorLine: 2,
    code: "nums = [1]\nprint(nums[1])",
    concept: "type_mismatch"
  });

  assert.equal(duplicate?.id, previous.id);
  assert.equal(differentCode, undefined);
  assert.equal(differentLine, undefined);
  assert.equal(differentConcept, undefined);
});

test("progress summary exposes mastery and review labels", () => {
  const model = emptyLearnerModel("local");
  model.trackedConcepts = ["python:off_by_one"];
  recordOutcome(model, {
    concept: "off_by_one",
    fixed: true,
    skipped: false,
    judgment: "correct",
    now: "2026-09-23T10:00:00.000Z"
  });

  const summary = summarizeProgress(model);
  assert.equal(summary[0].concept, "off_by_one");
  assert.equal(summary[0].status, "学习推进中");
});

test("mastery is empty until a concept is selected", () => {
  const model = emptyLearnerModel("local");
  recordOutcome(model, {
    concept: "off_by_one",
    fixed: true,
    skipped: false,
    judgment: "correct",
    now: "2026-09-24T10:00:00.000Z"
  });

  assert.deepEqual(summarizeProgress(model), []);
  model.trackedConcepts = ["python:off_by_one"];
  assert.equal(summarizeProgress(model).length, 1);
});

test("challenge key binds the same error signature", () => {
  const input = {
    file: "main.py",
    concept: "off_by_one" as const,
    errorLine: 2,
    code: "nums = [1]\nprint(nums[1])",
    message: "IndexError: list index out of range"
  };

  assert.equal(createChallengeKey(input), createChallengeKey(input));
  assert.notEqual(
    createChallengeKey(input),
    createChallengeKey({
      ...input,
      code: "nums = [1, 2]\nprint(nums[9])"
    })
  );
});

test("only real completions count as challenge repeats", () => {
  const completed = createLearningLogEntry({
    challengeKey: "same-key",
    challengeCompleted: true,
    fileName: "main.py",
    concept: "off_by_one",
    resolution: "after_hint",
    understandingSummary: "完成",
    confidenceDelta: 0.05,
    hintIndex: 1,
    attempts: 2
  });
  const viewed = createLearningLogEntry({
    challengeKey: "same-key",
    challengeCompleted: false,
    fileName: "main.py",
    concept: "off_by_one",
    resolution: "viewed_answer",
    understandingSummary: "查看答案",
    confidenceDelta: 0.05,
    hintIndex: 1,
    attempts: 1
  });

  assert.equal(challengeCompletionCount([completed, viewed], "same-key"), 1);
  assert.equal(challengeCompletionCount([viewed], "same-key"), 0);
});

test("repeat multipliers halve after each completion", () => {
  assert.equal(scoreMultiplierForRepeat(0), 1);
  assert.equal(scoreMultiplierForRepeat(1), 0.5);
  assert.equal(scoreMultiplierForRepeat(2), 0.25);
});

test("learning entries preserve their language", () => {
  const item = createLearningLogEntry({
    language: "javascript",
    fileName: "app.js",
    concept: "async_error",
    resolution: "after_hint",
    understandingSummary: "未处理 Promise rejection",
    confidenceDelta: 0.05,
    hintIndex: 1,
    attempts: 2
  });

  assert.equal(item.language, "javascript");
});

test("learning log store migrates legacy entries to Python", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coach-log-"));
  const filePath = path.join(directory, "log.json");
  try {
    await writeFile(
      filePath,
      JSON.stringify([
        {
          id: "legacy",
          timestamp: "2026-09-23T10:00:00.000Z",
          fileName: "main.py",
          concept: "off_by_one",
          resolution: "independent",
          understandingSummary: "完成",
          confidenceDelta: 0.15,
          hintIndex: 1,
          attempts: 1
        }
      ]),
      "utf8"
    );

    const entries = await new LearningLogStore(filePath).load();
    assert.equal(entries[0].language, "python");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("progress and options are grouped by language keys", () => {
  const model = emptyLearnerModel("local");
  model.trackedConcepts = [
    "python:off_by_one",
    "java:null_reference",
    "javascript:async_error"
  ];
  model.concepts["java:null_reference"] = {
    attempts: 1,
    failures: 0,
    last_seen: "2026-09-28",
    confidence: 0.8,
    consecutive_skips: 0,
    consecutive_answers: 0
  };

  const progress = summarizeProgress(model);
  const options = summarizeConceptOptions(model);

  assert.deepEqual(
    progress.map((item) => [item.language, item.concept, item.status]),
    [
      ["python", "off_by_one", "学习推进中"],
      ["java", "null_reference", "已掌握"],
      ["javascript", "async_error", "学习推进中"]
    ]
  );
  assert.ok(
    options.some(
      (item) =>
        item.key === "java:null_reference" &&
        item.language === "java" &&
        item.selected
    )
  );
});
