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

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-tasks-tools-");
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

let changes = 0;
const tools = { mem: { dir: DIR }, agents: new Map([["SmoothCow", {}]]), hooks: { change: () => (changes += 1) } } as unknown as Kit;
const call = (name: string, args: object, who = "main") => Tools.call(tools, who, name, args, new AbortController().signal, "x");

test("only the master has the tools", () => {
  const names = (who: string) => Tools.list(tools, who).map((s) => s.name);
  for (const name of ["task_add", "task_edit", "tasks"]) {
    expect(names("main")).toContain(name);
    expect(names("SmoothCow")).not.toContain(name);
  }
});

test("add, edit, list; each change told to the views; tasks.json kept", async () => {
  const add = await call("task_add", { title: "Abrir PR no fork?", choices: ["sim", "não"], ref: "uniichat", detail: "[PR](https://github.com/morum/uniichat/pull/2)" });
  expect(add).toEqual({ text: "Added P1 [user] Abrir PR no fork? options: sim | não (ref uniichat, 0m)", fail: false });
  expect(changes).toBe(1);
  const twin = await call("task_add", { title: "abrir pr no fork?" });
  expect(twin.fail).toBe(true);
  expect(changes).toBe(1);
  const edit = await call("task_edit", { id: "P1", state: "done", answer: "sim", note: "mesclado" });
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
