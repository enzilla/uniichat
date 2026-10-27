// Herdr.test
// ==========
// `bun test Herdr.test.ts`: the terminal's report to a Herdr pane.
// No binary is spawned. The cases are the ones Herdr rejects outright
// (apostrophe, control character, too long) and the state the sidebar
// shows (working wins over an open task; a task that waits is not
// blocked; quit drops a report still queued).

import { afterEach, expect, test } from "bun:test";
import * as Herdr from "./Herdr.ts";

const ENV = { HERDR_ENV: "1", HERDR_BIN_PATH: "/usr/bin/herdr", HERDR_PANE_ID: "w1:p1" };

afterEach(() => Herdr.herdr_reset());

test("outside a pane there is no report", () => {
  expect(Herdr.herdr_here({})).toBeNull();
  expect(Herdr.herdr_here({ HERDR_ENV: "1" })).toBeNull();
  const got: string[][] = [];
  Herdr.herdr_launch((bin, args, _sync, done) => {
    got.push([bin, ...args]);
    done();
  });
  Herdr.herdr_report({ env: {}, url: "http://127.0.0.1:8788", classic: false, running: true, yours: [] });
  expect(got).toEqual([]);
});

test("working wins; a task of yours blocks only when nothing runs; a wait does not", () => {
  expect(Herdr.herdr_phase(true, [{ id: "P7", title: "Escolha" }])).toEqual({ state: "working", message: "" });
  expect(Herdr.herdr_phase(false, [])).toEqual({ state: "idle", message: "" });
  expect(Herdr.herdr_phase(false, [{ id: "P7", title: "Escolha o\nmodelo" }, { id: "P8", title: "Outra" }])).toEqual({ state: "blocked", message: "P7 e mais 1: Escolha o modelo" });
});

test("the resume command is `unii` on PATH, with the server only when it is not the local one", () => {
  expect(Herdr.herdr_resume("http://127.0.0.1:8788", false)).toEqual(["unii"]);
  expect(Herdr.herdr_resume("http://127.0.0.1:8788", true)).toEqual(["unii", "--classic"]);
  expect(Herdr.herdr_resume("https://unii.example", false)).toEqual(["unii", "https://unii.example"]);
  expect(Herdr.herdr_resume("https://ex.com/a'b", false)).toBeNull();
  expect(Herdr.herdr_session("https://unii.example:8788/chat")).toBe("unii.example:8788");
  expect(Herdr.herdr_session("not a url")).toBeNull();
});

test("a report carries state, seq and the resume command; the same state is not sent twice; quit releases and drops the queue", () => {
  const got: { args: string[]; sync: boolean }[] = [];
  Herdr.herdr_launch((_bin, args, sync, done) => {
    got.push({ args, sync });
    done();
  });
  const base = { env: ENV, url: "https://unii.example", classic: false, yours: [] as Herdr.Yours[] };
  Herdr.herdr_report({ ...base, running: true });
  Herdr.herdr_report({ ...base, running: true });
  Herdr.herdr_report({ ...base, running: false, yours: [{ id: "P3", title: "Assine" }] });
  expect(got.map((g) => g.args[g.args.indexOf("--state") + 1])).toEqual(["working", "blocked"]);
  expect(got[0]?.args.slice(-5)).toEqual(["--agent-session-id", "unii.example", "--", "unii", "https://unii.example"]);
  expect(got[0]?.args).toContain("https://unii.example");
  const seqs = got.map((g) => Number(g.args[g.args.indexOf("--seq") + 1]));
  expect(seqs[1]).toBeGreaterThan(seqs[0] ?? 0);
  expect(got[1]?.args).toContain("P3: Assine");
  Herdr.herdr_release(ENV);
  Herdr.herdr_report({ ...base, running: true });
  expect(got.at(-1)?.args[1]).toBe("release-agent");
  expect(got.at(-1)?.sync).toBe(true);
  expect(got.filter((g) => g.args[1] === "report-agent")).toHaveLength(2);
});

test("a bad resume still reports the state, without the command", () => {
  const got: string[][] = [];
  Herdr.herdr_launch((_bin, args, _sync, done) => {
    got.push(args);
    done();
  });
  Herdr.herdr_report({ env: ENV, url: "https://ex.com/a'b", classic: false, running: false, yours: [] });
  expect(got[0]).not.toContain("--");
  expect(got[0]).toContain("idle");
});
