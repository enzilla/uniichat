// Restart
// =======
// The serve's restart as a native act of Unii's (R5, the user's decision
// P8 of 24/10/2026): a standing leave to restart when no subagent is at
// work, said in the chat before and after. Unii calls the restart tool
// (Tools.ts) with why and what to resume; with agents at work it's
// refused, unless the user picked "Sim, reinicie" in a task of kind
// restart (Tasks.ts's template), each such task taken once. The mark
// (restart.json in the chat's dir) outlives the process: the next start
// takes it (Server.ts Chat.open), says the restart is done and gives
// Unii a turn with what to resume, so work goes on with no prompt of the
// user's. How the process restarts: UNII_RESTART, a shell command, run
// apart from it; else, run by systemd as the unit's own process
// (INVOCATION_ID set and its parent systemd itself: a serve started from
// a shell under the unit, an agent's, inherits INVOCATION_ID but not that
// parent), it exits and the unit's Restart=always starts it again; else
// none. The mark says the process that asked and when: a start takes it
// only as a new process (not the one that asked) within MARK_TTL of the
// asking, else it's dropped unsaid (the restart didn't happen as asked:
// a later start, of any cause, must not say it did).

import * as fs from "node:fs";
import * as Tasks from "./Tasks.ts";

// a restart asked: why, what to resume, when (ISO), the agents it cut
// and the task that let it (null: none ran, none needed), whether the
// next start took it; used: the tasks that let a restart, each once
export type Mark = { why: string; resume: string; at: string; agents: string[]; task: string | null; done: boolean; used: string[]; pid?: number | null };

// how long after it's asked a start takes a mark as its restart
export const MARK_TTL = 10 * 60 * 1000;

// how this process restarts: a command, or its exit (systemd); null: none
export type How = { cmd: string } | "exit" | null;

const FILE = "/restart.json";
export const WHY    = 300;
export const RESUME = 2000;
export const USED   = 50;

// how long after the tool answers the process goes (the note, and the
// answer, reach the views first)
export const DELAY = 3000;

// parent: the name of this process's parent (/proc's comm), systemd's
// when the unit started it
export function how(env: Record<string, string | undefined>, parent: string | null = parent_name()): How {
  const cmd = (env.UNII_RESTART ?? "").trim();
  if (cmd !== "") {
    return { cmd };
  }
  return (env.INVOCATION_ID ?? "") !== "" && parent === "systemd" ? "exit" : null;
}

// the name of this process's parent; null: unknown
export function parent_name(): string | null {
  try {
    return fs.readFileSync("/proc/" + process.ppid + "/comm", "utf8").trim() || null;
  } catch {
    return null;
  }
}

// the mark as kept; null: none, or not one
export function mark_read(dir: string): Mark | null {
  try {
    const o = JSON.parse(fs.readFileSync(dir + FILE, "utf8"));
    if (typeof o !== "object" || o === null || typeof o.why !== "string" || typeof o.at !== "string") {
      return null;
    }
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((y) => typeof y === "string") : []);
    return { why: o.why, resume: typeof o.resume === "string" ? o.resume : "", at: o.at, agents: list(o.agents), task: typeof o.task === "string" ? o.task : null, done: o.done !== false, used: list(o.used).slice(-USED), pid: Number.isInteger(o.pid) ? o.pid : null };
  } catch {
    return null;
  }
}

export function mark_write(dir: string, mark: Mark): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + FILE + ".new", JSON.stringify(mark));
  fs.renameSync(dir + FILE + ".new", dir + FILE);
}

// the mark a start finds not yet taken, now taken (saved done); null:
// none, or not this start's: asked by this very process (it didn't
// restart), before it started, or longer than MARK_TTL ago (then saved
// done, unsaid). pid and since: this process's, and when it started
export function mark_take(dir: string, now = Date.now(), pid = process.pid, since = now - process.uptime() * 1000): Mark | null {
  const mark = mark_read(dir);
  if (mark === null || mark.done) {
    return null;
  }
  if (mark.pid === pid) {
    return null;
  }
  const at = Date.parse(mark.at);
  const ours = Number.isFinite(at) && now - at <= MARK_TTL && since >= at - 1000;
  mark_write(dir, { ...mark, done: true });
  return ours ? mark : null;
}

// whether a restart may go now (P8): why not, else null. working: the
// agents at work, by name; task: the one given to let it (null: none);
// used: those that let one before
export function check(h: How, working: string[], task: Tasks.Task | null, given: string | null, used: string[]): string | null {
  if (h === null) {
    return "This serve can't restart itself: it doesn't run under systemd (no INVOCATION_ID) and UNII_RESTART isn't set. Ask the user to restart it (a task of kind restart).";
  }
  if (given !== null) {
    if (task === null) {
      return "No task " + Tasks.task_id(given) + ".";
    }
    if (task.kind !== "restart") {
      return task.id + " is not of kind restart: only such a task lets a restart while agents are at work.";
    }
    // the user's pick of an option of Unii's: an order received (open, the
    // evidence round: only the user's pick makes one), or, closed before
    // that round, done by the user with it
    const ordered = Tasks.task_ordered(task) && Tasks.task_act(task, task.order?.answer ?? null) === "unii";
    if (!ordered && (task.state !== "done" || Tasks.task_act(task) !== "unii")) {
      return task.id + " doesn't let it: the user hasn't picked an option of yours (" + (Object.entries(task.acts).filter(([, a]) => a === "unii").map(([c]) => c).join(" | ") || "none") + ").";
    }
    // the user's pick only (the Mesa, the terminal): one Unii set itself
    // (task_edit) is no leave
    if (!ordered && task.closed_by !== "user") {
      return task.id + " doesn't let it: it was closed by you (task_edit), not by the user. Only the user's pick (the Mesa or the terminal) lets a restart while agents are at work: open it again for them, or wait for the agents' reports.";
    }
    if (used.includes(task.id)) {
      return task.id + " let a restart already: each lets one. Add a new task of kind restart.";
    }
    return null;
  }
  if (working.length > 0) {
    return "Agents at work: " + working.join(", ") + ". The standing leave (P8) is for restarts with none running: wait for their reports, or add a task of kind restart (assignee user: it offers \"" + Tasks.RESTART_YES + "\") and call restart again with its id once the user picks it.";
  }
  return null;
}

// said in the chat before the restart, and after it (the user's
// language: notes show in every view)
export function said_before(mark: Mark): string {
  const cut = mark.agents.length === 0 ? "" : " Agentes interrompidos: " + mark.agents.join(", ") + "; o Unii os retoma em seguida.";
  return "Reiniciando o serve: " + period(mark.why) + " O chat volta em alguns segundos, e o Unii retoma o trabalho sozinho." + cut;
}

export function said_after(mark: Mark): string {
  return "Serve reiniciado (pedido às " + clock(mark.at) + "): " + period(mark.why);
}

// the message that starts Unii's turn after it: what to resume
export function resume_said(mark: Mark): string {
  const cut = mark.agents.length === 0 ? "" : " It cut these agents: " + mark.agents.join(", ") + ": tell each to go on.";
  return "[Restart] The serve restarted as you asked at " + mark.at + " (" + mark.why + ")." + cut + " Resume now: " + (mark.resume === "" ? "check your open tasks (assignee unii) and go on." : mark.resume);
}

// a time as the chat reads it, the server's clock ("21:30")
function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// a text ending as a sentence does
function period(text: string): string {
  return /[.!?…]$/.test(text) ? text : text + ".";
}
