// Release.test
// ============
// `bun test scripts/ci/Release.test.ts`: the tag the release workflow
// publishes. A CI-only tree must not get a number. A feat must not be a
// patch. The old 31-enzilla.1.N tag must not come back.

import { expect, test } from "bun:test";
import { next_version, ships } from "./Release.ts";

const term = ["Term.ts"];
const ci = [".github/workflows/release.yml", "scripts/ci/Release.ts"];

test("the first tag is the written baseline, not a run number", () => {
  expect(next_version(null, ci, [])).toBe("v31.1.0");
  expect(next_version(null, [], [])).not.toMatch(/enzilla/);
});

test("release automation, tests and docs do not publish", () => {
  expect(ships("scripts/ci/Release.ts")).toBe(false);
  expect(ships("Herdr.test.ts")).toBe(false);
  expect(ships("README.md")).toBe(false);
  expect(ships("Term.ts")).toBe(true);
  const commits = [{ subject: "ci(release): stamp the tag", body: "" }];
  expect(next_version("v31.1.0", ci, commits)).toBeNull();
  expect(next_version("v31.1.0", ["README.md", "Herdr.test.ts"], [{ subject: "feat: docs only", body: "" }])).toBeNull();
});

test("feat is minor, fix is patch, breaking is major, and minor wins", () => {
  expect(next_version("v31.1.3", term, [{ subject: "feat(tui): herdr", body: "" }])).toBe("v31.2.0");
  expect(next_version("v31.1.3", term, [{ subject: "fix(web): image", body: "" }])).toBe("v31.1.4");
  expect(next_version("v31.1.3", term, [{ subject: "perf(cache): skills", body: "" }])).toBe("v31.1.4");
  expect(next_version("v31.1.3", term, [{ subject: "feat(tui)!: drop the line", body: "" }])).toBe("v32.0.0");
  expect(next_version("v31.1.3", term, [
    { subject: "fix(web): image", body: "" },
    { subject: "feat(tui): herdr", body: "" },
  ])).toBe("v31.2.0");
  expect(next_version("v31.1.3", term, [{ subject: "chore: types", body: "BREAKING CHANGE: the state shape" }])).toBe("v32.0.0");
});

test("a product commit with no conventional type is a patch", () => {
  expect(next_version("v31.1.0", ["Server.ts"], [{ subject: "Version 31", body: "" }])).toBe("v31.1.1");
});

test("a tag that is not vX.Y.Z is refused", () => {
  expect(() => next_version("31-enzilla.1.3", term, [{ subject: "fix: x", body: "" }])).toThrow("vX.Y.Z");
});
