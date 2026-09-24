import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function media(fileName: string): Promise<string> {
  return readFile(
    path.resolve(__dirname, "..", "..", "media", fileName),
    "utf8"
  );
}

test("hint text uses a black background", async () => {
  const css = await media("panel.css");
  const hintRule = css.match(/\.hint\s*\{[^}]+\}/)?.[0] ?? "";

  assert.match(hintRule, /background:\s*#000/i);
  assert.match(hintRule, /color:\s*#fff/i);
});

test("learning log exposes timeline, all-data, and row deletion controls", async () => {
  const script = await media("panel.js");

  assert.match(script, /clear-timeline/);
  assert.match(script, /clear-all/);
  assert.match(script, /delete-entry/);
  assert.match(script, /toggle-concept/);
  assert.match(script, /checkbox/);
});

test("answer code exposes insert and copy actions", async () => {
  const script = await media("panel.js");

  assert.match(script, /复制/);
  assert.match(script, /插入/);
  assert.match(script, /copy-answer/);
  assert.match(script, /insert-answer/);
});

test("panel shows answer access, AI closeness and repeat scoring", async () => {
  const script = await media("panel.js");

  assert.match(script, /state\.answerLabel/);
  assert.match(script, /AI 接近度/);
  assert.match(script, /repeatCount/);
  assert.match(script, /scoreMultiplier/);
});

test("duplicate errors expose timeline and forced-new-error actions", async () => {
  const script = await media("panel.js");

  assert.match(script, /查看上次错误/);
  assert.match(script, /判为新错误/);
  assert.match(script, /open-log-entry/);
  assert.match(script, /treat-as-new/);
});
