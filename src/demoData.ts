import { judgeByKeywords } from "./hintGenerator";
import {
  AnswerContent,
  Classification,
  DiagnosticSnapshot,
  HintIndex,
  MisconceptionId,
  SupportedLanguage,
  UnderstandingResult
} from "./types";

const DEMO_HINTS: Record<
  MisconceptionId,
  Record<HintIndex, string>
> = {
  off_by_one: {
    1: "循环开始和结束的边界分别是什么？最后一次循环访问了哪个位置？",
    2: "手动列出循环变量每一轮的值，尤其看最后一轮访问了哪个索引。",
    3: "索引从 0 开始，最后一个合法索引是长度减一。你的循环边界覆盖到了哪里？"
  },
  return_vs_print: {
    1: "函数里的结果现在去了屏幕，还是交给了调用它的那行代码？",
    2: "print 把值显示出来，return 才把值交给调用者。你的调用者拿到了什么？",
    3: "函数没有 return 时，Python 默认返回 None。这个 None 后面怎么被使用了？"
  },
  type_mismatch: {
    1: "加号两边的两个值分别是什么类型？它们允许直接做同一种运算吗？",
    2: "数字 3 和文字 \"3\" 不是同一类。你的表达式里哪一边是数字，哪一边是文字？",
    3: "如果一边是数字、一边是文字，需要使用当前语言提供的显式转换。你想保留哪一种类型？"
  },
  name_error: {
    1: "这个名称在哪一行被赋值或定义？它执行到了吗？",
    2: "检查名称拼写，并确认定义和使用是不是在同一个作用域。",
    3: "执行到使用位置前，名称必须已经存在；先把定义放到使用之前。"
  },
  syntax_error: {
    1: "检查这一行的括号、引号、分隔符和语句结尾是否完整。",
    2: "找一条相似的正确语句，逐项比较符号。",
    3: "条件、循环和函数必须符合当前语言的块结构，括号和引号要成对。"
  },
  key_error: {
    1: "这个键真的存在于字典里吗？先打印所有键看看。",
    2: "访问前可以先用 in 判断键是否存在。",
    3: "如果不确定键是否存在，使用 dict.get() 可以提供默认值。"
  },
  value_error: {
    1: "参与转换的原始值是什么？打印它看看格式。",
    2: "数字转换只能接受合法数字文本，空格和字母会导致失败。",
    3: "转换前先校验输入，或捕获当前语言的转换异常并给出提示。"
  },
  zero_division: {
    1: "除数在运算时是多少？它有没有可能变成零？",
    2: "打印除数，检查它如何被计算或更新。",
    3: "相除前先判断除数不为零，再执行除法。"
  },
  attribute_error: {
    1: "这个变量现在是什么类型？它真的有这个属性吗？",
    2: "核对对象的实际类型和可用成员名称。",
    3: "不同对象拥有的属性或方法不同，不能混用。"
  },
  import_error: {
    1: "导入名拼写正确吗？当前运行环境里有这个模块吗？",
    2: "确认目标模块是否在当前运行环境中可用。",
    3: "标准库、第三方包和本地文件的导入方式不同，先核对来源。"
  },
  indentation_error: {
    1: "冒号后的代码块缩进了吗？",
    2: "同一代码块的语句需要保持相同缩进。",
    3: "不要混用 tab 和空格，统一使用一种缩进方式。"
  },
  null_reference: {
    1: "这个值在使用前确定已经创建吗？",
    2: "查看对象来源，哪条路径可能留下了 null 或 undefined？",
    3: "访问属性或方法前先判断空值。"
  },
  index_out_of_bounds: {
    1: "索引和集合长度相比，哪个更大？",
    2: "列出合法索引范围，检查最后一次访问的位置。",
    3: "索引必须小于数组、字符串或集合的长度。"
  },
  class_cast_error: {
    1: "转换前对象实际是什么类型？",
    2: "查看变量赋值位置，确认它是否真的是目标类型。",
    3: "转换前使用类型判断，只处理兼容的实例。"
  },
  async_error: {
    1: "这个异步任务失败后由谁处理？",
    2: "找到缺失的 await、then 或 catch。",
    3: "使用 try/catch 或 Promise catch 处理异步拒绝。"
  }
};

const DEMO_ANSWER_EXPLANATIONS: Record<MisconceptionId, string> = {
  off_by_one:
    "循环多访问了一次。把结束边界改为容器长度，让最后一个有效索引保持为长度减一。",
  return_vs_print:
    "函数需要把结果交给调用者。使用 return 返回需要的值，调用处才能拿到它并继续使用。",
  type_mismatch:
    "加号两边类型不同。根据目标结果使用当前语言提供的显式转换，让两个操作数类型一致。",
  name_error:
    "名称在使用前必须先赋值或定义。把定义移到使用之前，并检查拼写和作用域。",
  syntax_error:
    "语法错误来自不完整的语句结构。检查括号、引号、分隔符和块边界，使代码符合当前语言规则。",
  key_error:
    "访问字典前要确认键存在。使用 in 判断，或用 get() 为缺失键提供默认值。",
  value_error:
    "转换或操作收到了不符合格式的值。检查输入内容，先校验再转换。",
  zero_division:
    "除数不能为零。相除前先判断除数，必要时返回默认值或跳过计算。",
  attribute_error:
    "当前对象没有这个属性。先确认对象类型，再使用该类型实际拥有的方法。",
  import_error:
    "当前语言找不到目标模块。检查模块名、运行环境和导入路径。",
  indentation_error:
    "代码块缩进不正确。统一使用空格或 tab，并保持同一层级对齐。",
  null_reference:
    "访问前确认对象存在。为空时提前返回、使用默认值或创建对象。",
  index_out_of_bounds:
    "访问位置超出合法范围。先检查长度，并让索引始终小于长度。",
  class_cast_error:
    "对象实际类型与转换目标不兼容。转换前先检查类型或调整设计。",
  async_error:
    "异步任务失败后需要处理。使用 try/catch 或 Promise catch 接收错误。"
};

function demoAnswerCode(
  language: SupportedLanguage,
  concept: MisconceptionId,
  snapshot: DiagnosticSnapshot
): string {
  const whileLoop = /\bwhile\b/.test(snapshot.code);

  if (concept === "off_by_one") {
    if (language === "java") {
      return whileLoop
        ? "while (i < values.length) {"
        : "for (int i = 0; i < values.length; i++) {";
    }
    if (language === "javascript") {
      return whileLoop
        ? "while (i < values.length) {"
        : "for (let i = 0; i < values.length; i++) {";
    }
    return whileLoop ? "while i < len(nums):" : "for i in range(len(nums)):";
  }

  if (concept === "return_vs_print") {
    return '    return "hello"';
  }

  if (concept === "type_mismatch") {
    if (language === "java") {
      return "int age = Integer.parseInt(text);";
    }
    if (language === "javascript") {
      return "const age = Number(text);";
    }
    return "age = int(text)";
  }

  if (concept === "name_error") {
    if (language === "java") {
      return "int score = 0;";
    }
    if (language === "javascript") {
      return "let score = 0;";
    }
    return 'name = "Alice"';
  }

  if (concept === "syntax_error") {
    if (language === "java") {
      return "for (int i = 0; i < 3; i++) { System.out.println(i); }";
    }
    if (language === "javascript") {
      return "for (let i = 0; i < 3; i++) { console.log(i); }";
    }
    return "for i in range(3):";
  }

  if (concept === "key_error") {
    return 'person.get("age", "unknown")';
  }

  if (concept === "value_error") {
    if (language === "java") {
      return "int number = Integer.parseInt(text);";
    }
    if (language === "javascript") {
      return "const number = Number.parseInt(text, 10);";
    }
    return "number = int(text)";
  }

  if (concept === "zero_division") {
    if (language === "java") {
      return "int result = count == 0 ? 0 : total / count;";
    }
    if (language === "javascript") {
      return "const result = count === 0 ? 0 : total / count;";
    }
    return "result = total / count if count else 0";
  }

  if (concept === "attribute_error") {
    if (language === "javascript") {
      return "console.log(text.trim());";
    }
    if (language === "java") {
      return "String text = String.valueOf(value);";
    }
    return "print(text.upper())";
  }

  if (concept === "import_error") {
    if (language === "java") {
      return "import java.util.List;";
    }
    if (language === "javascript") {
      return 'import path from "node:path";';
    }
    return "import math";
  }

  if (concept === "indentation_error") {
    return '    print("ok")';
  }

  if (concept === "null_reference") {
    if (language === "java") {
      return "if (value != null) value.trim();";
    }
    if (language === "javascript") {
      return "value?.trim();";
    }
    return 'value = value or ""';
  }

  if (concept === "index_out_of_bounds") {
    if (language === "java") {
      return "if (index < values.length) { result = values[index]; }";
    }
    if (language === "javascript") {
      return "if (index < values.length) { result = values[index]; }";
    }
    return "if index < len(values): value = values[index]";
  }

  if (concept === "class_cast_error") {
    if (language === "java") {
      return "if (value instanceof String text) { result = text.length(); }";
    }
    return "if (value instanceof String) { value = value.valueOf(); }";
  }

  if (concept === "async_error") {
    if (language === "javascript") {
      return "await task().catch((error) => console.error(error));";
    }
    return "result = task.catch((error) => console.error(error));";
  }

  return 'print("Age: " + str(age))';
}

export function demoHint(
  concept: MisconceptionId,
  hintIndex: HintIndex,
  snapshot: DiagnosticSnapshot
): string {
  if (concept === "off_by_one" && /\bwhile\b/.test(snapshot.code)) {
    const variants: Record<HintIndex, string> = {
      1: "检查 while 条件。循环变量什么时候会等于 len(nums)，那一轮访问合法吗？",
      2: "把 while 每一轮的 i 和 len(nums) 写出来，看最后一轮发生了什么。",
      3: "最后一个合法索引是 len(nums) - 1。while 条件需要保证 i 不超过它。"
    };
    return variants[hintIndex];
  }

  return DEMO_HINTS[concept][hintIndex];
}

export function demoJudgment(
  concept: MisconceptionId,
  answer: string
): UnderstandingResult {
  const judgment = judgeByKeywords(concept, answer);
  const reasons = {
    correct: "命中核心机制，演示模式判定为正确。",
    partial: "方向接近，但还没有说清具体原因。",
    wrong: "归因没有命中当前误概念。"
  } as const;

  return {
    judgment,
    reason: reasons[judgment],
    closeness:
      judgment === "correct" ? 0.9 : judgment === "partial" ? 0.55 : 0.15
  };
}

export function demoAnswer(
  concept: MisconceptionId,
  snapshot: DiagnosticSnapshot
): AnswerContent {
  const totalLines = Math.max(
    1,
    snapshot.code.replace(/\r\n?/g, "\n").split("\n").length
  );
  const line = Math.min(
    Math.max(1, Math.trunc(snapshot.errorLine)),
    totalLines
  );
  return {
    code: demoAnswerCode(
      snapshot.language ?? "python",
      concept,
      snapshot
    ),
    explanation: DEMO_ANSWER_EXPLANATIONS[concept],
    startLine: line,
    endLine: line
  };
}

export function demoClassify(
  snapshot: DiagnosticSnapshot
): Classification | undefined {
  const message = snapshot.message.toLowerCase();
  const language = snapshot.language ?? "python";

  if (language === "java") {
    if (message.includes("nullpointerexception")) {
      return { concept: "null_reference", confidence: 0.8, source: "rule" };
    }
    if (
      message.includes("arrayindexoutofboundsexception") ||
      message.includes("stringindexoutofboundsexception")
    ) {
      return {
        concept: "index_out_of_bounds",
        confidence: 0.8,
        source: "rule"
      };
    }
    if (
      message.includes("classcastexception") ||
      message.includes("cannot be cast to")
    ) {
      return {
        concept: "class_cast_error",
        confidence: 0.8,
        source: "rule"
      };
    }
  }

  if (language === "javascript") {
    if (
      message.includes("unhandledpromiserejection") ||
      message.includes("unhandled promise rejection")
    ) {
      return { concept: "async_error", confidence: 0.8, source: "rule" };
    }
    if (
      message.includes("cannot read properties of null") ||
      message.includes("cannot read properties of undefined")
    ) {
      return { concept: "null_reference", confidence: 0.8, source: "rule" };
    }
  }

  if (message.includes("indexerror")) {
    return { concept: "off_by_one", confidence: 0.8, source: "rule" };
  }
  if (message.includes("nonetype") || message.includes("is none")) {
    return { concept: "return_vs_print", confidence: 0.8, source: "rule" };
  }
  if (message.includes("typeerror")) {
    return { concept: "type_mismatch", confidence: 0.8, source: "rule" };
  }
  if (message.includes("nameerror")) {
    return { concept: "name_error", confidence: 0.8, source: "rule" };
  }
  if (message.includes("syntaxerror")) {
    return { concept: "syntax_error", confidence: 0.8, source: "rule" };
  }
  if (message.includes("keyerror")) {
    return { concept: "key_error", confidence: 0.8, source: "rule" };
  }
  if (message.includes("valueerror")) {
    return { concept: "value_error", confidence: 0.8, source: "rule" };
  }
  if (message.includes("zerodivisionerror")) {
    return { concept: "zero_division", confidence: 0.8, source: "rule" };
  }
  if (message.includes("attributeerror")) {
    return { concept: "attribute_error", confidence: 0.8, source: "rule" };
  }
  if (message.includes("modulenotfounderror") || message.includes("importerror")) {
    return { concept: "import_error", confidence: 0.8, source: "rule" };
  }
  if (message.includes("indentationerror")) {
    return { concept: "indentation_error", confidence: 0.8, source: "rule" };
  }

  if (
    language === "java" &&
    message.includes("numberformatexception")
  ) {
    return { concept: "value_error", confidence: 0.8, source: "rule" };
  }

  if (
    language === "javascript" &&
    message.includes("referenceerror")
  ) {
    return { concept: "name_error", confidence: 0.8, source: "rule" };
  }

  return undefined;
}
