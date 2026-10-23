// Tasks
// =====
// The chat's pending list ("pendências"): what Unii needs of the user (an
// approval, a product decision, a hand step) or keeps for itself, shown
// beside the chat (the web's aside, the terminal's footer and /p) where
// the user resolves each: done (with one of its choices, if any, and a
// comment), dropped, or opened again. Only the master's tools add and
// edit them (Tools.ts task_add, task_edit, tasks); subagents ask in
// their reports. Kept with the chat in tasks.json, apart from view.json
// (Memory.ts), written whole as it is; closed ones past KEEP or AGE go
// to tasks-arquivo.jsonl, only appended, never read in a turn.
// Each turn's message carries the list (Tasks.block, after "Agents at
// work now", out of the cached prefix): the open ones, then what the user
// changed since the last turn, marked told once a call that showed it
// ends well (Tasks.told), so a failed call shows it again. A user's
// resolution is a note in the chat; with go, a "[Pendências]" message
// that starts a turn, as a report does (Server.ts).
// Every text is stripped of control characters as it comes: titles and
// details reach the terminal (ANSI) and the web (escaped there).

import * as fs from "node:fs";
import { Disk } from "./Disk.ts";

// Types
// =====

export type State = "open" | "done" | "dropped";
export type Who   = "user" | "unii";

// a pending item: id ("P7"), title, detail (Markdown), state, who must
// act, who made it ("main", "user"), the answers offered, the one chosen,
// the comment it was closed with, a free link (a project, an agent, a
// PR), when made, last changed and closed (ISO), whether Unii saw its
// last change by the user
export type Task = {
  id      : string;
  title   : string;
  detail  : string;
  state   : State;
  who     : Who;
  by      : string;
  choices : string[];
  answer  : string | null;
  note    : string | null;
  ref     : string | null;
  made    : string;
  changed : string;
  closed  : string | null;
  told    : boolean;
};

// the list of a chat's dir: the next id's number, the tasks; shown: the
// changes the last block showed, by id, at each one's `changed`
export type Store = { dir: string; next: number; tasks: Task[]; shown: Map<string, string> };

// a change asked: by Unii (task_add, task_edit) or the user (an act)
export type Edit = {
  title?   : unknown;
  detail?  : unknown;
  who?     : unknown;
  choices? : unknown;
  ref?     : unknown;
  state?   : unknown;
  answer?  : unknown;
  note?    : unknown;
};

// Constants
// =========

// the longest title, detail, comment, choice, ref; the most choices
export const TITLE   = 200;
export const DETAIL  = 2000;
export const NOTE    = 1000;
export const CHOICE  = 80;
export const CHOICES = 9;
export const REF     = 100;

// the most open at once; closed ones kept past KEEP, or older than AGE,
// go to the archive (unless Unii hasn't seen them)
export const OPEN = 100;
export const KEEP = 200;
const DAY         = 86400000;
export const AGE  = 30 * DAY;

// a turn's block lists at most LINES open; views get the open ones and
// those closed in RECENT, at most VIEW of those
export const LINES  = 30;
export const RECENT = 7 * DAY;
export const VIEW   = 50;

const FILE    = "/tasks.json";
const ARCHIVE = "/tasks-arquivo.jsonl";

// the lists open, by dir (one per chat; tests open many)
const STORES = new Map<string, Store>();

const STATES: State[] = ["open", "done", "dropped"];

// how a resolution reads, in the chat (the user's language: notes show
// in both views)
const SAID: Record<State, string> = { open: "reaberta", done: "concluída", dropped: "descartada" };

// Texts
// =====

// a line: control characters (ESC included) and runs of spaces as one
// space, trimmed, cut at n
export function text_line(x: unknown, n: number): string {
  return String(x ?? "").replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
}

// a text of lines: control characters gone but newlines (tabs as
// spaces), cut at n
export function text_body(x: unknown, n: number): string {
  return String(x ?? "").replace(/\r\n?|[\u2028\u2029]/g, "\n").replace(/\t/g, "  ").replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "").trim().slice(0, n);
}

// "P7", "p7", "7": "P7"
export function task_id(x: unknown): string {
  const m = /^\s*[Pp]?(\d+)\s*$/.exec(String(x ?? ""));
  return m === null ? String(x ?? "").trim() : "P" + Number(m[1]);
}

// Store
// =====

// the list of a chat's dir, read once (none, or unreadable: empty, the
// unreadable file kept aside)
export function tasks_load(dir: string): Store {
  const had = STORES.get(dir);
  if (had !== undefined) {
    return had;
  }
  const s: Store = { dir, next: 1, tasks: [], shown: new Map() };
  const file = dir + FILE;
  if (fs.existsSync(file)) {
    try {
      const got = JSON.parse(fs.readFileSync(file, "utf8"));
      s.tasks = Array.isArray(got.tasks) ? got.tasks : [];
      s.next = Math.max(Number(got.next) || 1, ...s.tasks.map((t) => Number(t.id.slice(1)) + 1));
    } catch (err: any) {
      console.error("unii: " + file + " unreadable, kept as " + file + ".bad: " + (err?.message ?? err));
      fs.renameSync(file, file + ".bad");
    }
  }
  STORES.set(dir, s);
  return s;
}

// forgets the lists read (tests)
export function tasks_forget(): void {
  STORES.clear();
}

// written whole, then moved in place; flushed soon (Disk.ts)
export function tasks_save(s: Store): void {
  const file = s.dir + FILE;
  fs.mkdirSync(s.dir, { recursive: true });
  fs.writeFileSync(file + ".new", JSON.stringify({ next: s.next, tasks: s.tasks }));
  fs.renameSync(file + ".new", file);
  Disk.wrote(file);
}

// the closed ones past KEEP (the newest kept) or older than AGE, seen by
// Unii, appended to the archive and dropped
export function tasks_archive(s: Store, now: number): Task[] {
  const closed = s.tasks.filter((t) => t.state !== "open" && t.told).sort((a, b) => (b.closed ?? "").localeCompare(a.closed ?? ""));
  const old = closed.filter((t, k) => k >= KEEP || now - Date.parse(t.closed ?? t.changed) > AGE);
  if (old.length === 0) {
    return [];
  }
  fs.appendFileSync(s.dir + ARCHIVE, old.map((t) => JSON.stringify(t) + "\n").join(""));
  Disk.wrote(s.dir + ARCHIVE);
  s.tasks = s.tasks.filter((t) => !old.includes(t));
  return old;
}

export function task_find(s: Store, id: unknown): Task | null {
  const key = task_id(id);
  return s.tasks.find((t) => t.id === key) ?? null;
}

// Changes
// =======

// a choices list as given: strings, each a line, none empty or twice
function choices_read(x: unknown): string[] | string {
  if (x === undefined || x === null) {
    return [];
  }
  if (!Array.isArray(x)) {
    return "choices is a list of strings.";
  }
  const all = [...new Set(x.map((c) => text_line(c, CHOICE)).filter((c) => c !== ""))];
  return all.length > CHOICES ? "At most " + CHOICES + " choices." : all;
}

// a new task made by Unii (by: "main"); else why not
export function task_new(s: Store, args: Edit, by: string, now: number): Task | string {
  const title = text_line(args.title, TITLE);
  const choices = choices_read(args.choices);
  const who = args.who === undefined || args.who === null ? "user" : String(args.who);
  if (title === "") {
    return "A task needs a title.";
  }
  if (typeof choices === "string") {
    return choices;
  }
  if (who !== "user" && who !== "unii") {
    return "who is user or unii.";
  }
  const open = s.tasks.filter((t) => t.state === "open");
  const twin = open.find((t) => t.title.toLowerCase() === title.toLowerCase());
  if (twin !== undefined) {
    return twin.id + " is open with this title already: edit it (task_edit) instead.";
  }
  if (open.length >= OPEN) {
    return "The list has " + OPEN + " open tasks, the most it keeps: close some first.";
  }
  const at = new Date(now).toISOString();
  const ref = text_line(args.ref, REF);
  const task: Task = {
    id: "P" + s.next, title, detail: text_body(args.detail, DETAIL), state: "open", who, by, choices, answer: null, note: null,
    ref: ref === "" ? null : ref, made: at, changed: at, closed: null, told: true,
  };
  s.next += 1;
  s.tasks.push(task);
  tasks_save(s);
  return task;
}

// a task changed by Unii (task_edit): any field, its state too (one it
// closes is told: Unii did it); else why not
export function task_edit(s: Store, args: Edit & { id?: unknown }, now: number): Task | string {
  const task = task_find(s, args.id);
  if (task === null) {
    return "No task " + task_id(args.id) + ".";
  }
  const next = { ...task };
  if (args.title !== undefined) {
    next.title = text_line(args.title, TITLE);
    if (next.title === "") {
      return "A task needs a title.";
    }
  }
  if (args.detail !== undefined) {
    next.detail = text_body(args.detail, DETAIL);
  }
  if (args.who !== undefined) {
    if (args.who !== "user" && args.who !== "unii") {
      return "who is user or unii.";
    }
    next.who = args.who;
  }
  if (args.choices !== undefined) {
    const choices = choices_read(args.choices);
    if (typeof choices === "string") {
      return choices;
    }
    next.choices = choices;
  }
  if (args.ref !== undefined) {
    const ref = text_line(args.ref, REF);
    next.ref = ref === "" ? null : ref;
  }
  if (args.note !== undefined) {
    const note = text_body(args.note, NOTE);
    next.note = note === "" ? null : note;
  }
  if (args.state !== undefined) {
    const state = String(args.state) as State;
    if (!STATES.includes(state)) {
      return "state is one of " + STATES.join(", ") + ".";
    }
    if (state === "open" && task.state !== "open" && s.tasks.filter((t) => t.state === "open").length >= OPEN) {
      return "The list has " + OPEN + " open tasks, the most it keeps: close some first.";
    }
    next.state = state;
  }
  if (args.answer !== undefined) {
    const answer = args.answer === null ? null : text_line(args.answer, CHOICE);
    if (answer !== null && answer !== "" && !next.choices.includes(answer)) {
      return "No choice " + JSON.stringify(answer) + "; one of: " + next.choices.join(" | ") + ".";
    }
    next.answer = answer === "" ? null : answer;
  }
  return task_put(s, task, next, now, true);
}

// a task resolved by the user: done (answer: one of its choices), dropped
// or opened again, with a comment; null: so already (an act done again
// changes nothing), else the task, else why not
export function task_resolve(s: Store, id: unknown, state: unknown, answer: unknown, note: unknown, now: number): Task | string | null {
  const task = task_find(s, id);
  if (task === null) {
    return "Pendência " + task_id(id) + " não encontrada.";
  }
  const to = String(state) as State;
  if (!STATES.includes(to)) {
    return "Estado inválido: " + String(state) + ".";
  }
  const said = answer === undefined || answer === null ? null : text_line(answer, CHOICE) || null;
  if (said !== null && !task.choices.includes(said)) {
    return "A pendência " + task.id + " não tem a opção " + JSON.stringify(said) + ".";
  }
  const comment = note === undefined || note === null ? null : text_body(note, NOTE) || null;
  if (to === "open") {
    if (task.state === "open") {
      return null;
    }
    if (s.tasks.filter((t) => t.state === "open").length >= OPEN) {
      return "Há " + OPEN + " pendências abertas, o máximo: conclua alguma antes.";
    }
    return task_put(s, task, { ...task, state: "open", answer: null, note: comment }, now, false);
  }
  if (task.state === to && task.answer === said && (comment === null || comment === task.note)) {
    return null;
  }
  return task_put(s, task, { ...task, state: to, answer: to === "done" ? said : null, note: comment ?? task.note }, now, false);
}

// a change kept: stamped (a close: its time; told: Unii's own), the
// closed archived, saved
function task_put(s: Store, task: Task, next: Task, now: number, told: boolean): Task {
  const at = new Date(now).toISOString();
  const closes = next.state !== "open" && task.state === "open";
  next.changed = at;
  next.closed = next.state === "open" ? null : closes ? at : (task.closed ?? at);
  next.told = told;
  s.tasks[s.tasks.indexOf(task)] = next;
  tasks_archive(s, now);
  tasks_save(s);
  return next;
}

// the user's changes Unii hasn't seen, oldest first
export function tasks_untold(s: Store): Task[] {
  return s.tasks.filter((t) => !t.told).sort((a, b) => a.changed.localeCompare(b.changed));
}

// those changes seen: told, saved (a change since, at another `changed`,
// stays to tell); ids: those of `shown`, else all untold
export function tasks_told(s: Store, shown: Map<string, string> = s.shown): number {
  const told = s.tasks.filter((t) => !t.told && shown.get(t.id) === t.changed);
  told.forEach((t) => (t.told = true));
  if (told.length > 0) {
    tasks_save(s);
  }
  return told.length;
}

// every untold change told now (it went in a message)
export function tasks_tell(s: Store): Task[] {
  const all = tasks_untold(s);
  tasks_told(s, new Map(all.map((t) => [t.id, t.changed])));
  return all;
}

// Showing
// =======

// the open ones, the user's first, each by id; then the closed, newest
// first
export function tasks_sort(tasks: Task[]): Task[] {
  const num = (t: Task) => Number(t.id.slice(1));
  const open = tasks.filter((t) => t.state === "open").sort((a, b) => (a.who === b.who ? num(a) - num(b) : a.who === "user" ? -1 : 1));
  const closed = tasks.filter((t) => t.state !== "open").sort((a, b) => (b.closed ?? "").localeCompare(a.closed ?? ""));
  return [...open, ...closed];
}

// what views get: the open ones, then at most VIEW closed in RECENT
export function tasks_view(s: Store, now: number): Task[] {
  const all = tasks_sort(s.tasks);
  const open = all.filter((t) => t.state === "open");
  const closed = all.filter((t) => t.state !== "open" && now - Date.parse(t.closed ?? t.changed) <= RECENT).slice(0, VIEW);
  return [...open, ...closed];
}

// how long ago: "5m", "3h", "2d"
export function ago(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  return ms < 3600000 ? Math.floor(ms / 60000) + "m" : ms < DAY ? Math.floor(ms / 3600000) + "h" : Math.floor(ms / DAY) + "d";
}

// a resolution as the chat reads it: "Pendência P7 concluída pelo
// usuário: “título”. Resposta: sim. Comentário: “pode”."
export function task_said(t: Task): string {
  const answer = t.answer === null ? "" : " Resposta: " + t.answer + ".";
  const note = t.note === null ? "" : " Comentário: “" + t.note + "”.";
  return "Pendência " + t.id + " " + SAID[t.state] + " pelo usuário: “" + t.title + "”." + answer + note;
}

// a task as a line of the tasks tool or the block
export function task_line(t: Task, now: number, whole = false): string {
  const opts = t.choices.length === 0 ? "" : " options: " + t.choices.join(" | ");
  const tail = [t.ref === null ? "" : "ref " + t.ref, ago(t.made, now)].filter((x) => x !== "").join(", ");
  const how   = [t.state, t.answer === null ? "" : "answer: " + t.answer, t.note === null ? "" : "note: " + JSON.stringify(t.note)].filter((x) => x !== "");
  const state = t.state === "open" ? "" : " (" + how.join(", ") + ")";
  const head = "- " + t.id + " [" + t.who + "] " + t.title + state + opts + " (" + tail + ")";
  return whole && t.detail !== "" ? head + "\n  " + t.detail.replace(/\n/g, "\n  ") : head;
}

// the tasks tool: the open ones (all: and those closed lately), or those
// of a ref, or one whole
export function tasks_list(s: Store, args: { all?: unknown; ref?: unknown; id?: unknown }, now: number): string {
  if (args.id !== undefined) {
    const t = task_find(s, args.id);
    return t === null ? "No task " + task_id(args.id) + "." : task_line(t, now, true);
  }
  const all = args.all === true || args.all === "true";
  const ref = args.ref === undefined ? null : String(args.ref).toLowerCase();
  const shown = (all ? tasks_view(s, now) : tasks_sort(s.tasks).filter((t) => t.state === "open")).filter((t) => ref === null || (t.ref ?? "").toLowerCase().includes(ref));
  return shown.length === 0 ? (all ? "No tasks." : "No open tasks.") : shown.map((t) => task_line(t, now, true)).join("\n");
}

// a turn's block: what the user changed since the last turn, then the
// open ones (the newest LINES), each a line; "" if neither. What it shows
// is kept, to be told once the call ends well (Tasks.told)
export function tasks_block(s: Store, now: number): string {
  const changed = tasks_untold(s);
  const open = tasks_sort(s.tasks).filter((t) => t.state === "open");
  s.shown = new Map(changed.map((t) => [t.id, t.changed]));
  if (changed.length === 0 && open.length === 0) {
    return "";
  }
  const did = (t: Task) => {
    const what = t.state === "open" ? "reopened" : t.state;
    const answer = t.answer === null ? "" : " — answer: " + t.answer;
    const note = t.note === null ? "" : " — note: " + JSON.stringify(t.note);
    return "- " + t.id + " " + what + " by user: " + JSON.stringify(t.title) + answer + note;
  };
  const newest = tasks_sort([...open].sort((a, b) => b.made.localeCompare(a.made)).slice(0, LINES));
  const lines = [
    "Tasks (your pending list; the user sees it beside the chat and resolves items there):",
    ...(changed.length === 0 ? [] : ["Changed by the user since your last turn:", ...changed.map(did)]),
    ...(open.length === 0 ? ["Open: none."] : ["Open (" + open.length + "; the user's first):", ...newest.map((t) => task_line(t, now))]),
    ...(open.length > LINES ? ["+" + (open.length - LINES) + " older (the tasks tool lists them)"] : []),
  ];
  return lines.join("\n") + "\n\n";
}
