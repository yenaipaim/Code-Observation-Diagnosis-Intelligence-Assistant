import { SupportedLanguage } from "./types";

export interface CodePartRange {
  startLine: number;
  endLine: number;
}

interface DelimiterPair {
  open: string;
  close: string;
  openLine: number;
  closeLine: number;
}

interface InferCodePartOptions {
  includeControlBlock?: boolean;
}

const CONTROL_HEADER =
  /\b(?:if|else|for|while|do|switch|try|catch|finally|synchronized)\b/;
const PYTHON_CONTROL_HEADER =
  /^(?:async\s+)?(?:for|while|if|elif|else|try|except|finally|with|match|case)\b/;

function normalizeLines(code: string): string[] {
  return code.replace(/\r\n?/g, "\n").split("\n");
}

function lineIndent(line: string): number {
  const match = line.match(/^[ \t]*/);
  return match ? match[0].replace(/\t/g, "    ").length : 0;
}

function clampLine(line: number, totalLines: number): number {
  return Math.min(Math.max(Math.trunc(line), 1), totalLines);
}

function delimiterPairs(
  lines: readonly string[],
  language: SupportedLanguage
): DelimiterPair[] {
  const pairs: DelimiterPair[] = [];
  const stack: Array<{ char: string; line: number }> = [];
  const matches: Record<string, string> = {
    ")": "(",
    "]": "[",
    "}": "{"
  };
  let blockComment = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    let quote: string | undefined;
    let escaped = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (blockComment) {
        if (char === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        continue;
      }

      if (language === "python" && char === "#") {
        break;
      }
      if (char === "/" && next === "/") {
        break;
      }
      if (char === "/" && next === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        continue;
      }

      if (char === "(" || char === "[" || char === "{") {
        stack.push({ char, line: lineIndex });
        continue;
      }

      const expectedOpen = matches[char];
      if (!expectedOpen) {
        continue;
      }
      const opened = stack.pop();
      if (!opened || opened.char !== expectedOpen) {
        continue;
      }
      pairs.push({
        open: opened.char,
        close: char,
        openLine: opened.line,
        closeLine: lineIndex
      });
    }
  }

  return pairs;
}

function pythonSuiteRange(
  lines: readonly string[],
  errorIndex: number
): CodePartRange | undefined {
  const errorIndent = lineIndent(lines[errorIndex]);

  for (let index = errorIndex; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const indent = lineIndent(line);
    if (index !== errorIndex && indent > errorIndent) {
      continue;
    }
    if (index !== errorIndex && indent < errorIndent) {
      if (!line.trimEnd().endsWith(":")) {
        break;
      }
      if (!PYTHON_CONTROL_HEADER.test(line.trim())) {
        break;
      }
    }

    if (
      !line.trimEnd().endsWith(":") ||
      !PYTHON_CONTROL_HEADER.test(line.trim())
    ) {
      continue;
    }

    let end = index;
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next];
      if (!candidate.trim()) {
        end = next;
        continue;
      }
      if (lineIndent(candidate) <= indent) {
        break;
      }
      end = next;
    }

    return {
      startLine: index + 1,
      endLine: end + 1
    };
  }

  return undefined;
}

function controlBlockRange(
  lines: readonly string[],
  errorIndex: number,
  pairs: readonly DelimiterPair[]
): CodePartRange | undefined {
  return pairs
    .filter(
      (pair) =>
        pair.open === "{" &&
        pair.openLine <= errorIndex &&
        errorIndex <= pair.closeLine &&
        CONTROL_HEADER.test(lines[pair.openLine])
    )
    .sort(
      (left, right) =>
        left.closeLine -
        left.openLine -
        (right.closeLine - right.openLine)
    )
    .map((pair) => ({
      startLine: pair.openLine + 1,
      endLine: pair.closeLine + 1
    }))[0];
}

export function inferCodePartRange(
  code: string,
  language: SupportedLanguage,
  errorLine: number,
  options: InferCodePartOptions = {}
): CodePartRange {
  const lines = normalizeLines(code);
  const errorIndex = clampLine(errorLine, lines.length) - 1;
  const pairs = delimiterPairs(lines, language);
  const includeControlBlock = options.includeControlBlock ?? true;

  const expressionPairs = pairs
    .filter(
      (pair) =>
        pair.open !== "{" &&
        pair.openLine <= errorIndex &&
        errorIndex <= pair.closeLine
    )
    .sort(
      (left, right) =>
        left.closeLine -
        left.openLine -
        (right.closeLine - right.openLine)
    );
  const multilineExpressionPair = expressionPairs.find(
    (pair) => pair.openLine < pair.closeLine
  );
  if (multilineExpressionPair) {
    return {
      startLine: multilineExpressionPair.openLine + 1,
      endLine: multilineExpressionPair.closeLine + 1
    };
  }

  if (language === "python") {
    const suite = pythonSuiteRange(lines, errorIndex);
    if (suite) {
      return suite;
    }
  }

  if (includeControlBlock) {
    const block = controlBlockRange(lines, errorIndex, pairs);
    if (block) {
      return block;
    }
  }

  if (expressionPairs[0]) {
    return {
      startLine: expressionPairs[0].openLine + 1,
      endLine: expressionPairs[0].closeLine + 1
    };
  }

  return {
    startLine: errorIndex + 1,
    endLine: errorIndex + 1
  };
}

export function extractErrorPartCode(
  code: string,
  language: SupportedLanguage,
  errorLine: number,
  options: InferCodePartOptions = {}
): string {
  const lines = normalizeLines(code);
  const range = inferCodePartRange(
    code,
    language,
    errorLine,
    options
  );
  return lines
    .slice(range.startLine - 1, range.endLine)
    .join("\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\n[ \t]*$/, "");
}
