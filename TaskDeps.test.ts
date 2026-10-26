// TaskDeps.test
// =============
// `bun test TaskDeps.test.ts`: dependencies between tasks of the pending
// list (TaskDeps.ts, Tasks.ts after), and how the views show them
// (View.ts, web Html.ts), on chats in a temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

// evidence that closes a task (the evidence round): a file that exists
const EV = { type: "file", path: import.meta.path };

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-deps-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");
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

function view(s: T.Store): View.View {
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  return v;
}

test("add with after: ids that exist; none, a bad type, itself refused", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Token" });
  expect(add(s, { title: "Testar", after: ["p1", "1"] }).after).toEqual(["P1"]);
  expect(add(s, { title: "Agendar", after: "P1, P2" }).after).toEqual(["P1", "P2"]);
  expect(T.task_new(s, { title: "x", after: ["P9"] }, "main", NOW)).toBe("No task P9 to wait for.");
  expect(T.task_new(s, { title: "x", after: { a: 1 } }, "main", NOW)).toContain("after is a list of task ids");
  expect(T.task_new(s, { title: "x", after: [null] }, "main", NOW)).toContain("after is a list of task ids");
  expect(T.task_edit(s, { id: "P1", after: ["P1"] }, NOW)).toBe("A task can't wait for itself (P1).");
  expect(T.task_new(s, { title: "x", after: Array.from({ length: 21 }, (_, k) => "P" + (k + 1)) }, "main", NOW)).toContain("at most 20");
});

test("edit: a cycle refused, directly or through others; [] clears", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  add(s, { title: "B", after: ["P1"] });
  add(s, { title: "C", after: ["P2"] });
  expect(T.task_edit(s, { id: "P1", after: ["P2"] }, NOW)).toContain("P2 waits for P1 already");
  expect(T.task_edit(s, { id: "P1", after: ["P3"] }, NOW)).toContain("a cycle");
  const c = T.task_edit(s, { id: "P3", after: [] }, NOW) as T.Task;
  expect(c.after).toEqual([]);
  expect((T.task_edit(s, { id: "P1", after: ["P3"] }, NOW) as T.Task).after).toEqual(["P3"]);
});

test("blocked: can't be resolved by the user; freed once all close, told to Unii in the next block", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Salvar o token", who: "user" });
  add(s, { title: "Ligar o MCP", who: "unii" });
  add(s, { title: "Aprovar a triagem", after: ["P1", "P2"], choices: ["sim", "não"] });
  expect(T.task_resolve(s, "P3", "done", "sim", null, NOW)).toBe("A pendência P3 aguarda P1, P2: resolva essas pendências antes. Nada foi alterado.");
  expect(T.task_resolve(s, "P3", "dropped", null, null, NOW)).toContain("aguarda P1, P2");
  T.task_resolve(s, "P1", "done", null, null, NOW);
  expect(T.task_find(s, "P3")!.told).toBe(true);
  T.tasks_told(s, new Map([["P1", T.task_find(s, "P1")!.rev]]));
  // Unii closes its own: P3 freed, a change to tell
  T.task_edit(s, { id: "P2", state: "done", evidence: EV }, NOW);
  const p3 = T.task_find(s, "P3")!;
  expect(p3.freed).toBe(true);
  expect(p3.told).toBe(false);
  expect(T.tasks_untold(s).map((t) => t.id)).toEqual(["P3"]);
  const block = T.tasks_block(s, NOW);
  expect(block).toContain('- P3 freed: every task it waited for (P1, P2) is closed; the user sees it now: "Aprovar a triagem"');
  T.tasks_told(s);
  expect(T.tasks_untold(s)).toEqual([]);
  expect(T.task_resolve(s, "P3", "done", "sim", null, NOW)).not.toBeString();
});

test("a dependency dropped frees too; reopened, the dependent waits again and its freeing untold is undone", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  add(s, { title: "B", after: ["P1"] });
  T.task_resolve(s, "P1", "dropped", null, null, NOW);
  expect(T.task_find(s, "P2")!.freed).toBe(true);
  T.task_resolve(s, "P1", "open", null, null, NOW);
  const b = T.task_find(s, "P2")!;
  expect([b.freed, b.told]).toEqual([false, true]);
  expect(T.tasks_untold(s).map((t) => t.id)).toEqual(["P1"]);
  expect(T.tasks_block(s, NOW)).toContain("Waiting for other tasks (1; hidden from the user until freed):\n- P2 [user] B waits for P1");
  // freed and told, then reopened: waits again, nothing to undo
  T.task_resolve(s, "P1", "done", null, null, NOW);
  T.tasks_tell(s);
  T.task_resolve(s, "P1", "open", null, null, NOW);
  expect(view(s).tasks.length).toBe(2);
  expect(View.view_tasks(view(s)).waiting.map((t) => t.id)).toEqual(["P2"]);
});

test("Unii freeing a task by its own edit of after isn't a change to tell", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  add(s, { title: "B", after: ["P1"] });
  T.task_edit(s, { id: "P2", after: [] }, NOW);
  expect(T.tasks_untold(s)).toEqual([]);
});

test("order: those that free others first, by how many (through others too), then the user's", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "solta do user" });          // P1
  add(s, { title: "libera 1", who: "unii" });  // P2
  add(s, { title: "libera 3" });               // P3
  add(s, { title: "espera P2", after: ["P2"] }); // P4
  add(s, { title: "espera P3", after: ["P3"] }); // P5
  add(s, { title: "espera P5", after: ["P5"] }); // P6
  add(s, { title: "espera P3 e P5", after: ["P3", "P5"] }); // P7
  add(s, { title: "solta do Unii", who: "unii" }); // P8
  expect(T.tasks_sort(s.tasks).map((t) => t.id)).toEqual(["P3", "P2", "P1", "P8", "P4", "P5", "P6", "P7"]);
  const v = view(s);
  const { open, waiting } = View.view_tasks(v);
  expect(open.map((t) => t.id)).toEqual(["P3", "P2", "P1", "P8"]);
  expect(waiting.map((t) => t.id)).toEqual(["P4", "P5", "P6", "P7"]);
  expect(View.task_frees_said(v, open[0])).toBe("libera 3");
  expect(View.task_frees_said(v, open[2])).toBe("");
  // the tool: frees and waits said, the waiting apart
  const list = T.tasks_list(s, {}, NOW);
  expect(list).toContain("- P3 [user] libera 3 frees P5, P7 (0m)");
  expect(list).toContain("Waiting for other tasks (hidden from the user until freed):\n- P4 [user] espera P2 waits for P2 (0m)");
  expect(list.indexOf("P8 [unii]")).toBeLessThan(list.indexOf("Waiting"));
});

test("views: footer and /p leave the waiting out but their count; /p aguardando lists them; acts on them refused", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Token" });
  add(s, { title: "Ligar", who: "unii", after: ["P1"] });
  add(s, { title: "Agendar", after: ["P2"] });
  const v = view(s);
  expect(View.tasks_footer(v, 200)).toBe("Pendências: 1 aberta (P1) · +2 aguardando · /p");
  expect(View.tasks_footer(v, 40)).toBe("Pendências: 1 · +2 aguardando · /p");
  expect(View.tasks_footer(v, 20)).toBe("Pendências: 1 · /p");
  const md = View.tasks_md(v);
  expect(md).toContain("**Suas pendências (1)**\n\n- **P1** Token · **libera 2**");
  expect(md).toContain("_+2 aguardando outras pendências_ · `/p aguardando` mostra quais");
  expect(md).not.toContain("Agendar");
  expect(View.tasks_md(v, null, true)).toBe("**Aguardando outras pendências (2)**\n\n- P2 Ligar (com o Unii) — aguarda P1\n- P3 Agendar — aguarda P2 (com o Unii)");
  expect(View.tasks_md(v, v.tasks.find((t) => t.id === "P3")!)).toContain("aberta · com você · aguarda P2");
  expect(View.view_act(v, { $: "Task", task: "P3", state: "done" })).toEqual([]);
  expect(v.notes.pop()).toBe("A pendência P3 aguarda P2: resolva essa pendência antes. Nada foi alterado.");
  expect(View.view_act(v, { $: "Task", task: "P1", state: "done" })).toEqual([{ $: "task", task: "P1", state: "done" }]);
});

test("web: the waiting apart, without acts, escaped; what it frees named", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "<b>Token</b>" });
  add(s, { title: "<img src=x onerror=alert(1)>", after: ["P1"] });
  const html = Html.tasks_html(T.tasks_view(s, NOW));
  expect(html.open.length).toBe(1);
  expect(html.open[0]).toContain('<span class="frees">libera P2</span>');
  expect(html.waiting.length).toBe(1);
  expect(html.waiting[0]).toContain("aguarda P1 (sua)");
  expect(html.waiting[0]).not.toContain("<img");
  expect(html.waiting[0]).not.toContain("<button");
  expect(View.tasks_waiting_said(1)).toBe("+1 aguardando outras pendências");
});

test("an old tasks.json, without after: valid, nothing said, nothing kept aside", () => {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 3, tasks: [{ id: "P1", title: "A", state: "open" }, { id: "P2", title: "B", state: "done" }] }));
  const s = T.tasks_load(dir);
  expect(s.tasks.map((t) => t.after)).toEqual([[], []]);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(false);
  expect(T.tasks_block(s, NOW)).toContain("- P1 [user] A");
});

test("hand-edited after: wrong types, ids of no task, itself, a cycle left out; the file kept aside; nothing breaks", () => {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ tasks: [
    { id: "P1", title: "A", after: ["P2"] },
    { id: "P2", title: "B", after: ["P1", "P3"] },
    { id: "P3", title: "C", after: "P1" },
    { id: "P4", title: "D", after: ["P4", "P99", 7, null, { x: 1 }, "P1", "P1"] },
    { id: "P5", title: "E", after: ["P5"] },
    { id: "P6", title: "F", after: ["P1"], freed: true, told: true },
  ] }));
  const s = T.tasks_load(dir);
  const after = Object.fromEntries(s.tasks.map((t) => [t.id, t.after]));
  expect(after).toEqual({ P1: ["P2"], P2: ["P3"], P3: [], P4: ["P1"], P5: [], P6: ["P1"] });
  expect(s.tasks.find((t) => t.id === "P6")!.freed).toBe(false);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(true);
  expect(T.tasks_block(s, NOW)).toContain("Open (2;");
  const v = view(s);
  expect(View.tasks_footer(v, 200)).toBe("Pendências: 2 abertas (P3, P5) · +4 aguardando · /p");
  expect(Html.tasks_html(v.tasks).waiting.length).toBe(4);
  expect(View.tasks_md(v, null, true)).toContain("P1 A — aguarda P2");
});

test("archived dependencies leave the after lists", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  add(s, { title: "B", after: ["P1"] });
  T.task_edit(s, { id: "P1", state: "done", evidence: EV }, NOW - 40 * 86400000);
  T.task_edit(s, { id: "P2", title: "B2" }, NOW);
  expect(s.tasks.map((t) => t.id)).toEqual(["P2"]);
  expect(s.tasks[0].after).toEqual([]);
});

test("avisar tells the user's resolutions, not a freeing (the next block does); its words if ever said", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  add(s, { title: "B", after: ["P1"] });
  T.task_resolve(s, "P1", "done", null, null, NOW);
  const v = view(s);
  expect(View.view_untold(v).map((t) => t.id)).toEqual(["P1"]);
  expect(T.tasks_tell(s).map((t) => t.id)).toEqual(["P1"]);
  expect(T.tasks_untold(s).map((t) => t.id)).toEqual(["P2"]);
  expect(T.task_said(T.task_find(s, "P2")!)).toBe("Pendência P2 liberada: “B”. As pendências de que dependia (P1) foram resolvidas.");
  expect(T.tasks_block(s, NOW)).toContain("- P2 freed:");
});
