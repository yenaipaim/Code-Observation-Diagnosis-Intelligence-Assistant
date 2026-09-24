import { judgeByKeywords } from "./hintGenerator";
import {
  AnswerContent,
  Classification,
  DiagnosticSnapshot,
  HintIndex,
  MisconceptionId,
  UnderstandingResult
} from "./types";

const DEMO_HINTS: Record<
  MisconceptionId,
  Record<HintIndex, string>
> = {
  off_by_one: {
    1: "把 range 的两个参数写出来。列表有 5 个元素时，range 最后一个值会让循环变量停在哪里？",
    2: "手动列出循环变量每一轮的值，尤其看最后一轮访问了哪个索引。",
    3: "列表索引从 0 开始，最后一个合法索引是 len(nums) - 1。你的循环边界覆盖到了哪里？"
  },
  return_vs_print: {
    1: "函数里的结果现在去了屏幕，还是交给了调用它的那行代码？",
    2: "print 把值显示出来，return 才把值交给调用者。你的调用者拿到了什么？",
    3: "函数没有 return 时，Python 默认返回 None。这个 None 后面怎么被使用了？"
  },
  type_mismatch: {
    1: "加号两边的两个值分别是什么类型？它们允许直接做同一种运算吗？",
    2: "数字 3 和文字 \"3\" 不是同一类。你的表达式里哪一边是数字，哪一边是文字？",
    3: "如果一边是数字、一边是文字，需要用 str() 或 int() 明确转换。你想保留哪一种类型？"
  },
  name_error: {
    1: "这个名称在哪一行被赋值或定义？它执行到了吗？",
    2: "检查名称拼写，并确认定义和使用是不是在同一个作用域。",
    3: "Python 执行到使用位置前，名称必须已经存在；先把定义放到使用之前。"
  },
  syntax_error: {
    1: "检查这一行的冒号、括号、引号和运算符是否完整。",
    2: "找一条相似的正确语句，逐项比较符号。",
    3: "条件、循环和函数头通常需要冒号，括号和引号必须成对。"
  },
  key_error: {
    1: "这个键真的存在于字典里吗？先打印所有键看看。",
    2: "访问前可以先用 in 判断键是否存在。",
    3: "如果不确定键是否存在，使用 dict.get() 可以提供默认值。"
  },
  value_error: {
    1: "参与转换的原始值是什么？打印它看看格式。",
    2: "数字转换只能接受合法数字文本，空格和字母会导致失败。",
    3: "转换前先校验输入，或捕获 ValueError 并给出提示。"
  },
  zero_division: {
    1: "除数在运算时是多少？它有没有可能变成零？",
    2: "打印除数，检查它如何被计算或更新。",
    3: "相除前先判断除数不为零，再执行除法。"
  },
  attribute_error: {
    1: "这个变量现在是什么类型？它真的有这个属性吗？",
    2: "打印 type(value)，再核对正确的方法名称。",
    3: "不同对象拥有不同方法，字符串、列表和数字不能混用方法。"
  },
  import_error: {
    1: "模块名拼写正确吗？当前解释器环境里有这个模块吗？",
    2: "确认第三方包是否安装在当前 Python 环境中。",
    3: "标准库、第三方包和本地文件的导入方式不同，先核对来源。"
  },
  indentation_error: {
    1: "冒号后的代码块缩进了吗？",
    2: "同一代码块的语句需要保持相同缩进。",
    3: "不要混用 tab 和空格，统一使用一种缩进方式。"
  }
};

const DEMO_ANSWER_EXPLANATIONS: Record<MisconceptionId, string> = {
  off_by_one:
    "循环多访问了一次。把结束边界改为 len(nums)，让最后一个有效索引保持为 len(nums) - 1。",
  return_vs_print:
    "函数需要把结果交给调用者。使用 return 返回需要的值，调用处才能拿到它并继续使用。",
  type_mismatch:
    "加号两边类型不同。根据目标结果使用 str() 或 int() 明确转换，让两个操作数类型一致。",
  name_error:
    "名称在使用前必须先赋值或定义。把定义移到使用之前，并检查拼写和作用域。",
  syntax_error:
    "语法错误来自不完整的语句结构。检查冒号、括号、引号和运算符，使代码符合 Python 规则。",
  key_error:
    "访问字典前要确认键存在。使用 in 判断，或用 get() 为缺失键提供默认值。",
  value_error:
    "转换或操作收到了不符合格式的值。检查输入内容，先校验再转换。",
  zero_division:
    "除数不能为零。相除前先判断除数，必要时返回默认值或跳过计算。",
  attribute_error:
    "当前对象没有这个属性。先确认对象类型，再使用该类型实际拥有的方法。",
  import_error:
    "Python 找不到目标模块。检查模块名、安装环境和导入路径。",
  indentation_error:
    "代码块缩进不正确。统一使用空格或 tab，并保持同一层级对齐。"
};

function demoAnswerCode(
  concept: MisconceptionId,
  snapshot: DiagnosticSnapshot
): string {
  if (concept === "off_by_one") {
    if (/\bwhile\b/.test(snapshot.code)) {
      return [
        "nums = [10, 20, 30]",
        "i = 0",
        "while i < len(nums):",
        "    print(nums[i])",
        "    i += 1"
      ].join("\n");
    }
    return [
      "nums = [10, 20, 30]",
      "for i in range(len(nums)):",
      "    print(nums[i])"
    ].join("\n");
  }

  if (concept === "return_vs_print") {
    return [
      "def make_message():",
      '    return "hello"',
      "",
      "message = make_message()",
      "print(message)"
    ].join("\n");
  }

  if (concept === "name_error") {
    return [
      'name = "Alice"',
      "print(name)"
    ].join("\n");
  }

  if (concept === "syntax_error") {
    return [
      "for i in range(3):",
      "    print(i)"
    ].join("\n");
  }

  if (concept === "key_error") {
    return [
      'person = {"name": "Alice"}',
      'print(person.get("age", "unknown"))'
    ].join("\n");
  }

  if (concept === "value_error") {
    return [
      'text = "123"',
      "number = int(text)",
      "print(number)"
    ].join("\n");
  }

  if (concept === "zero_division") {
    return [
      "total = 10",
      "count = 0",
      "result = total / count if count else 0",
      "print(result)"
    ].join("\n");
  }

  if (concept === "attribute_error") {
    return [
      'text = "hello"',
      "print(text.upper())"
    ].join("\n");
  }

  if (concept === "import_error") {
    return [
      "import math",
      "print(math.sqrt(9))"
    ].join("\n");
  }

  if (concept === "indentation_error") {
    return [
      "if True:",
      '    print("ok")'
    ].join("\n");
  }

  return [
    "age = 18",
    'print("Age: " + str(age))'
  ].join("\n");
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
  return {
    code: demoAnswerCode(concept, snapshot),
    explanation: DEMO_ANSWER_EXPLANATIONS[concept]
  };
}

export function demoClassify(
  snapshot: DiagnosticSnapshot
): Classification | undefined {
  const message = snapshot.message.toLowerCase();
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
  return undefined;
}
