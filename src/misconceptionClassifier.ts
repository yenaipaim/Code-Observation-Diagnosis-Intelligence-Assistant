import {
  clampConfidence,
  DiagnosticSnapshot,
  MisconceptionId,
  Classification
} from "./types";

export type ClassificationFallback = (
  input: DiagnosticSnapshot
) => Promise<Classification | undefined>;

function includesAny(value: string, terms: readonly string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

interface FunctionInfo {
  name: string;
  startLine: number;
  endLine: number;
  hasPrint: boolean;
  hasReturn: boolean;
}

function parseFunctions(code: string): FunctionInfo[] {
  const lines = code.split(/\r?\n/);
  const functions: FunctionInfo[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(
      /^(\s*)def\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*:/
    );
    if (!match) {
      continue;
    }

    const baseIndent = match[1].length;
    let endLine = index;
    const info: FunctionInfo = {
      name: match[2],
      startLine: index + 1,
      endLine: index + 1,
      hasPrint: false,
      hasReturn: false
    };

    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const line = lines[bodyIndex];
      if (!line.trim()) {
        continue;
      }

      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= baseIndent) {
        break;
      }

      endLine = bodyIndex;
      info.hasPrint ||= /\bprint\s*\(/.test(line);
      info.hasReturn ||= /^\s*return\b/.test(line);
    }

    info.endLine = endLine + 1;
    functions.push(info);
  }

  return functions;
}

function hasCalledPrintWithoutReturn(
  code: string,
  errorLine: number
): boolean {
  const lines = code.split(/\r?\n/);
  return parseFunctions(code).some((functionInfo) => {
    if (!functionInfo.hasPrint || functionInfo.hasReturn) {
      return false;
    }

    const callPattern = new RegExp(
      `^\\s*[A-Za-z_]\\w*\\s*=\\s*${functionInfo.name}\\s*\\(`
    );
    return lines.some(
      (line, index) =>
        index + 1 <= errorLine &&
        index + 1 > functionInfo.endLine &&
        callPattern.test(line)
    );
  });
}

function ruleResult(
  concept: MisconceptionId,
  confidence: number
): Classification {
  return {
    concept,
    confidence: clampConfidence(confidence),
    source: "rule"
  };
}

export function classifyByRules(
  input: DiagnosticSnapshot
): Classification | undefined {
  const message = input.message;
  const code = input.code;

  if (
    includesAny(message, ["indexerror"]) &&
    (code.includes("range(") ||
      code.includes("len(") ||
      /while\s+[^:\n]+<=/.test(code))
  ) {
    return ruleResult("off_by_one", 0.96);
  }

  if (
    includesAny(message, ["nonetype", "is none"]) &&
    hasCalledPrintWithoutReturn(code, input.errorLine)
  ) {
    return ruleResult("return_vs_print", 0.9);
  }

  if (
    includesAny(message, ["typeerror"]) &&
    includesAny(message, [
      "int",
      "str",
      "float",
      "nonetype",
      "list",
      "tuple",
      "dict"
    ])
  ) {
    return ruleResult("type_mismatch", 0.92);
  }

  if (includesAny(message, ["nameerror"])) {
    return ruleResult("name_error", 0.94);
  }

  if (includesAny(message, ["syntaxerror", "invalid syntax"])) {
    return ruleResult("syntax_error", 0.94);
  }

  if (includesAny(message, ["keyerror"])) {
    return ruleResult("key_error", 0.94);
  }

  if (includesAny(message, ["valueerror"])) {
    return ruleResult("value_error", 0.92);
  }

  if (includesAny(message, ["zerodivisionerror", "division by zero"])) {
    return ruleResult("zero_division", 0.96);
  }

  if (includesAny(message, ["attributeerror"])) {
    return ruleResult("attribute_error", 0.92);
  }

  if (
    includesAny(message, [
      "modulenotfounderror",
      "importerror",
      "no module named"
    ])
  ) {
    return ruleResult("import_error", 0.94);
  }

  if (includesAny(message, ["indentationerror"])) {
    return ruleResult("indentation_error", 0.96);
  }

  return undefined;
}

export async function classifyMisconception(
  input: DiagnosticSnapshot,
  fallback?: ClassificationFallback
): Promise<Classification | undefined> {
  const ruleClassification = classifyByRules(input);
  if (ruleClassification) {
    return ruleClassification;
  }

  return fallback?.(input);
}
