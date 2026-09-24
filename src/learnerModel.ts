import { promises as fs } from "node:fs";
import path from "node:path";
import {
  clampConfidence,
  Judgment,
  LearnerConceptState,
  LearnerModel,
  MISCONCEPTION_IDS,
  MisconceptionId,
  isMisconceptionId
} from "./types";

export interface ConfidenceInput {
  judgment?: Judgment;
  fixed: boolean;
  usedHint: boolean;
  skipped: boolean;
  viewedAnswer: boolean;
  scoreMultiplier?: number;
}

export interface OutcomeInput {
  concept: MisconceptionId;
  judgment?: Judgment;
  fixed: boolean;
  usedHint?: boolean;
  skipped?: boolean;
  viewedAnswer?: boolean;
  scoreMultiplier?: number;
  now?: string;
}

export function emptyLearnerModel(userId = "local"): LearnerModel {
  return {
    user_id: userId,
    concepts: {},
    challenges: {},
    trackedConcepts: []
  };
}

export function setConceptTracked(
  model: LearnerModel,
  concept: MisconceptionId,
  tracked: boolean
): void {
  const selected = new Set(model.trackedConcepts);
  if (tracked) {
    selected.add(concept);
  } else {
    selected.delete(concept);
  }
  model.trackedConcepts = MISCONCEPTION_IDS.filter((id) =>
    selected.has(id)
  );
}

export function challengeRepeatCount(
  model: LearnerModel,
  challengeKey: string
): number {
  return model.challenges[challengeKey]?.completions ?? 0;
}

export function recordChallengeCompletion(
  model: LearnerModel,
  challengeKey: string,
  now = new Date().toISOString()
): void {
  const current = model.challenges[challengeKey] ?? {
    completions: 0,
    last_seen: now
  };
  current.completions += 1;
  current.last_seen = now;
  model.challenges[challengeKey] = current;
}

function emptyConceptState(now: string): LearnerConceptState {
  return {
    attempts: 0,
    failures: 0,
    last_seen: now.slice(0, 10),
    confidence: 0,
    consecutive_skips: 0,
    consecutive_answers: 0
  };
}

export function confidenceDeltaFor(input: ConfidenceInput): number {
  let delta = 0;

  if (input.viewedAnswer) {
    delta = 0;
  } else if (input.judgment === "wrong") {
    delta = -0.1;
  } else if (input.fixed && input.skipped) {
    delta = 0.1;
  } else if (input.fixed && input.judgment === "partial") {
    delta = 0.08;
  } else if (input.fixed && input.judgment === "correct") {
    delta = input.usedHint ? 0.05 : 0.15;
  }

  return delta * (input.scoreMultiplier ?? 1);
}

export function applyConfidenceUpdate(
  model: LearnerModel,
  concept: MisconceptionId,
  delta: number,
  now = new Date().toISOString()
): LearnerConceptState {
  const current =
    model.concepts[concept] ?? emptyConceptState(now);
  current.confidence = clampConfidence(current.confidence + delta);
  current.last_seen = now.slice(0, 10);
  model.concepts[concept] = current;
  return current;
}

export function recordOutcome(
  model: LearnerModel,
  input: OutcomeInput
): LearnerConceptState {
  const now = input.now ?? new Date().toISOString();
  const current =
    model.concepts[input.concept] ?? emptyConceptState(now);

  current.attempts += 1;
  if (!input.fixed || input.judgment === "wrong" || input.viewedAnswer) {
    current.failures += 1;
  }

  let delta = confidenceDeltaFor({
    judgment: input.judgment,
    fixed: input.fixed,
    usedHint: input.usedHint ?? false,
    skipped: input.skipped ?? false,
    viewedAnswer: input.viewedAnswer ?? false,
    scoreMultiplier: input.scoreMultiplier
  });
  if ((input.skipped ?? false) && current.consecutive_skips >= 3) {
    delta =
      Math.round(
        0.05 * (input.scoreMultiplier ?? 1) * 100
      ) / 100;
  }

  current.confidence = clampConfidence(current.confidence + delta);
  current.last_seen = now.slice(0, 10);
  current.consecutive_skips = input.skipped
    ? current.consecutive_skips + 1
    : 0;
  current.consecutive_answers = input.viewedAnswer
    ? current.consecutive_answers + 1
    : 0;
  model.concepts[input.concept] = current;
  return current;
}

export class LearnerModelStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<LearnerModel> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as Partial<LearnerModel>;
      return {
        user_id: parsed.user_id ?? "local",
        concepts: parsed.concepts ?? {},
        challenges: parsed.challenges ?? {},
        trackedConcepts: Array.isArray(parsed.trackedConcepts)
          ? parsed.trackedConcepts.filter(isMisconceptionId)
          : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyLearnerModel();
      }
      throw error;
    }
  }

  async save(model: LearnerModel): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      `${JSON.stringify(model, null, 2)}\n`,
      "utf8"
    );
  }
}
