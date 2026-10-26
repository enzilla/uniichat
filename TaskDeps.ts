// TaskDeps
// ========
// The pending list's dependencies (Tasks.ts): a task's `after` lists the
// ids it waits for. It's blocked while any of them is open; one done or
// dropped (or gone: archived, so closed) frees it. Pure, on any list of
// tasks, so the server (Tasks.ts) and the views (View.ts, web Html.ts)
// read a list the same way: views get every open task, so whether one
// is blocked, and how many it frees, is known there too.

// what this reads of a task
export type Dep = { id: string; state: string; after?: string[] };

// t's after list (none: a list of a version without it)
export function after_of(t: Dep): string[] {
  return Array.isArray(t.after) ? t.after : [];
}

// the most ids a task waits for
export const AFTER = 20;

// how long a task stays the user's before it's late (ms), when its kind
// says no other (late_after): the one value the late push (TaskPush) and
// the views' "atrasada há" (View) both read; also how long one of
// someone else's stalls before the watch (vigia.ts) charges it
export const LATE = 24 * 60 * 60 * 1000;

// Kind, priority and order (P3, P4, P5)
// ------------------------------------
// A task's kind says how long it stays the user's before it's late,
// counted since it became theirs to act on (ready: made, freed, opened
// again or handed to them): a PR's approval 24 h, a decision 72 h, a
// test 2 h (P4). None given: a PR link (GitHub pull) in its title makes
// it "pr", a title opening with "Teste" makes it "test"; else LATE. A
// PR link only in its detail or origin says nothing of its kind (a
// decision or a test often cites the PR it's about): the kind given
// always wins. Late tasks never expire nor leave "Agora" (P5): they only
// say how late. Its priority (declared; "normal" by default) sorts the
// open ones free to resolve: priority first, then how many it frees,
// then the one the user's to act on longest (ready_at: since it waits no
// more, or was handed to them; else made) (P3).

// (R5, the task's contract: action, a step only the user can do, 24 h as
// any; restart, the serve's restart (Restart.ts), 24 h; info, only to
// read, never late)
export type TaskKind = "pr" | "decision" | "test" | "action" | "restart" | "info";
export const KINDS: TaskKind[] = ["pr", "decision", "test", "action", "restart", "info"];
const H = 60 * 60 * 1000;
export const LATE_BY: Record<TaskKind, number> = { pr: 24 * H, decision: 72 * H, test: 2 * H, action: 24 * H, restart: 24 * H, info: Infinity };

export type Priority = "high" | "normal" | "low";
export const PRIORITIES: Priority[] = ["high", "normal", "low"];

// what lateness and order read of a task (an older list's: no kind,
// priority nor ready)
export type Timed = Dep & { title?: string; detail?: string; origin_url?: string | null; made: string; kind?: TaskKind | null; priority?: Priority | null; ready?: string | null };

// as people write it: https or http or no scheme, www. or not, any case
// (not part of another host or path: evil.com/github.com/... isn't one).
// The char before it is matched, not looked behind (Safari before 16.4
// can't parse a lookbehind, and web/app.js holds this): the link is m[1]
// (pr_link)
export const PR_LINK = /(?:^|[^\w.\/@-])((?:https?:\/\/)?(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)/i;

// the first PR link in s, as written; null: none
export function pr_link(s: string): string | null {
  const m = PR_LINK.exec(s);
  return m === null ? null : m[1];
}

// a task's kind: the one given, else as its title says (a PR link in
// it, or opening with "Teste"); null: none
export function kind_of(t: Timed): TaskKind | null {
  if (t.kind != null && KINDS.includes(t.kind)) {
    return t.kind;
  }
  if (PR_LINK.test(t.title ?? "")) {
    return "pr";
  }
  return /^\s*teste\b/i.test(t.title ?? "") ? "test" : null;
}

// how long a task stays the user's before it's late (ms), by its kind
export function late_after(t: Timed): number {
  const k = kind_of(t);
  return k === null ? LATE : LATE_BY[k];
}

// since when a task is the user's to act on (ISO): ready, else made
export function ready_at(t: Timed): string {
  return typeof t.ready === "string" && !Number.isNaN(Date.parse(t.ready)) ? t.ready : t.made;
}

// a task's priority (none, or not one: normal)
export function priority_of(t: Timed): Priority {
  return t.priority != null && PRIORITIES.includes(t.priority) ? t.priority : "normal";
}

// the order of the open tasks free to resolve (P3): those to act on
// before those only to read (kind info, R5), then the higher priority
// first, then the one that frees more, then the user's (a task of Unii's
// is in "Agora" only when its thread is the user's turn), then the one
// to act on longest (ready_at: since it waits no more or was handed to
// the user; else made), then by id
export function now_order<T extends Timed & { assignee?: string }>(tasks: T[]): (a: T, b: T) => number {
  const frees = new Map<string, number>();
  const n = (t: T) => {
    if (!frees.has(t.id)) {
      frees.set(t.id, frees_ids(tasks, t).length);
    }
    return frees.get(t.id)!;
  };
  const p = (t: T) => PRIORITIES.indexOf(priority_of(t));
  const age = (t: T) => Date.parse(ready_at(t)) || 0;
  const whose = (t: T) => (t.assignee === undefined || t.assignee === "user" ? 0 : 1);
  // only to read (info): after every task to act on, whatever its
  // priority, so an old one never stands first in "Agora" nor is the
  // "Próxima" while another waits for the user
  const read = (t: T) => (kind_of(t) === "info" ? 1 : 0);
  return (a, b) => read(a) - read(b) || p(a) - p(b) || n(b) - n(a) || whose(a) - whose(b) || age(a) - age(b) || Number(a.id.slice(1)) - Number(b.id.slice(1));
}

// a list's tasks by id
function by_id<T extends Dep>(tasks: T[]): Map<string, T> {
  return new Map(tasks.map((t) => [t.id, t]));
}

// the open ids t waits for, in its order
export function waits<T extends Dep>(tasks: T[], t: T, ids = by_id(tasks)): string[] {
  return after_of(t).filter((id) => ids.get(id)?.state === "open");
}

// whether t is open and waits for any open task
export function blocked<T extends Dep>(tasks: T[], t: T, ids = by_id(tasks)): boolean {
  return t.state === "open" && waits(tasks, t, ids).length > 0;
}

// the ids of the open tasks blocked
export function blocked_ids<T extends Dep>(tasks: T[]): Set<string> {
  const ids = by_id(tasks);
  return new Set(tasks.filter((t) => blocked(tasks, t, ids)).map((t) => t.id));
}

// the open tasks that wait for t itself, by id
export function frees_direct<T extends Dep>(tasks: T[], t: T): string[] {
  return tasks.filter((d) => d.state === "open" && after_of(d).includes(t.id)).map((d) => d.id).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

// the open tasks that wait for t, directly or through other open ones,
// by id, in their number's order (t closed: none)
export function frees_ids<T extends Dep>(tasks: T[], t: T): string[] {
  if (t.state !== "open") {
    return [];
  }
  const seen = new Set<string>([t.id]);
  const todo = [t.id];
  while (todo.length > 0) {
    const at = todo.pop()!;
    for (const d of tasks) {
      if (d.state === "open" && !seen.has(d.id) && after_of(d).includes(at)) {
        seen.add(d.id);
        todo.push(d.id);
      }
    }
  }
  seen.delete(t.id);
  return [...seen].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

// how many open tasks wait for t, directly or through other open ones
export function frees<T extends Dep>(tasks: T[], t: T): number {
  return frees_ids(tasks, t).length;
}

// whether `from`, through the after lists, reaches `to` (a task given
// the list `after` would wait for itself: a cycle)
export function reaches<T extends Dep>(tasks: T[], from: string[], to: string, ids = by_id(tasks)): boolean {
  const seen = new Set<string>();
  const todo = [...from];
  while (todo.length > 0) {
    const at = todo.pop()!;
    if (at === to) {
      return true;
    }
    if (!seen.has(at)) {
      seen.add(at);
      const u = ids.get(at);
      todo.push(...(u === undefined ? [] : after_of(u)));
    }
  }
  return false;
}

// Status, next step and its due time (the evidence round)
// --------------------------------------------------------
// An open task has a status beside its state: open (being worked on),
// waiting_user (Unii's, waiting for something only the user can give:
// its why says what), blocked (its why, and what unblocks it). A task
// of someone else's (Unii's) has a next step and when it's due
// (next_due); none given, it's due STALL after it last moved (moved:
// Tasks.task_moves). Past its due, not blocked by other tasks and not
// waiting for the user, it's overdue: the views say so, Unii's block
// lists it and the user's phones are told once (TaskPush). STALL is the
// server's setting (config task_stall, in hours; 4 by default): the
// views get each task's due from the server (Tasks.tasks_view), so they
// never read the setting themselves.

export type Status = "open" | "waiting_user" | "blocked";
export const STATUSES: Status[] = ["open", "waiting_user", "blocked"];

// how long a task of Unii's may stand still with no next_due (ms)
export const STALL_DEFAULT = 4 * H;
let stall = STALL_DEFAULT;

// the server's setting (ms, more than 0; else the default kept)
export function stall_set(ms: number): void {
  stall = Number.isFinite(ms) && ms > 0 ? ms : STALL_DEFAULT;
}

export function stall_ms(): number {
  return stall;
}

// what the due time reads of a task (an older list's: none of these)
export type Due = Dep & { assignee?: string; status?: Status | null; next_due?: string | null; moved?: string | null; changed?: string | null; made: string; due?: string | null };

// a task's status (none, or not one: open)
export function status_of(t: { status?: Status | null }): Status {
  return t.status != null && STATUSES.includes(t.status) ? t.status : "open";
}

// when a task's next step is due (ISO): an open one of someone else's
// (not the user's), not waiting for the user: its next_due, else STALL
// after it last moved; the server's (t.due, Tasks.tasks_view) wins in a
// view. null: none (closed, the user's, waiting for the user)
export function due_at(t: Due, ms = stall): string | null {
  if (t.state !== "open" || (t.assignee ?? "user") === "user" || status_of(t) === "waiting_user") {
    return null;
  }
  if (t.due !== undefined) {
    return t.due;
  }
  if (typeof t.next_due === "string" && !Number.isNaN(Date.parse(t.next_due))) {
    return new Date(Date.parse(t.next_due)).toISOString();
  }
  const from = Date.parse(t.moved ?? t.changed ?? t.made);
  return Number.isNaN(from) ? null : new Date(from + ms).toISOString();
}

// how long a task is past its due (ms), if it is and isn't waiting for
// other open tasks; else 0
export function overdue_ms<T extends Due>(tasks: T[], t: T, now: number, ms = stall): number {
  const due = due_at(t, ms);
  if (due === null || blocked(tasks, t)) {
    return 0;
  }
  const late = now - Date.parse(due);
  return late > 0 ? late : 0;
}

// Whose move it is ("sua vez")
// -----------------------------
// A task is the user's move only while there's something of theirs to
// do: open, not waiting for other open tasks (after), not waiting for
// Unii's reply in its thread (talk "unii"), not blocked (status), not
// waiting for something outside the list (waits_for: "CI do #42"; P85,
// the user's: a wait, out of Agora, no push, not counted, as the
// pipeline has it), and theirs (assignee user) or one of Unii's waiting for something only
// they can give (status waiting_user). A reply of Unii's in its thread
// (talk "user") makes no move of the user's by itself: on a task of
// Unii's (or an agent's) it is news to read, not a step to take (else
// the task stayed "sua vez" for good, the user having nothing to do).
// The Mesa's Agora (View.desk_group), the count on the tab and the
// app's badge (TaskPush.turn_count) and the pushes (TaskPush.actionable)
// all read this one rule.
export type Move = Dep & { assignee?: string; status?: Status | null; talk?: string | null; waits_for?: string | null };
export function user_move<T extends Move>(t: T, blocked_set: Set<string>): boolean {
  if (t.state !== "open" || blocked_set.has(t.id) || t.talk === "unii" || status_of(t) === "blocked" || outside_wait(t)) {
    return false;
  }
  return (t.assignee ?? "user") === "user" || status_of(t) === "waiting_user";
}

// whether a task's last thread message is Unii's saying it gave no reply
// (Tasks.Talk.none: the turn ended without one) and the user hasn't
// written since: still the user's move if it was (user_move), but the
// views say "Unii não respondeu", not "sua vez" as if Unii had answered
export function task_missed(t: { talk?: string | null; thread?: { who: string; none?: true }[] }): boolean {
  const thread = t.thread ?? [];
  const last = thread[thread.length - 1];
  return t.talk === "user" && last !== undefined && last.who === "unii" && last.none === true;
}

// whether a task waits for something outside the list (waits_for set)
export function outside_wait(t: { waits_for?: string | null }): boolean {
  return typeof t.waits_for === "string" && t.waits_for.trim() !== "";
}

// the ids of the tasks overdue now, in their number's order
export function overdue_ids<T extends Due>(tasks: T[], now: number, ms = stall): string[] {
  return tasks.filter((t) => overdue_ms(tasks, t, now, ms) > 0).map((t) => t.id).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}
