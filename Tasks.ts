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
// details reach the terminal (ANSI) and the web (escaped there). What
// tasks.json holds is read item by item (task_read): a hand edit, or a
// file of another version, can't break a turn or a view; an item with
// no id "P<n>" is left out, said in the server's log, the file kept
// whole as tasks.json.bad.
// Each change by the user stamps the task with the list's next version
// (rev, only ever up), so a block's shown changes are told by version,
// never by clock: two in one millisecond stay apart. Unii's own edits
// keep the stamp and whether it was told, unless it changes the state.
// A task may wait for others (after: their ids, TaskDeps.ts): blocked
// while any is open, it's out of the user's list (a count of those
// waiting shows instead) and can't be resolved; the open ones that free
// others come first, by how many. Freed (its last open one closed), it's
// a change Unii is told of, as a user's is (freed, a version stamped);
// waiting again (one reopened) before it was told, that change is moot.
// An after list is checked as given (ids that exist, not itself, no
// cycle) and as read from tasks.json (what's wrong left out, said in the
// log), so a hand edit can't make a list that loops.

import * as fs from "node:fs";
import { Disk } from "./Disk.ts";
import * as Deps from "./TaskDeps.ts";

// Types
// =====

export type State = "open" | "done" | "dropped";
export type Who   = "user" | "unii";

// a pending item (rev: the list's version at the last change by the
// user, Store.rev): id ("P7"), title, detail (Markdown), state, who must
// act, who made it ("main", "user"), the answers offered and what each
// means (hints, by the answer's place: "" for none), the one chosen,
// the comment it was closed with, a free link (a project, an agent, a
// PR), when made, last changed and closed (ISO), whether Unii saw its
// last change by the user; the ids it waits for (TaskDeps.ts), and
// whether that last change untold is its being freed
export type Task = {
  id      : string;
  title   : string;
  detail  : string;
  state   : State;
  who     : Who;
  by      : string;
  choices : string[];
  hints   : string[];
  answer  : string | null;
  note    : string | null;
  ref     : string | null;
  made    : string;
  changed : string;
  closed  : string | null;
  told    : boolean;
  rev     : number;
  after   : string[];
  freed   : boolean;
};

// the list of a chat's dir: the next id's number, the last version
// stamped (only up), the tasks; shown: the changes the last block
// showed, by id, at each one's rev
export type Store = { dir: string; next: number; rev: number; tasks: Task[]; shown: Map<string, number> };

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
  after?   : unknown;
};

// Constants
// =========

// the longest title, detail, comment, choice, ref; the most choices
export const TITLE   = 200;
export const DETAIL  = 2000;
export const NOTE    = 1000;
export const CHOICE  = 80;
export const HINT    = 300;
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

// a time as read: an ISO date, else `or`
function time_read(x: unknown, or: string): string {
  return typeof x === "string" && !Number.isNaN(Date.parse(x)) ? new Date(Date.parse(x)).toISOString() : or;
}

// a whole number >= 0 as read, else 0
function count_read(x: unknown): number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : 0;
}

// an item of tasks.json as a task: each field checked, its texts cleaned
// and cut as if given now, what's missing or wrong filled in; null: none
// can be made (no id "P<n>")
export function task_read(x: unknown, now: number): Task | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return null;
  }
  const o = x as Record<string, unknown>;
  const m = /^P([1-9]\d{0,8})$/.exec(typeof o.id === "string" ? o.id.trim() : "");
  if (m === null) {
    return null;
  }
  const state = STATES.includes(o.state as State) ? (o.state as State) : "open";
  // choices kept as answers and hints, or, as Unii may give them, each
  // its label and description (choices_read); a list without hints, as
  // older files keep, has none
  const hint = (k: number) => (Array.isArray(o.hints) && typeof o.hints[k] === "string" ? o.hints[k] : "");
  const given = (Array.isArray(o.choices) ? o.choices : []).flatMap((c, k) => (typeof c === "string" ? [{ label: c, description: hint(k) }] : typeof c?.label === "string" ? [c] : []));
  const read = choices_read(given);
  const { choices, hints } = typeof read === "string" ? choices_read(given.slice(0, CHOICES)) as Choices : read;
  const answer = typeof o.answer === "string" ? text_line(o.answer, CHOICE) : "";
  const text = (y: unknown, n: number, f: (y: unknown, n: number) => string) => (typeof y === "string" ? f(y, n) : "");
  const note = text(o.note, NOTE, text_body);
  const ref = text(o.ref, REF, text_line);
  const at = new Date(now).toISOString();
  const made = time_read(o.made, at);
  const changed = time_read(o.changed, made);
  return {
    id      : "P" + Number(m[1]),
    title   : text(o.title, TITLE, text_line) || "(sem título)",
    detail  : text(o.detail, DETAIL, text_body),
    state,
    who     : o.who === "unii" ? "unii" : "user",
    by      : text(o.by, 40, text_line) || "main",
    choices,
    hints,
    answer  : state === "done" && choices.includes(answer) ? answer : null,
    note    : note === "" ? null : note,
    ref     : ref === "" ? null : ref,
    made,
    changed,
    closed  : state === "open" ? null : time_read(o.closed, changed),
    told    : o.told !== false,
    rev     : count_read(o.rev),
    after   : after_raw(o.after, "P" + Number(m[1])),
    freed   : o.freed === true && o.told === false,
  };
}

// an after list as tasks.json holds it: its ids "P<n>" (none twice, not
// the task's own), at most AFTER; anything else left out
function after_raw(x: unknown, self: string): string[] {
  if (!Array.isArray(x)) {
    return [];
  }
  const ids = x.filter((y) => typeof y === "string" && /^P[1-9]\d{0,8}$/.test(y.trim())).map((y) => (y as string).trim());
  return [...new Set(ids)].filter((id) => id !== self).slice(0, Deps.AFTER);
}

// the after lists of tasks read, made sound: ids of no task left out, and
// those that would close a cycle (each task's in turn, in the list's
// order, kept only if it waits for no one that waits for it); how many
// lists changed, from what was read (raw: the items as read, by id)
function after_sound(tasks: Task[], raw: Map<string, unknown>): number {
  const ids = new Set(tasks.map((t) => t.id));
  const kept: Task[] = tasks.map((t) => ({ ...t, after: [] }));
  let fixed = 0;
  tasks.forEach((t, k) => {
    const after = t.after.filter((id) => ids.has(id) && !Deps.reaches(kept, [id], t.id));
    kept[k].after = after;
    t.after = after;
    const was = raw.get(t.id);
    if (JSON.stringify(was ?? []) !== JSON.stringify(after)) {
      fixed += 1;
    }
  });
  return fixed;
}

// the list of a chat's dir, read once (none: empty). Read whole before
// it's taken: unreadable, it's kept aside and the list is empty; items
// left out (task_read; an id twice: the first) are said in the log, the
// file kept aside as it was. The next id and version: past every one read
export function tasks_load(dir: string, now = Date.now()): Store {
  const had = STORES.get(dir);
  if (had !== undefined) {
    return had;
  }
  const s: Store = { dir, next: 1, rev: 0, tasks: [], shown: new Map() };
  const file = dir + FILE;
  if (fs.existsSync(file)) {
    try {
      const got = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof got !== "object" || got === null || !Array.isArray(got.tasks)) {
        throw new Error("no list of tasks");
      }
      const tasks: Task[] = [];
      const raw = new Map<string, unknown>();
      let left = 0;
      for (const x of got.tasks) {
        const t = task_read(x, now);
        if (t === null || tasks.some((u) => u.id === t.id)) {
          left += 1;
        } else {
          tasks.push(t);
          raw.set(t.id, (x as Record<string, unknown>).after ?? []);
        }
      }
      const fixed = after_sound(tasks, raw);
      if (fixed > 0) {
        console.error("unii: " + file + ": " + fixed + " task(s) with an after list wrong (not a list of ids, an id of no task, the task itself, a cycle): those ids left out");
      }
      if (left > 0 || fixed > 0) {
        if (left > 0) {
          console.error("unii: " + file + ": " + left + " item(s) left out (no id P<n>, or an id twice); the file as it was kept as " + file + ".bad");
        }
        fs.copyFileSync(file, file + ".bad");
      }
      s.tasks = tasks;
      s.next = Math.max(1, count_read(got.next), ...tasks.map((t) => Number(t.id.slice(1)) + 1));
      s.rev = Math.max(count_read(got.rev), ...tasks.map((t) => t.rev));
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
  fs.writeFileSync(file + ".new", JSON.stringify({ next: s.next, rev: s.rev, tasks: s.tasks }));
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
  const gone = new Set(old.map((t) => t.id));
  s.tasks.forEach((t) => (t.after = t.after.filter((id) => !gone.has(id))));
  return old;
}

export function task_find(s: Store, id: unknown): Task | null {
  const key = task_id(id);
  return s.tasks.find((t) => t.id === key) ?? null;
}

// Changes
// =======

// the answers offered and what each means, by place
type Choices = { choices: string[]; hints: string[] };

// a choices list as given: each a label, or { label, description } (a
// line each), none empty or twice (the first kept)
function choices_read(x: unknown): Choices | string {
  if (x === undefined || x === null) {
    return { choices: [], hints: [] };
  }
  if (!Array.isArray(x)) {
    return "choices is a list of { label, description } (or of strings).";
  }
  const all = x.map((c): Record<string, unknown> => (typeof c === "object" && c !== null ? c : { label: c })).map((c) => ({ label: text_line(c.label, CHOICE), hint: text_line(c.description, HINT) }));
  const kept = all.filter((c, k) => c.label !== "" && all.findIndex((d) => d.label === c.label) === k);
  return kept.length > CHOICES ? "At most " + CHOICES + " choices." : { choices: kept.map((c) => c.label), hints: kept.map((c) => c.hint) };
}

// an after list as given (["P3", "P4"], or "P3, P4"; null: none): ids
// of tasks of the list, none twice; self: the task's own id, refused, as
// an id whose own after lists reach it (a cycle); else why not
function after_read(s: Store, x: unknown, self: string | null): string[] | string {
  if (x === undefined || x === null || x === "") {
    return [];
  }
  const all = typeof x === "string" ? x.split(/[\s,;]+/).filter((y) => y !== "") : Array.isArray(x) ? x : null;
  if (all === null || all.some((y) => typeof y !== "string" && typeof y !== "number")) {
    return "after is a list of task ids, as [\"P3\", \"P4\"].";
  }
  const ids = [...new Set(all.map(task_id))];
  if (ids.length > Deps.AFTER) {
    return "A task waits for at most " + Deps.AFTER + " others.";
  }
  for (const id of ids) {
    if (id === self) {
      return "A task can't wait for itself (" + id + ").";
    }
    if (task_find(s, id) === null) {
      return "No task " + id + " to wait for.";
    }
  }
  if (self !== null) {
    const loop = ids.find((id) => Deps.reaches(s.tasks, [id], self));
    if (loop !== undefined) {
      return loop + " waits for " + self + " already (directly or through others): " + self + " can't wait for it, a cycle.";
    }
  }
  return ids;
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
  const after = after_read(s, args.after, null);
  if (typeof after === "string") {
    return after;
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
    id: "P" + s.next, title, detail: text_body(args.detail, DETAIL), state: "open", who, by, ...choices, answer: null, note: null,
    ref: ref === "" ? null : ref, made: at, changed: at, closed: null, told: true, rev: 0, after, freed: false,
  };
  s.next += 1;
  s.tasks.push(task);
  tasks_save(s);
  return task;
}

// a task changed by Unii (task_edit): any field, its state too. A new
// state makes the task told (Unii did it); any other edit leaves told
// and rev as they were, so a user's change Unii hasn't seen yet stays to
// tell; else why not
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
    next.choices = choices.choices;
    next.hints = choices.hints;
  }
  if (args.ref !== undefined) {
    const ref = text_line(args.ref, REF);
    next.ref = ref === "" ? null : ref;
  }
  if (args.note !== undefined) {
    const note = text_body(args.note, NOTE);
    next.note = note === "" ? null : note;
  }
  if (args.after !== undefined) {
    const after = after_read(s, args.after, task.id);
    if (typeof after === "string") {
      return after;
    }
    next.after = after;
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
  return task_put(s, task, next, now, next.state !== task.state ? true : null);
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
  const waits = Deps.waits(s.tasks, task);
  if (to !== "open" && task.state === "open" && waits.length > 0) {
    return "A pendência " + task.id + " aguarda " + waits.join(", ") + ": resolva " + (waits.length === 1 ? "essa pendência" : "essas pendências") + " antes. Nada foi alterado.";
  }
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

// a change kept: stamped (a close: its time); told: true, Unii's own
// change of state; false, the user's, stamped with the next version;
// null, Unii's other edits, told and rev as they were. The closed
// archived, saved. Others it frees, or makes wait again: tasks_freed
function task_put(s: Store, task: Task, next: Task, now: number, told: boolean | null): Task {
  const at = new Date(now).toISOString();
  const closes = next.state !== "open" && task.state === "open";
  const was = Deps.blocked_ids(s.tasks);
  next.changed = at;
  next.closed = next.state === "open" ? null : closes ? at : (task.closed ?? at);
  next.told = told ?? task.told;
  next.freed = told === null ? task.freed : false;
  if (told === false) {
    s.rev += 1;
    next.rev = s.rev;
  }
  s.tasks[s.tasks.indexOf(task)] = next;
  tasks_freed(s, was, next.id);
  tasks_archive(s, now);
  tasks_save(s);
  return next;
}

// after a change (to the task `by`): each open task that waited (was:
// the blocked before) and waits no more is freed, a change to tell
// (stamped with the next version), but by: Unii changed it itself; each
// that waits again before its being freed was told, that change undone
function tasks_freed(s: Store, was: Set<string>, by: string): void {
  const now = Deps.blocked_ids(s.tasks);
  for (const t of s.tasks) {
    if (t.state !== "open") {
      continue;
    }
    if (was.has(t.id) && !now.has(t.id) && t.id !== by) {
      s.rev += 1;
      t.rev = s.rev;
      t.told = false;
      t.freed = true;
    } else if (!was.has(t.id) && now.has(t.id) && t.freed && !t.told) {
      t.told = true;
      t.freed = false;
    }
  }
}

// the user's changes Unii hasn't seen, oldest first
export function tasks_untold(s: Store): Task[] {
  return s.tasks.filter((t) => !t.told).sort((a, b) => a.rev - b.rev || a.changed.localeCompare(b.changed));
}

// those changes seen: told, saved (a change since, at another rev, stays
// to tell); shown: rev by id, those the last block showed by default
export function tasks_told(s: Store, shown: Map<string, number> = s.shown): number {
  const told = s.tasks.filter((t) => !t.told && shown.get(t.id) === t.rev);
  told.forEach((t) => (t.told = true));
  if (told.length > 0) {
    tasks_save(s);
  }
  return told.length;
}

// every untold change by the user told now (it went in a message); a
// freeing isn't the user's: the block of the turn that message starts
// tells it
export function tasks_tell(s: Store): Task[] {
  const all = tasks_untold(s).filter((t) => !t.freed);
  tasks_told(s, new Map(all.map((t) => [t.id, t.rev])));
  return all;
}

// Showing
// =======

// the open ones free to resolve: those that free others first, most
// first (TaskDeps.frees), then the user's, each by id; then the open
// that wait, by id; then the closed, newest first
export function tasks_sort(tasks: Task[]): Task[] {
  const num = (t: Task) => Number(t.id.slice(1));
  const waiting = Deps.blocked_ids(tasks);
  const frees = new Map(tasks.map((t) => [t.id, Deps.frees(tasks, t)]));
  const rank = (a: Task, b: Task) => (frees.get(b.id)! - frees.get(a.id)!) || (a.who === b.who ? num(a) - num(b) : a.who === "user" ? -1 : 1);
  const free = tasks.filter((t) => t.state === "open" && !waiting.has(t.id)).sort(rank);
  const open = [...free, ...tasks.filter((t) => waiting.has(t.id)).sort((a, b) => num(a) - num(b))];
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
  if (t.freed && t.state === "open") {
    return "Pendência " + t.id + " liberada: “" + t.title + "”. As pendências de que dependia (" + t.after.join(", ") + ") foram resolvidas.";
  }
  const answer = t.answer === null ? "" : " Resposta: " + t.answer + ".";
  const note = t.note === null ? "" : " Comentário: “" + t.note + "”.";
  return "Pendência " + t.id + " " + SAID[t.state] + " pelo usuário: “" + t.title + "”." + answer + note;
}

// a task as a line of the tasks tool or the block (all: the list it's
// of, for whom it waits and frees; none given, those not said)
export function task_line(t: Task, now: number, whole = false, all: Task[] | null = null): string {
  const waits = all === null ? [] : Deps.waits(all, t);
  const frees = all === null ? [] : Deps.frees_direct(all, t);
  const deps = (waits.length === 0 ? "" : " waits for " + waits.join(", ")) + (frees.length === 0 ? "" : " frees " + frees.join(", ")) + (all === null && t.after.length > 0 ? " after " + t.after.join(", ") : "");
  const opts = (t.choices.length === 0 ? "" : " options: " + t.choices.map((c, k) => c + (t.hints[k] ? " (" + t.hints[k] + ")" : "")).join(" | ")) + deps;
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
  if (shown.length === 0) {
    return all ? "No tasks." : "No open tasks.";
  }
  const waiting = Deps.blocked_ids(s.tasks);
  const line = (t: Task) => task_line(t, now, true, s.tasks);
  const free = shown.filter((t) => !waiting.has(t.id));
  const wait = shown.filter((t) => waiting.has(t.id));
  return [...free.map(line), ...(wait.length === 0 ? [] : ["Waiting for other tasks (hidden from the user until freed):", ...wait.map(line)])].join("\n");
}

// a turn's block: what the user changed since the last turn, then the
// open ones (the newest LINES), each a line; "" if neither. What it shows
// is kept, to be told once the call ends well (Tasks.told)
export function tasks_block(s: Store, now: number): string {
  const changed = tasks_untold(s);
  const open = tasks_sort(s.tasks).filter((t) => t.state === "open");
  s.shown = new Map(changed.map((t) => [t.id, t.rev]));
  if (changed.length === 0 && open.length === 0) {
    return "";
  }
  const waiting = Deps.blocked_ids(s.tasks);
  const did = (t: Task) => {
    if (t.freed && t.state === "open") {
      return "- " + t.id + " freed: every task it waited for (" + t.after.join(", ") + ") is closed; the user sees it now: " + JSON.stringify(t.title);
    }
    const what = t.state === "open" ? "reopened" : t.state;
    const answer = t.answer === null ? "" : " — answer: " + t.answer;
    const note = t.note === null ? "" : " — note: " + JSON.stringify(t.note);
    return "- " + t.id + " " + what + " by user: " + JSON.stringify(t.title) + answer + note;
  };
  const newest = tasks_sort([...open].sort((a, b) => b.made.localeCompare(a.made)).slice(0, LINES));
  const free = newest.filter((t) => !waiting.has(t.id));
  const wait = newest.filter((t) => waiting.has(t.id));
  const line = (t: Task) => task_line(t, now, false, s.tasks);
  const lines = [
    "Tasks (your pending list; the user sees it beside the chat and resolves items there):",
    ...(changed.length === 0 ? [] : ["Changed since your last turn (by the user, or freed):", ...changed.map(did)]),
    ...(open.length === 0 ? ["Open: none."] : ["Open (" + (open.length - waiting.size) + "; those that free others first, then the user's):", ...free.map(line)]),
    ...(wait.length === 0 ? [] : ["Waiting for other tasks (" + waiting.size + "; hidden from the user until freed):", ...wait.map(line)]),
    ...(open.length > LINES ? ["+" + (open.length - LINES) + " older (the tasks tool lists them)"] : []),
  ];
  return lines.join("\n") + "\n\n";
}
