(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const view = document.body.dataset.view || "panel";
  let state;
  let timeline = [];
  let progress = [];
  let conceptOptions = [];
  let focusEntryId;
  const conceptLabels = {
    off_by_one: "差一错误",
    return_vs_print: "返回值 vs 打印",
    type_mismatch: "类型混淆"
  };

  const icons = {
    play: '<path d="m7 4 10 8-10 8z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15 8 3 3"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    skip: '<path d="m5 4 10 8-10 8z"/><path d="M19 5v14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16V4h12"/>',
    insert: '<path d="M12 5v14"/><path d="m5 12 7 7 7-7"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (icons[name] || "") +
      "</svg>";
  }

  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function actionButton(label, iconName, type, className) {
    const button = element("button", className || "");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon(iconName);
    button.append(document.createTextNode(label));
    if (type) {
      button.addEventListener("click", function () {
        vscode.postMessage({ type: type });
      });
    }
    return button;
  }

  function payloadButton(label, iconName, payload, className) {
    const button = element("button", className || "");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon(iconName);
    button.append(document.createTextNode(label));
    button.addEventListener("click", function () {
      vscode.postMessage(payload);
    });
    return button;
  }

  function iconButton(label, iconName, payload, className) {
    const button = element("button", "icon-button " + (className || ""));
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon(iconName);
    button.addEventListener("click", function () {
      vscode.postMessage(payload);
    });
    return button;
  }

  function topLine(label, status) {
    const line = element("div", "topline");
    const titleWrap = element("div", "level-title");
    titleWrap.append(element("span", "status-dot " + status));
    titleWrap.append(document.createTextNode(label));
    line.append(titleWrap);
    return line;
  }

  function section(title, content) {
    const node = element("section", "section");
    if (title) {
      node.append(element("div", "eyebrow", title));
    }
    node.append(content);
    return node;
  }

  function understandingBox(placeholder, submitLabel, includeSkip) {
    const sectionNode = element("section", "section");
    sectionNode.append(element("div", "eyebrow", "理解验证"));
    const textarea = element("textarea");
    textarea.placeholder = placeholder;
    textarea.setAttribute("aria-label", placeholder);
    sectionNode.append(textarea);

    const actions = element("div", "actions");
    const submit = actionButton(submitLabel, "send", null);
    submit.addEventListener("click", function () {
      vscode.postMessage({ type: "submit", value: textarea.value });
    });
    actions.append(submit);
    if (includeSkip) {
      actions.append(actionButton("跳过解释", "skip", "skip", "secondary"));
    }
    sectionNode.append(actions);
    return sectionNode;
  }

  function renderPanel() {
    clear(app);
    if (!state) {
      app.append(element("div", "empty", "等待报错诊断..."));
      return;
    }

    const complete = state.stage === "completed";
    const error = state.stage === "diagnose" || state.stage === "guiding";
    app.append(
      topLine(
        state.level
          ? "当前关卡：" + state.conceptLabel
          : "调试教练",
        complete ? "success" : error ? "error" : ""
      )
    );

    if (state.stage === "empty") {
      app.append(element("div", "empty", "运行 Python 代码，出现报错后这里会开始引导。"));
      return;
    }

    if (state.stage === "configuration") {
      const notice = element("div", "notice");
      notice.append(element("strong", "", "需要配置"));
      notice.append(element("p", "message", state.message));
      const actions = element("div", "actions");
      actions.append(actionButton("设置 API", "key", "configure"));
      notice.append(actions);
      app.append(section("", notice));
      return;
    }

    const message = element("p", "message", state.message);
    app.append(section(state.stage === "diagnose" ? "为什么报错" : "当前进展", message));

    if (state.stage === "diagnose") {
      const actions = element("div", "actions");
      actions.append(actionButton("开始闯关", "play", "start"));
      app.append(section("", actions));
      return;
    }

    if (state.stage === "guiding") {
      if (state.hint) {
        app.append(section("提示 " + state.hintIndex, element("p", "hint", state.hint)));
      }
      if (state.closeness !== undefined) {
        app.append(
          section(
            "AI 接近度",
            element(
              "p",
              "message",
              "与标准答案接近度 " + Math.round(state.closeness * 100) + "%"
            )
          )
        );
      }
      app.append(
        understandingBox("说说你的理解...", "提交", false)
      );
      const actions = element("div", "actions");
      actions.append(actionButton("换个提示", "bulb", "hint", "secondary"));
      const reveal = actionButton(state.answerLabel, "check", "reveal");
      actions.append(reveal);
      app.append(section("", actions));
      const meta = element("div", "meta-row");
      meta.append(element("span", "", "你已经尝试了 " + state.attempts + " 次"));
      if (state.level && state.level.repeatCount > 0) {
        meta.append(
          element(
            "span",
            "badge",
            "重复关卡 · 本次得分 x" + state.level.scoreMultiplier
          )
        );
      }
      if (state.badge) {
        meta.append(element("span", "badge", state.badge));
      }
      app.append(meta);
      return;
    }

    if (state.stage === "duplicate") {
      const actions = element("div", "actions");
      if (state.duplicate) {
        actions.append(
          payloadButton("查看上次错误", "history", {
            type: "open-log-entry",
            id: state.duplicate.entryId
          }, "secondary")
        );
      }
      actions.append(
        actionButton("判为新错误", "play", "treat-as-new")
      );
      app.append(section("", actions));
      return;
    }

    if (state.stage === "verifying") {
      if (state.closeness !== undefined) {
        app.append(
          section(
            "AI 接近度",
            element(
              "p",
              "message",
              "与标准答案接近度 " + Math.round(state.closeness * 100) + "%"
            )
          )
        );
      }
      app.append(
        understandingBox(
          "说说你刚才改了什么...",
          "提交理解",
          Boolean(state.canSkipUnderstanding)
        )
      );
      return;
    }

    if (state.stage === "completed") {
      if (state.answer) {
        const codeSection = element("section", "section");
        codeSection.append(element("div", "eyebrow", "可运行代码"));
        const pre = element("pre", "code-block");
        const code = element("code");
        code.textContent = state.answer.code;
        pre.append(code);
        codeSection.append(pre);

        const codeActions = element("div", "actions");
        codeActions.append(
          payloadButton("复制", "copy", {
            type: "copy-answer",
            code: state.answer.code
          }, "secondary")
        );
        codeActions.append(
          payloadButton("插入", "insert", {
            type: "insert-answer",
            code: state.answer.code
          })
        );
        codeSection.append(codeActions);
        app.append(codeSection);
        app.append(
          section("解释", element("p", "message", state.answer.explanation))
        );
      }
      const actions = element("div", "actions");
      actions.append(actionButton("打开学习日志", "history", "open-log", "secondary"));
      app.append(section("", actions));
      const meta = element("div", "meta-row");
      meta.append(element("span", "", "理解度 " + Math.round(state.confidence * 100) + "%"));
      if (state.badge) {
        meta.append(element("span", "badge", state.badge));
      }
      app.append(meta);
    }
  }

  function resolutionLabel(resolution) {
    if (resolution === "independent") {
      return "独立解决";
    }
    if (resolution === "after_hint") {
      return "提示后解决";
    }
    if (resolution === "viewed_answer") {
      return "看了答案";
    }
    return "理解未验证";
  }

  function renderLog() {
    clear(app);
    app.append(topLine("学习日志", "success"));

    const clearActions = element("div", "actions log-actions");
    clearActions.append(
      actionButton(
        "清除历史时间线",
        "trash",
        "clear-timeline",
        "secondary"
      )
    );
    clearActions.append(
      actionButton("一键清除", "trash", "clear-all", "danger")
    );
    app.append(section("", clearActions));

    const progressSection = element("section", "section");
    progressSection.append(element("div", "eyebrow", "掌握度"));
    const picker = element("div", "concept-picker");
    conceptOptions.forEach(function (item) {
      const option = element("label", "concept-option");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.selected;
      checkbox.addEventListener("change", function () {
        vscode.postMessage({
          type: "toggle-concept",
          concept: item.concept,
          checked: checkbox.checked
        });
      });
      option.append(checkbox, document.createTextNode(item.label));
      picker.append(option);
    });
    progressSection.append(picker);
    if (!progress.length) {
      progressSection.append(
        element("p", "message", "默认不统计。请选择错误类型，或由运行报错自动勾选。")
      );
    }
    progress.forEach(function (item) {
      const wrap = element("div", "progress-item");
      const head = element("div", "progress-head");
      head.append(element("span", "", item.label));
      head.append(element("span", "log-time", Math.round(item.confidence * 100) + "% · " + item.status));
      const track = element("div", "progress-track");
      const value = element("div", "progress-value");
      value.style.width = Math.round(item.confidence * 100) + "%";
      track.append(value);
      wrap.append(head, track);
      progressSection.append(wrap);
    });
    app.append(progressSection);

    const listSection = element("section", "section");
    listSection.append(element("div", "eyebrow", "错误时间线"));
    if (!timeline.length) {
      listSection.append(element("p", "message", "还没有闯关记录。"));
      app.append(listSection);
      return;
    }

    const list = element("ol", "log-list");
    timeline.forEach(function (entry) {
      const item = element("li", "log-item");
      item.dataset.entryId = entry.id;
      const head = element("div", "log-head");
      head.append(element("span", "log-title", entry.fileName));
      const time = new Date(entry.timestamp);
      const side = element("div", "log-side");
      side.append(
        element(
          "span",
          "log-time",
          time.toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          })
        )
      );
      side.append(
        iconButton("删除这条记录", "trash", {
          type: "delete-entry",
          id: entry.id
        }, "danger")
      );
      head.append(side);
      item.append(head);
      item.append(
        element(
          "div",
          "log-detail",
          (conceptLabels[entry.concept] || entry.concept) +
            " · " +
            resolutionLabel(entry.resolution) +
            " · " +
            entry.understandingSummary +
            (entry.repeatCount
              ? " · 重复关卡 x" + entry.scoreMultiplier
              : "")
        )
      );
      if (entry.errorLine !== undefined) {
        const details = element("details", "error-details");
        details.append(element("summary", "", "查看错误详情"));
        details.append(
          element(
            "div",
            "log-location",
            "第 " + entry.errorLine + " 行"
          )
        );
        if (entry.errorMessage) {
          details.append(element("p", "message", entry.errorMessage));
        }
        if (entry.errorCode) {
          const pre = element("pre", "code-block");
          const code = element("code");
          code.textContent = entry.errorCode;
          pre.append(code);
          details.append(pre);
        }
        item.append(details);
      }
      list.append(item);
    });
    listSection.append(list);
    app.append(listSection);
    if (focusEntryId) {
      requestAnimationFrame(function () {
        const target = Array.from(
          document.querySelectorAll(".log-item")
        ).find(function (item) {
          return item.dataset.entryId === focusEntryId;
        });
        if (!target) {
          return;
        }
        target.classList.add("highlight");
        target.scrollIntoView({ block: "center" });
        const details = target.querySelector("details");
        if (details) {
          details.open = true;
        }
        focusEntryId = undefined;
      });
    }
  }

  window.addEventListener("message", function (event) {
    const message = event.data;
    if (message.type === "state") {
      state = message.state;
      renderPanel();
    }
    if (message.type === "timeline") {
      timeline = message.timeline || [];
      progress = message.progress || [];
      conceptOptions = message.conceptOptions || [];
      focusEntryId = message.focusEntryId;
      renderLog();
    }
    if (message.type === "error" && state) {
      state.stage = "configuration";
      state.message = "操作失败：" + message.message;
      renderPanel();
    }
  });

  if (view === "log") {
    renderLog();
    vscode.postMessage({ type: "ready" });
  } else {
    renderPanel();
    vscode.postMessage({ type: "ready" });
  }
}());
