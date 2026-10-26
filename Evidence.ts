// Evidence
// ========
// What closes a task of the pending list (Tasks.ts): no task is done or
// dropped without a concrete, documented solution, checked here, not
// taken on Unii's word. Each evidence has a type, and the system checks
// what it can of each:
// - slack: a message sent ({channel, ts}: the channel's id, C/D/G…, and
//   the message's ts, 1234567890.123456), its link if given;
// - pr_merged: a pull request merged ({url}): its state read live from
//   GitHub (`gh pr view`, Evidence.CHECK.pr) as MERGED, its merge
//   commit kept; given as such but not read so, refused;
// - commit_tests: a commit and its tests ({repo, sha, command, passed,
//   failed}): the commit read live on GitHub (Evidence.CHECK.commit),
//   failed 0 and passed at least 1;
// - tfc: a Terraform Cloud run ({run: run-<16>, status}): its id and
//   status checked as written (no TFC token here: not read live);
// - file: a file that exists on the server's computer ({path}: absolute,
//   a regular file, not empty), its size and change time kept;
// - reason: a reason in words ({text}, at least REASON letters), only to
//   drop a task (it no longer applies), never to say it's done.
// Two more are only the system's own, never given by a tool: user (the
// user's resolution, as the Mesa or the terminal made it) and restart
// (the serve restarted, as the user ordered).
// evidence_read is pure (the shape, the file's existence aside): the
// data layer's (Tasks.task_edit) check. evidence_verify adds the live
// checks (pr_merged, commit_tests), the tools' (Tools.task): a
// confirmation given in the arguments is never taken, only one read.

import * as fs from "node:fs";

// Types
// =====

export type EvType = "slack" | "pr_merged" | "commit_tests" | "tfc" | "file" | "reason" | "user" | "restart";

// an evidence as kept: its type, when it was recorded, a summary (what
// it shows, optional), and its own fields by type; confirmed: what was
// read live (pr_merged: "MERGED <merge sha>"; commit_tests: the commit's
// sha), when it was
export type Evidence = {
  type      : EvType;
  at        : string;
  summary?  : string;
  channel?  : string;
  ts?       : string;
  url?      : string;
  repo?     : string;
  sha?      : string;
  command?  : string;
  passed?   : number;
  failed?   : number;
  run?      : string;
  status?   : string;
  path?     : string;
  size?     : number;
  text?     : string;
  answer?   : string | null;
  note?     : string | null;
  migrated? : boolean;
  confirmed?: string;
};

// Constants
// =========

// the types a tool may give; those only the system records
export const GIVEN: EvType[] = ["slack", "pr_merged", "commit_tests", "tfc", "file", "reason"];
export const SYSTEM: EvType[] = ["user", "restart"];
const TYPES: EvType[] = [...GIVEN, ...SYSTEM];

// the most evidences a task keeps; a reason's least length; a text's most
export const EVIDENCES = 5;
export const REASON    = 40;
export const TEXT      = 600;
export const SUMMARY   = 300;

const CHANNEL = /^[CDG][A-Z0-9]{6,}$/;
const TS      = /^\d{9,10}\.\d{6}$/;
const PR_URL  = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/;
const REPO    = /^[\w.-]+\/[\w.-]+$/;
const SHA     = /^[0-9a-f]{7,40}$/;
const RUN     = /^run-[A-Za-z0-9]{16}$/;
// a TFC run's statuses that say it ran (done); a drop takes any
export const TFC_DONE = ["applied", "planned_and_finished"];
const TFC_ANY  = [...TFC_DONE, "discarded", "canceled", "errored", "policy_soft_failed"];

// Texts
// =====

function line(x: unknown, n: number): string {
  return String(x ?? "").replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
}

// a whole number >= 0 as given (a number, or digits), else null
function count(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && /^\s*\d+\s*$/.test(x) ? Number(x) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

// Reading
// =======

// the evidences a tool gives to close a task (one object, or a list of
// them), for `to` (done or dropped): each checked as its type asks, a
// file's existence too (fs); the live checks are evidence_verify's.
// system: the system's own may be given (user, restart); a tool's never.
// Else why not (Unii reads it: English, as the tools' errors)
export function evidence_read(x: unknown, to: "done" | "dropped", now: number, system = false): Evidence[] | string {
  if (x === undefined || x === null || x === "" || (Array.isArray(x) && x.length === 0)) {
    return none_said(to);
  }
  const all = Array.isArray(x) ? x : [x];
  if (all.length > EVIDENCES) {
    return "At most " + EVIDENCES + " evidences.";
  }
  const out: Evidence[] = [];
  for (const [k, y] of all.entries()) {
    const got = one_read(y, to, now, system, all.length === 1 ? "evidence: " : "evidence " + (k + 1) + ": ");
    if (typeof got === "string") {
      return got;
    }
    out.push(got);
  }
  return out;
}

// what's said when no evidence is given
export function none_said(to: "done" | "dropped"): string {
  return "Refused: a task is " + (to === "done" ? "done" : "dropped") + " only with evidence of a concrete, documented solution. Give evidence: {type: " + (to === "done" ? GIVEN.filter((t) => t !== "reason").join(" | ") : GIVEN.join(" | ")) + ", ...}: slack {channel, ts} (a message sent), pr_merged {url} (merged, read live on GitHub), commit_tests {repo, sha, command, passed, failed: 0}, tfc {run: run-..., status}, file {path: absolute, exists}" + (to === "dropped" ? ", reason {text: at least " + REASON + " characters} (only to drop)" : "; reason only drops a task") + ". Nothing was changed.";
}

function one_read(y: unknown, to: "done" | "dropped", now: number, system: boolean, at: string): Evidence | string {
  if (typeof y !== "object" || y === null || Array.isArray(y)) {
    return at + "each evidence is an object {type, ...}.";
  }
  const o = y as Record<string, unknown>;
  const type = line(o.type, 20).toLowerCase() as EvType;
  if (!TYPES.includes(type)) {
    return at + "type is one of " + GIVEN.join(", ") + ".";
  }
  if (SYSTEM.includes(type) && !system) {
    return at + "type " + type + " is recorded by the system only (the user's resolution, a restart), never given.";
  }
  const summary = line(o.summary, SUMMARY);
  const base: Evidence = { type, at: new Date(now).toISOString(), ...(summary === "" ? {} : { summary }) };
  switch (type) {
    case "slack": {
      const channel = line(o.channel, 20).toUpperCase();
      const ts = line(o.ts, 20);
      if (!CHANNEL.test(channel)) {
        return at + "slack: channel is the channel's id (C…, D… or G…, as D0C361HU1R9).";
      }
      if (!TS.test(ts)) {
        return at + "slack: ts is the message's timestamp, as 1793019564.060589.";
      }
      const url = line(o.url, 300);
      if (url !== "" && !(/^https:\/\/[\w.-]+\.slack\.com\/archives\//.test(url) && url.includes(channel))) {
        return at + "slack: url, if given, is the message's link on slack.com, of that channel.";
      }
      return { ...base, channel, ts, ...(url === "" ? {} : { url }) };
    }
    case "pr_merged": {
      const url = line(o.url, 300).replace(/\/+$/, "");
      if (!PR_URL.test(url)) {
        return at + "pr_merged: url is the PR's GitHub link, https://github.com/<owner>/<repo>/pull/<n>.";
      }
      const confirmed = line(o.confirmed, 80);
      if (!system && !/^MERGED\b/.test(confirmed)) {
        return at + "pr_merged: " + url + " not confirmed merged (its state is read live on GitHub).";
      }
      return { ...base, url, confirmed };
    }
    case "commit_tests": {
      const repo = line(o.repo, 120);
      const sha = line(o.sha, 40).toLowerCase();
      const command = line(o.command, 200);
      const passed = count(o.passed);
      const failed = count(o.failed);
      if (!REPO.test(repo)) {
        return at + "commit_tests: repo is <owner>/<repo>, as morum/uniichat.";
      }
      if (!SHA.test(sha)) {
        return at + "commit_tests: sha is the commit, 7 to 40 hex characters.";
      }
      if (command === "") {
        return at + "commit_tests: command is the test command run, as \"bun test\".";
      }
      if (passed === null || failed === null) {
        return at + "commit_tests: passed and failed are the counts of tests as the run said them (whole numbers).";
      }
      if (failed > 0) {
        return at + "commit_tests: " + failed + " test(s) failed: a failing run is no evidence of a solution.";
      }
      if (passed < 1) {
        return at + "commit_tests: no test passed: a run of none is no evidence.";
      }
      const confirmed = line(o.confirmed, 80);
      if (!system && !SHA.test(confirmed)) {
        return at + "commit_tests: " + repo + "@" + sha + " not confirmed (the commit is read live on GitHub).";
      }
      return { ...base, repo, sha, command, passed, failed, confirmed };
    }
    case "tfc": {
      const run = line(o.run, 40);
      const status = line(o.status, 40).toLowerCase();
      if (!RUN.test(run)) {
        return at + "tfc: run is the run's id, run-<16 letters or digits>, as run-buHH5YDfjFpk7Uhj.";
      }
      if (!(to === "done" ? TFC_DONE : TFC_ANY).includes(status)) {
        return at + "tfc: status is " + (to === "done" ? TFC_DONE.join(" or ") + " (a run that didn't apply doesn't make it done)" : TFC_ANY.join(", ")) + ".";
      }
      return { ...base, run, status };
    }
    case "file": {
      const path = line(o.path, 500);
      if (!path.startsWith("/")) {
        return at + "file: path is absolute, on the server's computer.";
      }
      let st: fs.Stats;
      try {
        st = fs.statSync(path);
      } catch {
        return at + "file: " + path + " doesn't exist on the server's computer.";
      }
      if (!st.isFile() || st.size === 0) {
        return at + "file: " + path + " is " + (st.isFile() ? "empty" : "not a regular file") + ".";
      }
      return { ...base, path, size: st.size, confirmed: st.mtime.toISOString() };
    }
    case "reason": {
      const text = line(o.text, TEXT);
      if (to === "done") {
        return at + "reason only drops a task (it no longer applies); done needs evidence of the solution.";
      }
      if (text.length < REASON) {
        return at + "reason: text says why it no longer applies, in at least " + REASON + " characters.";
      }
      return { ...base, text };
    }
    case "user": {
      const answer = o.answer === undefined || o.answer === null ? null : line(o.answer, 80) || null;
      const note = o.note === undefined || o.note === null ? null : line(o.note, TEXT) || null;
      return { ...base, answer, note, ...(o.migrated === true ? { migrated: true } : {}) };
    }
    case "restart": {
      return base;
    }
  }
}

// evidences as tasks.json holds them: those whose shape is sound (no
// file looked at, no live check: what was checked then is kept), the
// rest left out
export function evidence_clean(x: unknown): Evidence[] {
  if (!Array.isArray(x)) {
    return [];
  }
  const out: Evidence[] = [];
  for (const y of x.slice(0, EVIDENCES * 4)) {
    if (typeof y !== "object" || y === null || Array.isArray(y)) {
      continue;
    }
    const o = y as Record<string, unknown>;
    const type = String(o.type ?? "") as EvType;
    if (!TYPES.includes(type)) {
      continue;
    }
    const at = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? new Date(Date.parse(o.at)).toISOString() : new Date(0).toISOString();
    const keep: Evidence = { type, at };
    for (const k of ["summary", "channel", "ts", "url", "repo", "sha", "command", "run", "status", "path", "text", "confirmed"] as const) {
      if (typeof o[k] === "string" && o[k] !== "") {
        keep[k] = line(o[k], k === "text" ? TEXT : 500);
      }
    }
    for (const k of ["passed", "failed", "size"] as const) {
      const n = count(o[k]);
      if (n !== null) {
        keep[k] = n;
      }
    }
    if (type === "user") {
      keep.answer = typeof o.answer === "string" ? line(o.answer, 80) : null;
      keep.note = typeof o.note === "string" ? line(o.note, TEXT) : null;
      if (o.migrated === true) {
        keep.migrated = true;
      }
    }
    out.push(keep);
  }
  return out;
}

// Live checks
// ===========
// How a PR's state and a commit are read (gh; replaced in the tests):
// a PR: its state (OPEN, MERGED, CLOSED) and merge commit; a commit: its
// full sha; null: not read (gh missing, no access, none such)

export type PrState = { state: string; merge: string | null };
export const CHECK: { pr: (url: string) => Promise<PrState | null>; commit: (repo: string, sha: string) => Promise<string | null> } = { pr: gh_pr, commit: gh_commit };

const TIMEOUT = 20e3;

async function gh(args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const kill = setTimeout(() => proc.kill(), TIMEOUT);
    const text = await new Response(proc.stdout).text();
    clearTimeout(kill);
    return (await proc.exited) === 0 ? text : null;
  } catch {
    return null;
  }
}

async function gh_pr(url: string): Promise<PrState | null> {
  const text = await gh(["pr", "view", url, "--json", "state,mergeCommit"]);
  try {
    const o = text === null ? null : JSON.parse(text);
    return typeof o?.state === "string" ? { state: o.state, merge: typeof o?.mergeCommit?.oid === "string" ? o.mergeCommit.oid : null } : null;
  } catch {
    return null;
  }
}

async function gh_commit(repo: string, sha: string): Promise<string | null> {
  const text = await gh(["api", "repos/" + repo + "/commits/" + sha, "--jq", ".sha"]);
  const got = text === null ? "" : text.trim();
  return SHA.test(got) ? got : null;
}

// the evidences a tool gives, with what's read live: a PR's state, a
// commit's existence (a confirmation given in the arguments is never
// taken: it's read here or the evidence is refused). The arguments as
// evidence_read should read them ({ v }); else why not
export async function evidence_verify(x: unknown): Promise<{ v: unknown } | string> {
  if (x === undefined || x === null || typeof x !== "object") {
    return { v: x };
  }
  const all = Array.isArray(x) ? x : [x];
  const out: unknown[] = [];
  for (const [k, y] of all.entries()) {
    const at = all.length === 1 ? "evidence: " : "evidence " + (k + 1) + ": ";
    if (typeof y !== "object" || y === null || Array.isArray(y)) {
      out.push(y);
      continue;
    }
    const { confirmed: _given, ...o } = y as Record<string, unknown>;
    const type = line(o.type, 20).toLowerCase();
    if (type === "pr_merged") {
      const url = line(o.url, 300).replace(/\/+$/, "");
      if (PR_URL.test(url)) {
        const got = await CHECK.pr(url);
        if (got === null) {
          return at + "pr_merged: " + url + "'s state couldn't be read on GitHub (gh): not confirmed, so refused. Try again, or give other evidence.";
        }
        if (got.state !== "MERGED") {
          return at + "pr_merged: " + url + " is " + got.state + " on GitHub, not merged.";
        }
        out.push({ ...o, confirmed: "MERGED" + (got.merge === null ? "" : " " + got.merge) });
        continue;
      }
    }
    if (type === "commit_tests") {
      const repo = line(o.repo, 120);
      const sha = line(o.sha, 40).toLowerCase();
      if (REPO.test(repo) && SHA.test(sha)) {
        const got = await CHECK.commit(repo, sha);
        if (got === null || !got.startsWith(sha)) {
          return at + "commit_tests: " + repo + "@" + sha + " not found on GitHub (gh): not confirmed, so refused. Push it first, or check the repo and sha.";
        }
        out.push({ ...o, confirmed: got });
        continue;
      }
    }
    out.push(o);
  }
  return { v: Array.isArray(x) ? out : out[0] };
}

// Showing
// =======

// an evidence as Unii's lines say it (English, short)
export function evidence_line(e: Evidence): string {
  const what: Record<EvType, () => string> = {
    slack: () => "slack " + e.channel + " " + e.ts,
    pr_merged: () => "pr_merged " + e.url + (e.confirmed === undefined ? "" : " (" + e.confirmed.slice(0, 19) + ")"),
    commit_tests: () => "commit_tests " + e.repo + "@" + (e.sha ?? "").slice(0, 12) + " " + e.passed + " pass " + e.failed + " fail",
    tfc: () => "tfc " + e.run + " " + e.status,
    file: () => "file " + e.path,
    reason: () => "reason " + JSON.stringify(e.text),
    user: () => "user's resolution" + (e.migrated ? " (migrated)" : ""),
    restart: () => "restart",
  };
  return what[e.type]();
}
