// Machine.test
// ============
// `bun test Machine.test.ts`: a shell call's time limit (Machine.shell,
// Machine.limit), the file kinds read, write and edit refuse
// (Machine.regular), and the server's backstop on a device's job
// (Tools.job, Tools.job_limit). POSIX only: the shells run sh.

import { afterAll, expect, test } from "bun:test";
import * as child from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { Machine, TIMEOUT, TIMEOUT_MAX, VIDEO_LIMIT, WIN } from "./Machine.ts";
import { Tools, type Tools as Kit } from "./Tools.ts";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-machine-");
const PIDS: number[] = [];
afterAll(() => {
  PIDS.forEach((pid) => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  });
  fs.rmSync(DIR, { recursive: true, force: true });
});

const live = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// a shell call, timed; the pids it printed as "pid=N", kept to clean up
const run = async (command: string, secs?: number, signal = new AbortController().signal) => {
  const t0 = performance.now();
  const out = await Machine.shell(DIR, command, signal, secs);
  const pids = [...out.text.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
  PIDS.push(...pids);
  return { ...out, secs: (performance.now() - t0) / 1000, pids };
};

// a process may take a moment to be reaped after its kill
const gone = async (pid: number) => {
  for (let k = 0; k < 40 && live(pid); k++) {
    await Bun.sleep(25);
  }
  return !live(pid);
};

test.skipIf(WIN)("a command that ends before its limit answers as before", async () => {
  const out = await run("echo hi", 5);
  expect(out.text).toMatch(/^hi\n\(exit 0 in \d+\.\d s\)$/);
  expect(out.fail).toBe(false);
  const bad = await run("echo no; exit 3", 5);
  expect(bad.text).toMatch(/^no\n\(exit 3 in /);
  expect(bad.fail).toBe(true);
});

test.skipIf(WIN)("sleep 100 with timeout 2 is killed in about 2 s, the output so far kept, failed", async () => {
  const out = await run("echo partial; echo pid=$$; sleep 100", 2);
  expect(out.secs).toBeGreaterThan(1.9);
  expect(out.secs).toBeLessThan(3.5);
  expect(out.fail).toBe(true);
  expect(out.text).toStartWith("partial\npid=");
  expect(out.text).toContain("(timed out after 2 s: killed)");
  expect(out.text).toContain("Give a larger timeout");
  expect(await gone(out.pids[0])).toBe(true);
}, 10_000);

test.skipIf(WIN)("a background child holding the output dies too; the shell had already ended", async () => {
  const out = await run("sleep 100 & echo pid=$!", 1);
  expect(out.secs).toBeLessThan(3);
  expect(out.text).toContain("(timed out after 1 s: killed)");
  expect(await gone(out.pids[0])).toBe(true);
}, 10_000);

test.skipIf(WIN)("a background job with its own output file is left alone: the call ends at once", async () => {
  const out = await run("sleep 3 > /dev/null 2>&1 & echo pid=$!", 1);
  expect(out.secs).toBeLessThan(0.9);
  expect(out.fail).toBe(false);
  expect(live(out.pids[0])).toBe(true);
});

test.skipIf(WIN)("a group ignoring SIGTERM is killed by SIGKILL some 5 s later", async () => {
  const out = await run("trap '' TERM; echo pid=$$; sleep 100 & echo pid=$!; wait", 1);
  expect(out.secs).toBeGreaterThan(5.5);
  expect(out.secs).toBeLessThan(8);
  expect(out.text).toContain("(timed out after 1 s: killed, SIGKILL after SIGTERM didn't end it)");
  expect(out.pids.length).toBe(2);
  for (const pid of out.pids) {
    expect(await gone(pid)).toBe(true);
  }
}, 15_000);

test.skipIf(WIN || Bun.which("setsid") === null)("a process that left the group and holds the output can't keep the call waiting", async () => {
  const out = await run("setsid sh -c 'echo pid=$$; sleep 100' & sleep 0.2; echo shell", 1);
  expect(out.secs).toBeLessThan(8);
  expect(out.text).toContain("shell");
  expect(out.text).toContain("(timed out after 1 s: killed");
  expect(out.fail).toBe(true);
}, 15_000);

test.skipIf(WIN || Bun.which("setsid") === null)("past the limit, no signal goes to a group that is no longer the shell's (its id may be reused)", async () => {
  const sent: number[] = [];
  const real = Machine.kill;
  (Machine as any).kill = (pid: number, sig?: NodeJS.Signals) => {
    sent.push(pid);
    real(pid, sig);
  };
  try {
    const out = await run("setsid sh -c 'echo pid=$$; sleep 100' & sleep 0.2; echo shell", 1);
    expect(out.text).toContain("(timed out after 1 s: killed");
    expect(sent.filter((pid) => pid < 0)).toEqual([]);
  } finally {
    (Machine as any).kill = real;
  }
}, 15_000);

test.skipIf(WIN)("a stop in the TERM grace answers stopped with its time, not the timeout's advice", async () => {
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 2000);
  const out = await run("trap '' TERM; echo pid=$$; sleep 100 & echo pid=$!; wait", 1, stop.signal);
  expect(out.secs).toBeLessThan(3.5);
  expect(out.text).toMatch(/\(stopped in \d+\.\d s\)$/);
  expect(out.text).not.toContain("Give a larger timeout");
  for (const pid of out.pids) {
    expect(await gone(pid)).toBe(true);
  }
}, 15_000);

test.skipIf(WIN)("a stop still answers stopped, at once", async () => {
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 300);
  const out = await run("echo pid=$$; sleep 100", 10, stop.signal);
  expect(out.secs).toBeLessThan(1.5);
  expect(out.text).toContain("(stopped in ");
  expect(await gone(out.pids[0])).toBe(true);
});

test.skipIf(WIN)("a shell job (as a device runs it) takes its timeout from the input", async () => {
  const t0 = performance.now();
  const out = await Machine.run({ name: "shell", input: { command: "sleep 100", timeout: 1 }, cwd: "a" }, DIR, new AbortController().signal);
  expect((performance.now() - t0) / 1000).toBeLessThan(3);
  expect(out.text).toStartWith("(timed out after 1 s: killed)");
  expect(out.fail).toBe(true);
}, 10_000);

test("timeout: a number over 0, at most TIMEOUT_MAX; anything else the default", () => {
  expect(TIMEOUT).toBe(600);
  expect(TIMEOUT_MAX).toBe(3600);
  expect(Machine.limit(undefined)).toBe(600);
  expect(Machine.limit(null)).toBe(600);
  expect(Machine.limit(0)).toBe(600);
  expect(Machine.limit(-5)).toBe(600);
  expect(Machine.limit(NaN)).toBe(600);
  expect(Machine.limit(Infinity)).toBe(600);
  expect(Machine.limit("abc")).toBe(600);
  expect(Machine.limit("")).toBe(600);
  expect(Machine.limit(true)).toBe(600);
  expect(Machine.limit({})).toBe(600);
  expect(Machine.limit(30)).toBe(30);
  expect(Machine.limit("45")).toBe(45);
  expect(Machine.limit(1.5)).toBe(1.5);
  expect(Machine.limit(99999)).toBe(3600);
});

test.skipIf(WIN)("read, write and edit refuse a FIFO at once, rather than block the device", async () => {
  const fifo = DIR + "/fifo";
  child.execFileSync("mkfifo", [fifo]);
  const job = (name: string, input: object) => Machine.run({ name, input, cwd: "a" }, DIR, new AbortController().signal);
  const cwd = DIR + "/a";
  fs.mkdirSync(cwd, { recursive: true });
  for (const [name, input] of [["read", { path: fifo }], ["write", { path: fifo, content: "x" }], ["edit", { edits: [{ path: fifo, old: "a", new: "b" }] }]] as const) {
    const out = await job(name, input);
    expect(out.fail).toBe(true);
    expect(out.text).toContain("not a regular file");
  }
  expect((await job("read", { path: cwd })).text).toContain("(a directory)");
  expect((await job("write", { path: cwd + "/new.txt", content: "ok\n" })).fail).toBe(false);
  expect((await job("read", { path: cwd + "/new.txt" })).text).toStartWith("ok\n[lines 1-1 of 1]");
  expect((await job("read", { path: cwd + "/none.txt" })).fail).toBe(true);
});

test("the server's backstop: past a shell's own limit and SPARE, view_video's, the quick jobs'; none on an MCP call", () => {
  expect(Tools.job_limit({ name: "shell", input: {}, cwd: "a" })).toBe(630_000);
  expect(Tools.job_limit({ name: "shell", input: { timeout: 10 }, cwd: "a" })).toBe(40_000);
  expect(Tools.job_limit({ name: "shell", input: { timeout: 1e9 }, cwd: "a" })).toBe(3_630_000);
  expect(Tools.job_limit({ name: "view_video", input: {}, cwd: "a" })).toBe(VIDEO_LIMIT + 30_000);
  for (const name of ["read", "write", "edit", "skill"]) {
    expect(Tools.job_limit({ name, input: {}, cwd: "a" })).toBe(120_000);
  }
  expect(Tools.job_limit({ name: "mcp", input: {}, cwd: "a" })).toBeNull();
  expect(Tools.job_limit({ name: "halt", input: {}, cwd: "a" })).toBeNull();
});

test("a device that never answers (an older unii) is told to drop the job, and the call ends failed", async () => {
  const sent: any[] = [];
  const link = { live: () => true, send: (m: object) => sent.push(m) };
  const tools = { devices: new Map([["old", { who: "u", terms: new Map([["t", link]]), jobs: new Map(), skills: [] }]]) } as unknown as Kit;
  const kit = Tools as any;
  const was = kit.job_limit;
  kit.job_limit = () => 100;
  try {
    const out = await Tools.job(tools, "old", { name: "shell", input: { command: "sleep 100" }, cwd: "a" }, new AbortController().signal, "j1");
    expect(out.fail).toBe(true);
    expect(out.text).toContain("timed out after 0 s: the device didn't answer in time");
    expect(sent[0]).toEqual({ $: "jobs", ids: ["j1"] });
    expect(sent.some((m) => m.$ === "job" && m.id === "j1")).toBe(true);
    // the device, told its jobs without this one, aborts it (Device.ts)
    expect(sent.at(-1)).toEqual({ $: "jobs", ids: [] });
  } finally {
    kit.job_limit = was;
  }
});
