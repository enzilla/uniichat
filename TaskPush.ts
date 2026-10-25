// TaskPush
// ========
// The pending list's pushes (Push.ts sends them): a task that becomes the
// user's to act on (open, assignee "user", not waiting for others nor for
// Unii's reply), made or freed, is told to the owner's phones and
// browsers; those that come within WINDOW go as one ("Pendências P3 e P4
// precisam de você"). A push shows only the ids, never a title: its text
// passes through the browser vendor's push service.
// Once a day, at REMIND (the server's local hour), the ones still the
// user's past LATE since told are told again as late ("Pendência P3 está
// em atraso"), each once ever: one reminded isn't again, even reopened.
// Each push carries the user's count (open tasks whose move it is, as
// the Mesa's "Agora" counts them) for the app's badge (sw.js).
// What was told is kept in the chat's dir (push.json, written whole,
// mode 600), and only once its pushes went (or failed TRIES times, WAITS
// apart): one cut off before is pushed again at the next look. The first
// look, with no file, takes the tasks open then as told, since they were
// made (so their LATE counts from then, not from the server's start), and
// today's reminder as looked for, so turning this on pushes nothing of
// the list, neither then nor at today's REMIND. A task that stops
// being the user's (resolved, waiting again) is forgotten, so being so
// again (reopened, freed again) is told again.

import * as fs from "node:fs";
import * as Deps from "./TaskDeps.ts";
import type { Task } from "./Tasks.ts";
import { write_whole } from "./Write.ts";

// Types
// =====

// what was told: each task the user's now and since when (ISO; its push,
// or the first look); the ones made or freed and not pushed yet, and since
// when the first waits (ms; null: none); the ones reminded as late; the
// local day (YYYY-MM-DD) the last reminder was looked for
export type State = { seen: Record<string, string>; queue: string[]; since: number | null; reminded: string[]; day: string | null };

// a push to send: new (made or freed) or late, its tasks, its text, and
// the user's count
export type Notice = { kind: "new" | "late"; ids: string[]; text: string; count: number };

// Constants
// =========

export const FILE = "/push.json";

// how long tasks made or freed wait to go together (ms)
export const WINDOW = 45 * 1000;

// how long a task stays the user's before it's late (ms): TaskDeps.LATE,
// shared with the views
export const LATE = Deps.LATE;

// the local hour the daily reminder goes, at or after
export const REMIND = 9;

// how many times a push is tried, and the waits between (ms, growing)
export const TRIES = 3;
export const WAITS = [5000, 20000];

// how many ids a push names (the rest counted)
const NAMES = 4;

// a task's id as tasks.json holds it
const ID = /^P\d{1,15}$/;

// Functions
// =========

// the tasks whose move is the user's to be pushed: open, theirs, not
// waiting for others, nor for Unii's reply in its thread
export function actionable(tasks: Task[]): string[] {
  const blocked = Deps.blocked_ids(tasks);
  return tasks.filter((t) => t.state === "open" && t.assignee === "user" && t.talk !== "unii" && !blocked.has(t.id)).map((t) => t.id);
}

// the user's count, as the Mesa's "Agora" (View.desk_group "now"): open,
// not waiting for Unii nor for others, theirs or their turn in its thread
export function turn_count(tasks: Task[]): number {
  const blocked = Deps.blocked_ids(tasks);
  return tasks.filter((t) => t.state === "open" && t.talk !== "unii" && !blocked.has(t.id) && (t.assignee === "user" || t.talk === "user")).length;
}

// "P3"; "P3 e P4"; "P3, P4 e P5"; past NAMES, "P1, P2, P3, P4 e mais 2"
export function ids_said(ids: string[]): string {
  if (ids.length > NAMES) {
    return ids.slice(0, NAMES).join(", ") + " e mais " + (ids.length - NAMES);
  }
  return ids.length === 1 ? ids[0] : ids.slice(0, -1).join(", ") + " e " + ids[ids.length - 1];
}

// a push's text: only the ids
export function text(kind: Notice["kind"], ids: string[]): string {
  const one = ids.length === 1;
  if (kind === "late") {
    return (one ? "Pendência " : "Pendências ") + ids_said(ids) + (one ? " está em atraso" : " estão em atraso");
  }
  return (one ? "Pendência " : "Pendências ") + ids_said(ids) + (one ? " precisa de você" : " precisam de você");
}

// a local day as YYYY-MM-DD
export function day(now: number): string {
  const d = new Date(now);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// the ids by their number
function sorted(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

// since when a task open at the first look is the user's: when it was
// made, if that's a time and not past now; else now
function made_at(task: Task | undefined, now: number): string {
  const made = Date.parse(task?.made ?? "");
  return new Date(Number.isNaN(made) || made > now ? now : made).toISOString();
}

// a look at the list (state: null, the first): what's told now, and the
// pushes to send (sending them is the caller's)
export function step(state: State | null, tasks: Task[], now: number): { state: State; send: Notice[] } {
  const ids = actionable(tasks);
  const mine = new Set(ids);
  const at = new Date(now).toISOString();
  const send: Notice[] = [];
  const count = turn_count(tasks);
  if (state === null) {
    const by = new Map(tasks.map((t) => [t.id, t]));
    return { state: { seen: Object.fromEntries(ids.map((id) => [id, made_at(by.get(id), now)])), queue: [], since: null, reminded: [], day: day(now) }, send };
  }
  const seen: Record<string, string> = {};
  for (const id of ids) {
    seen[id] = state.seen[id] ?? at;
  }
  let queue = state.queue.filter((id) => mine.has(id));
  const fresh = ids.filter((id) => state.seen[id] === undefined && !queue.includes(id));
  let since = queue.length === 0 ? null : state.since ?? now;
  if (fresh.length > 0) {
    queue = [...queue, ...fresh];
    since = since ?? now;
  }
  if (queue.length > 0 && since !== null && now - since >= WINDOW) {
    const told = sorted(queue);
    send.push({ kind: "new", ids: told, text: text("new", told), count });
    for (const id of told) {
      seen[id] = at;
    }
    queue = [];
    since = null;
  }
  const exist = new Set(tasks.map((t) => t.id));
  let reminded = state.reminded.filter((id) => exist.has(id));
  let looked = state.day;
  const today = day(now);
  if (looked !== today && new Date(now).getHours() >= REMIND) {
    looked = today;
    const late = sorted(ids.filter((id) => !queue.includes(id) && !reminded.includes(id) && now - Date.parse(seen[id]) >= LATE));
    if (late.length > 0) {
      send.push({ kind: "late", ids: late, text: text("late", late), count });
      reminded = [...reminded, ...late];
    }
  }
  return { state: { seen, queue, since: queue.length === 0 ? null : since, reminded, day: looked }, send };
}

// what's told, as kept in a chat's dir (null: none yet, or not one: the
// next look starts again, as the first)
export function load(dir: string): State | null {
  try {
    const o = JSON.parse(fs.readFileSync(dir + FILE, "utf8"));
    const seen: Record<string, string> = {};
    for (const [id, at] of Object.entries(o?.seen ?? {})) {
      if (ID.test(id) && typeof at === "string" && !Number.isNaN(Date.parse(at))) {
        seen[id] = at;
      }
    }
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((id): id is string => typeof id === "string" && ID.test(id)) : []);
    const since = typeof o?.since === "number" && Number.isFinite(o.since) ? o.since : null;
    const day = typeof o?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? o.day : null;
    return { seen, queue: list(o?.queue), since, reminded: list(o?.reminded), day };
  } catch {
    return null;
  }
}

export function save(dir: string, state: State): void {
  fs.mkdirSync(dir, { recursive: true });
  write_whole(dir + FILE, JSON.stringify(state) + "\n");
}

// a send: true once the push went (try: 0 the first, 1 the second...)
export type Send = (n: Notice, try_: number) => boolean | Promise<boolean>;

// the chats' dirs whose pushes are going (a look then does nothing: the
// one going keeps what it told when done)
const GOING = new Set<string>();

// a push sent, tried again after each WAITS while it fails, TRIES times
// in all: whether it went
export async function tell(n: Notice, send: Send, wait: (ms: number) => Promise<unknown> = Bun.sleep): Promise<boolean> {
  for (let i = 0; ; i++) {
    let ok = false;
    try {
      ok = (await send(n, i)) === true;
    } catch (err: any) {
      console.error("task push: " + (err?.message ?? err));
    }
    if (ok) {
      return true;
    }
    if (i + 1 >= TRIES) {
      console.error("task push: " + n.ids.join(" ") + " not sent after " + TRIES + " tries, given up");
      return false;
    }
    await wait(WAITS[Math.min(i, WAITS.length - 1)]);
  }
}

// a look at a chat's list: the pushes given to `send` (each tried TRIES
// times), then what's told kept (written only if it changed): a push is
// taken as told only once it went or was given up, so one cut off (the
// server stopped) goes again at the next look. A look while pushes are
// going does nothing
export async function look(dir: string, tasks: Task[], now: number, send: Send, wait?: (ms: number) => Promise<unknown>): Promise<Notice[]> {
  if (GOING.has(dir)) {
    return [];
  }
  const was = load(dir);
  const { state, send: out } = step(was, tasks, now);
  const keep = () => (was === null || JSON.stringify(was) !== JSON.stringify(state)) && save(dir, state);
  if (out.length === 0) {
    keep();
    return out;
  }
  GOING.add(dir);
  try {
    for (const n of out) {
      await tell(n, send, wait);
    }
    keep();
  } finally {
    GOING.delete(dir);
  }
  return out;
}
