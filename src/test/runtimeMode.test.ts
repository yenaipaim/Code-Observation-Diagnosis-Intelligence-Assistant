import assert from "node:assert/strict";
import test from "node:test";
import { AutomaticRuntimeMode } from "../runtimeMode";

test("automatic mode uses demo without an API key", () => {
  const mode = new AutomaticRuntimeMode(() => false, () => false);

  assert.equal(mode.isDemoMode(), true);
});

test("automatic mode uses the API when a key exists", () => {
  const mode = new AutomaticRuntimeMode(() => false, () => true);

  assert.equal(mode.isDemoMode(), false);
});

test("force demo mode wins over an API key", () => {
  const mode = new AutomaticRuntimeMode(() => true, () => true);

  assert.equal(mode.isDemoMode(), true);
});

test("API fallback switches to demo until reset", () => {
  const mode = new AutomaticRuntimeMode(() => false, () => true);

  assert.equal(mode.isDemoMode(), false);
  mode.activateFallback();
  assert.equal(mode.isFallbackActive(), true);
  assert.equal(mode.isDemoMode(), true);
  mode.resetFallback();
  assert.equal(mode.isFallbackActive(), false);
  assert.equal(mode.isDemoMode(), false);
});

test("removing the API key switches the existing mode to demo", () => {
  let hasKey = true;
  const mode = new AutomaticRuntimeMode(() => false, () => hasKey);

  assert.equal(mode.isDemoMode(), false);
  hasKey = false;
  assert.equal(mode.isDemoMode(), true);
});
