import { promises as fs } from "node:fs";
import path from "node:path";
import {
  clampConfidence,
  Judgment,
  LanguageConceptKey,
  LearnerConceptState,
  LearnerModel,
  LANGUAGE_CONCEPT_IDS,
  MISCONCEPTION_IDS,
  MisconceptionId,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
  isMisconceptionId,
  isSupportedLanguage,
  languageConceptKey,
  parseLanguageConceptKey
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
  language?: SupportedLanguage;
  concept: MisconceptionId;
  judgment?: Judgment;
  fixed: boolean;
  usedHint?: boolean;
  skipped?: boolean;
  viewedAnswer?: boolean;
  scoreMultiplier?: number;
  now?: string;
}

export const MIN_POSITIVE_CONFIDENCE_DELTA = 0.05;

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
  concept: LanguageConceptKey,
  tracked: boolean
): void {
  const selected = new Set(model.trackedConcepts);
  if (tracked) {
    selected.add(concept);
  } else {
    selected.delete(concept);
  }
  model.trackedConcepts = sortLanguageConceptKeys(selected);
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
    delta = MIN_POSITIVE_CONFIDENCE_DELTA;
  } else if (input.judgment === "wrong") {
    delta = -0.1;
  } else if (input.fixed && input.skipped) {
    delta = 0.1;
  } else if (input.fixed && input.judgment === "partial") {
    delta = 0.08;
  } else if (input.fixed && input.judgment === "correct") {
    delta = input.usedHint ? MIN_POSITIVE_CONFIDENCE_DELTA : 0.15;
  }

  return delta * (input.scoreMultiplier ?? 1);
}

export function applyConfidenceUpdate(
  model: LearnerModel,
  concept: MisconceptionId | LanguageConceptKey,
  delta: number,
  now = new Date().toISOString()
): LearnerConceptState {
  const key = normalizeLanguageConceptKey(concept);
  const current =
    model.concepts[key] ?? emptyConceptState(now);
  current.confidence = clampConfidence(current.confidence + delta);
  current.last_seen = now.slice(0, 10);
  model.concepts[key] = current;
  return current;
}

export function recordOutcome(
  model: LearnerModel,
  input: OutcomeInput
): LearnerConceptState {
  const now = input.now ?? new Date().toISOString();
  const key = languageConceptKey(
    input.language ?? "python",
    input.concept
  );
  const current =
    model.concepts[key] ?? emptyConceptState(now);

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
        MIN_POSITIVE_CONFIDENCE_DELTA *
          (input.scoreMultiplier ?? 1) *
          100
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
  model.concepts[key] = current;
  return current;
}

export class LearnerModelStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<LearnerModel> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      return normalizeLearnerModel(JSON.parse(content));
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

function sortLanguageConceptKeys(
  keys: Iterable<LanguageConceptKey>
): LanguageConceptKey[] {
  const selected = new Set(keys);
  const sorted: LanguageConceptKey[] = [];
  for (const language of SUPPORTED_LANGUAGES) {
    for (const concept of LANGUAGE_CONCEPT_IDS[language]) {
      const key = languageConceptKey(language, concept);
      if (selected.has(key)) {
        sorted.push(key);
      }
    }
  }
  return sorted;
}

function normalizeLanguageConceptKey(
  value: MisconceptionId | LanguageConceptKey
): LanguageConceptKey {
  if (isMisconceptionId(value)) {
    return languageConceptKey("python", value);
  }

  const parsed = parseLanguageConceptKey(value);
  if (!parsed) {
    throw new Error(`Invalid language concept key: ${value}`);
  }
  return languageConceptKey(parsed.language, parsed.concept);
}

export function normalizeLearnerModel(value: unknown): LearnerModel {
  const parsed =
    value && typeof value === "object"
      ? (value as {
          user_id?: unknown;
          concepts?: unknown;
          challenges?: unknown;
          trackedConcepts?: unknown;
        })
      : {};
  const concepts: LearnerModel["concepts"] = {};
  const legacyConcepts: LearnerModel["concepts"] = {};

  if (parsed.concepts && typeof parsed.concepts === "object") {
    for (const [rawKey, rawState] of Object.entries(parsed.concepts)) {
      if (!rawState || typeof rawState !== "object") {
        continue;
      }
      if (isMisconceptionId(rawKey)) {
        legacyConcepts[languageConceptKey("python", rawKey)] =
          rawState as LearnerConceptState;
        continue;
      }
      const parsedKey = parseLanguageConceptKey(rawKey);
      if (parsedKey) {
        concepts[
          languageConceptKey(parsedKey.language, parsedKey.concept)
        ] = rawState as LearnerConceptState;
      }
    }
  }

  const tracked = new Set<LanguageConceptKey>();
  if (Array.isArray(parsed.trackedConcepts)) {
    for (const value of parsed.trackedConcepts) {
      if (isMisconceptionId(value)) {
        tracked.add(languageConceptKey("python", value));
        continue;
      }
      const parsedKey = parseLanguageConceptKey(value);
      if (parsedKey) {
        tracked.add(
          languageConceptKey(parsedKey.language, parsedKey.concept)
        );
      }
    }
  }

  return {
    user_id:
      typeof parsed.user_id === "string" ? parsed.user_id : "local",
    concepts: { ...legacyConcepts, ...concepts },
    challenges: normalizeChallenges(parsed.challenges),
    trackedConcepts: sortLanguageConceptKeys(tracked)
  };
}

function normalizeChallenges(value: unknown): LearnerModel["challenges"] {
  const challenges: LearnerModel["challenges"] = {};
  if (!value || typeof value !== "object") {
    return challenges;
  }

  for (const [rawKey, rawState] of Object.entries(value)) {
    if (!rawState || typeof rawState !== "object") {
      continue;
    }
    const state = rawState as {
      completions?: unknown;
      last_seen?: unknown;
    };
    if (
      typeof state.completions !== "number" ||
      typeof state.last_seen !== "string"
    ) {
      continue;
    }
    challenges[normalizeChallengeKey(rawKey)] = {
      completions: state.completions,
      last_seen: state.last_seen
    };
  }

  return challenges;
}

function normalizeChallengeKey(key: string): string {
  if (/^(?:python|java|javascript)\n/.test(key)) {
    return key;
  }

  const file = key.split("\n", 1)[0].toLowerCase();
  const language: SupportedLanguage = file.endsWith(".java")
    ? "java"
    : file.endsWith(".js") ||
        file.endsWith(".mjs") ||
        file.endsWith(".cjs")
      ? "javascript"
      : "python";
  return `${language}\n${key}`;
}
