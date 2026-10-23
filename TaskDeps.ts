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

// how many open tasks wait for t, directly or through other open ones
export function frees<T extends Dep>(tasks: T[], t: T): number {
  if (t.state !== "open") {
    return 0;
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
  return seen.size - 1;
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
