// TasksMesa.test
// ==============
// `bun test TasksMesa.test.ts`: the pending list's hardening (phase 0 of
// the Mesa: the verifiers' ressalvas) and, below, its conversation and
// fields (phase 1), on chats in a temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-mesa-");
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

function reload(): T.Store {
  T.tasks_forget();
  return T.tasks_load(dir);
}

// Phase 0
// =======

test("task_edit refuses done on a task that waits; dropped goes; done with its after cleared too", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  add(s, { title: "B", after: ["P1"] });
  add(s, { title: "C", after: ["P1"] });
  const no = T.task_edit(s, { id: "P2", state: "done" }, NOW);
  expect(no).toBe("P2 waits for P1, still open: it can't be done before them. Close those first, change its after, or drop it if it no longer applies.");
  expect(T.task_find(s, "P2")!.state).toBe("open");
  expect((T.task_edit(s, { id: "P2", state: "dropped" }, NOW) as T.Task).state).toBe("dropped");
  expect((T.task_edit(s, { id: "P3", state: "done", after: [] }, NOW) as T.Task).state).toBe("done");
});

test("a resolution untold survives Unii's change of state and a restart; told once shown", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Mesclar?", choices: ["sim", "não"] });
  T.task_resolve(s, "P1", "done", "sim", "pode", NOW);
  T.task_edit(s, { id: "P1", state: "open" }, NOW + 1);
  const again = reload();
  const t = T.task_find(again, "P1")!;
  expect([t.state, t.told, t.heard]).toEqual(["open", false, { state: "done", answer: "sim", note: "pode" }]);
  expect(T.tasks_block(again, NOW + 2)).toContain("- P1 done by user: \"Mesclar?\" — answer: sim — note: \"pode\" — since then you made it open");
  expect(T.tasks_told(again)).toBe(1);
  expect(T.task_find(again, "P1")!.heard).toBe(null);
  expect(T.tasks_block(again, NOW + 3)).not.toContain("by user");
});

test("a heard of a hand edit: wrong shapes read as none, told tasks keep none", () => {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ tasks: [
    { id: "P1", title: "A", state: "done", told: false, heard: { state: "x" } },
    { id: "P2", title: "B", state: "done", told: true, heard: { state: "done" } },
    { id: "P3", title: "C", state: "open", told: false, heard: { state: "dropped", note: "\u001b[31mnão\u0007" } },
  ] }));
  const s = T.tasks_load(dir);
  expect(s.tasks.map((t) => t.heard)).toEqual([null, null, { state: "dropped", answer: null, note: "[31mnão" }]);
  expect(T.tasks_block(s, NOW)).toContain("- P3 dropped by user: \"C\" — note: \"[31mnão\" — since then you made it open");
});

test("tasks.json freeing a task that still waits: unfreed, said in the log, the file kept aside", () => {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ tasks: [
    { id: "P1", title: "A" },
    { id: "P2", title: "B", after: ["P1"], freed: true, told: false },
    { id: "P3", title: "C", after: ["P4"], freed: true, told: false },
    { id: "P4", title: "D", state: "done" },
  ] }));
  const s = T.tasks_load(dir);
  const p2 = T.task_find(s, "P2")!;
  expect([p2.freed, p2.told]).toEqual([false, true]);
  const p3 = T.task_find(s, "P3")!;
  expect([p3.freed, p3.told]).toEqual([true, false]);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(true);
  const block = T.tasks_block(s, NOW);
  expect(block).not.toContain("P2 freed");
  expect(block).toContain("P3 freed");
});

test("ids past 9 digits: made and read back; past MAXID: refused, nothing made", () => {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 1000000000, tasks: [{ id: "P999999999", title: "A" }] }));
  const s = T.tasks_load(dir);
  expect(add(s, { title: "B" }).id).toBe("P1000000000");
  const again = reload();
  expect(again.tasks.map((t) => t.id)).toEqual(["P999999999", "P1000000000"]);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(false);
  expect(again.next).toBe(1000000001);
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: T.MAXID + 1, tasks: [] }));
  const full = reload();
  expect(T.task_new(full, { title: "C" }, "main", NOW)).toBe("The list has no ids left (the last is P999999999999999).");
  expect(full.tasks).toEqual([]);
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ tasks: [{ id: "P1000000000000000", title: "too long" }, { id: "P5", title: "ok", after: [3, 5, 1e300] }, { id: "P3", title: "x" }] }));
  const odd = reload();
  expect(odd.tasks.map((t) => t.id)).toEqual(["P5", "P3"]);
  expect(T.task_find(odd, "P5")!.after).toEqual(["P3"]);
});

test("the ✓ never says a bare 0 when some wait; the list says none to resolve now", () => {
  expect(View.tasks_count_said(2, 3)).toBe("2");
  expect(View.tasks_count_said(0, 3)).toBe("+3");
  expect(View.tasks_count_said(0, 0)).toBe("0");
  expect(View.tasks_none_said(0)).toBe("Nenhuma pendência aberta.");
  expect(View.tasks_none_said(2)).toBe("Nenhuma pendência para resolver agora.");
  const s = T.tasks_load(dir);
  add(s, { title: "A", who: "unii" });
  add(s, { title: "B", after: ["P1"] });
  T.task_edit(s, { id: "P1", detail: "x" }, NOW);
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW).filter((t) => t.id === "P2").concat(T.tasks_view(s, NOW).filter((t) => t.id === "P1"));
  expect(View.tasks_md(v)).toContain("**Pendências abertas (1)**");
  const only = View.view_new();
  only.tasks = [{ ...T.task_find(s, "P2")!, after: ["P9"] }, { ...T.task_find(s, "P1")!, id: "P9", after: ["P2"], state: "open" }];
  expect(View.tasks_md(only)).toContain("Nenhuma pendência para resolver agora.");
});
