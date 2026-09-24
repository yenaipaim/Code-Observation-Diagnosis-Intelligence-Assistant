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
  assert.equal(panelCommand?.icon, "$(question)");
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
