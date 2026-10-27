// Tasks.tools.test
// ================
// `bun test Tasks.tools.test.ts`: the pending list's tools (Tools.ts
// task_add, task_edit, tasks), only the master's, called as a call would,
// on a chat in a temporary dir.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Tasks from "./Tasks.ts";
import { Tools, type Tools as Kit } from "./Tools.ts";

// evidence that closes a task (the evidence round): a file that exists
const EV = { type: "file", path: import.meta.path };

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-tasks-tools-");
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

let changes = 0;
const tools = { mem: { dir: DIR }, agents: new Map([["SmoothCow", {}]]), log: { change: () => (changes += 1) } } as unknown as Kit;
// the evidence round: task_add needs done_when, and a task of Unii's its
// next_step; given here unless a test gives its own (TasksEvidence.test.ts
// tests them)
const ROUND = (name: string, args: any) => (name !== "task_add" ? args : { done_when: "feito", ...(String(args.assignee ?? args.who ?? "") === "unii" ? { next_step: "seguir" } : {}), ...args });
const call = (name: string, args: object, who = "main") => Tools.call(tools, who, name, ROUND(name, args), new AbortController().signal, "x");

test("only the master has the tools", () => {
  const names = (who: string) => Tools.list(who).map((s) => s.name);
  for (const name of ["task_add", "task_edit", "task_reply", "tasks"]) {
    expect(names("main")).toContain(name);
    expect(names("SmoothCow")).not.toContain(name);
  }
});

test("add, edit, list; each change told to the views; tasks.json kept", async () => {
  const add = await call("task_add", { title: "Abrir PR no fork?", origin: "chat", choices: ["sim", "não"], acts: { sim: "user", "não": "user" }, ref: "uniichat", ref_new: true, detail: "[PR](https://github.com/morum/uniichat/pull/2)", prs: [{ url: "https://github.com/morum/uniichat/pull/2", head: "739a8be" }] });
  expect(add).toEqual({ text: "Added P1 [user] Abrir PR no fork? options: sim | não (ref uniichat, from chat, pr https://github.com/morum/uniichat/pull/2 @739a8be pending, 0m)", fail: false });
  expect(changes).toBe(1);
  const twin = await call("task_add", { title: "abrir pr no fork?", origin: "chat" });
  expect(twin.fail).toBe(true);
  expect(changes).toBe(1);
  const edit = await call("task_edit", { id: "P1", state: "done", evidence: EV, answer: "sim", note: "mesclado" });
  expect(edit.text).toStartWith("Changed P1 [user] Abrir PR no fork? (done, answer: sim, note: \"mesclado\")");
  expect(changes).toBe(2);
  expect((await call("tasks", {})).text).toBe("No open tasks.");
  expect((await call("tasks", { all: true })).text).toContain("[PR](https://github.com/morum/uniichat/pull/2)");
  expect((await call("task_edit", { id: "P5" })).fail).toBe(true);
  const kept = JSON.parse(fs.readFileSync(DIR + "/tasks.json", "utf8"));
  expect(kept.next).toBe(2);
  expect(kept.tasks[0].by).toBe("main");
  expect(Tasks.tasks_untold(Tasks.tasks_load(DIR))).toEqual([]);
});

test("after through the tools: waits and frees said; a cycle refused, nothing changed", async () => {
  const a = await call("task_add", { title: "Salvar o token xoxp", origin: "chat" });
  const id = a.text.split(" ")[1];
  const b = await call("task_add", { title: "Ligar o MCP", origin: "chat", who: "unii", after: [id] });
  expect(b.text).toContain(" waits for " + id);
  const bid = b.text.split(" ")[1];
  const n = changes;
  const loop = await call("task_edit", { id, after: [bid] });
  expect(loop).toEqual({ text: bid + " waits for " + id + " already (directly or through others): " + id + " can't wait for it, a cycle.", fail: true });
  expect(changes).toBe(n);
  const list = (await call("tasks", {})).text;
  expect(list).toContain(id + " [user] Salvar o token xoxp frees " + bid);
  expect(list).toContain("Waiting for other tasks (hidden from the user until freed):\n- " + bid + " [unii] Ligar o MCP waits for " + id);
});

test("fields and the thread by the tools: added, refused when wrong, replied to, listed whole", async () => {
  const fields = [{ id: "amb", label: "Ambiente", kind: "choice", choices: ["hom", "prod"] }, { id: "obs", label: "Obs", kind: "text", required: false }];
  const add = await call("task_add", { title: "Aplicar onde?", origin: "chat", fields });
  expect(add.fail).toBe(false);
  expect(add.text).toContain("fields: amb* \"Ambiente\" (choice: hom | prod); obs \"Obs\" (text)");
  const id = add.text.split(" ")[1];
  expect((await call("task_add", { title: "Outra", origin: "chat", fields: [{ id: "x", label: "X", kind: "choice", choices: ["só"] }] })).text).toBe("Field x (choice) needs at least 2 choices.");
  expect((await call("task_edit", { id, fields: "nope" })).fail).toBe(true);
  const s = Tasks.tasks_load(DIR);
  Tasks.task_draft(s, id, { amb: "prod" });
  Tasks.task_say(s, id, "Por que prod?", Date.now());
  expect(await call("task_reply", { id, text: "Porque o hom já tem." })).toEqual({ text: "Replied in " + id + "'s thread; the user's turn there.", fail: false });
  expect((await call("task_reply", { id: "P999", text: "x" })).fail).toBe(true);
  const whole = (await call("tasks", { id })).text;
  expect(whole).toContain("draft (not sent yet): Ambiente: prod");
  expect(whole).toContain("thread (the user's turn):\n  user: Por que prod?\n  you: Porque o hom já tem.");
});
