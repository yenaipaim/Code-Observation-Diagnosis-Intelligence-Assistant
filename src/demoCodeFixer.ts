import {
  DiagnosticSnapshot,
  MisconceptionId,
  SupportedLanguage
} from "./types";

export interface DemoCodeFix {
  code: string;
  startLine: number;
  endLine: number;
}

type Fixer = (
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
) => DemoCodeFix | undefined;

function normalizeLines(code: string): string[] {
  return code.replace(/\r\n?/g, "\n").split("\n");
}

function lineAt(
  snapshot: DiagnosticSnapshot,
  errorLine: number
): { lines: string[]; index: number; code: string; indent: string } {
  const lines = normalizeLines(snapshot.code);
  const index = Math.min(
    Math.max(Math.trunc(errorLine), 1),
    Math.max(lines.length, 1)
  ) - 1;
  const code = lines[index] ?? "";
  return {
    lines,
    index,
    code,
    indent: code.match(/^\s*/)?.[0] ?? ""
  };
}

function lineFix(
  code: string,
  errorLine: number
): DemoCodeFix {
  return {
    code,
    startLine: errorLine,
    endLine: errorLine
  };
}

function replaceErrorLine(
  snapshot: DiagnosticSnapshot,
  errorLine: number,
  replacer: (line: string) => string | undefined
): DemoCodeFix | undefined {
  const { code } = lineAt(snapshot, errorLine);
  const fixed = replacer(code);
  if (!fixed || fixed === code) {
    return undefined;
  }
  return lineFix(fixed, errorLine);
}

function undefinedName(message: string): string | undefined {
  return (
    message.match(
      /name\s+['"]([A-Za-z_]\w*)['"]\s+is not defined/i
    )?.[1] ??
    message.match(
      /ReferenceError:\s*([A-Za-z_]\w*)\s+is not defined/i
    )?.[1] ??
    message.match(
      /symbol:\s+(?:variable|class|method)\s+([A-Za-z_]\w*)/i
    )?.[1]
  );
}

function fixReturnVsPrint(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  if (language !== "python") {
    return undefined;
  }

  const { lines, index } = lineAt(snapshot, errorLine);
  for (let current = index; current >= 0; current -= 1) {
    const match = lines[current].match(/^(\s*)print\s*\((.*)\)\s*$/);
    if (!match) {
      continue;
    }
    return lineFix(
      `${match[1]}return ${match[2]}`,
      current + 1
    );
  }

  return undefined;
}

function fixTypeMismatch(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  return replaceErrorLine(snapshot, errorLine, (line) => {
    if (language === "python") {
      const message = snapshot.message;
      if (/can only concatenate str/i.test(message)) {
        return line
          .replace(
            /(\+\s*)([A-Za-z_]\w*|\d+)(?=\s*[),]?\s*$)/,
            "$1str($2)"
          )
          .replace(
            /([A-Za-z_]\w*)(\s*\+\s*["'][^"']*["'])/,
            "str($1)$2"
          );
      }
      if (
        /unsupported operand type\(s\) for \+:\s*'int' and 'str'/i.test(
          message
        )
      ) {
        return line
          .replace(
            /(\+\s*)([A-Za-z_]\w*)(?=\s*[),]?\s*$)/,
            "$1int($2)"
          )
          .replace(
            /([A-Za-z_]\w*)(\s*\+\s*["'][^"']*["'])/,
            "int($1)$2"
          );
      }
      if (/\bstr\b/i.test(message) && line.includes("+")) {
        return line.replace(
          /(\+\s*)([A-Za-z_]\w*(?:\[[^\]]+\])?)(?=\s*[),]?\s*$)/,
          "$1str($2)"
        );
      }
      return undefined;
    }

    if (language === "java") {
      const match = line.match(
        /(\b(int|long|double|float)\s+\w+\s*=\s*)("[^"]*"|'[^']*')/
      );
      if (!match || match.index === undefined) {
        return undefined;
      }
      const conversions: Record<string, string> = {
        int: "Integer.parseInt",
        long: "Long.parseLong",
        double: "Double.parseDouble",
        float: "Float.parseFloat"
      };
      const conversion = conversions[match[2]];
      if (!conversion) {
        return undefined;
      }
      return [
        line.slice(0, match.index),
        `${match[1]}${conversion}(${match[3]})`,
        line.slice(match.index + match[0].length)
      ].join("");
    }

    return line.replace(
      /(\b(?:const|let|var)\s+\w+\s*=\s*)("[^"]*"|'[^']*')/,
      "$1Number($2)"
    );
  });
}

function fixNameError(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  const name = undefinedName(snapshot.message);
  if (!name) {
    return undefined;
  }

  const { code, indent } = lineAt(snapshot, errorLine);
  const declaration =
    language === "python"
      ? `${name} = 0`
      : language === "javascript"
        ? `let ${name} = 0;`
        : `int ${name} = 0;`;

  return lineFix(
    `${indent}${declaration}\n${code}`,
    errorLine
  );
}

function fixSyntaxError(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  return replaceErrorLine(snapshot, errorLine, (line) => {
    const trimmed = line.trim();
    let fixed = line;

    if (language === "python") {
      if (
        /^(?:if|elif|for|while|def|class|try|except|finally|with)\b/.test(
          trimmed
        ) &&
        !trimmed.endsWith(":")
      ) {
        fixed += ":";
      }

      const openParentheses = (fixed.match(/\(/g) ?? []).length;
      const closeParentheses = (fixed.match(/\)/g) ?? []).length;
      if (openParentheses > closeParentheses) {
        fixed += ")".repeat(openParentheses - closeParentheses);
      }
      return fixed;
    }

    if (
      trimmed &&
      !/[{};:,]$/.test(trimmed) &&
      !/^(?:if|else|for|while|switch|try|catch|finally|do|class|interface)\b/.test(
        trimmed
      )
    ) {
      fixed += ";";
    }
    return fixed;
  });
}

function fixValueError(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  const { code, indent } = lineAt(snapshot, errorLine);

  if (language === "python") {
    const assignment = code.match(
      /^(\s*)([A-Za-z_]\w*)\s*=\s*(int|float)\s*\((.+)\)\s*$/
    );
    if (assignment) {
      const [, matchedIndent, variable, conversion, value] = assignment;
      return lineFix(
        [
          `${matchedIndent}try:`,
          `${matchedIndent}    ${variable} = ${conversion}(${value})`,
          `${matchedIndent}except ValueError:`,
          `${matchedIndent}    ${variable} = 0`
        ].join("\n"),
        errorLine
      );
    }

    return lineFix(
      [
        `${indent}try:`,
        `${indent}    ${code.trimStart()}`,
        `${indent}except ValueError:`,
        `${indent}    print("请输入有效数字")`
      ].join("\n"),
      errorLine
    );
  }

  if (language === "java") {
    const assignment = code.match(
      /^(\s*)([A-Za-z_]\w*(?:<[^>]+>)?(?:\[\])?)\s+([A-Za-z_]\w*)\s*=\s*(Integer\.parseInt|Long\.parseLong|Double\.parseDouble|Float\.parseFloat)\s*\((.+)\)\s*;\s*$/
    );
    if (assignment) {
      const [
        ,
        matchedIndent,
        type,
        variable,
        conversion,
        value
      ] = assignment;
      return lineFix(
        [
          `${matchedIndent}${type} ${variable} = 0;`,
          `${matchedIndent}try {`,
          `${matchedIndent}    ${variable} = ${conversion}(${value});`,
          `${matchedIndent}} catch (NumberFormatException error) {`,
          `${matchedIndent}    ${variable} = 0;`,
          `${matchedIndent}}`
        ].join("\n"),
        errorLine
      );
    }

    return lineFix(
      [
        `${indent}try {`,
        `${indent}    ${code.trimStart()}`,
        `${indent}} catch (NumberFormatException error) {`,
        `${indent}    System.out.println("请输入有效数字");`,
        `${indent}}`
      ].join("\n"),
      errorLine
    );
  }

  const assignment = code.match(
    /^(\s*)(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(Number\.parseInt|parseInt|Number\.parseFloat|parseFloat|Number)\s*\((.+?)\)\s*;?\s*$/
  );
  if (assignment) {
    const [, matchedIndent, variable, conversion, args] = assignment;
    return lineFix(
      [
        `${matchedIndent}let ${variable} = ${conversion}(${args});`,
        `${matchedIndent}if (Number.isNaN(${variable})) {`,
        `${matchedIndent}    ${variable} = 0;`,
        `${matchedIndent}}`
      ].join("\n"),
      errorLine
    );
  }

  return lineFix(
    [
      `${indent}try {`,
      `${indent}    ${code.trimStart()}`,
      `${indent}} catch (error) {`,
      `${indent}    console.error(error);`,
      `${indent}}`
    ].join("\n"),
    errorLine
  );
}

function fixZeroDivision(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  return replaceErrorLine(snapshot, errorLine, (line) => {
    if (language === "python") {
      const match = line.match(
        /^(\s*)([A-Za-z_]\w*)\s*=\s*(.+?)\s*\/\s*(.+?)\s*$/
      );
      if (!match) {
        return undefined;
      }
      const [, indent, variable, numerator, denominator] = match;
      return `${indent}${variable} = ${numerator} / ${denominator} if ${denominator} else 0`;
    }

    if (language === "java") {
      const match = line.match(
        /^(\s*)(?:([A-Za-z_]\w*(?:<[^>]+>)?(?:\[\])?)\s+)?([A-Za-z_]\w*)\s*=\s*(.+?)\s*\/\s*(.+?)\s*;\s*$/
      );
      if (!match) {
        return undefined;
      }
      const [, indent, type, variable, numerator, denominator] = match;
      const declaration = type ? `${type} ` : "";
      return `${indent}${declaration}${variable} = ${denominator} == 0 ? 0 : ${numerator} / ${denominator};`;
    }

    const match = line.match(
      /^(\s*)(const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s*\/\s*(.+?)\s*;?\s*$/
    );
    if (!match) {
      return undefined;
    }
    const [, indent, keyword, variable, numerator, denominator] = match;
    return `${indent}${keyword} ${variable} = ${denominator} === 0 ? 0 : ${numerator} / ${denominator};`;
  });
}

function fixAttributeError(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  const { code, indent } = lineAt(snapshot, errorLine);

  if (language === "python") {
    const messageMatch = snapshot.message.match(
      /'([^']+)' object has no attribute '([^']+)'/
    );
    const codeMatch = code.match(
      /^(\s*)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)\s*\((.*)\)\s*$/
    );
    if (!codeMatch) {
      return undefined;
    }

    const [, , objectName, attribute, args] = codeMatch;
    const objectType = messageMatch?.[1];
    const replacement =
      objectType === "list" && ["push", "add"].includes(attribute)
        ? "append"
        : undefined;
    if (replacement) {
      return lineFix(
        `${indent}${objectName}.${replacement}(${args})`,
        errorLine
      );
    }

    return lineFix(
      [
        `${indent}if hasattr(${objectName}, "${attribute}"):`,
        `${indent}    ${code.trimStart()}`
      ].join("\n"),
      errorLine
    );
  }

  if (language !== "javascript") {
    return undefined;
  }

  const match = code.match(
    /^(\s*)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)\s*\((.*)\)\s*;?\s*$/
  );
  if (!match) {
    return undefined;
  }
  const [, , objectName, attribute] = match;
  return lineFix(
    [
      `${indent}if (typeof ${objectName}?.${attribute} === "function") {`,
      `${indent}    ${code.trimStart()}`,
      `${indent}}`
    ].join("\n"),
    errorLine
  );
}

function fixImportError(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  const { code } = lineAt(snapshot, errorLine);

  if (language === "python") {
    const module =
      snapshot.message.match(/No module named\s+['"]([^'"]+)['"]/i)?.[1] ??
      snapshot.message.match(/No module named\s+([A-Za-z_][\w.]*)/i)?.[1];
    if (!module) {
      return undefined;
    }
    return lineFix(
      `# 先安装或确认运行环境：python -m pip install ${module}\n${code}`,
      errorLine
    );
  }

  if (language === "javascript") {
    const module = snapshot.message.match(
      /Cannot find module\s+['"]([^'"]+)['"]/i
    )?.[1];
    if (!module) {
      return undefined;
    }
    return lineFix(
      `// 先安装或确认依赖：npm install ${module}\n${code}`,
      errorLine
    );
  }

  const className =
    snapshot.message.match(/NoClassDefFoundError:\s*([^\s]+)/i)?.[1] ??
    snapshot.message.match(/ClassNotFoundException:\s*([^\s]+)/i)?.[1];
  if (!className) {
    return undefined;
  }
  const normalized = className.replace(/\//g, ".");
  return lineFix(
    `// 请确认依赖已安装并导入：${normalized}\n${code}`,
    errorLine
  );
}

function indentationWidth(line: string): number {
  return (line.match(/^\s*/)?.[0] ?? "").replace(/\t/g, "    ").length;
}

function fixIndentationError(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  if (language !== "python") {
    return undefined;
  }

  const { lines, index, code } = lineAt(snapshot, errorLine);
  const unexpectedIndent = /unexpected indent/i.test(snapshot.message);
  if (unexpectedIndent) {
    const currentWidth = indentationWidth(code);
    const fixed = `${" ".repeat(Math.max(0, currentWidth - 4))}${code.trimStart()}`;
    return fixed === code ? undefined : lineFix(fixed, errorLine);
  }

  let headerIndex = index - 1;
  while (headerIndex >= 0 && !lines[headerIndex].trim()) {
    headerIndex -= 1;
  }
  if (headerIndex < 0 || !lines[headerIndex].trimEnd().endsWith(":")) {
    return undefined;
  }

  const expectedIndent = indentationWidth(lines[headerIndex]) + 4;
  const fixed = `${" ".repeat(expectedIndent)}${code.trimStart()}`;
  return fixed === code ? undefined : lineFix(fixed, errorLine);
}

function fixNullReference(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  const { code, indent } = lineAt(snapshot, errorLine);

  if (language === "javascript") {
    const property = snapshot.message.match(
      /reading\s+['"]([^'"]+)['"]/i
    )?.[1];
    if (property) {
      const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fixed = code.replace(
        new RegExp(`([A-Za-z_]\\w*)\\.${escaped}\\b`),
        `$1?.${property}`
      );
      if (fixed !== code) {
        return lineFix(fixed, errorLine);
      }
    }

    const fallback = code.replace(
      /([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/,
      "$1?.$2("
    );
    return fallback === code ? undefined : lineFix(fallback, errorLine);
  }

  if (language !== "java") {
    return undefined;
  }

  const objectName = code.match(/\b([A-Za-z_]\w*)\s*\./)?.[1];
  if (!objectName) {
    return undefined;
  }
  return lineFix(
    [
      `${indent}if (${objectName} != null) {`,
      `${indent}    ${code.trimStart()}`,
      `${indent}}`
    ].join("\n"),
    errorLine
  );
}

function numericDefault(type: string): string {
  return /^(?:int|long|short|byte|float|double|boolean|char)$/.test(type)
    ? "0"
    : "null";
}

function fixIndexOutOfBounds(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  const { code, indent } = lineAt(snapshot, errorLine);

  if (language === "java") {
    const assignment = code.match(
      /^(\s*)([A-Za-z_]\w*(?:<[^>]+>)?(?:\[\])?)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\[\s*([^\]]+)\s*\]\s*;\s*$/
    );
    if (assignment) {
      const [, , type, variable, collection, index] = assignment;
      return lineFix(
        `${indent}${type} ${variable} = (${index} >= 0 && ${index} < ${collection}.length) ? ${collection}[${index}] : ${numericDefault(type)};`,
        errorLine
      );
    }
  }

  const collection = code.match(
    /([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\[\s*([^\]]+)\s*\]/
  );
  if (!collection) {
    return undefined;
  }
  const [, collectionName, index] = collection;

  if (language === "javascript") {
    const fixed = code.replace(
      collection[0],
      `${collectionName}?.[${index}] ?? null`
    );
    return fixed === code ? undefined : lineFix(fixed, errorLine);
  }

  const lengthExpression =
    language === "java"
      ? `${collectionName}.length`
      : `${collectionName}.length`;
  return lineFix(
    [
      `${indent}if (${index} >= 0 && ${index} < ${lengthExpression}) {`,
      `${indent}    ${code.trimStart()}`,
      `${indent}}`
    ].join("\n"),
    errorLine
  );
}

function fixClassCastError(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  if (language !== "java") {
    return undefined;
  }

  return replaceErrorLine(snapshot, errorLine, (line) => {
    const assignment = line.match(
      /^(\s*)([A-Za-z_]\w*(?:<[^>]+>)?)\s+([A-Za-z_]\w*)\s*=\s*\(\s*([A-Za-z_]\w*)\s*\)\s*([A-Za-z_]\w*)\s*;\s*$/
    );
    if (!assignment) {
      return undefined;
    }
    const [, indent, type, variable, castType, source] = assignment;
    return `${indent}${type} ${variable} = ${source} instanceof ${castType} ? (${castType}) ${source} : null;`;
  });
}

function fixAsyncError(
  language: SupportedLanguage,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  if (language !== "javascript") {
    return undefined;
  }

  return replaceErrorLine(snapshot, errorLine, (line) => {
    if (line.includes(".catch(")) {
      return undefined;
    }

    const assignment = line.match(
      /^(\s*)((?:const|let|var)\s+[A-Za-z_]\w*\s*=\s*)(.+?)\s*;?\s*$/
    );
    if (assignment) {
      const [, indent, prefix, expression] = assignment;
      return `${indent}${prefix}${expression}.catch((error) => console.error(error));`;
    }

    const statement = line.match(
      /^(\s*)(await\s+)?(.+?)\s*;?\s*$/
    );
    if (!statement) {
      return undefined;
    }
    const [, indent, awaitPrefix = "", expression] = statement;
    return `${indent}${awaitPrefix}${expression}.catch((error) => console.error(error));`;
  });
}

const FIXERS: Partial<Record<MisconceptionId, Fixer>> = {
  return_vs_print: fixReturnVsPrint,
  type_mismatch: fixTypeMismatch,
  name_error: fixNameError,
  syntax_error: fixSyntaxError,
  value_error: fixValueError,
  zero_division: fixZeroDivision,
  attribute_error: fixAttributeError,
  import_error: fixImportError,
  indentation_error: fixIndentationError,
  null_reference: fixNullReference,
  index_out_of_bounds: fixIndexOutOfBounds,
  class_cast_error: fixClassCastError,
  async_error: fixAsyncError
};

export function fixDemoAnswerCode(
  concept: MisconceptionId,
  snapshot: DiagnosticSnapshot,
  errorLine: number
): DemoCodeFix | undefined {
  const language = snapshot.language ?? "python";
  const fixer = FIXERS[concept];
  if (!fixer) {
    return undefined;
  }

  const fix = fixer(language, snapshot, errorLine);
  if (!fix) {
    return undefined;
  }

  const totalLines = normalizeLines(snapshot.code).length;
  const startLine = Math.min(
    Math.max(fix.startLine, 1),
    totalLines
  );
  const endLine = Math.min(
    Math.max(fix.endLine, startLine),
    totalLines
  );
  return {
    code: fix.code,
    startLine,
    endLine
  };
}
