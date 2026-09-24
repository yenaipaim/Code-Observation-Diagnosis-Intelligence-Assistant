import {
  CurrentLevel,
  HintIndex,
  Judgment,
  MisconceptionId
} from "./types";

function nextHint(hintIndex: HintIndex): HintIndex {
  return Math.min(3, hintIndex + 1) as HintIndex;
}

export class CoachStateMachine {
  private judgment?: Judgment;

  private constructor(private readonly level: CurrentLevel) {}

  static start(
    concept: MisconceptionId,
    file: string,
    errorLine: number,
    startedAt = new Date().toISOString(),
    challenge: {
      key?: string;
      repeatCount?: number;
      scoreMultiplier?: number;
    } = {}
  ): CoachStateMachine {
    return new CoachStateMachine({
      concept,
      file,
      errorLine,
      startedAt,
      challengeKey: challenge.key ?? "",
      repeatCount: challenge.repeatCount ?? 0,
      scoreMultiplier: challenge.scoreMultiplier ?? 1,
      attempts: 0,
      hintIndex: 1,
      status: "in_progress",
      hintUsed: false,
      answerRevealed: false
    });
  }

  snapshot(): CurrentLevel {
    return { ...this.level };
  }

  recordDirectFailure(): void {
    this.level.attempts += 1;
    this.level.hintIndex = nextHint(this.level.hintIndex);
    this.level.status = "in_progress";
  }

  submitJudgment(judgment: Judgment): void {
    this.judgment = judgment;
    if (judgment === "wrong") {
      this.level.attempts += 1;
      this.level.hintIndex = nextHint(this.level.hintIndex);
      this.level.status = "in_progress";
      return;
    }

    this.level.status = "verifying";
  }

  markCodeFixed(hadUnderstanding = false): void {
    if (
      hadUnderstanding ||
      this.judgment === "correct" ||
      this.judgment === "partial"
    ) {
      this.level.status = "completed";
      return;
    }

    this.level.status = "verifying";
  }

  useHint(): HintIndex {
    this.level.hintUsed = true;
    return this.level.hintIndex;
  }

  advanceHint(): HintIndex {
    this.level.hintUsed = true;
    this.level.hintIndex = nextHint(this.level.hintIndex);
    return this.level.hintIndex;
  }

  canRevealAnswer(): boolean {
    return this.level.status !== "completed";
  }

  revealAnswer(): boolean {
    if (!this.canRevealAnswer() || this.level.answerRevealed) {
      return false;
    }

    this.level.answerRevealed = true;
    this.level.status = "completed";
    return true;
  }
}
