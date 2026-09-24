import assert from "node:assert/strict";
import test from "node:test";
import { CoachController } from "../coachController";
import { emptyLearnerModel } from "../learnerModel";
import {
  DiagnosticSnapshot,
  LearningLogEntry,
  LearnerModel,
  MisconceptionId
} from "../types";

function snapshot(): DiagnosticSnapshot {
  return {
    file: "main.py",
    message: "IndexError: list index out of range",
    errorLine: 2,
    code: "nums = [1]\nprint(nums[1])"
  };
}

function harness(options?: {
  judgment?: "correct" | "partial" | "wrong";
  closeness?: number;
  hasApiKey?: boolean;
  concepts?: MisconceptionId[];
  answerThrows?: boolean;
}) {
  let model: LearnerModel = emptyLearnerModel("test");
  const logs: LearningLogEntry[] = [];
  const published: string[] = [];
  const judgmentCalls: Array<{
    attempt: { text?: string; code?: string; codeFixed?: boolean };
    referenceAnswer?: { code: string; explanation: string };
  }> = [];
  const controller = new CoachController({
    classifier: async () => ({
      concept: options?.concepts?.shift() ?? "off_by_one",
      confidence: 0.96,
      source: "rule"
    }),
    hintService: {
      generateHint: async () => "循环最后访问了哪个索引？",
      generateAnswer: async () => {
        if (options?.answerThrows) {
          throw new Error("offline");
        }
        return {
          code: "for i in range(len(nums)):\n    print(nums[i])",
          explanation: "末尾多跑一次，应把范围减一。"
        };
      }
    },
    judgmentService: async (_concept, attempt, _snapshot, referenceAnswer) => {
      judgmentCalls.push({ attempt, referenceAnswer });
      return {
        judgment: options?.judgment ?? "correct",
        reason: "test",
        closeness: options?.closeness
      };
    },
    modelStore: {
      load: async () => model,
      save: async (next) => {
        model = next;
      }
    },
    logStore: {
      load: async () => logs,
      append: async (entry) => {
        logs.push(entry);
        return logs;
      }
    },
    hasApiKey: async () => options?.hasApiKey ?? true,
    demoMode: false,
    publish: (state) => {
      published.push(state.stage);
    }
  });

  return {
    controller,
    logs,
    published,
    judgmentCalls,
    getModel: () => model
  };
}

test("opening a diagnostic shows the diagnosis stage", async () => {
  const { controller } = harness();
  const state = await controller.openDiagnostic(snapshot());
  assert.equal(state.stage, "diagnose");
  assert.equal(state.conceptLabel, "差一错误");
  assert.equal(controller.currentFile(), "main.py");
});

test("a runtime error auto-selects its mastery item", async () => {
  const { controller, getModel } = harness();
  await controller.openDiagnostic(snapshot());

  assert.deepEqual(getModel().trackedConcepts, ["off_by_one"]);
});

test("a user can manually select and clear a mastery item", async () => {
  const { controller, getModel } = harness();
  await controller.setTrackedConcept("name_error", true);
  assert.deepEqual(getModel().trackedConcepts, ["name_error"]);

  await controller.setTrackedConcept("name_error", false);
  assert.deepEqual(getModel().trackedConcepts, []);
});

test("an unchanged diagnostic event does not add an attempt", async () => {
  const { controller } = harness();
  await controller.openDiagnostic(snapshot());
  const state = await controller.openDiagnostic(snapshot());
  assert.equal(state.level?.attempts, 0);
});

test("starting a challenge requests the first dynamic hint", async () => {
  const { controller } = harness();
  await controller.openDiagnostic(snapshot());
  const state = await controller.startChallenge();
  assert.equal(state.stage, "guiding");
  assert.equal(state.hintIndex, 1);
  assert.match(state.hint ?? "", /最后访问/);
});

test("a repeated error keeps the panel in guiding and advances one hint", async () => {
  const { controller } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  const state = await controller.openDiagnostic({
    ...snapshot(),
    code: "nums = [1]\nprint(nums[1])  # still failing"
  });

  assert.equal(state.stage, "guiding");
  assert.equal(state.level?.attempts, 1);
  assert.equal(state.hintIndex, 2);
});

test("a correct explanation moves into code verification", async () => {
  const { controller } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  const state = await controller.submitUnderstanding("结束值多跑了一次");
  assert.equal(state.stage, "verifying");
  assert.equal(state.level?.status, "verifying");
});

test("AI judgment receives the reference answer and reports closeness", async () => {
  const { controller, judgmentCalls } = harness({ closeness: 0.72 });
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  const state = await controller.submitUnderstanding("差一错误");

  assert.equal(judgmentCalls.length, 1);
  assert.equal(judgmentCalls[0].attempt.text, "差一错误");
  assert.match(
    judgmentCalls[0].referenceAnswer?.code ?? "",
    /range\(len\(nums\)\)/
  );
  assert.equal(state.closeness, 0.72);
});

test("AI judgment evaluates the current code after a successful run", async () => {
  const { controller, judgmentCalls } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  const state = await controller.markCodeFixed(
    "for i in range(len(nums)):\n    print(nums[i])"
  );

  assert.equal(judgmentCalls.length, 1);
  assert.equal(judgmentCalls[0].attempt.codeFixed, true);
  assert.match(judgmentCalls[0].attempt.code ?? "", /range\(len\(nums\)\)/);
  assert.equal(state.stage, "completed");
});

test("a fixed program completes the level and appends a log", async () => {
  const { controller, logs, getModel } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("结束值多跑了一次");
  const state = await controller.markCodeFixed();

  assert.equal(state.stage, "completed");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].resolution, "after_hint");
  assert.equal(getModel().concepts.off_by_one?.confidence, 0.05);
});

test("repeated success completion does not append or score twice", async () => {
  const { controller, logs, getModel } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("结束值多跑了一次");
  await controller.markCodeFixed();
  const state = await controller.markCodeFixed();

  assert.equal(state.stage, "completed");
  assert.equal(logs.length, 1);
  assert.equal(getModel().concepts.off_by_one?.confidence, 0.05);
});

test("concurrent success events complete the level once", async () => {
  const { controller, logs, getModel } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("结束值多跑了一次");
  const states = await Promise.all([
    controller.markCodeFixed(),
    controller.markCodeFixed()
  ]);

  assert.deepEqual(
    states.map((state) => state.stage),
    ["completed", "completed"]
  );
  assert.equal(logs.length, 1);
  assert.equal(getModel().concepts.off_by_one?.confidence, 0.05);
});

test("skipping explanation after a successful fix records unverified learning", async () => {
  const { controller, logs, getModel } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  const verifying = await controller.markCodeFixed();
  assert.equal(verifying.stage, "verifying");
  assert.equal(verifying.canSkipUnderstanding, true);
  const completed = await controller.skipUnderstanding();

  assert.equal(completed.stage, "completed");
  assert.equal(logs[0].resolution, "unverified");
  assert.equal(getModel().concepts.off_by_one?.confidence, 0.1);
});

test("correct understanding cannot be skipped before the code is fixed", async () => {
  const { controller, logs } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("结束值多跑了一次");
  const beforeSkip = await controller.currentState();
  assert.equal(beforeSkip.canSkipUnderstanding, false);
  const state = await controller.skipUnderstanding();

  assert.equal(state.stage, "verifying");
  assert.equal(logs.length, 0);
  assert.equal(state.level?.status, "verifying");
});

test("submitting understanding after a fixed program completes the level", async () => {
  const { controller, logs } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.markCodeFixed();
  const state = await controller.submitUnderstanding("结束值多跑了一次");

  assert.equal(state.stage, "completed");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].resolution, "after_hint");
});

test("answer is available on the first attempt and does not score", async () => {
  const { controller, logs, getModel } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  const beforeReveal = await controller.currentState();
  assert.equal(beforeReveal.canRevealAnswer, true);
  assert.equal(beforeReveal.answerLabel, "查看答案");
  const state = await controller.revealAnswer();

  assert.match(state.answer?.code ?? "", /range\(len\(nums\)\)/);
  assert.equal(state.canRevealAnswer, false);
  assert.equal(state.confidence, 0);
  assert.equal(logs[0].resolution, "viewed_answer");
  assert.equal(getModel().concepts.off_by_one?.confidence, 0);
});

test("an answer generation failure leaves the level open", async () => {
  const { controller, logs } = harness({ answerThrows: true });
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.openDiagnostic({
    ...snapshot(),
    code: "nums = [1]\nprint(nums[1])  # attempt 2"
  });
  await controller.openDiagnostic({
    ...snapshot(),
    code: "nums = [1]\nprint(nums[1])  # attempt 3"
  });
  const state = await controller.revealAnswer();

  assert.equal(state.stage, "guiding");
  assert.equal(state.level?.status, "in_progress");
  assert.equal(logs.length, 0);
});

test("a wrong explanation lowers confidence by 0.10", async () => {
  const { controller, getModel } = harness({ judgment: "wrong" });
  const model = getModel();
  model.concepts.off_by_one = {
    attempts: 1,
    failures: 1,
    last_seen: "2026-09-23",
    confidence: 0.4,
    consecutive_skips: 0,
    consecutive_answers: 0
  };
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("应该是变量名写错了");

  assert.equal(model.concepts.off_by_one?.confidence, 0.3);
});

test("answer prerequisite failure does not complete the level", async () => {
  const { controller } = harness({ hasApiKey: false });
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.openDiagnostic({
    ...snapshot(),
    code: "nums = [1]\nprint(nums[1])  # attempt 2"
  });
  await controller.openDiagnostic({
    ...snapshot(),
    code: "nums = [1]\nprint(nums[1])  # attempt 3"
  });
  const state = await controller.revealAnswer();

  assert.equal(state.stage, "configuration");
  assert.equal(state.level?.status, "in_progress");
});

test("revealed answer contains runnable code before its explanation", async () => {
  const { controller } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();

  const state = await controller.revealAnswer();

  assert.match(state.answer?.code ?? "", /range\(len\(nums\)\)/);
  assert.match(state.answer?.explanation ?? "", /范围减一/);
});

test("a new level reports only the confidence delta in its log", async () => {
  const { controller, logs, getModel } = harness();
  const model = getModel();
  model.concepts.off_by_one = {
    attempts: 1,
    failures: 1,
    last_seen: "2026-09-23",
    confidence: 0.1,
    consecutive_skips: 0,
    consecutive_answers: 0
  };
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("结束值多跑了一次");
  await controller.markCodeFixed();

  assert.equal(logs[0].confidenceDelta, 0.05);
});

test("same error after completion starts a repeat level", async () => {
  const { controller, logs, getModel } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("结束值多跑了一次");
  await controller.markCodeFixed();
  const confidenceAfterCompletion =
    getModel().concepts.off_by_one?.confidence;

  const state = await controller.openDiagnostic(snapshot());
  assert.equal(state.stage, "diagnose");
  assert.equal(state.level?.repeatCount, 1);
  assert.equal(state.level?.scoreMultiplier, 0.5);
  assert.equal(logs.length, 1);
  assert.equal(
    getModel().concepts.off_by_one?.confidence,
    confidenceAfterCompletion
  );
});

test("different code at the same location starts a new level", async () => {
  const { controller, logs, getModel } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("结束值多跑了一次");
  await controller.markCodeFixed();
  const confidenceAfterCompletion =
    getModel().concepts.off_by_one?.confidence;

  const state = await controller.openDiagnostic({
    ...snapshot(),
    code: "nums = [1, 2]\nprint(nums[9])"
  });

  assert.equal(state.stage, "diagnose");
  assert.equal(state.level?.status, "in_progress");
  assert.equal(state.level?.attempts, 0);
  assert.equal(logs.length, 1);
  assert.equal(
    getModel().concepts.off_by_one?.confidence,
    confidenceAfterCompletion
  );
});

test("a repeated challenge scores half", async () => {
  const { controller, logs, getModel } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("结束值多跑了一次");
  await controller.markCodeFixed();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("结束值多跑了一次");
  const state = await controller.markCodeFixed();

  assert.equal(state.stage, "completed");
  assert.equal(logs.length, 2);
  assert.equal(logs[1].repeatCount, 1);
  assert.equal(logs[1].scoreMultiplier, 0.5);
  assert.equal(logs[1].confidenceDelta, 0.03);
  assert.equal(getModel().concepts.off_by_one?.confidence, 0.08);
});

test("clearing the visible timeline does not reset repeat scoring", async () => {
  const { controller, logs } = harness();
  await controller.openDiagnostic(snapshot());
  await controller.startChallenge();
  await controller.submitUnderstanding("结束值多跑了一次");
  await controller.markCodeFixed();
  logs.splice(0, logs.length);

  const state = await controller.openDiagnostic(snapshot());

  assert.equal(state.level?.repeatCount, 1);
  assert.equal(state.level?.scoreMultiplier, 0.5);
});

test("a different misconception closes the previous level first", async () => {
  const { controller, logs } = harness({
    concepts: ["off_by_one", "type_mismatch"]
  });
  await controller.openDiagnostic(snapshot());
  const state = await controller.openDiagnostic({
    ...snapshot(),
    message: "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
    file: "other.py"
  });

  assert.equal(state.conceptLabel, "类型混淆");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].concept, "off_by_one");
  assert.equal(logs[0].resolution, "unverified");
});
