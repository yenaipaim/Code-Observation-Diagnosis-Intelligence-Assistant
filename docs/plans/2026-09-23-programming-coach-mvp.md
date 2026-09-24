# Programming Coach MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VSCode extension that turns Python diagnostics into Socratic debugging practice, tracks learner confidence, and shows a learning timeline.

**Architecture:** The extension listens to Python diagnostics, classifies one of three misconception types, and drives a persistent WebviewView state machine. Pure domain modules own classification, hint orchestration, confidence updates, and timeline construction; VSCode-facing modules own events, decorations, SecretStorage, files, and Webviews. DeepSeek calls use an injectable client so tests and demo mode never require the network.

**Tech Stack:** TypeScript 5, VSCode Extension API, Node.js 18+ (`fetch`), Node test runner, static Webview HTML/CSS/JavaScript, DeepSeek OpenAI-compatible API.

**Spec:** `E:\weixinfile\xwechat_files\wxid_rldj9cf13kfj22_861a\msg\file\2026-09\编程学习助手-Codex规格文档(1).md`

## Global Constraints

- Python only in the MVP.
- Never insert explanatory text inline in code; use only editor decoration and the side panel.
- Never reveal a complete answer until the unlock rule is met.
- Never edit learner code automatically.
- Never hardcode final hint copy; demo mode is the only allowed cache path.
- Demo mode must make zero DeepSeek API calls.
- Store API keys with `vscode.SecretStorage`.
- Store learner data and learning logs as local JSON under the extension data directory.
- Keep confidence in `[0, 1]`.
- Treat the same level as: same concept, or same file and error line within 5, or within 3 minutes of the previous level.
- UI text is Chinese; code identifiers and API names remain exact English.

---

### Task 1: Scaffold Extension And Domain Types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.vscodeignore`
- Create: `.gitignore`
- Create: `src/types.ts`
- Create: `src/test/types.test.ts`

**Interfaces:**
- Produces: `MisconceptionId`, `HintIndex`, `ResolutionKind`, `Judgment`, `DiagnosticSnapshot`, `CurrentLevel`, `LearnerConceptState`, `LearnerModel`, `LearningLogEntry`, `PanelState`.

- [ ] **Step 1: Write the failing test**

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { clampConfidence, isMisconceptionId, sameLevel } from "../types";

test("clampConfidence keeps confidence inside zero and one", () => {
  assert.equal(clampConfidence(-0.2), 0);
  assert.equal(clampConfidence(1.2), 1);
  assert.equal(clampConfidence(0.42), 0.42);
});

test("isMisconceptionId accepts only MVP concepts", () => {
  assert.equal(isMisconceptionId("off_by_one"), true);
  assert.equal(isMisconceptionId("unknown"), false);
});

test("sameLevel detects nearby diagnostics in one file", () => {
  assert.equal(sameLevel(
    { concept: "off_by_one", file: "main.py", errorLine: 10, startedAt: "2026-09-23T10:00:00.000Z" },
    { concept: "type_mismatch", file: "main.py", errorLine: 14, startedAt: "2026-09-23T10:04:00.000Z" },
  ), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile`

Expected: FAIL because `src/types.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Define strict string unions, JSON-safe interfaces, `clampConfidence`, `isMisconceptionId`, and `sameLevel` exactly as used by the test. Add the package manifest with commands `programmingCoach.configureApiKey`, `programmingCoach.openPanel`, and `programmingCoach.openLearningLog`; two Webview views; and the `programmingCoach.demoMode` configuration.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run compile`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .vscodeignore .gitignore src/types.ts src/test/types.test.ts
git commit -m "feat: scaffold programming coach extension"
```

### Task 2: Classify Misconceptions

**Files:**
- Create: `src/misconceptionClassifier.ts`
- Create: `src/test/misconceptionClassifier.test.ts`

**Interfaces:**
- Consumes: `MisconceptionId`, `DiagnosticSnapshot`.
- Produces: `classifyByRules(input: DiagnosticSnapshot): Classification | undefined` and `classifyMisconception(input: DiagnosticSnapshot, fallback?: (input: DiagnosticSnapshot) => Promise<Classification | undefined>): Promise<Classification | undefined>`.

- [ ] **Step 1: Write the failing test**

```typescript
test("classifies IndexError with len and range as off_by_one", () => {
  const result = classifyByRules({
    message: "IndexError: list index out of range",
    errorLine: 4,
    code: "nums = [1, 2]\nfor i in range(len(nums) + 1):\n    print(nums[i])",
  });
  assert.equal(result?.concept, "off_by_one");
});

test("classifies TypeError between str and int as type_mismatch", () => {
  const result = classifyByRules({
    message: "TypeError: can only concatenate str (not \"int\") to str",
    errorLine: 1,
    code: "age = 18\nprint(\"age: \" + age)",
  });
  assert.equal(result?.concept, "type_mismatch");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`

Expected: FAIL because the classifier is missing.

- [ ] **Step 3: Write minimal implementation**

Implement exception and code-feature rules in spec order. Add `return_vs_print` detection for a nearby function containing `print(` without `return` and a call-site `None` failure. Call fallback only when rules return no result. Parse strict JSON and reject concept IDs outside the MVP union.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`

Expected: PASS for all classifier tests.

- [ ] **Step 5: Commit**

```bash
git add src/misconceptionClassifier.ts src/test/misconceptionClassifier.test.ts
git commit -m "feat: classify supported python misconceptions"
```

### Task 3: DeepSeek Client And Learning Judgment

**Files:**
- Create: `src/deepseekClient.ts`
- Create: `src/hintGenerator.ts`
- Create: `src/test/deepseekClient.test.ts`
- Create: `src/test/hintGenerator.test.ts`

**Interfaces:**
- Consumes: `DiagnosticSnapshot`, `Classification`, `HintIndex`, `Judgment`.
- Produces: `DeepSeekClient`, `HintGenerator`, `JudgeUnderstanding`, `judgeByKeywords`.

- [ ] **Step 1: Write the failing tests**

```typescript
test("DeepSeek client sends the API key as a bearer token", async () => {
  let authorization = "";
  const client = new DeepSeekClient("secret", async (_url, init) => {
    authorization = String(new Headers(init?.headers).get("authorization"));
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
  });
  await client.completeJson("system", "user");
  assert.equal(authorization, "Bearer secret");
});

test("keyword fallback recognizes a correct off-by-one explanation", () => {
  assert.equal(judgeByKeywords("off_by_one", "循环多跑了一次，range 结束值不对"), "correct");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Write minimal implementation**

Implement a fetch-injected `DeepSeekClient` targeting `https://api.deepseek.com/chat/completions` with `deepseek-chat`, JSON extraction, timeout handling, and clear errors. Implement three fixed directions per concept with dynamic prompts. Implement understanding judgment and keyword fallback exactly per spec.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`

Expected: PASS without network calls.

- [ ] **Step 5: Commit**

```bash
git add src/deepseekClient.ts src/hintGenerator.ts src/test/deepseekClient.test.ts src/test/hintGenerator.test.ts
git commit -m "feat: add deepseek reasoning adapters"
```

### Task 4: Learner Model And State Machine

**Files:**
- Create: `src/learnerModel.ts`
- Create: `src/stateMachine.ts`
- Create: `src/test/learnerModel.test.ts`
- Create: `src/test/stateMachine.test.ts`

**Interfaces:**
- Consumes: `LearnerModel`, `CurrentLevel`, `Judgment`, `ResolutionKind`.
- Produces: `emptyLearnerModel`, `confidenceDeltaFor`, `applyConfidenceUpdate`, `CoachStateMachine`.

- [ ] **Step 1: Write the failing tests**

```typescript
test("correct understanding with a fixed program adds 0.15", () => {
  assert.equal(confidenceDeltaFor({ judgment: "correct", fixed: true, usedHint: false, skipped: false }), 0.15);
});

test("wrong judgment subtracts 0.10 and never goes below zero", () => {
  const model = emptyLearnerModel("local");
  applyConfidenceUpdate(model, "off_by_one", -0.1);
  assert.equal(model.concepts.off_by_one.confidence, 0);
});

test("state machine keeps the level when a direct fix misses", () => {
  const machine = CoachStateMachine.start("off_by_one", "main.py", 10);
  machine.recordDirectFailure();
  assert.equal(machine.snapshot().attempts, 1);
  assert.equal(machine.snapshot().hintIndex, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`

Expected: FAIL because model and state machine are missing.

- [ ] **Step 3: Write minimal implementation**

Implement JSON-safe model creation, confidence update table, score constraints, direct-answer lock (`attempts >= 2`), hint escalation capped at 3, same-level time window, skip streak scoring, and stage transitions.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`

Expected: PASS for model and state machine tests.

- [ ] **Step 5: Commit**

```bash
git add src/learnerModel.ts src/stateMachine.ts src/test/learnerModel.test.ts src/test/stateMachine.test.ts
git commit -m "feat: track learner confidence and level state"
```

### Task 5: Learning Log And Demo Data

**Files:**
- Create: `src/learningLog.ts`
- Create: `src/demoData.ts`
- Create: `src/test/learningLog.test.ts`
- Create: `src/test/demoData.test.ts`

**Interfaces:**
- Consumes: `LearningLogEntry`, `LearnerModel`, `MisconceptionId`, `HintIndex`.
- Produces: `appendLearningLog`, `sortTimeline`, `summarizeProgress`, `demoHint`, `demoJudgment`.

- [ ] **Step 1: Write the failing tests**

```typescript
test("timeline sorts newest entries first", () => {
  const timeline = sortTimeline([
    entry("2026-09-23T09:00:00.000Z"),
    entry("2026-09-23T10:00:00.000Z"),
  ]);
  assert.equal(timeline[0].timestamp, "2026-09-23T10:00:00.000Z");
});

test("demo data covers every concept and hint direction", () => {
  for (const concept of ["off_by_one", "return_vs_print", "type_mismatch"] as const) {
    for (const hintIndex of [1, 2, 3] as const) {
      assert.ok(demoHint(concept, hintIndex, sampleContext(concept)).length > 10);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`

Expected: FAIL because log and demo modules are missing.

- [ ] **Step 3: Write minimal implementation**

Implement append, load, sort, progress summary, and the `已掌握`/`建议重点复习` labels. Add `3 x 3` demo hints, three demo judgments, and offline matching by concept plus code feature flags.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`

Expected: PASS and no API calls.

- [ ] **Step 5: Commit**

```bash
git add src/learningLog.ts src/demoData.ts src/test/learningLog.test.ts src/test/demoData.test.ts
git commit -m "feat: add learning timeline and offline demo data"
```

### Task 6: Diagnostics, Decorations, And Extension Wiring

**Files:**
- Create: `src/diagnosticListener.ts`
- Create: `src/extension.ts`
- Create: `src/test/diagnosticListener.test.ts`
- Create: `media/question.svg`
- Create: `media/coach.svg`

**Interfaces:**
- Consumes: classifier, state machine, model store, hint generator, panel controller.
- Produces: `extractPythonDiagnostics`, `DiagnosticListener`, extension activation commands.

- [ ] **Step 1: Write the failing test**

```typescript
test("extractPythonDiagnostics keeps only Python error and warning diagnostics", () => {
  const result = extractPythonDiagnostics("python", [
    { severity: 0, message: "IndexError", range: { start: { line: 3 } } },
    { severity: 3, message: "hint", range: { start: { line: 4 } } },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].errorLine, 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`

Expected: FAIL because diagnostics extraction is missing.

- [ ] **Step 3: Write minimal implementation**

Register `onDidChangeDiagnostics`, filter Python diagnostics, read the local file and nearby lines, classify, open/reuse a level, and apply a red line background plus gutter SVG. Do not call `setDecorations` with inline text. Wire SecretStorage, JSON directory creation, controller construction, and commands in `extension.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`

Expected: PASS for diagnostics parsing and compile.

- [ ] **Step 5: Commit**

```bash
git add src/diagnosticListener.ts src/extension.ts src/test/diagnosticListener.test.ts media/question.svg media/coach.svg
git commit -m "feat: connect diagnostics to coaching state"
```

### Task 7: Side Panel And State Machine UI

**Files:**
- Create: `src/panelProvider.ts`
- Create: `media/panel.html`
- Create: `media/panel.css`
- Create: `media/panel.js`

**Interfaces:**
- Consumes: `PanelState`, `JudgeUnderstanding`, `HintGenerator`, `LearnerModelStore`, `LearningLogStore`.
- Produces: `PanelProvider`, `LearningLogProvider`.

- [ ] **Step 1: Write the failing test**

```typescript
test("answer stays locked before the user has two attempts", () => {
  const state = panelState({ attempts: 1, answerUnlocked: false });
  assert.equal(state.canRevealAnswer, false);
  assert.equal(state.answerLabel, "看答案 (0/3)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`

Expected: FAIL because panel state serialization is missing.

- [ ] **Step 3: Write minimal implementation**

Implement both providers, CSP-safe static assets, Chinese copy, state renderers for diagnose/guiding/verifying/completed, API-key setup callout, answer lock, hint rotation, understanding form, timeline view, score badge, and accessible `aria-label` text on icon buttons.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`

Expected: PASS and TypeScript build clean.

- [ ] **Step 5: Commit**

```bash
git add src/panelProvider.ts media/panel.html media/panel.css media/panel.js
git commit -m "feat: add coaching and learning log webviews"
```

### Task 8: Documentation And Development Log

**Files:**
- Create: `README.md`
- Create: `docs/DEVELOPMENT_LOG.md`
- Modify: `package.json`

**Interfaces:**
- Produces: run instructions, configuration instructions, stage log.

- [ ] **Step 1: Verify README acceptance**

Run: `rg -n "设置 API Key|演示模式|F5|npm run test|npm run compile" README.md`

Expected: all required operational instructions found.

- [ ] **Step 2: Verify development log acceptance**

Run: `rg -n "^## " docs/DEVELOPMENT_LOG.md`

Expected: only major stages are listed, no sub-stage checklist.

- [ ] **Step 3: Run full verification**

Run: `npm run compile && npm run test`

Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/DEVELOPMENT_LOG.md package.json
git commit -m "docs: add extension usage and stage log"
```
