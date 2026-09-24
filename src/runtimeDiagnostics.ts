export interface PythonRuntimeError {
  message: string;
  file: string;
  errorLine: number;
}

export function stripAnsi(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    ""
  );
}

export function extractPythonScriptPath(
  commandLine: string
): string | undefined {
  const matches = commandLine.matchAll(
    /(?:"([^"]+\.py)"|'([^']+\.py)'|([^\s"';&|]+\.py))(?=\s|$)/gi
  );

  for (const match of matches) {
    return match[1] ?? match[2] ?? match[3];
  }

  return undefined;
}

export function isPythonCommandLine(commandLine: string): boolean {
  return commandLine
    .split(/&&|\|\||;|\r?\n/)
    .some((segment) => {
      const normalized = segment.trim().replace(/^&\s*/, "");
      const token = normalized.match(
        /^(?:"([^"]+)"|'([^']+)'|(\S+))/
      );
      const executable = token?.[1] ?? token?.[2] ?? token?.[3];
      if (!executable) {
        return false;
      }

      const basename =
        executable.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
      return /^(?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?$/i.test(
        basename
      );
    });
}

export function parsePythonRuntimeError(
  output: string
): PythonRuntimeError | undefined {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trimEnd());

  let errorIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^[A-Za-z_][\w.]*(?:Error|Exception):\s+\S/.test(lines[index])) {
      errorIndex = index;
      break;
    }
  }
  if (errorIndex < 0) {
    return undefined;
  }

  for (let index = errorIndex - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/^\s*File "(.+)", line (\d+), in /);
    if (match) {
      return {
        message: lines[errorIndex].trim(),
        file: match[1],
        errorLine: Number(match[2])
      };
    }
  }

  return undefined;
}
