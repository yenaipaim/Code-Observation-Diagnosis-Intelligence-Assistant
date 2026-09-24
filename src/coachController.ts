import {
  CoachStateMachine
} from "./stateMachine";
import {
  challengeRepeatCount,
  emptyLearnerModel,
  recordChallengeCompletion,
  recordOutcome,
  setConceptTracked
} from "./learnerModel";
import {
  challengeCompletionCount,
  createChallengeKey,
  createLearningLogEntry,
  scoreMultiplierForRepeat
} from "./learningLog";
import {
  AnswerContent,
  Classification,
  CONCEPT_LABELS,
  CurrentLevel,
  DiagnosticSnapshot,
  DuplicateErrorReference,
  Judgment,
  LearningLogEntry,
  LearnerModel,
  PanelState
} from "./types";

export interface ClassificationService {
  (input: DiagnosticSnapshot): Promise<Classification | undefined>;
}

export interface HintService {
  generateHint(
    snapshot: DiagnosticSnapshot,
    concept: Classification["concept"],
    hintIndex: CurrentLevel["hintIndex"]
  ): Promise<string>;
  generateAnswer(
    snapshot: DiagnosticSnapshot,
    concept: Classification["concept"]
  ): Promise<AnswerContent>;
}

export interface JudgmentService {
  (
    concept: Classification["concept"],
    attempt: {
      text?: string;
      code?: string;
      codeFixed?: boolean;
    },
    snapshot?: DiagnosticSnapshot,
    referenceAnswer?: AnswerContent
  ): Promise<{ judgment: Judgment; reason: string; closeness?: number }>;
}

export interface LearnerModelStore {
  load(): Promise<LearnerModel>;
  save(model: LearnerModel): Promise<void>;
}

export interface LearningLogStoreLike {
  append(entry: LearningLogEntry): Promise<LearningLogEntry[]>;
  load(): Promise<LearningLogEntry[]>;
}

export interface CoachControllerOptions {
  classifier: ClassificationService;
  hintService: HintService;
  judgmentService: JudgmentService;
  modelStore: LearnerModelStore;
  logStore: LearningLogStoreLike;
  hasApiKey: () => Promise<boolean>;
  demoMode: boolean | (() => boolean);
  publish: (state: PanelState) => void;
}

const EXPLANATIONS: Record<Classification["concept"], string> = {
  off_by_one: "你访问的位置超出了容器实际拥有的范围。",
  return_vs_print: "函数把结果显示出来了，但没有把结果交给调用者。",
  type_mismatch: "参与运算的两个值类型不同，当前运算不能直接处理。",
  name_error: "你使用了 Python 当前找不到的名称或变量。",
  syntax_error: "Python 无法按语法规则解析这行代码。",
  key_error: "你访问了字典里不存在的键。",
  value_error: "值的格式或范围不符合当前操作要求。",
  zero_division: "除法或取模运算的除数是零。",
  attribute_error: "这个对象没有你正在访问的属性或方法。",
  import_error: "Python 无法找到或加载要导入的模块。",
  indentation_error: "代码块的缩进层级不符合 Python 语法。"
};

export class CoachController {
  private model: LearnerModel = emptyLearnerModel();
  private loaded = false;
  private snapshot?: DiagnosticSnapshot;
  private machine?: CoachStateMachine;
  private lastJudgment?: Judgment;
  private stage: PanelState["stage"] = "empty";
  private message = "等待 Python 报错。";
  private hint?: string;
  private answer?: AnswerContent;
  private referenceAnswer?: AnswerContent;
  private codeFixed = false;
  private closeness?: number;
  private completionInFlight?: Promise<void>;
  private duplicate?: DuplicateErrorReference;
  private duplicateConcept?: Classification["concept"];

  constructor(private readonly options: CoachControllerOptions) {}

  private isDemoMode(): boolean {
    return typeof this.options.demoMode === "function"
      ? this.options.demoMode()
      : this.options.demoMode;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.model = await this.options.modelStore.load();
    this.loaded = true;
  }

  async currentState(): Promise<PanelState> {
    await this.ensureLoaded();
    return this.buildState();
  }

  currentFile(): string | undefined {
    return this.snapshot?.file;
  }

  async setTrackedConcept(
    concept: Classification["concept"],
    tracked: boolean
  ): Promise<PanelState> {
    await this.ensureLoaded();
    setConceptTracked(this.model, concept, tracked);
    await this.options.modelStore.save(this.model);
    this.publish();
    return this.buildState();
  }

  async resetLearningData(): Promise<PanelState> {
    await this.ensureLoaded();
    this.model = emptyLearnerModel(this.model.user_id);
    this.duplicate = undefined;
    this.duplicateConcept = undefined;
    this.closeness = undefined;
    this.referenceAnswer = undefined;
    await this.options.modelStore.save(this.model);
    this.publish();
    return this.buildState();
  }

  async openDiagnostic(snapshot: DiagnosticSnapshot): Promise<PanelState> {
    await this.ensureLoaded();
    const classification = await this.options.classifier(snapshot);
    if (!classification) {
      this.stage = "diagnose";
      this.message = `暂时无法归类这个报错：${snapshot.message}`;
      this.publish();
      return this.buildState();
    }

    if (!this.model.trackedConcepts.includes(classification.concept)) {
      setConceptTracked(this.model, classification.concept, true);
      await this.options.modelStore.save(this.model);
    }

    if (this.completionInFlight) {
      await this.completionInFlight;
    }

    const nextFingerprint = {
      concept: classification.concept,
      file: snapshot.file ?? "unknown.py",
      errorLine: snapshot.errorLine,
      startedAt: new Date().toISOString()
    };

    const previousSnapshot = this.snapshot;
    const diagnosticChanged =
      !previousSnapshot ||
      previousSnapshot.file !== snapshot.file ||
      previousSnapshot.errorLine !== snapshot.errorLine ||
      previousSnapshot.message !== snapshot.message ||
      previousSnapshot.code !== snapshot.code;
    const currentLevel = this.machine?.snapshot();
    if (
      this.machine &&
      currentLevel?.concept === classification.concept &&
      currentLevel.status !== "completed" &&
      this.snapshot &&
      sameLevel(
        {
          ...currentLevel,
          file: this.snapshot.file ?? "unknown.py"
        },
        nextFingerprint
      )
    ) {
      if (diagnosticChanged) {
        this.machine.recordDirectFailure();
        this.snapshot = snapshot;
        this.message = `你已经尝试了 ${this.machine.snapshot().attempts} 次，提示已升级。`;
        await this.requestHint(false);
        return this.buildState();
      }

      this.snapshot = snapshot;
      this.publish();
      return this.buildState();
    }

    await this.closeActiveLevel();
    const history = await this.options.logStore.load();
    const challengeKey = createChallengeKey({
      ...snapshot,
      concept: classification.concept
    });
    const repeatCount = Math.max(
      challengeCompletionCount(history, challengeKey),
      challengeRepeatCount(this.model, challengeKey)
    );
    this.snapshot = snapshot;
    this.machine = CoachStateMachine.start(
      classification.concept,
      nextFingerprint.file,
      snapshot.errorLine,
      nextFingerprint.startedAt,
      {
        key: challengeKey,
        repeatCount,
        scoreMultiplier: scoreMultiplierForRepeat(repeatCount)
      }
    );
    this.lastJudgment = undefined;
    this.hint = undefined;
    this.answer = undefined;
    this.referenceAnswer = undefined;
    this.codeFixed = false;
    this.closeness = undefined;
    this.duplicate = undefined;
    this.duplicateConcept = undefined;

    this.snapshot = snapshot;
    this.stage = "diagnose";
    this.message = [
      EXPLANATIONS[classification.concept],
      `错误位置：${snapshot.file ?? "unknown.py"}:${snapshot.errorLine}`,
      `报错原文：${snapshot.message}`
    ].join("\n");
    this.publish();
    return this.buildState();
  }

  async startChallenge(): Promise<PanelState> {
    return this.requestHint(false);
  }

  async treatDuplicateAsNew(): Promise<PanelState> {
    await this.ensureLoaded();
    const snapshot = this.snapshot;
    const concept = this.duplicateConcept;
    if (!snapshot || !concept) {
      return this.buildState();
    }

    await this.closeActiveLevel();
    const challengeKey = createChallengeKey({
      ...snapshot,
      concept
    });
    const repeatCount = Math.max(
      challengeCompletionCount(
        await this.options.logStore.load(),
        challengeKey
      ),
      challengeRepeatCount(this.model, challengeKey)
    );
    this.snapshot = snapshot;
    this.machine = CoachStateMachine.start(
      concept,
      snapshot.file ?? "unknown.py",
      snapshot.errorLine,
      new Date().toISOString(),
      {
        key: challengeKey,
        repeatCount,
        scoreMultiplier: scoreMultiplierForRepeat(repeatCount)
      }
    );
    this.lastJudgment = undefined;
    this.hint = undefined;
    this.answer = undefined;
    this.referenceAnswer = undefined;
    this.codeFixed = false;
    this.closeness = undefined;
    this.duplicate = undefined;
    this.duplicateConcept = undefined;
    this.stage = "diagnose";
    this.message = [
      EXPLANATIONS[concept],
      `错误位置：${snapshot.file ?? "unknown.py"}:${snapshot.errorLine}`,
      `报错原文：${snapshot.message}`
    ].join("\n");
    this.publish();
    return this.buildState();
  }

  async requestHint(advance = false): Promise<PanelState> {
    await this.ensureLoaded();
    const snapshot = this.snapshot;
    const level = this.machine?.snapshot();
    if (!snapshot || !level) {
      return this.buildState();
    }

    if (!this.isDemoMode() && !(await this.options.hasApiKey())) {
      this.stage = "configuration";
      this.message = "请先配置 API，或在设置中开启演示模式。";
      this.publish();
      return this.buildState();
    }

    try {
      if (advance) {
        this.machine?.advanceHint();
      }
      const activeLevel = this.machine?.snapshot() ?? level;
      this.stage = "guiding";
      this.hint = await this.options.hintService.generateHint(
        snapshot,
        activeLevel.concept,
        activeLevel.hintIndex
      );
      this.machine?.useHint();
      this.message = `提示 ${activeLevel.hintIndex}`;
    } catch (error) {
      this.message = `提示生成失败：${(error as Error).message}`;
    }

    this.publish();
    return this.buildState();
  }

  async submitUnderstanding(userAnswer: string): Promise<PanelState> {
    await this.ensureLoaded();
    if (this.completionInFlight) {
      await this.completionInFlight;
    }
    const level = this.machine?.snapshot();
    if (!level || level.status === "completed") {
      return this.buildState();
    }

    const referenceAnswer = await this.ensureReferenceAnswer();
    const result = await this.options.judgmentService(
      level.concept,
      { text: userAnswer },
      this.snapshot,
      referenceAnswer
    );
    this.lastJudgment = result.judgment;
    this.closeness = result.closeness;
    this.machine?.submitJudgment(result.judgment);

    if (result.judgment === "wrong") {
      recordOutcome(this.model, {
        concept: level.concept,
        judgment: "wrong",
        fixed: false,
        usedHint: level.hintUsed,
        viewedAnswer: false,
        scoreMultiplier: level.scoreMultiplier
      });
      await this.options.modelStore.save(this.model);
      this.stage = "guiding";
      this.message = `这还不是原因所在。${result.reason}`;
      await this.requestHint(false);
    } else {
      if (this.codeFixed) {
        await this.completeLevel();
        return this.buildState();
      }
      this.stage = "verifying";
      this.message =
        result.judgment === "correct"
          ? "方向对了。现在去代码里按你的想法修改，然后运行。"
          : "方向接近了。现在去代码里验证你的判断。";
    }

    this.publish();
    return this.buildState();
  }

  async markCodeFixed(currentCode?: string): Promise<PanelState> {
    await this.ensureLoaded();
    if (this.completionInFlight) {
      await this.completionInFlight;
    }
    const level = this.machine?.snapshot();
    if (!level || level.status === "completed") {
      return this.buildState();
    }

    if (
      currentCode?.trim() &&
      (this.isDemoMode() || (await this.options.hasApiKey()))
    ) {
      const result = await this.options.judgmentService(
        level.concept,
        {
          code: currentCode,
          codeFixed: true
        },
        this.snapshot,
        await this.ensureReferenceAnswer()
      );
      this.closeness = result.closeness;
      if (result.judgment !== "wrong") {
        this.lastJudgment = result.judgment;
        this.machine?.submitJudgment(result.judgment);
        await this.completeLevel();
        return this.buildState();
      }

      this.lastJudgment = undefined;
      this.machine?.markCodeFixed(false);
      this.codeFixed = true;
      this.stage = "verifying";
      this.message = `代码已运行成功，但和标准答案还有距离。${result.reason}`;
      this.publish();
      return this.buildState();
    }

    if (
      this.lastJudgment === "correct" ||
      this.lastJudgment === "partial"
    ) {
      await this.completeLevel();
    } else {
      this.machine?.markCodeFixed(false);
      this.codeFixed = true;
      this.stage = "verifying";
      this.message = "代码跑通了。说说你刚才改了什么？";
      this.publish();
    }

    return this.buildState();
  }

  private async ensureReferenceAnswer(): Promise<
    AnswerContent | undefined
  > {
    if (this.referenceAnswer) {
      return this.referenceAnswer;
    }
    const snapshot = this.snapshot;
    const level = this.machine?.snapshot();
    if (!snapshot || !level) {
      return undefined;
    }

    try {
      this.referenceAnswer = await this.options.hintService.generateAnswer(
        snapshot,
        level.concept
      );
    } catch {
      return undefined;
    }
    return this.referenceAnswer;
  }

  async skipUnderstanding(): Promise<PanelState> {
    await this.ensureLoaded();
    if (this.completionInFlight) {
      await this.completionInFlight;
    }
    if (
      !this.machine ||
      this.machine.snapshot().status === "completed" ||
      this.stage !== "verifying" ||
      !this.codeFixed ||
      this.lastJudgment !== undefined
    ) {
      return this.buildState();
    }
    await this.completeLevel(true);
    return this.buildState();
  }

  async revealAnswer(): Promise<PanelState> {
    await this.ensureLoaded();
    const snapshot = this.snapshot;
    const level = this.machine?.snapshot();
    if (
      !snapshot ||
      !level ||
      level.status === "completed" ||
      !this.machine?.canRevealAnswer()
    ) {
      return this.buildState();
    }

    if (!this.isDemoMode() && !(await this.options.hasApiKey())) {
      this.stage = "configuration";
      this.message = "查看答案需要配置 API，或使用演示模式。";
      this.publish();
      return this.buildState();
    }

    let answer: AnswerContent;
    try {
      answer =
        this.referenceAnswer ??
        (await this.options.hintService.generateAnswer(
          snapshot,
          level.concept
        ));
    } catch (error) {
      this.stage = "guiding";
      this.message = `答案生成失败：${(error as Error).message}`;
      this.publish();
      return this.buildState();
    }

    if (!this.machine.revealAnswer()) {
      return this.buildState();
    }

    this.answer = answer;
    this.referenceAnswer = answer;
    const state = recordOutcome(this.model, {
      concept: level.concept,
      fixed: false,
      usedHint: true,
      viewedAnswer: true,
      scoreMultiplier: level.scoreMultiplier
    });
    await this.options.logStore.append(
      createLearningLogEntry({
        fileName: level.file,
        concept: level.concept,
        resolution: "viewed_answer",
        understandingSummary: "查看答案",
        confidenceDelta: 0,
        hintIndex: level.hintIndex,
        attempts: level.attempts,
        errorLine: level.errorLine,
        errorMessage: snapshot.message,
        errorCode: snapshot.code,
        challengeKey: level.challengeKey,
        repeatCount: level.repeatCount,
        scoreMultiplier: level.scoreMultiplier,
        challengeCompleted: false
      })
    );
    await this.options.modelStore.save(this.model);
    this.stage = "completed";
    this.message = `这一关使用了答案。当前理解度：${Math.round(
      state.confidence * 100
    )}%。`;
    this.publish();
    return this.buildState();
  }

  private async completeLevel(skipped = false): Promise<void> {
    if (this.completionInFlight) {
      await this.completionInFlight;
      return;
    }

    const level = this.machine?.snapshot();
    if (!level || level.status === "completed") {
      return;
    }

    const completion = this.performCompleteLevel(skipped);
    this.completionInFlight = completion;
    try {
      await completion;
    } finally {
      if (this.completionInFlight === completion) {
        this.completionInFlight = undefined;
      }
    }
  }

  private async performCompleteLevel(skipped: boolean): Promise<void> {
    const level = this.machine?.snapshot();
    if (!level || level.status === "completed") {
      return;
    }

    const confidenceBefore =
      this.model.concepts[level.concept]?.confidence ?? 0;
    const judgment = skipped ? undefined : this.lastJudgment;
    const state = recordOutcome(this.model, {
      concept: level.concept,
      judgment,
      fixed: true,
      usedHint: level.hintUsed,
      skipped,
      viewedAnswer: false,
      scoreMultiplier: level.scoreMultiplier
    });
    const resolution = skipped
      ? "unverified"
      : level.hintUsed
        ? "after_hint"
        : "independent";
    const confidenceDelta =
      Math.round((state.confidence - confidenceBefore) * 100) / 100;

    await this.options.logStore.append(
      createLearningLogEntry({
        fileName: level.file,
        concept: level.concept,
        resolution,
        understandingSummary: skipped
          ? "跳过了解释"
          : judgment ?? "完成验证",
        confidenceDelta,
        hintIndex: level.hintIndex,
        attempts: level.attempts,
        errorLine: level.errorLine,
        errorMessage: this.snapshot?.message,
        errorCode: this.snapshot?.code,
        challengeKey: level.challengeKey,
        repeatCount: level.repeatCount,
        scoreMultiplier: level.scoreMultiplier,
        challengeCompleted: true
      })
    );
    recordChallengeCompletion(this.model, level.challengeKey);
    await this.options.modelStore.save(this.model);
    this.machine?.markCodeFixed(!skipped);
    this.stage = "completed";
    const repeatText =
      level.repeatCount > 0
        ? ` 重复关卡，本次得分系数 ${level.scoreMultiplier}。`
        : "";
    const closenessText =
      this.closeness !== undefined
        ? ` 与标准答案接近度 ${Math.round(this.closeness * 100)}%。`
        : "";
    this.message = skipped
      ? `代码跑通了。当前理解度：${Math.round(state.confidence * 100)}%。${repeatText}${closenessText}`
      : `这一关通过了！当前理解度：${Math.round(state.confidence * 100)}%。${repeatText}${closenessText}`;
    this.publish();
  }

  private async closeActiveLevel(): Promise<void> {
    const level = this.machine?.snapshot();
    if (!level || level.status === "completed") {
      return;
    }

    await this.options.logStore.append(
      createLearningLogEntry({
        fileName: level.file,
        concept: level.concept,
        resolution: "unverified",
        understandingSummary: "出现新的误概念，本关结束",
        confidenceDelta: 0,
        hintIndex: level.hintIndex,
        attempts: level.attempts,
        errorLine: level.errorLine,
        errorMessage: this.snapshot?.message,
        errorCode: this.snapshot?.code,
        challengeKey: level.challengeKey,
        repeatCount: level.repeatCount,
        scoreMultiplier: level.scoreMultiplier,
        challengeCompleted: false
      })
    );
  }

  private buildState(): PanelState {
    const level = this.machine?.snapshot();
    const conceptState = level
      ? this.model.concepts[level.concept]
      : undefined;
    const confidence = conceptState?.confidence ?? 0;
    const canRevealAnswer = this.machine?.canRevealAnswer() ?? false;

    return {
      stage: this.stage,
      level,
      conceptLabel: level ? CONCEPT_LABELS[level.concept] : undefined,
      message: this.message,
      hint: this.hint,
      attempts: level?.attempts ?? 0,
      hintIndex: level?.hintIndex ?? 1,
      canRevealAnswer,
      canSkipUnderstanding:
        this.stage === "verifying" &&
        this.codeFixed &&
        this.lastJudgment === undefined,
      answerLabel: canRevealAnswer ? "查看答案" : "答案已查看",
      confidence,
      badge:
        (conceptState?.consecutive_skips ?? 0) >= 3
          ? "建议再练"
          : confidence >= 0.8
            ? "已掌握"
            : undefined,
      apiKeyConfigured: false,
      demoMode: this.isDemoMode(),
      closeness: this.closeness,
      answer: this.answer,
      duplicate: this.duplicate
    };
  }

  private publish(): void {
    this.options.publish(this.buildState());
  }
}

function sameLevel(
  left: CurrentLevel,
  right: {
    concept: Classification["concept"];
    file: string;
    errorLine: number;
    startedAt: string;
  }
): boolean {
  return (
    left.concept === right.concept ||
    (left.file === right.file &&
      Math.abs(left.errorLine - right.errorLine) <= 5) ||
    Math.abs(
      new Date(left.startedAt).getTime() -
        new Date(right.startedAt).getTime()
    ) <=
      3 * 60 * 1000
  );
}
