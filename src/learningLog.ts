import { promises as fs } from "node:fs";
import path from "node:path";
import {
  CONCEPT_LABELS,
  HintIndex,
  DiagnosticSnapshot,
  LearningLogEntry,
  LearnerModel,
  MISCONCEPTION_IDS,
  MisconceptionId,
  ResolutionKind
} from "./types";

export interface NewLearningLogEntry {
  fileName: string;
  concept: MisconceptionId;
  resolution: ResolutionKind;
  understandingSummary: string;
  confidenceDelta: number;
  hintIndex: HintIndex;
  attempts: number;
  errorLine?: number;
  errorMessage?: string;
  errorCode?: string;
  challengeKey?: string;
  repeatCount?: number;
  scoreMultiplier?: number;
  challengeCompleted?: boolean;
  now?: string;
}

export interface ProgressSummary {
  concept: MisconceptionId;
  label: string;
  confidence: number;
  status: "已掌握" | "建议重点复习" | "学习推进中";
}

export interface ConceptOption {
  concept: MisconceptionId;
  label: string;
  selected: boolean;
  confidence: number;
}

export function createLearningLogEntry(
  input: NewLearningLogEntry
): LearningLogEntry {
  const timestamp = input.now ?? new Date().toISOString();
  return {
    id: `${timestamp}-${input.concept}-${Math.random().toString(16).slice(2)}`,
    timestamp,
    fileName: input.fileName,
    concept: input.concept,
    resolution: input.resolution,
    understandingSummary: input.understandingSummary,
    confidenceDelta: input.confidenceDelta,
    hintIndex: input.hintIndex,
    attempts: input.attempts,
    errorLine: input.errorLine,
    errorMessage: input.errorMessage,
    errorCode: input.errorCode,
    challengeKey: input.challengeKey,
    repeatCount: input.repeatCount,
    scoreMultiplier: input.scoreMultiplier,
    challengeCompleted: input.challengeCompleted
  };
}

export function appendLearningLog(
  entries: readonly LearningLogEntry[],
  entry: LearningLogEntry
): LearningLogEntry[] {
  return [...entries, entry];
}

export function deleteLearningLogEntry(
  entries: readonly LearningLogEntry[],
  entryId: string
): LearningLogEntry[] {
  return entries.filter((entry) => entry.id !== entryId);
}

export function sortTimeline(
  entries: readonly LearningLogEntry[]
): LearningLogEntry[] {
  return [...entries].sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
  );
}

export function normalizeErrorCode(
  code: string,
  errorLine: number,
  radius = 2
): string {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  const start = Math.max(0, errorLine - 1 - radius);
  const end = Math.min(lines.length, errorLine + radius);

  return lines
    .slice(start, end)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

export interface ChallengeIdentityInput {
  file?: string;
  concept: MisconceptionId;
  errorLine: number;
  code: string;
  message?: string;
}

export function createChallengeKey(input: ChallengeIdentityInput): string {
  const message = (input.message ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return [
    normalizeFile(input.file),
    input.concept,
    message,
    normalizeErrorCode(input.code, input.errorLine)
  ].join("\n");
}

export function scoreMultiplierForRepeat(repeatCount: number): number {
  return (
    Math.round(
      Math.pow(0.5, Math.max(0, repeatCount)) * 10000
    ) / 10000
  );
}

export function challengeCompletionCount(
  entries: readonly LearningLogEntry[],
  challengeKey: string
): number {
  return entries.filter(
    (entry) =>
      learningEntryChallengeKey(entry) === challengeKey &&
      learningEntryCompleted(entry)
  ).length;
}

export function findDuplicateLearningLogEntry(
  entries: readonly LearningLogEntry[],
  snapshot: Pick<
    DiagnosticSnapshot,
    "file" | "errorLine" | "code"
  > & { concept?: MisconceptionId }
): LearningLogEntry | undefined {
  const currentFile = normalizeFile(snapshot.file);
  const currentCode = normalizeErrorCode(
    snapshot.code,
    snapshot.errorLine
  );

  return sortTimeline(entries).find((entry) => {
    if (
      normalizeFile(entry.fileName) !== currentFile ||
      entry.errorLine !== snapshot.errorLine ||
      (snapshot.concept !== undefined &&
        entry.concept !== snapshot.concept) ||
      !entry.errorCode
    ) {
      return false;
    }

    return (
      normalizeErrorCode(entry.errorCode, entry.errorLine) === currentCode
    );
  });
}

export function summarizeProgress(model: LearnerModel): ProgressSummary[] {
  return model.trackedConcepts.map((concept) => {
    const state = model.concepts[concept];
    const confidence = state?.confidence ?? 0;
    const status =
      (state?.consecutive_answers ?? 0) >= 3
        ? "建议重点复习"
        : confidence >= 0.8
          ? "已掌握"
          : "学习推进中";

    return {
      concept,
      label: CONCEPT_LABELS[concept],
      confidence,
      status
    };
  });
}

export function summarizeConceptOptions(
  model: LearnerModel
): ConceptOption[] {
  return MISCONCEPTION_IDS.map((concept) => ({
    concept,
    label: CONCEPT_LABELS[concept],
    selected: model.trackedConcepts.includes(concept),
    confidence: model.concepts[concept]?.confidence ?? 0
  }));
}

export class LearningLogStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<LearningLogEntry[]> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as unknown;
      return Array.isArray(parsed) ? (parsed as LearningLogEntry[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async save(entries: readonly LearningLogEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      `${JSON.stringify(entries, null, 2)}\n`,
      "utf8"
    );
  }

  async append(entry: LearningLogEntry): Promise<LearningLogEntry[]> {
    const entries = appendLearningLog(await this.load(), entry);
    await this.save(entries);
    return entries;
  }

  async remove(entryId: string): Promise<LearningLogEntry[]> {
    const entries = deleteLearningLogEntry(await this.load(), entryId);
    await this.save(entries);
    return entries;
  }

  async clear(): Promise<void> {
    await this.save([]);
  }
}

function normalizeFile(fileName: string | undefined): string {
  return (fileName ?? "unknown.py")
    .replace(/\\/g, "/")
    .toLowerCase();
}

function learningEntryChallengeKey(
  entry: LearningLogEntry
): string | undefined {
  if (entry.challengeKey) {
    return entry.challengeKey;
  }
  if (!entry.errorCode || entry.errorLine === undefined) {
    return undefined;
  }
  return createChallengeKey({
    file: entry.fileName,
    concept: entry.concept,
    errorLine: entry.errorLine,
    code: entry.errorCode,
    message: entry.errorMessage
  });
}

function learningEntryCompleted(entry: LearningLogEntry): boolean {
  if (entry.challengeCompleted !== undefined) {
    return entry.challengeCompleted;
  }
  return entry.resolution !== "viewed_answer" && entry.confidenceDelta > 0;
}
