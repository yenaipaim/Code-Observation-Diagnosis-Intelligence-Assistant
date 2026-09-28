import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface ManifestEntry {
  command?: string;
  when?: string;
  icon?: string;
}

interface PackageManifest {
  activationEvents?: string[];
  contributes?: {
    commands?: ManifestEntry[];
    menus?: Record<string, ManifestEntry[]>;
    configuration?: {
      properties?: Record<string, { default?: unknown }>;
    };
  };
}

test("the Python editor exposes a clickable question-mark panel entry", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.resolve(__dirname, "..", "..", "package.json"),
      "utf8"
    )
  ) as PackageManifest;
  const panelEntry = manifest.contributes?.menus?.["editor/title"]?.find(
    (entry) => entry.command === "programmingCoach.openPanel"
  );
  const panelCommand = manifest.contributes?.commands?.find(
    (entry) => entry.command === "programmingCoach.openPanel"
  );

  assert.ok(panelEntry);
  assert.match(panelEntry.when ?? "", /python/);
  assert.match(panelEntry.when ?? "", /java/);
  assert.match(panelEntry.when ?? "", /javascript/);
  assert.equal(panelCommand?.icon, "$(question)");
});

test("the manifest activates and runs Java and JavaScript files", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.resolve(__dirname, "..", "..", "package.json"),
      "utf8"
    )
  ) as PackageManifest;
  const commands = manifest.contributes?.commands ?? [];

  assert.ok(manifest.activationEvents?.includes("onLanguage:java"));
  assert.ok(manifest.activationEvents?.includes("onLanguage:javascript"));
  assert.ok(
    commands.some(
      (entry) => entry.command === "programmingCoach.runCurrentFile"
    )
  );
  assert.ok(
    commands.some(
      (entry) => entry.command === "programmingCoach.runPythonFile"
    )
  );
});

test("Java and JavaScript runtime paths have PATH defaults", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.resolve(__dirname, "..", "..", "package.json"),
      "utf8"
    )
  ) as PackageManifest;
  const properties = manifest.contributes?.configuration?.properties;

  assert.equal(
    properties?.["programmingCoach.javaRuntimePath"]?.default,
    "java"
  );
  assert.equal(
    properties?.["programmingCoach.javascriptRuntimePath"]?.default,
    "node"
  );
});

test("API settings default to DeepSeek chat", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.resolve(__dirname, "..", "..", "package.json"),
      "utf8"
    )
  ) as PackageManifest;
  const properties = manifest.contributes?.configuration?.properties;

  assert.equal(
    properties?.["programmingCoach.apiBaseUrl"]?.default,
    "https://api.deepseek.com"
  );
  assert.equal(
    properties?.["programmingCoach.apiModel"]?.default,
    "deepseek-chat"
  );
});
