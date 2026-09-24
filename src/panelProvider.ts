import { readFileSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import {
  ConceptOption,
  ProgressSummary
} from "./learningLog";
import { LearningLogEntry, PanelState } from "./types";

export interface PanelActions {
  start: () => Promise<void>;
  submit: (value: string) => Promise<void>;
  hint: () => Promise<void>;
  revealAnswer: () => Promise<void>;
  skip: () => Promise<void>;
  configureApiKey: () => Promise<void>;
  openLearningLog: () => Promise<void>;
  copyAnswer: (code: string) => Promise<void>;
  insertAnswer: (code: string) => Promise<void>;
  openLogEntry: (entryId: string) => Promise<void>;
  treatDuplicateAsNew: () => Promise<void>;
}

interface WebviewMessage {
  type?: string;
  value?: string;
  code?: string;
  id?: string;
  concept?: string;
  checked?: boolean;
}

export interface LearningLogActions {
  clearTimeline: () => Promise<void>;
  clearAll: () => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
  toggleConcept: (
    concept: string,
    checked: boolean
  ) => Promise<void>;
}

function nonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

function loadHtml(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  view: "panel" | "log"
): string {
  const mediaRoot = vscode.Uri.joinPath(extensionUri, "media");
  const htmlPath = path.join(mediaRoot.fsPath, "panel.html");
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "panel.css")
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "panel.js")
  );
  const token = nonce();

  return readFileSync(htmlPath, "utf8")
    .replaceAll("{{cspSource}}", webview.cspSource)
    .replaceAll("{{styleUri}}", styleUri.toString())
    .replaceAll("{{scriptUri}}", scriptUri.toString())
    .replaceAll("{{nonce}}", token)
    .replaceAll("{{view}}", view);
}

export class PanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private state: PanelState;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: PanelActions,
    initialState: PanelState
  ) {
    this.state = initialState;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
    };
    view.webview.html = loadHtml(this.extensionUri, view.webview, "panel");
    view.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message);
    });
  }

  postState(state: PanelState, apiKeyConfigured: boolean): void {
    this.state = {
      ...state,
      apiKeyConfigured
    };
    void this.view?.webview.postMessage({
      type: "state",
      state: this.state
    });
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case "ready":
          await this.view?.webview.postMessage({
            type: "state",
            state: this.state
          });
          break;
        case "start":
          await this.actions.start();
          break;
        case "submit":
          await this.actions.submit(message.value ?? "");
          break;
        case "hint":
          await this.actions.hint();
          break;
        case "reveal":
          await this.actions.revealAnswer();
          break;
        case "skip":
          await this.actions.skip();
          break;
        case "configure":
          await this.actions.configureApiKey();
          break;
        case "open-log":
          await this.actions.openLearningLog();
          break;
        case "copy-answer":
          await this.actions.copyAnswer(message.code ?? "");
          break;
        case "insert-answer":
          await this.actions.insertAnswer(message.code ?? "");
          break;
        case "open-log-entry":
          if (message.id) {
            await this.actions.openLogEntry(message.id);
          }
          break;
        case "treat-as-new":
          await this.actions.treatDuplicateAsNew();
          break;
      }
    } catch (error) {
      await this.view?.webview.postMessage({
        type: "error",
        message: (error as Error).message
      });
    }
  }
}

export class LearningLogProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private focusEntryId?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly loadLog: () => Promise<{
      timeline: LearningLogEntry[];
      progress: ProgressSummary[];
      conceptOptions: ConceptOption[];
    }>,
    private readonly actions: LearningLogActions
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
    };
    view.webview.html = loadHtml(this.extensionUri, view.webview, "log");
    view.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message);
    });
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case "clear-timeline":
          await this.actions.clearTimeline();
          break;
        case "clear-all":
          await this.actions.clearAll();
          break;
        case "delete-entry":
          if (message.id) {
            await this.actions.deleteEntry(message.id);
          }
          break;
        case "toggle-concept":
          if (message.concept) {
            await this.actions.toggleConcept(
              message.concept,
              message.checked ?? false
            );
          }
          break;
      }
      await this.refresh();
    } catch (error) {
      await this.view?.webview.postMessage({
        type: "error",
        message: (error as Error).message
      });
    }
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    const data = await this.loadLog();
    await this.view.webview.postMessage({
      type: "timeline",
      ...data,
      focusEntryId: this.focusEntryId
    });
    this.focusEntryId = undefined;
  }

  async focusEntry(entryId: string): Promise<void> {
    this.focusEntryId = entryId;
    if (!this.view) {
      return;
    }
    await this.refresh();
  }
}
