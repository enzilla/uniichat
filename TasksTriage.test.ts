// TasksTriage.test
// ================
// `bun test TasksTriage.test.ts`: UX round 4, "triar e retomar" (P68):
// "Agora" sorted by priority, then how many it frees, then the oldest
// (P3); late by kind, counted since the task became the user's to act on
// (P4: a PR 24 h, a decision 72 h, a test 2 h); a late one never
// expires nor leaves "Agora" (P5). On chats in a temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Deps from "./TaskDeps.ts";
import * as TaskPush from "./TaskPush.ts";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Render.tsx";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-triage-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");
const H    = 3600e3;
let dir    = "";

beforeEach(() => {
  T.tasks_forget();
  dir = fs.mkdtempSync(ROOT + "/chat-");
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function add(s: T.Store, args: T.Edit, now = NOW): T.Task {
  const t = T.task_new(s, args, "main", now);
  if (typeof t === "string") {
    throw new Error(t);
  }
  return t;
}

const now_ids = (tasks: T.Task[]) => View.desk_list(tasks).find((g) => g.group === "now")?.tasks.map((t) => t.id) ?? [];

test("P3: Agora by priority, then how many it frees, then the oldest; the server's order the same", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "nova, normal" }, NOW + 5 * H);              // P1
  add(s, { title: "antiga, normal" }, NOW);                    // P2
  add(s, { title: "libera 2" }, NOW + 9 * H);                  // P3
  add(s, { title: "espera P3", after: ["P3"] }, NOW + 9 * H);  // P4
  add(s, { title: "espera P4", after: ["P4"] }, NOW + 9 * H);  // P5
  add(s, { title: "alta, a mais nova", priority: "high" }, NOW + 20 * H); // P6
  add(s, { title: "baixa, antiga", priority: "low" }, NOW - 50 * H);      // P7
  add(s, { title: "libera 1" }, NOW + 8 * H);                  // P8
  add(s, { title: "espera P8", after: ["P8"] }, NOW + 8 * H);  // P9
  const tasks = T.tasks_view(s, NOW + 30 * H);
  expect(now_ids(tasks)).toEqual(["P6", "P3", "P8", "P2", "P1", "P7"]);
  expect(T.tasks_sort(s.tasks).slice(0, 6).map((t) => t.id)).toEqual(["P6", "P3", "P8", "P2", "P1", "P7"]);
  // "Próxima" follows the same order
  expect(View.desk_next(tasks, "P3")?.id).toBe("P8");
  // the row says the priority, not "normal"
  const html = Html.desk_html(tasks, "", "", "P6", NOW + 30 * H);
  expect(html.list.find((x) => x.includes('data-desk="P6"'))).toContain('<span class="prio high">prioridade alta</span>');
  expect(html.list.find((x) => x.includes('data-desk="P7"'))).toContain('<span class="prio low">prioridade baixa</span>');
  expect(html.list.find((x) => x.includes('data-desk="P1"'))).not.toContain("prioridade");
  expect(html.detail.join("")).toContain("prioridade alta");
  // the terminal's /mesa says it too
  const v = View.view_new();
  v.tasks = tasks;
  expect(View.desk_md(v)).toContain("- **P6** alta, a mais nova · **prioridade alta**");
});

test("kind and priority: given, checked, changed, cleared; kept on disk; an older list's read as none and normal", () => {
  const s = T.tasks_load(dir);
  expect(T.task_new(s, { title: "x", kind: "bug" }, "main", NOW)).toBe('kind is one of pr, decision, test, action, restart, info ("" for none).');
  expect(T.task_new(s, { title: "x", priority: "urgente" }, "main", NOW)).toBe("priority is one of high, normal, low.");
  expect(s.tasks.length).toBe(0);
  const t = add(s, { title: "Decidir", kind: "Decision", priority: " HIGH " });
  expect([t.kind, t.priority, t.ready]).toEqual(["decision", "high", new Date(NOW).toISOString()]);
  expect(T.task_line(t, NOW)).toContain("kind decision, priority high");
  const e = T.task_edit(s, { id: "P1", kind: "", priority: "" }, NOW + H) as T.Task;
  expect([e.kind, e.priority]).toEqual([null, "normal"]);
  expect(T.task_edit(s, { id: "P1", priority: "x" }, NOW + H)).toBe("priority is one of high, normal, low.");
  T.task_edit(s, { id: "P1", kind: "test", priority: "low" }, NOW + H);
  T.tasks_forget();
  const back = T.tasks_load(dir).tasks[0];
  expect([back.kind, back.priority]).toEqual(["test", "low"]);
  // an item of an older tasks.json, without them
  const old = T.task_read({ id: "P9", title: "Velha", made: "2026-10-20T10:00:00Z", kind: "outra", priority: 3 }, NOW)!;
  expect([old.kind, old.priority, old.ready]).toEqual([null, "normal", "2026-10-20T10:00:00.000Z"]);
});

test("P4: the kind, given or as its title says, sets when it's late: PR 24 h, decision 72 h, test 2 h, else 24 h", () => {
  const base = { id: "P1", state: "open", made: "2026-10-23T12:00:00Z" };
  expect(Deps.kind_of({ ...base, title: "Aprovar https://github.com/morum/uniichat/pull/16" })).toBe("pr");
  expect(Deps.kind_of({ ...base, detail: "https://github.com/Numih/x/issues/3" })).toBe(null);
  expect(Deps.kind_of({ ...base, title: "Teste do push após o reinício" })).toBe("test");
  expect(Deps.kind_of({ ...base, title: "Testemunha" })).toBe(null);
  expect(Deps.kind_of({ ...base, title: "Teste", kind: "decision" })).toBe("decision");
  expect(Deps.late_after({ ...base, kind: "pr" })).toBe(24 * H);
  expect(Deps.late_after({ ...base, kind: "decision" })).toBe(72 * H);
  expect(Deps.late_after({ ...base, kind: "test" })).toBe(2 * H);
  expect(Deps.late_after(base)).toBe(Deps.LATE);
  const s = T.tasks_load(dir);
  add(s, { title: "Decidir a frente", kind: "decision" });                                  // P1
  add(s, { title: "Teste do push" });                                                       // P2
  add(s, { title: "Mesclar https://github.com/morum/uniichat/pull/16", prs: [{ url: "https://github.com/morum/uniichat/pull/16", head: "a9e8586" }] }); // P3
  add(s, { title: "Outra coisa" });                                                         // P4
  const tasks = T.tasks_view(s, NOW);
  const late = (id: string, h: number) => View.task_late_said(tasks.find((t) => t.id === id)!, new Set(), NOW + h * H + 1);
  expect([late("P2", 2), late("P3", 2), late("P1", 2)]).toEqual(["atrasada há 2 h", "", ""]);
  expect([late("P3", 24), late("P4", 24), late("P1", 48)]).toEqual(["atrasada há 24 h", "atrasada há 24 h", ""]);
  expect(late("P1", 72)).toBe("atrasada há 3 d");
  // the Mesa's detail says its kind and limit
  const detail = Html.desk_html(tasks, "", "", "P2", NOW).detail.join("");
  expect(detail).toContain("<dt>Tipo</dt><dd>teste, prazo 2 h</dd>");
  expect(detail).toContain("Teste, prazo 2 h.");
  expect(Html.desk_html(tasks, "", "", "P1", NOW).detail.join("")).toContain("decisão, prazo 72 h");
  expect(Html.desk_html(tasks, "", "", "P4", NOW).detail.join("")).not.toContain('class="kind"');
});

test("P4: late counts since it became the user's to act on: freed, opened again, handed by Unii", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Reiniciar" });                                      // P1
  add(s, { title: "Teste depois do reinício", after: ["P1"] });        // P2
  add(s, { title: "Do Unii", assignee: "unii" });                      // P3
  add(s, { title: "Velha", kind: "test" });                            // P4
  T.task_resolve(s, "P1", "done", null, null, NOW + 30 * H);
  T.task_edit(s, { id: "P3", assignee: "user", kind: "test" }, NOW + 40 * H);
  T.task_resolve(s, "P4", "done", null, null, NOW + 1 * H);
  T.task_resolve(s, "P4", "open", null, null, NOW + 50 * H);
  const tasks = T.tasks_view(s, NOW + 51 * H);
  const by = (id: string) => tasks.find((t) => t.id === id)!;
  expect(by("P2").ready).toBe(new Date(NOW + 30 * H).toISOString());
  expect(by("P3").ready).toBe(new Date(NOW + 40 * H).toISOString());
  expect(by("P4").ready).toBe(new Date(NOW + 50 * H).toISOString());
  const blocked = Deps.blocked_ids(tasks);
  // P2, a test: made 51 h ago, freed 21 h ago: late by those 21 h
  expect(View.task_late_said(by("P2"), blocked, NOW + 51 * H)).toBe("atrasada há 21 h");
  // P4 opened again an hour ago: not late yet (test: 2 h)
  expect(View.task_late_said(by("P4"), blocked, NOW + 51 * H)).toBe("");
  expect(View.task_late_said(by("P4"), blocked, NOW + 52 * H + 1)).toBe("atrasada há 2 h");
  // a change that isn't a handing over keeps it
  T.task_edit(s, { id: "P4", title: "Velha, renomeada" }, NOW + 53 * H);
  expect(s.tasks.find((t) => t.id === "P4")!.ready).toBe(new Date(NOW + 50 * H).toISOString());
  // Unii clearing the after list by its own edit makes it the user's from then
  add(s, { title: "A" }, NOW);                                // P5
  add(s, { title: "B", after: ["P5"] }, NOW);                 // P6
  T.task_edit(s, { id: "P6", after: [] }, NOW + 60 * H);
  expect(s.tasks.find((t) => t.id === "P6")!.ready).toBe(new Date(NOW + 60 * H).toISOString());
});

test("P5: a late one never expires: at +72 h a test is still open and in Agora, only marked late", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Teste do push", kind: "test" });
  add(s, { title: "Reiniciar o serve", choices: ["Sim", "Depois"] });
  const later = NOW + 72 * H;
  const tasks = T.tasks_view(s, later);
  expect(tasks.map((t) => t.state)).toEqual(["open", "open"]);
  expect(now_ids(tasks)).toEqual(["P1", "P2"]);
  const html = Html.desk_html(tasks, "", "", null, later).list.join("");
  expect(html.match(/class="late"/g)?.length).toBe(2);
  expect(html).not.toMatch(/vencida|expirada/);
});

test("the late push by kind: a test reminded the day after 2 h, a decision not before 72 h", () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  const made = new Date(at(23, 10)).toISOString();
  const task = (id: string, kind: Deps.TaskKind | null): T.Task => ({
    id, title: id, detail: "", state: "open", assignee: "user", origin: "chat", origin_url: null, agent: null, by: "main", choices: [], answer: null, note: null, ref: null,
    made, changed: made, moved: made, kind, priority: "normal", ready: made, closed: null, told: true, rev: 0, after: [], freed: false, heard: null, fields: [], draft: {}, answers: null, thread: [], talk: null,
  });
  const tasks = [task("P1", "test"), task("P2", "decision"), task("P3", null)];
  let out = TaskPush.step(null, tasks, at(23, 10));
  // the first look before REMIND passed: the day's reminder already looked
  out = TaskPush.step(out.state, tasks, at(24, TaskPush.REMIND));
  expect(out.send).toEqual([{ kind: "late", ids: ["P1"], text: "Pendência P1 está em atraso", count: 3 }]);
  out = TaskPush.step(out.state, tasks, at(25, TaskPush.REMIND));
  expect(out.send.map((n) => n.ids)).toEqual([["P3"]]);
  out = TaskPush.step(out.state, tasks, at(26, TaskPush.REMIND));
  expect(out.send).toEqual([]);
  out = TaskPush.step(out.state, tasks, at(27, TaskPush.REMIND));
  expect(out.send.map((n) => n.ids)).toEqual([["P2"]]);
});

test("P4: a PR link only in the detail or origin doesn't make it a PR; in the title it does; the kind given always wins", () => {
  const base = { id: "P1", state: "open", made: "2026-10-23T12:00:00Z" };
  const pr = "https://github.com/morum/uniichat/pull/17";
  expect(Deps.kind_of({ ...base, title: "Decidir a frente", detail: "veja " + pr })).toBe(null);
  expect(Deps.kind_of({ ...base, title: "Decidir a frente", origin_url: pr })).toBe(null);
  expect(Deps.kind_of({ ...base, title: "Teste do push", detail: "veja " + pr })).toBe("test");
  expect(Deps.kind_of({ ...base, title: "Aprovar " + pr })).toBe("pr");
  expect(Deps.kind_of({ ...base, title: "Aprovar " + pr, kind: "decision" })).toBe("decision");
  expect(Deps.kind_of({ ...base, title: "Aprovar o PR", detail: pr, kind: "pr" })).toBe("pr");
  const s = T.tasks_load(dir);
  add(s, { title: "Decidir o rumo", detail: "contexto: " + pr, kind: "decision", prs: [{ url: pr, head: "88f1899" }] });   // P1
  add(s, { title: "Teste depois do merge", detail: pr, prs: [{ url: pr, head: "88f1899" }] });                             // P2
  add(s, { title: "Escolher a frente", detail: pr, prs: [{ url: pr, head: "88f1899" }] });                                 // P3
  const tasks = T.tasks_view(s, NOW);
  const late = (id: string, h: number) => View.task_late_said(tasks.find((t) => t.id === id)!, new Set(), NOW + h * H + 1);
  // the decision citing a PR: 72 h, not 24 h; the test: 2 h; none: 24 h (the default, not the PR's)
  expect([late("P1", 25), late("P1", 72)]).toEqual(["", "atrasada há 3 d"]);
  expect(late("P2", 2)).toBe("atrasada há 2 h");
  expect(Deps.kind_of(tasks.find((t) => t.id === "P3")!)).toBe(null);
});

test("P3: the oldest is the one the user's to act on longest (ready), not the one made first; else made", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Livre desde o início" }, NOW);                       // P1
  add(s, { title: "Bloqueadora", assignee: "unii" }, NOW);              // P2
  add(s, { title: "Criada antes, liberada depois", after: ["P2"] }, NOW - 50 * H); // P3
  T.task_resolve(s, "P2", "done", null, null, NOW + 10 * H);
  const tasks = T.tasks_view(s, NOW + 11 * H);
  expect(tasks.find((t) => t.id === "P3")!.ready).toBe(new Date(NOW + 10 * H).toISOString());
  expect(now_ids(tasks)).toEqual(["P1", "P3"]);
  expect(T.tasks_sort(s.tasks).slice(0, 2).map((t) => t.id)).toEqual(["P1", "P3"]);
  expect(View.desk_next(tasks, "P1")?.id).toBe("P3");
  // without ready (an older list's), made decides
  const timed = (id: string, made: string, ready?: string) => ({ id, state: "open", made, ...(ready === undefined ? {} : { ready }) });
  const a = timed("P7", "2026-10-20T10:00:00Z");
  const b = timed("P8", "2026-10-22T10:00:00Z");
  const c = timed("P9", "2026-10-19T10:00:00Z", "2026-10-23T10:00:00Z");
  const list = [c, b, a];
  expect([...list].sort(Deps.now_order(list)).map((t) => t.id)).toEqual(["P7", "P8", "P9"]);
  // a ready that isn't a time: made
  const d = timed("P6", "2026-10-21T10:00:00Z", "nada");
  const list2 = [b, d];
  expect([...list2].sort(Deps.now_order(list2)).map((t) => t.id)).toEqual(["P6", "P8"]);
});

test("the late push counts since the task became the user's to act on (ready), not since told; a future ready: since told", () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  const iso = (n: number) => new Date(n).toISOString();
  const task = (id: string, made: string, ready: string): T.Task => ({
    id, title: id, detail: "", state: "open", assignee: "user", origin: "chat", origin_url: null, agent: null, by: "main", choices: [], answer: null, note: null, ref: null,
    made, changed: ready, moved: ready, kind: null, priority: "normal", ready, closed: null, told: true, rev: 0, after: [], freed: false, heard: null, fields: [], draft: {}, answers: null, thread: [], talk: null,
  });
  // P1: made long ago, freed at 25 10:00 (before the first look: told as of made);
  // P2: ready at 23 10:00, told only at 24 08:00 (pushes failed);
  // P3: a ready past now (a clock gone wrong): since told
  const tasks = [
    task("P1", iso(at(20, 10)), iso(at(25, 10))),
    task("P2", iso(at(23, 10)), iso(at(23, 10))),
    task("P3", iso(at(23, 10)), "2099-01-01T00:00:00.000Z"),
  ];
  const state: TaskPush.State = { seen: { P1: iso(at(20, 10)), P2: iso(at(24, 8)), P3: iso(at(24, 8)) }, queue: [], since: null, reminded: [], day: TaskPush.day(at(25, 12)) };
  expect(TaskPush.late_since(tasks[0], state.seen.P1, at(26, 9))).toBe(at(25, 10));
  expect(TaskPush.late_since(tasks[2], state.seen.P3, at(26, 9))).toBe(at(24, 8));
  // 26 09:00: P1 freed 23 h ago (not late, though told 6 d ago); P2 ready 47 h ago; P3 told 25 h ago
  let out = TaskPush.step(state, tasks, at(26, TaskPush.REMIND));
  expect(out.send).toEqual([{ kind: "late", ids: ["P2", "P3"], text: "Pendências P2 e P3 estão em atraso", count: 3 }]);
  out = TaskPush.step(out.state, tasks, at(27, TaskPush.REMIND));
  expect(out.send).toEqual([{ kind: "late", ids: ["P1"], text: "Pendência P1 está em atraso", count: 3 }]);
  // a day earlier (24 09:00 is before ready+24 h for P2, 23 h after its ready): only by ready, never by told
  const early: TaskPush.State = { ...state, day: TaskPush.day(at(23, 12)) };
  out = TaskPush.step(early, [tasks[1]], at(24, TaskPush.REMIND));
  expect(out.send).toEqual([]);
  out = TaskPush.step(early, [tasks[1]], at(24, 10, 1));
  expect(out.send.map((n) => n.ids)).toEqual([["P2"]]);
});
