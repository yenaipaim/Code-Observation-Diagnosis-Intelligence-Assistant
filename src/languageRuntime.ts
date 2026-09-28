import {
  parsePythonRuntimeError,
  stripAnsi
} from "./runtimeDiagnostics";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LANGUAGE_CONCEPT_IDS,
  MisconceptionId,
  SupportedLanguage
} from "./types";

export interface ParsedRuntimeError {
  language: SupportedLanguage;
  message: string;
  file: string;
  errorLine: number;
}

export interface LanguageRuntimeProfile {
  language: SupportedLanguage;
  displayName: string;
  extensions: readonly string[];
  defaultExecutable: string;
  runtimePathSection: string;
  runtimePathSetting: string;
  isCommandLine: (commandLine: string) => boolean;
  extractScriptPath: (commandLine: string) => string | undefined;
  parseRuntimeError: (output: string) => ParsedRuntimeError | undefined;
  concepts: readonly MisconceptionId[];
}

const JAVA_EXTENSIONS = [".java"] as const;
const JAVASCRIPT_EXTENSIONS = [".js", ".mjs", ".cjs"] as const;

function commandSegments(commandLine: string): string[] {
  return commandLine
    .split(/&&|\|\||;|\r?\n/)
    .map((segment) => segment.trim().replace(/^&\s*/, ""))
    .filter(Boolean);
}

function executableName(segment: string): string {
  const token = segment.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const executable = token?.[1] ?? token?.[2] ?? token?.[3] ?? "";
  return executable.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
}

function isExecutable(segment: string, names: readonly string[]): boolean {
  const name = executableName(segment);
  return names.some(
    (candidate) =>
      new RegExp(`^${candidate}(?:\\.exe)?$`, "i").test(name)
  );
}

function pathFromCommand(
  commandLine: string,
  extensions: readonly string[]
): string | undefined {
  const extensionPattern = extensions
    .map((extension) => extension.replace(".", "\\."))
    .join("|");
  const pattern = new RegExp(
    `(?:"([^"]+(?:${extensionPattern}))"|'([^']+(?:${extensionPattern}))'|([^\\s"';&|]+(?:${extensionPattern})))(?=\\s|$)`,
    "i"
  );

  for (const segment of commandSegments(commandLine)) {
    const match = segment.match(pattern);
    if (match) {
      return match[1] ?? match[2] ?? match[3];
    }
  }

  return undefined;
}

export function isRuntimeCommandLine(
  commandLine: string,
  language: SupportedLanguage
): boolean {
  return commandSegments(commandLine).some((segment) => {
    if (language === "java") {
      return isExecutable(segment, ["java"]);
    }
    if (language === "javascript") {
      return isExecutable(segment, ["node"]);
    }
    return isExecutable(segment, ["python", "python3", "py"]);
  });
}

export function extractScriptPath(
  commandLine: string,
  language: SupportedLanguage
): string | undefined {
  if (language === "java") {
    return pathFromCommand(commandLine, JAVA_EXTENSIONS);
  }
  if (language === "javascript") {
    return pathFromCommand(commandLine, JAVASCRIPT_EXTENSIONS);
  }

  const match = commandLine.match(
    /(?:"([^"]+\.py)"|'([^']+\.py)'|([^\s"';&|]+\.py))(?=\s|$)/i
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function javaCommandTargetsFile(
  commandLine: string,
  filePath: string
): boolean {
  const className = path
    .basename(filePath, path.extname(filePath))
    .toLowerCase();

  return commandSegments(commandLine).some((segment) => {
    if (!isExecutable(segment, ["java"])) {
      return false;
    }

    const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    return tokens.some((token) => {
      const value = token.replace(/^["']|["']$/g, "");
      const target = value
        .replace(/\.java$/i, "")
        .split(/[\\/.]/)
        .pop()
        ?.toLowerCase();
      return target === className;
    });
  });
}

export function createRuntimeCommand(
  language: SupportedLanguage,
  filePath: string,
  executable: string
): { executable: string; args: string[] } {
  return {
    executable: executable.trim() || runtimeProfileForLanguage(language).defaultExecutable,
    args: [filePath]
  };
}

export function resolveRuntimeErrorPath(
  reportedFile: string,
  cwd: string | undefined,
  language: SupportedLanguage,
  runningFile?: string
): string {
  if (path.isAbsolute(reportedFile)) {
    return path.resolve(reportedFile);
  }

  const baseDirectory =
    language === "java" && runningFile
      ? path.dirname(runningFile)
      : cwd ?? process.cwd();
  return path.resolve(baseDirectory, reportedFile);
}

export function parseJavaRuntimeError(
  output: string
): ParsedRuntimeError | undefined {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trimEnd());

  for (const line of lines) {
    const compileError = line.match(
      /^(.*\.java):(\d+):\s*(?:error|错误)\s*[:：]\s*(.+)$/i
    );
    if (compileError) {
      return {
        language: "java",
        file: compileError[1],
        errorLine: Number(compileError[2]),
        message: compileError[3].trim()
      };
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const summary = lines[index].trim();
    if (
      !/^(?:Exception in thread "[^"]+"\s+)?(?:[A-Za-z_$][\w$]*\.)*(?:Exception|Error|[A-Za-z_$][\w$]*(?:Exception|Error))(?::\s*\S.*)?$/.test(
        summary
      )
    ) {
      continue;
    }

    for (let frameIndex = index + 1; frameIndex < lines.length; frameIndex += 1) {
      const frame = lines[frameIndex].match(
        /^\s*at\s+.+\((.+\.java):(\d+)\)\s*$/
      );
      if (frame) {
        return {
          language: "java",
          file: frame[1],
          errorLine: Number(frame[2]),
          message: summary
        };
      }
    }
  }

  return undefined;
}

function normalizeJavaScriptFilePath(
  value: string
): string | undefined {
  const candidate = value.trim();
  if (candidate.startsWith("node:")) {
    return undefined;
  }
  if (!/^file:/i.test(candidate)) {
    return candidate;
  }

  try {
    return fileURLToPath(candidate);
  } catch {
    return undefined;
  }
}

function nodeUserFrame(line: string): { file: string; line: number } | undefined {
  const parenthesized = line.match(
    /\bat\s+.*?\((.+?\.(?:js|mjs|cjs)):(\d+):\d+\)/
  );
  if (parenthesized) {
    const file = normalizeJavaScriptFilePath(parenthesized[1]);
    if (file) {
      return {
        file,
        line: Number(parenthesized[2])
      };
    }
  }

  const plain = line.match(
    /\bat\s+(.+?\.(?:js|mjs|cjs)):(\d+):\d+/
  );
  if (plain) {
    const file = normalizeJavaScriptFilePath(plain[1]);
    if (file) {
      return {
        file,
        line: Number(plain[2])
      };
    }
  }

  return undefined;
}

export function parseJavaScriptRuntimeError(
  output: string
): ParsedRuntimeError | undefined {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trimEnd());

  let errorIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (
      /^(?:Uncaught\s+)?(?:UnhandledPromiseRejection|SyntaxError|Exception|Error|[A-Za-z_$][\w$]*(?:Exception|Error))(?:\s+\[[^\]]+\])?:\s*\S/.test(
        lines[index].trim()
      )
    ) {
      errorIndex = index;
      break;
    }
  }
  if (errorIndex < 0) {
    return undefined;
  }

  const message = lines[errorIndex].trim();
  for (let index = errorIndex + 1; index < lines.length; index += 1) {
    const frame = nodeUserFrame(lines[index]);
    if (frame) {
      return {
        language: "javascript",
        file: frame.file,
        errorLine: frame.line,
        message
      };
    }
  }

  for (let index = errorIndex - 1; index >= 0; index -= 1) {
    const location = lines[index].match(
      /^(.*?\.(?:js|mjs|cjs)):(\d+)$/
    );
    if (location) {
      const file = normalizeJavaScriptFilePath(location[1]);
      if (file) {
        return {
          language: "javascript",
          file,
          errorLine: Number(location[2]),
          message
        };
      }
    }
  }

  return undefined;
}

function parsePythonLanguageRuntimeError(
  output: string
): ParsedRuntimeError | undefined {
  const parsed = parsePythonRuntimeError(output);
  return parsed ? { language: "python", ...parsed } : undefined;
}

export function createLanguageRuntimeProfiles(): Record<
  SupportedLanguage,
  LanguageRuntimeProfile
> {
  const makeProfile = (
    language: SupportedLanguage,
    displayName: string,
    extensions: readonly string[],
    defaultExecutable: string,
    runtimePathSection: string,
    runtimePathSetting: string,
    parseRuntimeError: (output: string) => ParsedRuntimeError | undefined
  ): LanguageRuntimeProfile => ({
    language,
    displayName,
    extensions,
    defaultExecutable,
    runtimePathSection,
    runtimePathSetting,
    isCommandLine: (commandLine) =>
      isRuntimeCommandLine(commandLine, language),
    extractScriptPath: (commandLine) =>
      extractScriptPath(commandLine, language),
    parseRuntimeError,
    concepts: LANGUAGE_CONCEPT_IDS[language]
  });

  return {
    python: makeProfile(
      "python",
      "Python",
      [".py"],
      "python",
      "python",
      "defaultInterpreterPath",
      parsePythonLanguageRuntimeError
    ),
    java: makeProfile(
      "java",
      "Java",
      JAVA_EXTENSIONS,
      "java",
      "programmingCoach",
      "javaRuntimePath",
      parseJavaRuntimeError
    ),
    javascript: makeProfile(
      "javascript",
      "JavaScript",
      JAVASCRIPT_EXTENSIONS,
      "node",
      "programmingCoach",
      "javascriptRuntimePath",
      parseJavaScriptRuntimeError
    )
  };
}

export function runtimeProfileForLanguage(
  language: SupportedLanguage
): LanguageRuntimeProfile {
  return createLanguageRuntimeProfiles()[language];
}

export function runtimeProfileForLanguageId(
  languageId: string
): LanguageRuntimeProfile | undefined {
  if (languageId === "python") {
    return runtimeProfileForLanguage("python");
  }
  if (languageId === "java") {
    return runtimeProfileForLanguage("java");
  }
  if (languageId === "javascript") {
    return runtimeProfileForLanguage("javascript");
  }
  return undefined;
}

export function runtimeProfileForPath(
  filePath: string
): LanguageRuntimeProfile | undefined {
  const normalized = filePath.toLowerCase();
  return Object.values(createLanguageRuntimeProfiles()).find((profile) =>
    profile.extensions.some((extension) => normalized.endsWith(extension))
  );
}
