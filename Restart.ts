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
// apart from it; else, run by systemd (INVOCATION_ID set, the unit's
// Restart=always), it exits and systemd starts it again; else none.

import * as fs from "node:fs";
import * as Tasks from "./Tasks.ts";

// a restart asked: why, what to resume, when (ISO), the agents it cut
// and the task that let it (null: none ran, none needed), whether the
// next start took it; used: the tasks that let a restart, each once
export type Mark = { why: string; resume: string; at: string; agents: string[]; task: string | null; done: boolean; used: string[] };

// how this process restarts: a command, or its exit (systemd); null: none
export type How = { cmd: string } | "exit" | null;

const FILE = "/restart.json";
export const WHY    = 300;
export const RESUME = 2000;
export const USED   = 50;

// how long after the tool answers the process goes (the note, and the
// answer, reach the views first)
export const DELAY = 3000;

export function how(env: Record<string, string | undefined>): How {
  const cmd = (env.UNII_RESTART ?? "").trim();
  return cmd !== "" ? { cmd } : (env.INVOCATION_ID ?? "") !== "" ? "exit" : null;
}

// the mark as kept; null: none, or not one
export function mark_read(dir: string): Mark | null {
  try {
    const o = JSON.parse(fs.readFileSync(dir + FILE, "utf8"));
    if (typeof o !== "object" || o === null || typeof o.why !== "string" || typeof o.at !== "string") {
      return null;
    }
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((y) => typeof y === "string") : []);
    return { why: o.why, resume: typeof o.resume === "string" ? o.resume : "", at: o.at, agents: list(o.agents), task: typeof o.task === "string" ? o.task : null, done: o.done !== false, used: list(o.used).slice(-USED) };
  } catch {
    return null;
  }
}

export function mark_write(dir: string, mark: Mark): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + FILE + ".new", JSON.stringify(mark));
  fs.renameSync(dir + FILE + ".new", dir + FILE);
}

// the mark a start finds not yet taken, now taken (saved done); null: none
export function mark_take(dir: string): Mark | null {
  const mark = mark_read(dir);
  if (mark === null || mark.done) {
    return null;
  }
  mark_write(dir, { ...mark, done: true });
  return mark;
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
    if (task.state !== "done" || Tasks.task_act(task) !== "unii") {
      return task.id + " doesn't let it: the user hasn't picked an option of yours (" + (Object.entries(task.acts).filter(([, a]) => a === "unii").map(([c]) => c).join(" | ") || "none") + ").";
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
