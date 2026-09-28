import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8")
);
const outputDirectory = path.join(root, "output", "packages");
const output = path.join(
  outputDirectory,
  `${packageJson.name}-${packageJson.version}.vsix`
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync(
  npm,
  ["exec", "--yes", "@vscode/vsce", "--", "package", "--out", output],
  {
    cwd: root,
    shell: process.platform === "win32",
    stdio: "inherit"
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
