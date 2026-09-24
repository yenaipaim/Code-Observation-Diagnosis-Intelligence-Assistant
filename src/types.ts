export const MISCONCEPTION_IDS = [
  "off_by_one",
  "return_vs_print",
  "type_mismatch",
  "name_error",
  "syntax_error",
  "key_error",
  "value_error",
  "zero_division",
  "attribute_error",
  "import_error",
  "indentation_error"
] as const;

export type MisconceptionId = (typeof MISCONCEPTION_IDS)[number];
export type HintIndex = 1 | 2 | 3;
export type Judgment = "correct" | "partial" | "wrong";
export type ResolutionKind =
  | "independent"
  | "after_hint"
  | "viewed_answer"
  | "unverified";
export type LevelStatus = "in_progress" | "verifying" | "completed";
export type PanelStage =
  | "diagnose"
  | "guiding"
  | "verifying"
  | "completed"
  | "duplicate"
  | "configuration"
  | "empty";

export interface DiagnosticSnapshot {
  message: string;
  errorLine: number;
  code: string;
  file?: string;
  severity?: number;
  source?: string;
}

export interface Classification {
  concept: MisconceptionId;
  confidence: number;
  source: "rule" | "llm";
}

export interface LevelFingerprint {
  concept: MisconceptionId;
  file: string;
  errorLine: number;
  startedAt: string;
}

export interface CurrentLevel extends LevelFingerprint {
  challengeKey: string;
  repeatCount: number;
  scoreMultiplier: number;
  attempts: number;
  hintIndex: HintIndex;
  status: LevelStatus;
  hintUsed: boolean;
  answerRevealed: boolean;
}

export interface LearnerConceptState {
  attempts: number;
  failures: number;
  last_seen: string;
  confidence: number;
  consecutive_skips: number;
  consecutive_answers: number;
}

export interface LearnerModel {
  user_id: string;
  concepts: Partial<Record<MisconceptionId, LearnerConceptState>>;
  challenges: Partial<
    Record<string, { completions: number; last_seen: string }>
  >;
  trackedConcepts: MisconceptionId[];
}

export interface LearningLogEntry {
  id: string;
  timestamp: string;
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
}

export interface AnswerContent {
  code: string;
  explanation: string;
}

export interface DuplicateErrorReference {
  entryId: string;
  fileName: string;
  errorLine: number;
  timestamp: string;
}

export interface PanelState {
  stage: PanelStage;
  level?: CurrentLevel;
  conceptLabel?: string;
  message: string;
  hint?: string;
  attempts: number;
  hintIndex: HintIndex;
  canRevealAnswer: boolean;
  canSkipUnderstanding: boolean;
  answerLabel: string;
  confidence: number;
  badge?: "已掌握" | "建议再练";
  apiKeyConfigured: boolean;
  demoMode: boolean;
  closeness?: number;
  answer?: AnswerContent;
  duplicate?: DuplicateErrorReference;
}

export interface UnderstandingResult {
  judgment: Judgment;
  reason: string;
  closeness?: number;
}

export const CONCEPT_LABELS: Record<MisconceptionId, string> = {
  off_by_one: "差一错误",
  return_vs_print: "返回值 vs 打印",
  type_mismatch: "类型混淆",
  name_error: "未定义名称",
  syntax_error: "语法错误",
  key_error: "字典键错误",
  value_error: "值转换错误",
  zero_division: "除零错误",
  attribute_error: "属性错误",
  import_error: "导入错误",
  indentation_error: "缩进错误"
};

export function clampConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

export function isMisconceptionId(value: unknown): value is MisconceptionId {
  return (
    typeof value === "string" &&
    (MISCONCEPTION_IDS as readonly string[]).includes(value)
  );
}

export function sameLevel(
  left: LevelFingerprint,
  right: LevelFingerprint
): boolean {
  if (left.concept === right.concept) {
    return true;
  }

  if (
    left.file === right.file &&
    Math.abs(left.errorLine - right.errorLine) <= 5
  ) {
    return true;
  }

  const elapsed = Math.abs(
    new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
  );
  return Number.isFinite(elapsed) && elapsed <= 3 * 60 * 1000;
}
