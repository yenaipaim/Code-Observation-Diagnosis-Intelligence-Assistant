import {
  AnswerContent,
  DiagnosticSnapshot,
  HintIndex,
  LANGUAGE_LABELS,
  MisconceptionId,
  SupportedLanguage,
  UnderstandingResult
} from "./types";
import { inferCodePartRange } from "./codePart";

export interface JsonCompleter {
  completeJson<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

export interface DemoHintProvider {
  (
    concept: MisconceptionId,
    hintIndex: HintIndex,
    snapshot: DiagnosticSnapshot
  ): string | undefined;
}

export interface DemoAnswerProvider {
  (
    concept: MisconceptionId,
    snapshot: DiagnosticSnapshot
  ): AnswerContent | undefined;
}

interface HintResponse {
  hint?: string;
}

interface AnswerResponse {
  code?: string;
  explanation?: string;
  startLine?: number | string;
  endLine?: number | string;
}

interface JudgmentResponse {
  judgment?: judgmentValue;
  reason?: string;
  closeness?: number;
}

type judgmentValue = "correct" | "partial" | "wrong";

export interface UnderstandingJudgeOptions {
  throwOnApiError?: boolean;
}

const DIRECTIONS: Record<MisconceptionId, Record<HintIndex, string>> = {
  off_by_one: {
    1: "定位循环边界：引导用户关注循环的结束条件，不要直接提“索引从 0 开始”。",
    2: "手动推演：让用户列出循环变量的值，观察最后一次循环发生了什么。",
    3: "揭示索引规则：提示索引从 0 开始，最后一个合法索引是长度减一。"
  },
  return_vs_print: {
    1: "区分“显示”和“交出”：引导用户思考函数结果的去向。",
    2: "对比 print 和 return：让用户理解 print 给屏幕看，return 给调用者用。",
    3: "揭示默认返回值：提示函数没有 return 时，Python 默认返回 None。"
  },
  type_mismatch: {
    1: "检查操作数类型：让用户注意参与运算的两个值是不是同一类。",
    2: "区分数字和文字：提示 3 和 \"3\" 不同，能做加法或只能拼接。",
    3: "给出转换方法：提示使用当前语言提供的显式类型转换。"
  },
  name_error: {
    1: "检查名称定义：引导用户确认变量或函数在使用前是否已经赋值或定义。",
    2: "对比拼写：让用户逐字符检查当前名称和定义位置的名称。",
    3: "定位生命周期：提示名称必须先执行赋值，后续代码才能使用。"
  },
  syntax_error: {
    1: "检查语句结构：引导用户关注括号、引号、分隔符和块边界是否完整。",
    2: "对照上一行：让用户找相似的正确语句，逐项比较符号。",
    3: "按语法单位检查：条件、循环和函数定义需要符合当前语言的块结构。"
  },
  key_error: {
    1: "检查字典键：引导用户确认访问的键是否真实存在。",
    2: "先看键列表：让用户打印或查看字典的 keys。",
    3: "安全访问：提示使用 in 判断或 dict.get() 处理缺失键。"
  },
  value_error: {
    1: "检查输入值：引导用户确认传入转换或操作的值是否符合格式。",
    2: "查看原始字符串：让用户输出转换前的值，确认空格、字母或小数点。",
    3: "先校验再转换：提示捕获转换异常或先验证输入格式。"
  },
  zero_division: {
    1: "检查除数：引导用户确认除数在运算时是否可能为零。",
    2: "追踪变量：让用户打印除数并检查它如何被计算或更新。",
    3: "先判断再相除：提示除数为零时返回默认值或跳过计算。"
  },
  attribute_error: {
    1: "检查对象类型：引导用户确认变量当前到底是什么类型。",
    2: "查看可用方法：让用户核对对象实际类型和可用成员名称。",
    3: "使用正确类型：提示不同对象拥有的属性或方法不同。"
  },
  import_error: {
    1: "检查模块名：引导用户确认导入名称拼写和环境是否一致。",
    2: "确认安装环境：让用户检查当前运行环境是否提供目标模块。",
    3: "核对导入路径：提示标准库、第三方包和本地文件导入方式不同。"
  },
  indentation_error: {
    1: "检查缩进层级：引导用户确认冒号后的代码块是否缩进。",
    2: "统一空格：让用户对齐同一代码块中的语句。",
    3: "检查混合缩进：提示不要混用 tab 和空格。"
  },
  null_reference: {
    1: "检查对象状态：引导用户确认变量在使用前是否可能为空。",
    2: "追踪来源：让用户查看对象从哪来，哪条分支可能没有赋值。",
    3: "先判空再使用：提示在访问属性或方法前处理空值。"
  },
  index_out_of_bounds: {
    1: "检查访问位置：引导用户比较索引和集合实际长度。",
    2: "推演最后一步：让用户列出有效索引范围，检查越界发生在哪一次。",
    3: "限制边界：提示索引必须小于长度，循环和随机值都要受约束。"
  },
  class_cast_error: {
    1: "检查运行类型：引导用户确认对象实际是什么类型。",
    2: "对比声明和实例：让用户查看变量被赋值的真实对象。",
    3: "转换前判断：提示使用类型检查或重新设计转换位置。"
  },
  async_error: {
    1: "检查异步结果：引导用户确认 Promise 失败后由谁处理。",
    2: "追踪调用链：让用户找到 await、then 或 catch 的缺失位置。",
    3: "处理拒绝：提示用 try/catch 或 catch 处理异步错误。"
  }
};

function lineWindow(code: string, errorLine: number): string {
  const lines = code.split(/\r?\n/);
  const start = Math.max(0, errorLine - 4);
  const end = Math.min(lines.length, errorLine + 3);

  return lines
    .slice(start, end)
    .map((line, index) => `${start + index + 1}: ${line}`)
    .join("\n");
}

function assertSafeHint(hint: string): void {
  if (
    /```/.test(hint) ||
    /\n\s*(def|return|for|while|import|from|class)\s+/.test(hint)
  ) {
    throw new Error("提示包含完整修复代码，已拒绝显示");
  }
}

function normalizeAnswerCode(code: string): string {
  const normalized = code.replace(/\r\n?/g, "\n");
  const fenced = normalized.trim().match(
    /^```[^\n]*\n([\s\S]*?)\n?```$/i
  );
  const content = fenced?.[1] ?? normalized;
  return content.replace(/^\n/, "").replace(/\n[ \t]*$/, "");
}

function lineCount(code: string): number {
  return Math.max(1, code.replace(/\r\n?/g, "\n").split("\n").length);
}

function lineNumber(
  value: number | string | undefined,
  fallback: number,
  totalLines: number
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  const candidate = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.min(Math.max(candidate, 1), totalLines);
}

function selectAnswerSnippet(
  code: string,
  source: string,
  startLine: number,
  endLine: number
): string {
  const answerLines = code.replace(/\r\n?/g, "\n").split("\n");
  const sourceLines = source.replace(/\r\n?/g, "\n").split("\n");
  const replacementLength = endLine - startLine + 1;

  if (
    answerLines.length > replacementLength &&
    answerLines.length === sourceLines.length
  ) {
    return answerLines.slice(startLine - 1, endLine).join("\n");
  }

  return code;
}

function mergeAnswerIntoCodePart(
  source: string,
  code: string,
  requested: { startLine: number; endLine: number },
  complete: { startLine: number; endLine: number }
): string {
  if (
    requested.startLine === complete.startLine &&
    requested.endLine === complete.endLine
  ) {
    return code;
  }

  const sourceLines = source.replace(/\r\n?/g, "\n").split("\n");
  const answerLines = code.replace(/\r\n?/g, "\n").split("\n");
  return [
    ...sourceLines.slice(
      complete.startLine - 1,
      requested.startLine - 1
    ),
    ...answerLines,
    ...sourceLines.slice(requested.endLine, complete.endLine)
  ].join("\n");
}

function numberedCode(code: string): string {
  return code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line, index) => `${index + 1}: ${line}`)
    .join("\n");
}

export class HintGenerator {
  constructor(
    private readonly client?: JsonCompleter,
    private readonly demoHint?: DemoHintProvider,
    private readonly demoMode = false,
    private readonly demoAnswer?: DemoAnswerProvider
  ) {}

  async generateHint(
    snapshot: DiagnosticSnapshot,
    concept: MisconceptionId,
    hintIndex: HintIndex
  ): Promise<string> {
    if (this.demoMode) {
      const cached = this.demoHint?.(concept, hintIndex, snapshot);
      if (cached) {
        return cached;
      }
      throw new Error("演示模式下没有匹配的提示缓存");
    }

    if (!this.client) {
      throw new Error("API 客户端未配置");
    }

    const language = snapshot.language ?? "python";
    const direction = DIRECTIONS[concept][hintIndex];
    const response = await this.client.completeJson<HintResponse>(
      [
        `你是 ${LANGUAGE_LABELS[language]} 调试教练。`,
        "你只能提出一个短小、具体、可回答的引导问题。",
        "禁止给完整修复代码，禁止直接替用户完成修改。",
        `本步固定引导方向：${direction}`,
        "结合用户的具体代码和报错，输出 JSON：{\"hint\":\"...\"}"
      ].join("\n"),
      [
        `语言：${LANGUAGE_LABELS[language]}`,
        `误概念：${concept}`,
        `报错原文：${snapshot.message}`,
        `报错行：${snapshot.errorLine}`,
        "相关代码：",
        lineWindow(snapshot.code, snapshot.errorLine)
      ].join("\n")
    );

    if (!response.hint?.trim()) {
      throw new Error("模型没有返回有效提示");
    }

    const hint = response.hint.trim();
    assertSafeHint(hint);
    return hint;
  }

  async generateAnswer(
    snapshot: DiagnosticSnapshot,
    concept: MisconceptionId
  ): Promise<AnswerContent> {
    if (this.demoMode) {
      const cached = this.demoAnswer?.(concept, snapshot);
      if (cached) {
        return cached;
      }
      throw new Error("演示模式下没有匹配的答案缓存");
    }

    if (!this.client) {
      throw new Error("API 客户端未配置");
    }

    const language = snapshot.language ?? "python";
    const response = await this.client.completeJson<AnswerResponse>(
      [
        `目标是 ${LANGUAGE_LABELS[language]} 代码。`,
        "用户已经尝试并主动点击了“看答案”。",
        "只修改报错所在的完整代码部分，不要返回完整文件，也不要扩大到无关的函数、循环或代码块。",
        "完整代码部分必须是一个可以直接替换的语法单位，例如完整语句、完整循环、完整条件、完整函数调用或对应代码块。",
        "不能只截取报错行：如果报错属于多行语句、多行表达式、循环或代码块，startLine 和 endLine 必须覆盖该部分的全部行。",
        "code 字段必须包含 startLine 到 endLine 的完整替换内容，保留原有缩进、花括号和代码块内部内容，不包含 Markdown 代码围栏。",
        "startLine 和 endLine 必须使用当前完整代码的 1-based 行号，包含结束行。",
        "只有修复一个完整单行语句时，startLine 和 endLine 才相同。",
        "explanation 单独解释核心原因，不要在解释里混入完整代码。",
        "不要修改用户文件，只输出教学结果。",
        "输出 JSON：{\"code\":\"...\",\"explanation\":\"...\",\"startLine\":1,\"endLine\":1}"
      ].join("\n"),
      [
        `语言：${LANGUAGE_LABELS[language]}`,
        `误概念：${concept}`,
        `报错原文：${snapshot.message}`,
        `报错行：${snapshot.errorLine}`,
        "当前完整代码（行号仅用于定位）：",
        numberedCode(snapshot.code)
      ].join("\n")
    );

    const code = normalizeAnswerCode(response.code ?? "");
    const explanation = response.explanation?.trim() ?? "";
    if (!code || !explanation) {
      throw new Error("模型没有返回有效答案");
    }

    const totalLines = lineCount(snapshot.code);
    const fallbackLine = lineNumber(
      snapshot.errorLine,
      1,
      totalLines
    );
    const hasRequestedRange =
      response.startLine !== undefined ||
      response.endLine !== undefined;
    const requestedStartLine = lineNumber(
      response.startLine,
      fallbackLine,
      totalLines
    );
    const requestedEndLine = Math.max(
      requestedStartLine,
      lineNumber(response.endLine, requestedStartLine, totalLines)
    );
    const requestedRange = {
      startLine: requestedStartLine,
      endLine: requestedEndLine
    };
    const completeRange = inferCodePartRange(
      snapshot.code,
      language,
      fallbackLine
    );
    const useCompleteRange =
      !hasRequestedRange ||
      (requestedRange.startLine >= completeRange.startLine &&
        requestedRange.endLine <= completeRange.endLine);
    const startLine = useCompleteRange
      ? completeRange.startLine
      : requestedRange.startLine;
    const endLine = useCompleteRange
      ? completeRange.endLine
      : requestedRange.endLine;
    const answerCode = !hasRequestedRange
      ? code
      : useCompleteRange
        ? mergeAnswerIntoCodePart(
            snapshot.code,
            selectAnswerSnippet(
              code,
              snapshot.code,
              requestedRange.startLine,
              requestedRange.endLine
            ),
            requestedRange,
            completeRange
          )
        : selectAnswerSnippet(
            code,
            snapshot.code,
            requestedRange.startLine,
            requestedRange.endLine
          );
    const selectedCode = selectAnswerSnippet(
      answerCode,
      snapshot.code,
      startLine,
      endLine
    );

    return {
      code: selectedCode,
      explanation,
      startLine,
      endLine
    };
  }
}

const KEYWORDS: Record<
  MisconceptionId,
  { correct: readonly string[]; partial: readonly string[] }
> = {
  off_by_one: {
    correct: ["结束值", "边界", "多跑", "越界", "最后一个", "len - 1", "len-1"],
    partial: ["range", "循环", "索引", "下标"]
  },
  return_vs_print: {
    correct: ["return", "返回", "交出去", "none", "调用者"],
    partial: ["print", "打印", "函数结果", "输出"]
  },
  type_mismatch: {
    correct: ["str", "int", "转换", "拼接", "字符串", "整数"],
    partial: ["类型", "数字", "文字", "加法", "操作数"]
  },
  name_error: {
    correct: ["先定义", "赋值", "未定义", "拼写", "变量名"],
    partial: ["变量", "名称", "定义"]
  },
  syntax_error: {
    correct: ["冒号", "括号", "引号", "语法", "缺少"],
    partial: ["写错", "符号", "格式"]
  },
  key_error: {
    correct: ["键不存在", "get", "in", "字典键"],
    partial: ["字典", "键", "key"]
  },
  value_error: {
    correct: ["输入格式", "转换失败", "非法值", "不能转换"],
    partial: ["值", "格式", "转换"]
  },
  zero_division: {
    correct: ["除数为零", "分母为零", "不能除以零", "先判断"],
    partial: ["除数", "分母", "零"]
  },
  attribute_error: {
    correct: ["对象类型", "没有这个属性", "方法名", "类型不对"],
    partial: ["属性", "方法", "对象"]
  },
  import_error: {
    correct: ["没有安装", "模块名", "解释器环境", "导入路径"],
    partial: ["导入", "模块", "包"]
  },
  indentation_error: {
    correct: ["缩进", "空格", "tab", "代码块"],
    partial: ["对齐", "层级", "格式"]
  },
  null_reference: {
    correct: ["为空", "null", "undefined", "判空", "空值"],
    partial: ["对象", "属性", "初始化"]
  },
  index_out_of_bounds: {
    correct: ["越界", "长度", "索引范围", "小于长度"],
    partial: ["索引", "数组", "下标"]
  },
  class_cast_error: {
    correct: ["实际类型", "类型不兼容", "强制转换", "instanceof"],
    partial: ["类型", "转换", "对象"]
  },
  async_error: {
    correct: ["promise", "catch", "await", "异步", "拒绝"],
    partial: ["异步", "回调", "任务"]
  }
};

function containsAny(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

export function judgeByKeywords(
  concept: MisconceptionId,
  userAnswer: string
): judgmentValue {
  const keywords = KEYWORDS[concept];
  if (containsAny(userAnswer, keywords.correct)) {
    return "correct";
  }
  if (containsAny(userAnswer, keywords.partial)) {
    return "partial";
  }
  return "wrong";
}

export async function judgeUnderstanding(
  concept: MisconceptionId,
  userAnswer: string,
  client?: JsonCompleter,
  snapshot?: DiagnosticSnapshot,
  referenceAnswer?: AnswerContent,
  userCode?: string,
  options: UnderstandingJudgeOptions = {}
): Promise<UnderstandingResult> {
  const language: SupportedLanguage = snapshot?.language ?? "python";
  if (client) {
    try {
      const response = await client.completeJson<JudgmentResponse>(
        [
          `比较 ${LANGUAGE_LABELS[language]} 初学者的理解或代码与标准答案的接近度。`,
          "正确代码执行成功不代表解释分值；必须按接近标准答案判断。",
          "correct：核心机制正确，closeness >= 0.75。",
          "partial：方向接近，closeness 0.40 到 0.74。",
          "wrong：归因或代码方向错误，closeness < 0.40。",
          "标准答案可能只是一段需要替换的最小代码片段，不是完整文件。",
          "只输出 JSON：{\"judgment\":\"correct|partial|wrong\",\"closeness\":0.0,\"reason\":\"...\"}"
        ].join("\n"),
        [
          `语言：${LANGUAGE_LABELS[language]}`,
          `误概念：${concept}`,
          `报错原文：${snapshot?.message ?? "未提供"}`,
          `报错行：${snapshot?.errorLine ?? "未提供"}`,
          "相关代码：",
          snapshot ? lineWindow(snapshot.code, snapshot.errorLine) : "未提供",
          `标准修正片段：${referenceAnswer?.code ?? "未提供"}`,
          `标准解释：${referenceAnswer?.explanation ?? "未提供"}`,
          `学生回答：${userAnswer || "未提供"}`,
          `学生当前代码：${userCode ?? "未提供"}`
        ].join("\n")
      );

      if (
        response.judgment === "correct" ||
        response.judgment === "partial" ||
        response.judgment === "wrong"
      ) {
        const fallbackCloseness =
          response.judgment === "correct"
            ? 0.9
            : response.judgment === "partial"
              ? 0.55
              : 0.15;
        return {
          judgment: response.judgment,
          reason: response.reason ?? "AI 判断",
          closeness: Math.round(
            Math.max(
              0,
              Math.min(1, response.closeness ?? fallbackCloseness)
            ) * 100
          ) / 100
        };
      }
    } catch (error) {
      if (options.throwOnApiError) {
        throw error;
      }
      // Fall through to deterministic keyword matching.
    }
  }

  const judgment = judgeByKeywords(concept, userAnswer);
  return {
    judgment,
    reason: "使用关键词兜底判断",
    closeness:
      judgment === "correct" ? 0.9 : judgment === "partial" ? 0.55 : 0.15
  };
}
