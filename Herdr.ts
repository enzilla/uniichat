// Herdr (https://herdr.dev/docs/add-herdr-support/): the terminal reports
// itself when it runs in a pane. Herdr then shows unii as idle, working
// or blocked, notifies when a turn ends or a task of yours is waiting,
// and after a server restart runs the same `unii` again. Outside Herdr
// (no HERDR_ENV=1) every call returns without spawning anything.
//
// Reports go through HERDR_BIN_PATH. A slow or missing binary must not
// stall the chat: one report in flight, older ones dropped, a short
// kill. A late report cannot undo a release: seq only grows, and quit
// drops whatever was still queued.

import { spawn, spawnSync } from "node:child_process";

export type Yours = { id: string; title: string };

export type Report = {
  env     : Env;
  url     : string;
  classic : boolean;
  running : boolean;
  yours   : Yours[];
};

type Env = Record<string, string | undefined>;

type Here = { bin: string; pane: string };

type Job = { bin: string; args: string[]; key: string };

type Launch = (bin: string, args: string[], sync: boolean, done: () => void) => void;

const SOURCE = "unii";
const AGENT  = "unii";
const LOCAL  = "http://127.0.0.1:8788";
const KILL   = 800;
const SYNC   = 400;

// the three states Herdr rolls up. working wins: a turn or a subagent
// still running is not "needs you", even with tasks open. blocked is a
// task of yours that you can act on now (not one waiting on another
// task, not one waiting outside the list). idle is the prompt.
export type Phase = "idle" | "working" | "blocked";

export function herdr_phase(running: boolean, yours: Yours[]): { state: Phase; message: string } {
  if (running) {
    return { state: "working", message: "" };
  }
  if (yours.length === 0) {
    return { state: "idle", message: "" };
  }
  return { state: "blocked", message: herdr_message(yours) };
}

// "P7: título" or "P7 e mais 3: título". Herdr shows it on the block.
// Control characters would break the report; they become spaces.
export function herdr_message(yours: Yours[]): string {
  const first = yours[0];
  if (first === undefined) {
    return "";
  }
  const title = first.title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const more = yours.length > 1 ? " e mais " + (yours.length - 1) : "";
  return (first.id + more + (title === "" ? "" : ": " + title)).slice(0, 200);
}

// the command Herdr runs in the same directory after its server restarts.
// First word is the name on PATH, never a path. Herdr rejects the whole
// report (state included) when an argument has an apostrophe or a
// control character, or the command is too long: then null, and the
// caller sends the state alone.
export function herdr_resume(url: string, classic: boolean): string[] | null {
  const argv = ["unii"];
  if (url !== LOCAL) {
    argv.push(url);
  }
  if (classic) {
    argv.push("--classic");
  }
  if (argv.length > 64 || argv.join(" ").length > 8192 || argv.some((a) => /['\u0000-\u001f\u007f]/.test(a))) {
    return null;
  }
  return argv;
}

// host of the server, the session Herdr stores beside the command.
// Same character rule as the command: a bad host drops the resume.
export function herdr_session(url: string): string | null {
  try {
    const host = new URL(url).host;
    return /^[\w.:-]+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function herdr_here(env: Env): Here | null {
  if (env.HERDR_ENV !== "1") {
    return null;
  }
  const bin = env.HERDR_BIN_PATH ?? "";
  const pane = env.HERDR_PANE_ID ?? "";
  if (bin === "" || pane === "" || bin.includes("\0") || pane.includes("\0")) {
    return null;
  }
  return { bin, pane };
}

export function herdr_args(pane: string, seq: string, phase: { state: Phase; message: string }, resume: string[] | null, session: string | null): string[] {
  const args = ["pane", "report-agent", pane, "--source", SOURCE, "--agent", AGENT, "--state", phase.state, "--seq", seq];
  if (phase.message !== "") {
    args.push("--message", phase.message);
  }
  if (resume !== null && session !== null) {
    args.push("--agent-session-id", session, "--", ...resume);
  }
  return args;
}

let seq = 0;
let last = "";
let dead = false;
let flight: Job | null = null;
let next: Job | null = null;
let launch: Launch = default_launch;

function seq_next(): string {
  seq = Math.max(Date.now(), seq + 1);
  return String(seq);
}

// tests replace the spawn. The chat's own calls keep default_launch.
export function herdr_launch(f: Launch): void {
  launch = f;
}

export function herdr_reset(): void {
  seq = 0;
  last = "";
  dead = false;
  flight = null;
  next = null;
  launch = default_launch;
}

export function herdr_report(o: Report): void {
  const here = herdr_here(o.env);
  if (here === null || dead) {
    return;
  }
  const phase = herdr_phase(o.running, o.yours);
  const resume = herdr_resume(o.url, o.classic);
  const session = resume === null ? null : herdr_session(o.url);
  // seq is not part of the key: two paints of the same state must not
  // each spawn herdr. A newer state replaces one still queued.
  const key = [phase.state, phase.message, (resume ?? []).join("\0"), session ?? ""].join("\0");
  if (same(key)) {
    return;
  }
  enqueue({ bin: here.bin, args: herdr_args(here.pane, seq_next(), phase, resume, session), key });
}

function same(key: string): boolean {
  if (next?.key === key) {
    return true;
  }
  if (flight?.key === key && next === null) {
    return true;
  }
  return flight === null && next === null && last === key;
}

export function herdr_release(env: Env): void {
  const here = herdr_here(env);
  dead = true;
  next = null;
  if (here === null) {
    return;
  }
  const args = ["pane", "release-agent", here.pane, "--source", SOURCE, "--agent", AGENT, "--seq", seq_next()];
  launch(here.bin, args, true, () => undefined);
}

function enqueue(job: Job): void {
  if (dead) {
    return;
  }
  if (flight?.key === job.key || (flight === null && next === null && last === job.key)) {
    return;
  }
  next = job;
  if (flight === null) {
    kick();
  }
}

function kick(): void {
  if (dead || flight !== null || next === null) {
    return;
  }
  const job = next;
  next = null;
  flight = job;
  launch(job.bin, job.args, false, () => {
    if (flight === job) {
      flight = null;
      last = job.key;
    }
    kick();
  });
}

function default_launch(bin: string, args: string[], sync: boolean, done: () => void): void {
  if (sync) {
    try {
      spawnSync(bin, args, { stdio: "ignore", timeout: SYNC });
    } catch {
      // missing binary, or it did not exit in time: Herdr keeps the pane
    }
    done();
    return;
  }
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(bin, args, { stdio: "ignore" });
  } catch {
    done();
    return;
  }
  let once = false;
  const fin = (): void => {
    if (once) {
      return;
    }
    once = true;
    clearTimeout(timer);
    done();
  };
  const timer = setTimeout(() => {
    child.kill();
    fin();
  }, KILL);
  child.on("error", fin);
  child.on("close", fin);
}
