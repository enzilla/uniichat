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
// keep the stamp and whether it was told, unless it changes the state of
// one already told; the user's change untold is kept as made (heard), so
// Unii changing the state meanwhile can't hide it. Ids go to 15 digits
// (MAXID), past which none is made.
// A task may wait for others (after: their ids, TaskDeps.ts): blocked
// while any is open, it's out of the user's list (a count of those
// waiting shows instead) and can't be resolved; the open ones that free
// others come first, by how many. Freed (its last open one closed), it's
// a change Unii is told of, as a user's is (freed, a version stamped);
// waiting again (one reopened) before it was told, that change is moot.
// An after list is checked as given (ids that exist, not itself, no
// cycle) and as read from tasks.json (what's wrong left out, said in the
// log), so a hand edit can't make a list that loops.
// A task may ask several things at once (fields: a choice, many, a text,
// yes or no, each required or not). The user answers each apart, kept
// as a draft (no turn, no change told) till they conclude: then every
// answer goes at once (answers), the required ones first all given.
// The user may also talk about a task without resolving it: a message
// in its thread is a message of the chat (one memory: marked with the
// task, Tasks.task_mark), that starts a turn with the task in focus;
// the task then waits for Unii ("aguardando o Unii") till it replies in
// the thread (task_reply) or the turn ends (its last reply goes there,
// tasks_talked): then it's the user's turn ("sua vez").

import * as fs from "node:fs";
import { Disk } from "./Disk.ts";
import * as Deps from "./TaskDeps.ts";

// Types
// =====

export type State = "open" | "done" | "dropped";
export type Who   = "user" | "unii";

// who is responsible for a task: one of ASSIGNEES ("user", "unii"; a
// string, so others may come); where it came from: one of ORIGINS
// ("chat": the user's message; "timer": a schedule's turn; "agent:<name>":
// a subagent's report; "slack", "github" for later), with a link to its
// source if any
export type Assignee = string;
export type Origin   = string;

// a pending item (rev: the list's version at the last change by the
// user, Store.rev): id ("P7"), title, detail (Markdown), state, who must
// act (assignee; tasks.json and the tools' `who` of older versions read
// as it), where it came from (origin, null: not known) and its source's
// link, who made it ("main", "user"), the answers offered, the one chosen,
// the comment it was closed with, a free link (a project, an agent, a
// PR), when made, last changed and closed (ISO), whether Unii saw its
// last change by the user; the ids it waits for (TaskDeps.ts), and
// whether that last change untold is its being freed; the user's
// change untold as made (Heard); its fields, the user's answers to them
// so far (draft) and as concluded (answers); its thread, and whose turn
// it is in it (unii: the user wrote, Unii hasn't replied; user: Unii
// replied; null: neither)
export type Task = {
  id      : string;
  title   : string;
  detail  : string;
  state   : State;
  assignee   : Assignee;
  origin     : Origin | null;
  origin_url : string | null;
  by      : string;
  choices : string[];
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
  heard   : Heard | null;
  fields  : Field[];
  draft   : Values;
  answers : Values | null;
  thread  : Talk[];
  talk    : Who | null;
};

// the user's last change as they made it, kept till Unii is told of it:
// Unii changing the state meanwhile (task_edit) doesn't hide it
export type Heard = { state: State; answer: string | null; note: string | null; answers?: Values | null };

// a question of a task: its id (letters, digits, - and _), its label,
// its kind (one choice, many, a text, yes or no), its choices (yes or
// no: sim, não), whether it must be answered to conclude
export type Kind  = "choice" | "multi" | "text" | "yesno";
export type Field = { id: string; label: string; kind: Kind; choices: string[]; required: boolean };

// answers by field id: a choice or a text, or the choices picked
export type Value  = string | string[];
export type Values = Record<string, Value>;

// a message of a task's thread: whose, its text, when
export type Talk = { who: Who; text: string; at: string };

// the list of a chat's dir: the next id's number, the last version
// stamped (only up), the tasks; shown: the changes the last block
// showed, by id, at each one's rev
export type Store = { dir: string; next: number; rev: number; tasks: Task[]; shown: Map<string, number> };

// a change asked: by Unii (task_add, task_edit) or the user (an act)
export type Edit = {
  title?   : unknown;
  detail?  : unknown;
  who?     : unknown;
  assignee?   : unknown;
  origin?     : unknown;
  origin_url? : unknown;
  choices? : unknown;
  ref?     : unknown;
  state?   : unknown;
  answer?  : unknown;
  note?    : unknown;
  after?   : unknown;
  fields?  : unknown;
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

// those a task may be assigned to; its origins, an agent's by name; the
// longest origin and source link
export const ASSIGNEES = ["user", "unii"];
const ORIGIN = /^(chat|timer|slack|github|agent:[A-Za-z0-9][A-Za-z0-9_.-]{0,63})$/;
export const ORIGIN_URL = 500;

// the most fields of a task, a label's length, a text answer's (NOTE);
// a thread message's length, the most a thread keeps, the most views get
export const FIELDS  = 12;
export const LABEL   = 200;
export const TALK    = 4000;
export const THREAD  = 40;
export const VIEW_TALK = 12;

// a field's id; its kinds, by the names they're given in (Portuguese too)
const FIELD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/;
const KINDS: Record<string, Kind> = {
  choice: "choice", one: "choice", escolha: "choice", radio: "choice",
  multi: "multi", many: "multi", multiple: "multi", "múltipla": "multi", multipla: "multi", checkbox: "multi",
  text: "text", texto: "text",
  yesno: "yesno", "yes/no": "yesno", bool: "yesno", boolean: "yesno", simnao: "yesno", "sim/não": "yesno", "simnão": "yesno",
};
export const YESNO = ["sim", "não"];

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

// an id as tasks.json holds it, "P<n>", n up to MAXID (15 digits: a
// safe integer, so an id made is always one read back)
const ID         = /^P([1-9]\d{0,14})$/;
export const MAXID = 999999999999999;

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
  const m = ID.exec(typeof o.id === "string" ? o.id.trim() : "");
  if (m === null) {
    return null;
  }
  const state = STATES.includes(o.state as State) ? (o.state as State) : "open";
  const choices = Array.isArray(o.choices) ? [...new Set(o.choices.filter((c) => typeof c === "string").map((c) => text_line(c, CHOICE)).filter((c) => c !== ""))].slice(0, CHOICES) : [];
  const answer = typeof o.answer === "string" ? text_line(o.answer, CHOICE) : "";
  const text = (y: unknown, n: number, f: (y: unknown, n: number) => string) => (typeof y === "string" ? f(y, n) : "");
  const note = text(o.note, NOTE, text_body);
  const ref = text(o.ref, REF, text_line);
  const fields = fields_read(o.fields).fields;
  const at = new Date(now).toISOString();
  const made = time_read(o.made, at);
  const changed = time_read(o.changed, made);
  return {
    id      : "P" + Number(m[1]),
    title   : text(o.title, TITLE, text_line) || "(sem título)",
    detail  : text(o.detail, DETAIL, text_body),
    state,
    assignee   : assignee_read(o.assignee) ?? assignee_read(o.who) ?? "user",
    origin     : origin_read(o.origin),
    origin_url : origin_read(o.origin) === null ? null : url_read(o.origin_url),
    by      : text(o.by, 40, text_line) || "main",
    choices,
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
    heard   : o.told === false ? heard_read(o.heard, fields) : null,
    fields,
    draft   : values_clean(fields, o.draft),
    answers : state === "done" && fields.length > 0 && typeof o.answers === "object" && o.answers !== null ? values_clean(fields, o.answers) : null,
    thread  : thread_read(o.thread),
    talk    : state === "open" && (o.talk === "unii" || o.talk === "user") ? o.talk : null,
  };
}

// an assignee as given (one of ASSIGNEES, any case, spaces around);
// else null
export function assignee_read(x: unknown): Assignee | null {
  const a = typeof x === "string" ? x.trim().toLowerCase() : "";
  return ASSIGNEES.includes(a) ? a : null;
}

// an origin as given ("chat", "timer", "agent:Name", ...); else null
export function origin_read(x: unknown): Origin | null {
  const o = typeof x === "string" ? x.trim() : "";
  const kind = o.split(":")[0].toLowerCase();
  const as = kind === "agent" ? "agent:" + o.slice(6) : kind;
  return ORIGIN.test(as) ? as : null;
}

// a source's link as given: http(s), no spaces, quotes, angle brackets
// or control characters, at most ORIGIN_URL; else null
export function url_read(x: unknown): string | null {
  const u = typeof x === "string" ? x.trim() : "";
  if (u.length > ORIGIN_URL || !/^https?:\/\/[^\s"'<>`\\\x00-\x1f\x7f-\x9f\u2028\u2029]+$/i.test(u)) {
    return null;
  }
  try {
    return new URL(u).protocol.startsWith("http") ? u : null;
  } catch {
    return null;
  }
}

// where a turn came from, by its messages' origins (a message of the
// user's has none): the user's among them, chat; else the first's
export function turn_origin(origins: (string | undefined)[]): Origin {
  return origins.length === 0 || origins.some((o) => o === undefined) ? "chat" : origin_read(origins[0]) ?? "chat";
}

// a task's assignee, origin and link as given by a tool (assignee, or the
// older who; origin_url only with an origin, its own or the task's); each
// absent undefined; else why not
function whose_args(args: Edit, origin: Origin | null): { assignee?: Assignee; origin?: Origin; origin_url?: string | null } | string {
  const out: { assignee?: Assignee; origin?: Origin; origin_url?: string | null } = {};
  const given = (x: unknown) => x !== undefined && x !== null;
  if (given(args.assignee) || given(args.who)) {
    const a = given(args.assignee) ? assignee_read(args.assignee) : null;
    const w = given(args.who) ? assignee_read(args.who) : null;
    if ((given(args.assignee) && a === null) || (given(args.who) && w === null)) {
      return "assignee is one of: " + ASSIGNEES.join(", ") + ".";
    }
    if (a !== null && w !== null && a !== w) {
      return "assignee and who differ: give assignee only (who is its older name).";
    }
    out.assignee = (a ?? w)!;
  }
  if (given(args.origin)) {
    const o = origin_read(args.origin);
    if (o === null) {
      return "origin is chat, timer, slack, github or agent:<name> (letters, digits, . _ -).";
    }
    out.origin = o;
  }
  if (args.origin_url !== undefined) {
    const raw = args.origin_url === null ? "" : String(args.origin_url).trim();
    const u = raw === "" ? null : url_read(raw);
    if (raw !== "" && u === null) {
      return "origin_url is an http(s) link of at most " + ORIGIN_URL + " characters, without spaces, quotes or angle brackets.";
    }
    if (u !== null && (out.origin ?? origin) === null) {
      return "origin_url needs an origin.";
    }
    out.origin_url = u;
  }
  return out;
}

// a thread as read: its messages that are one (whose, a text), cleaned,
// the newest THREAD
function thread_read(x: unknown): Talk[] {
  if (!Array.isArray(x)) {
    return [];
  }
  const all: Talk[] = [];
  for (const y of x) {
    if (typeof y !== "object" || y === null || Array.isArray(y)) {
      continue;
    }
    const o = y as Record<string, unknown>;
    const text = typeof o.text === "string" ? text_body(o.text, TALK) : "";
    if ((o.who === "user" || o.who === "unii") && text !== "") {
      all.push({ who: o.who, text, at: time_read(o.at, new Date(0).toISOString()) });
    }
  }
  return all.slice(-THREAD);
}
// a Heard as read; null: none, or not one
function heard_read(x: unknown, fields: Field[]): Heard | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return null;
  }
  const o = x as Record<string, unknown>;
  if (!STATES.includes(o.state as State)) {
    return null;
  }
  const answer = typeof o.answer === "string" ? text_line(o.answer, CHOICE) : "";
  const note = typeof o.note === "string" ? text_body(o.note, NOTE) : "";
  const answers = typeof o.answers === "object" && o.answers !== null ? values_clean(fields, o.answers) : null;
  return { state: o.state as State, answer: answer === "" ? null : answer, note: note === "" ? null : note, ...(answers === null ? {} : { answers }) };
}

// an after list as tasks.json holds it: its ids "P<n>" (or n, as the
// tools take them; none twice, not the task's own), at most AFTER;
// anything else left out
function after_raw(x: unknown, self: string): string[] {
  if (!Array.isArray(x)) {
    return [];
  }
  const ids = x.map((y) => (typeof y === "number" && Number.isSafeInteger(y) ? "P" + y : y)).filter((y) => typeof y === "string" && ID.test(y.trim())).map((y) => (y as string).trim());
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

// a task read as freed (its being freed untold) that still waits (a hand
// edit) is no change to tell: it stays hidden, so its next turn would
// say "the user sees it now" falsely; how many were so
function freed_sound(tasks: Task[]): number {
  const blocked = Deps.blocked_ids(tasks);
  const wrong = tasks.filter((t) => t.freed && blocked.has(t.id));
  wrong.forEach((t) => {
    t.freed = false;
    t.told = true;
  });
  return wrong.length;
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
      let bad = 0;
      for (const x of got.tasks) {
        const t = task_read(x, now);
        if (t === null || tasks.some((u) => u.id === t.id)) {
          left += 1;
        } else {
          tasks.push(t);
          raw.set(t.id, (x as Record<string, unknown>).after ?? []);
          const f = (x as Record<string, unknown>).fields;
          bad += f === undefined || (Array.isArray(f) && f.length === t.fields.length) ? 0 : 1;
        }
      }
      const fixed = after_sound(tasks, raw) + freed_sound(tasks) + bad;
      if (fixed > 0) {
        console.error("unii: " + file + ": " + fixed + " task(s) with an after list wrong (not a list of ids, an id of no task, the task itself, a cycle: those ids left out), freed while still waiting (made unfreed), or with fields wrong (those left out)");
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
// (each with who too, its assignee as an older version reads it: going
// back a version keeps whose each is)
export function tasks_save(s: Store): void {
  const file = s.dir + FILE;
  fs.mkdirSync(s.dir, { recursive: true });
  fs.writeFileSync(file + ".new", JSON.stringify({ next: s.next, rev: s.rev, tasks: s.tasks.map((t) => ({ ...t, who: t.assignee === "unii" ? "unii" : "user" })) }));
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

// Fields
// ------

// a fields list as given: each {id, label, kind, choices?, required?}
// (required by default; yesno's choices: sim, não; choice and multi: at
// least 2), at most FIELDS, no id twice (in any case). fields: those
// that are sound; why: the first that isn't (null: all are). A hand
// edit's file keeps the sound ones; a tool refuses the list
export function fields_read(x: unknown): { fields: Field[]; why: string | null } {
  if (x === undefined || x === null) {
    return { fields: [], why: null };
  }
  if (!Array.isArray(x)) {
    return { fields: [], why: "fields is a list of {id, label, kind, choices?, required?}." };
  }
  const fields: Field[] = [];
  let why: string | null = null;
  const no = (said: string) => (why = why ?? said);
  x.forEach((y, k) => {
    if (typeof y !== "object" || y === null || Array.isArray(y)) {
      return no("fields[" + k + "] is not an object.");
    }
    const o = y as Record<string, unknown>;
    const id = typeof o.id === "string" || typeof o.id === "number" ? String(o.id).trim() : "";
    if (!FIELD_ID.test(id)) {
      return no("fields[" + k + "]: id is 1 to 24 letters, digits, - or _, starting with a letter or digit.");
    }
    if (fields.some((f) => f.id.toLowerCase() === id.toLowerCase())) {
      return no("Field id " + id + " given twice.");
    }
    const kind = Object.hasOwn(KINDS, String(o.kind ?? "").trim().toLowerCase()) ? KINDS[String(o.kind).trim().toLowerCase()] : undefined;
    if (kind === undefined) {
      return no("Field " + id + ": kind is one of choice, multi, text, yesno.");
    }
    const label = text_line(o.label, LABEL);
    if (label === "") {
      return no("Field " + id + " needs a label.");
    }
    if (o.required !== undefined && typeof o.required !== "boolean") {
      return no("Field " + id + ": required is true or false.");
    }
    let choices: string[] = kind === "yesno" ? [...YESNO] : [];
    if (kind === "choice" || kind === "multi") {
      const got = choices_read(o.choices);
      if (typeof got === "string") {
        return no("Field " + id + ": " + got);
      }
      if (got.length < 2) {
        return no("Field " + id + " (" + kind + ") needs at least 2 choices.");
      }
      choices = got;
    }
    fields.push({ id, label, kind, choices, required: o.required !== false });
  });
  if (fields.length > FIELDS) {
    no("At most " + FIELDS + " fields.");
  }
  return { fields: fields.slice(0, FIELDS), why };
}

// whether a field's answer is given
export function value_given(v: Value | undefined): boolean {
  return v !== undefined && v.length > 0;
}

// an answer given to a field: its value ({ v: null }: none, cleared),
// else why not (the user's words: views show it)
export function value_read(f: Field, x: unknown): { v: Value | null } | string {
  if (x === undefined || x === null || x === "" || (Array.isArray(x) && x.length === 0)) {
    return { v: null };
  }
  const name = "“" + f.label + "”";
  if (f.kind === "text") {
    if (typeof x !== "string") {
      return "O campo " + name + " espera um texto.";
    }
    const text = text_body(x, NOTE);
    return { v: text === "" ? null : text };
  }
  const all = Array.isArray(x) ? x : [x];
  if (all.some((y) => typeof y !== "string") || (f.kind !== "multi" && all.length > 1)) {
    return f.kind === "multi" ? "O campo " + name + " espera uma lista de opções." : "O campo " + name + " espera uma opção.";
  }
  const got = all.map((y) => text_line(y, CHOICE));
  const bad = got.find((y) => !f.choices.includes(y));
  if (bad !== undefined) {
    return "O campo " + name + " não tem a opção “" + bad + "”. Opções: " + f.choices.join(", ") + ".";
  }
  return { v: f.kind === "multi" ? f.choices.filter((c) => got.includes(c)) : got[0] };
}

// a values object as read (tasks.json): those of fields of the list,
// sound, kept; the rest left out
export function values_clean(fields: Field[], x: unknown): Values {
  const out: Values = {};
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return out;
  }
  for (const f of fields) {
    const got = Object.hasOwn(x, f.id) ? value_read(f, (x as Record<string, unknown>)[f.id]) : null;
    if (got !== null && typeof got !== "string" && got.v !== null) {
      out[f.id] = got.v;
    }
  }
  return out;
}

// a task's field by its id (as given, or in another case)
export function field_find(t: { fields: Field[] }, id: string): Field | null {
  return t.fields.find((f) => f.id === id) ?? t.fields.find((f) => f.id.toLowerCase() === id.toLowerCase()) ?? null;
}

// answers given (by field id) laid over a task's draft: the draft as it
// would be, else why not (the user's words)
export function values_merge(t: Task, x: unknown): Values | string {
  if (x === undefined || x === null) {
    return { ...t.draft };
  }
  if (typeof x !== "object" || Array.isArray(x)) {
    return "Respostas inválidas: informe um objeto com as respostas de cada campo.";
  }
  const out: Values = { ...t.draft };
  for (const [key, value] of Object.entries(x)) {
    const f = field_find(t, key);
    if (f === null) {
      return "A pendência " + t.id + " não tem o campo “" + text_line(key, 40) + "”.";
    }
    const got = value_read(f, value);
    if (typeof got === "string") {
      return got;
    }
    if (got.v === null) {
      delete out[f.id];
    } else {
      out[f.id] = got.v;
    }
  }
  return out;
}

// the required fields a draft leaves unanswered
export function fields_missing(t: Task, values: Values): Field[] {
  return t.fields.filter((f) => f.required && !value_given(Object.hasOwn(values, f.id) ? values[f.id] : undefined));
}

// answers as read: "Ambiente: hom; Prazo: “sexta”" ("" for none)
export function values_said(fields: Field[], values: Values | null | undefined): string {
  if (values === null || values === undefined) {
    return "";
  }
  return fields.filter((f) => Object.hasOwn(values, f.id)).map((f) => {
    const v = values[f.id];
    return f.label + ": " + (Array.isArray(v) ? v.join(", ") : f.kind === "text" ? "“" + v + "”" : v);
  }).join("; ");
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
// (origin: where the turn came from, unless args give one)
export function task_new(s: Store, args: Edit, by: string, now: number, origin: Origin | null = null): Task | string {
  const title = text_line(args.title, TITLE);
  const choices = choices_read(args.choices);
  if (title === "") {
    return "A task needs a title.";
  }
  if (typeof choices === "string") {
    return choices;
  }
  const whose = whose_args(args, origin_read(origin));
  if (typeof whose === "string") {
    return whose;
  }
  const after = after_read(s, args.after, null);
  if (typeof after === "string") {
    return after;
  }
  const fields = fields_read(args.fields);
  if (fields.why !== null) {
    return fields.why;
  }
  const open = s.tasks.filter((t) => t.state === "open");
  const twin = open.find((t) => t.title.toLowerCase() === title.toLowerCase());
  if (twin !== undefined) {
    return twin.id + " is open with this title already: edit it (task_edit) instead.";
  }
  if (open.length >= OPEN) {
    return "The list has " + OPEN + " open tasks, the most it keeps: close some first.";
  }
  if (s.next > MAXID) {
    return "The list has no ids left (the last is P" + MAXID + ").";
  }
  const at = new Date(now).toISOString();
  const ref = text_line(args.ref, REF);
  const task: Task = {
    id: "P" + s.next, title, detail: text_body(args.detail, DETAIL), state: "open", assignee: whose.assignee ?? "user", origin: whose.origin ?? origin_read(origin), origin_url: whose.origin_url ?? null, by, choices, answer: null, note: null,
    ref: ref === "" ? null : ref, made: at, changed: at, closed: null, told: true, rev: 0, after, freed: false, heard: null,
    fields: fields.fields, draft: {}, answers: null, thread: [], talk: null,
  };
  s.next += 1;
  s.tasks.push(task);
  tasks_save(s);
  return task;
}

// Inbox
// -----
// A task from outside (Server.ts /api/inbox: a script with the inbox
// token, as the Slack sorter or the stalled tasks' watch, vigia.ts),
// always the user's, from slack, github or timer (a script run by a
// systemd timer), keyed by its ref (one conversation, "slack:D0123"): an open one of
// that ref and origin gets the new text appended (its oldest lines
// dropped past DETAIL), the newest title and link; else a new one (by
// "inbox"). Nothing is told to Unii and no turn starts: the user
// decides, and their resolution reaches Unii as any other. Only the keys
// below are taken; any other, or a wrong value, is refused, said why

export const INBOX_ORIGINS = ["slack", "github", "timer"];
const INBOX_KEYS = ["title", "detail", "origin", "origin_url", "ref", "choices"];

// the marks that turn text's direction (U+202A-U+202E, U+2066-U+2069,
// U+200E, U+200F): from outside (anyone on Slack), so a title can't read
// backwards in the Mesa or the terminal
const BIDI = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/g;

export function bidi_strip(x: unknown): unknown {
  return typeof x === "string" ? x.replace(BIDI, "") : Array.isArray(x) ? x.map(bidi_strip) : x;
}

export function task_inbox(s: Store, x: unknown, now: number): { task: Task; made: boolean } | string {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return "task is an object {title, detail, origin, origin_url, ref, choices}.";
  }
  const o = Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, bidi_strip(v)]));
  const odd = Object.keys(o).filter((k) => !INBOX_KEYS.includes(k));
  if (odd.length > 0) {
    return "Unknown key(s): " + odd.slice(0, 5).map((k) => text_line(k, 40)).join(", ") + ".";
  }
  const bad = INBOX_KEYS.filter((k) => k !== "choices" && o[k] !== undefined && typeof o[k] !== "string");
  if (bad.length > 0) {
    return bad.join(", ") + " must be text.";
  }
  const origin = origin_read(o.origin);
  if (origin === null || !INBOX_ORIGINS.includes(origin)) {
    return "origin is one of: " + INBOX_ORIGINS.join(", ") + ".";
  }
  const ref = text_line(o.ref, REF);
  if (ref === "") {
    return "A task from outside needs a ref (its conversation).";
  }
  const title = text_line(o.title, TITLE);
  if (title === "") {
    return "A task needs a title.";
  }
  const url = o.origin_url === undefined || o.origin_url === "" ? null : url_read(o.origin_url);
  if (o.origin_url !== undefined && o.origin_url !== "" && (url === null || !/^https:/i.test(url))) {
    return "origin_url is an https link of at most " + ORIGIN_URL + " characters, without spaces, quotes or angle brackets.";
  }
  if (Array.isArray(o.choices) && o.choices.some((c) => typeof c !== "string")) {
    return "choices is a list of strings.";
  }
  const choices = choices_read(o.choices);
  if (typeof choices === "string") {
    return choices;
  }
  const detail = text_body(o.detail, DETAIL);
  const had = s.tasks.find((t) => t.state === "open" && t.assignee === "user" && t.origin === origin && t.ref === ref);
  if (had === undefined) {
    const t = task_new(s, { title, detail, choices, ref, origin, origin_url: url, assignee: "user" }, "inbox", now);
    return typeof t === "string" ? t : { task: t, made: true };
  }
  const twin = s.tasks.find((t) => t !== had && t.state === "open" && t.title.toLowerCase() === title.toLowerCase());
  if (twin !== undefined) {
    return twin.id + " is open with this title already.";
  }
  had.title = title;
  had.detail = detail_join(had.detail, detail, DETAIL);
  had.origin_url = url ?? had.origin_url;
  if (choices.length > 0) {
    had.choices = choices;
  }
  had.changed = new Date(now).toISOString();
  tasks_save(s);
  return { task: had, made: false };
}

// two texts, one after the other; past n, the first's oldest lines go
// (an ellipsis line where they were), the newest kept whole if it can be
export function detail_join(a: string, b: string, n: number): string {
  const all = a === "" ? b : b === "" ? a : a + "\n" + b;
  if (all.length <= n) {
    return all;
  }
  const tail = all.slice(all.length - (n - 2));
  const cut = tail.indexOf("\n");
  return "…\n" + (cut >= 0 && cut < tail.length - 1 ? tail.slice(cut + 1) : tail);
}

// a task changed by Unii (task_edit): any field, its state too. A new
// state makes the task told (Unii did it), unless a change by the user
// is still untold: then, as any other edit, told and rev stay as they
// were, so that change (its Heard) is still told. Done can't be set while
// it waits for open tasks (dropped can: it no longer applies); else why
// not
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
  const whose = whose_args(args, task.origin);
  if (typeof whose === "string") {
    return whose;
  }
  Object.assign(next, whose);
  if (whose.origin !== undefined && whose.origin !== task.origin && whose.origin_url === undefined) {
    next.origin_url = null;
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
  if (args.after !== undefined) {
    const after = after_read(s, args.after, task.id);
    if (typeof after === "string") {
      return after;
    }
    next.after = after;
  }
  if (args.fields !== undefined) {
    const fields = fields_read(args.fields);
    if (fields.why !== null) {
      return fields.why;
    }
    next.fields = fields.fields;
    next.draft = values_clean(next.fields, task.draft);
    next.answers = task.answers === null ? null : values_clean(next.fields, task.answers);
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
  const waits = Deps.waits(s.tasks, next);
  if (next.state === "done" && task.state === "open" && waits.length > 0) {
    return task.id + " waits for " + waits.join(", ") + ", still open: it can't be done before them. Close those first, change its after, or drop it if it no longer applies.";
  }
  if (next.state !== "open") {
    next.talk = null;
  }
  const untold = !task.told && !task.freed;
  return task_put(s, task, next, now, next.state !== task.state && !untold ? true : null);
}

// a task resolved by the user: done (answer: one of its choices), dropped
// or opened again, with a comment; null: so already (an act done again
// changes nothing), else the task, else why not
export function task_resolve(s: Store, id: unknown, state: unknown, answer: unknown, note: unknown, now: number, values?: unknown): Task | string | null {
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
    return task_put(s, task, { ...task, state: "open", answer: null, note: comment, answers: null }, now, false);
  }
  const draft = to === "done" ? values_merge(task, values) : task.draft;
  if (typeof draft === "string") {
    return draft + " Nada foi alterado.";
  }
  const missing = to === "done" && task.state === "open" ? fields_missing(task, draft) : [];
  if (missing.length > 0) {
    return "Responda " + (missing.length === 1 ? "o campo obrigatório" : "os campos obrigatórios") + " da pendência " + task.id + " antes de concluir: " + missing.map((f) => "“" + f.label + "”").join(", ") + ". Nada foi alterado.";
  }
  const answers = to === "done" && task.fields.length > 0 ? values_clean(task.fields, draft) : null;
  if (task.state === to && task.answer === said && (comment === null || comment === task.note) && JSON.stringify(task.answers) === JSON.stringify(answers ?? task.answers)) {
    return null;
  }
  return task_put(s, task, { ...task, state: to, answer: to === "done" ? said : null, note: comment ?? task.note, draft, answers: to === "done" ? (answers ?? task.answers) : null, talk: null }, now, false);
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
  next.heard = told === null ? task.heard : told ? null : { state: next.state, answer: next.answer, note: next.note, answers: next.answers };
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

// the user's answers to an open task's fields (by id), kept as a draft:
// no turn, no change told; else why not (the user's words)
export function task_draft(s: Store, id: unknown, values: unknown): Task | string {
  const task = task_find(s, id);
  if (task === null) {
    return "Pendência " + task_id(id) + " não encontrada.";
  }
  if (task.state !== "open") {
    return "A pendência " + task.id + " já foi resolvida: reabra-a para mudar as respostas.";
  }
  if (task.fields.length === 0) {
    return "A pendência " + task.id + " não tem campos.";
  }
  const draft = values_merge(task, values);
  if (typeof draft === "string") {
    return draft;
  }
  const next = { ...task, draft };
  s.tasks[s.tasks.indexOf(task)] = next;
  tasks_save(s);
  return next;
}

// a message of the chat about a task (its thread's): marked with it, so
// Unii, and the chat's memory, know what it's about
export function task_mark(t: Task, text: string): string {
  return "[Pendência " + t.id + ": “" + t.title + "”]\n\n" + text;
}

// a message in a thread: kept, the newest THREAD; whose turn it is next
function task_talk(s: Store, task: Task, who: Who, text: string, now: number): Task {
  const thread = [...task.thread, { who, text, at: new Date(now).toISOString() }].slice(-THREAD);
  const next: Task = { ...task, thread, talk: task.state !== "open" ? null : who === "user" ? "unii" : "user" };
  s.tasks[s.tasks.indexOf(task)] = next;
  tasks_save(s);
  return next;
}

// the user writes in an open task's thread (not a resolution: a talk);
// it now waits for Unii; else why not (the user's words)
export function task_say(s: Store, id: unknown, text: unknown, now: number): Task | string {
  const task = task_find(s, id);
  if (task === null) {
    return "Pendência " + task_id(id) + " não encontrada.";
  }
  if (task.state !== "open") {
    return "A pendência " + task.id + " já foi resolvida: reabra-a para conversar sobre ela.";
  }
  const said = text_body(text, TALK + 1);
  if (said === "") {
    return "Escreva uma mensagem.";
  }
  if (said.length > TALK) {
    return "Mensagem longa demais: no máximo " + TALK + " caracteres.";
  }
  return task_talk(s, task, "user", said, now);
}

// Unii replies in a task's thread (task_reply): the user's turn, if open
export function task_reply(s: Store, id: unknown, text: unknown, now: number): Task | string {
  const task = task_find(s, id);
  if (task === null) {
    return "No task " + task_id(id) + ".";
  }
  const said = text_body(text, TALK);
  if (said === "") {
    return "A reply needs a text.";
  }
  return task_talk(s, task, "unii", said, now);
}

// a turn ended: each task still waiting for Unii gets its last reply
// (reply; null: none, said so; failed: the turn's error, said with it,
// so the thread doesn't send the user to look for a reply that isn't
// there) in its thread, and it's the user's turn
export function tasks_talked(s: Store, reply: string | null, now: number, failed: string | null = null): Task[] {
  const none = failed === null || failed.trim() === "" ? "O Unii não respondeu aqui; veja a conversa principal." : "O Unii não conseguiu responder (" + failed.trim() + "). Escreva de novo aqui para tentar outra vez.";
  const text = reply === null || text_body(reply, TALK) === "" ? text_body(none, TALK) : text_body(reply, TALK);
  return s.tasks.filter((t) => t.talk === "unii").map((t) => task_talk(s, t, "unii", text, now));
}

// the user's changes Unii hasn't seen, oldest first
export function tasks_untold(s: Store): Task[] {
  return s.tasks.filter((t) => !t.told).sort((a, b) => a.rev - b.rev || a.changed.localeCompare(b.changed));
}

// those changes seen: told, saved (a change since, at another rev, stays
// to tell); shown: rev by id, those the last block showed by default
export function tasks_told(s: Store, shown: Map<string, number> = s.shown): number {
  const told = s.tasks.filter((t) => !t.told && shown.get(t.id) === t.rev);
  told.forEach((t) => {
    t.told = true;
    t.heard = null;
  });
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
  const rank = (a: Task, b: Task) => (frees.get(b.id)! - frees.get(a.id)!) || (a.assignee === b.assignee ? num(a) - num(b) : a.assignee === "user" ? -1 : b.assignee === "user" ? 1 : a.assignee.localeCompare(b.assignee));
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
  return [...open, ...closed].map((t) => (t.thread.length > VIEW_TALK ? { ...t, thread: t.thread.slice(-VIEW_TALK) } : t));
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
  const answers = t.state === "done" ? values_said(t.fields, t.answers) : "";
  const note = t.note === null ? "" : " Comentário: “" + t.note + "”.";
  return "Pendência " + t.id + " " + SAID[t.state] + " pelo usuário: “" + t.title + "”." + answer + (answers === "" ? "" : " Respostas: " + answers + ".") + note;
}

// a task as a line of the tasks tool or the block (all: the list it's
// of, for whom it waits and frees; none given, those not said)
export function task_line(t: Task, now: number, whole = false, all: Task[] | null = null): string {
  const waits = all === null ? [] : Deps.waits(all, t);
  const frees = all === null ? [] : Deps.frees_direct(all, t);
  const deps = (waits.length === 0 ? "" : " waits for " + waits.join(", ")) + (frees.length === 0 ? "" : " frees " + frees.join(", ")) + (all === null && t.after.length > 0 ? " after " + t.after.join(", ") : "");
  const kind = (f: Field) => f.kind + (f.kind === "choice" || f.kind === "multi" ? ": " + f.choices.join(" | ") : "");
  const fields = t.fields.length === 0 ? "" : " fields: " + t.fields.map((f) => f.id + (f.required ? "*" : "") + " " + JSON.stringify(f.label) + " (" + kind(f) + ")").join("; ");
  const talk = t.talk === "unii" ? " [the user wrote in its thread: reply with task_reply]" : "";
  const opts = (t.choices.length === 0 ? "" : " options: " + t.choices.join(" | ")) + fields + deps + talk;
  const tail = [t.ref === null ? "" : "ref " + t.ref, t.origin === null ? "" : "from " + t.origin + (t.origin_url === null ? "" : " " + t.origin_url), ago(t.made, now)].filter((x) => x !== "").join(", ");
  const how   = [t.state, t.answer === null ? "" : "answer: " + t.answer, t.note === null ? "" : "note: " + JSON.stringify(t.note)].filter((x) => x !== "");
  const state = t.state === "open" ? "" : " (" + how.join(", ") + ")";
  const head = "- " + t.id + " [" + t.assignee + "] " + t.title + state + opts + " (" + tail + ")";
  if (!whole) {
    return head;
  }
  const answers = values_said(t.fields, t.state === "done" ? t.answers : t.draft);
  const more = [
    t.detail,
    answers === "" ? "" : (t.state === "done" ? "answers: " : "draft (not sent yet): ") + answers,
    t.thread.length === 0 ? "" : "thread (" + (t.talk === "unii" ? "waiting for your reply" : t.talk === "user" ? "the user's turn" : "quiet") + "):\n" + t.thread.slice(-VIEW_TALK).map((m) => (m.who === "user" ? "user: " : "you: ") + m.text).join("\n"),
  ].filter((x) => x !== "");
  return more.length === 0 ? head : head + "\n  " + more.join("\n").replace(/\n/g, "\n  ");
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
    const h = t.heard ?? { state: t.state, answer: t.answer, note: t.note };
    const what = h.state === "open" ? "reopened" : h.state;
    const answer = h.answer === null ? "" : " — answer: " + h.answer;
    const note = h.note === null ? "" : " — note: " + JSON.stringify(h.note);
    const said = h.state === "done" ? values_said(t.fields, h.answers === undefined ? t.answers : h.answers) : "";
    const answers = said === "" ? "" : " — fields: " + said;
    const since = h.state === t.state ? "" : " — since then you made it " + t.state;
    return "- " + t.id + " " + what + " by user: " + JSON.stringify(t.title) + answer + answers + note + since;
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
