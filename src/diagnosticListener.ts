import { DiagnosticSnapshot } from "./types";

export interface DiagnosticLike {
  severity: number;
  message: string;
  range: {
    start: {
      line: number;
    };
  };
  source?: string;
}

export interface PythonDiagnostic
  extends Omit<DiagnosticLike, "range"> {
  errorLine: number;
}

export interface DiagnosticEvent {
  filePath: string;
  languageId: string;
  diagnostics: readonly DiagnosticLike[];
  readFile: (filePath: string) => Promise<string>;
}

export type DiagnosticHandler = (
  snapshot: DiagnosticSnapshot
) => Promise<void>;

export function extractPythonDiagnostics(
  languageId: string,
  diagnostics: readonly DiagnosticLike[]
): PythonDiagnostic[] {
  if (languageId !== "python") {
    return [];
  }

  return diagnostics
    .filter((diagnostic) => diagnostic.severity === 0)
    .map((diagnostic) => ({
      severity: diagnostic.severity,
      message: diagnostic.message,
      source: diagnostic.source,
      errorLine: diagnostic.range.start.line + 1
    }))
    .sort((left, right) => left.errorLine - right.errorLine);
}

export function buildDiagnosticSnapshot(
  filePath: string,
  diagnostic: DiagnosticLike,
  code: string
): DiagnosticSnapshot {
  return {
    file: filePath,
    message: diagnostic.message,
    severity: diagnostic.severity,
    source: diagnostic.source,
    errorLine: diagnostic.range.start.line + 1,
    code
  };
}

export class DiagnosticListener {
  constructor(private readonly handler: DiagnosticHandler) {}

  async process(event: DiagnosticEvent): Promise<void> {
    const diagnostics = extractPythonDiagnostics(
      event.languageId,
      event.diagnostics
    );
    const diagnostic = diagnostics[0];
    if (!diagnostic) {
      return;
    }

    const code = await event.readFile(event.filePath);
    await this.handler(
      buildDiagnosticSnapshot(
        event.filePath,
        {
          ...diagnostic,
          range: { start: { line: diagnostic.errorLine - 1 } }
        },
        code
      )
    );
  }
}
