// TestSetup
// =========
// Preloaded by `bun test` (bunfig.toml), before any test file: a server's
// data dir for the run, so `bun test` alone never reads or writes real
// data (~/.unii, or a service's UNII_DIR). UNII_DIR already in /tmp is
// kept (a run that wants its own); anything else is replaced by a fresh
// /tmp/unii-test-XXXXXX, said once. The dir is removed as the run ends
// (a test file only empties it: Disk.ts syncs the dir itself).

import { afterAll } from "bun:test";
import * as fs from "node:fs";

const was = process.env.UNII_DIR ?? "";
if (!was.startsWith("/tmp/")) {
  process.env.UNII_DIR = fs.mkdtempSync("/tmp/unii-test-");
  console.error("unii test: UNII_DIR=" + process.env.UNII_DIR + (was === "" ? "" : " (not " + was + ": tests never touch real data)"));
}
// a preload's afterAll runs once, after every file's tests
afterAll(() => fs.rmSync(process.env.UNII_DIR!, { recursive: true, force: true }));
