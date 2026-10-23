// Choices.test
// ============
// `bun test Choices.test.ts`: a task's answers offered with what each
// means (Tasks.ts): given as { label, description } or as bare labels,
// kept as choices and hints by place, read back from tasks.json (an older
// one, without hints, too), and shown to Unii in its lines and block.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-choices-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");
let dir    = "";

beforeEach(() => {
  T.tasks_forget();
  dir = fs.mkdtempSync(ROOT + "/chat-");
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function add(s: T.Store, args: T.Edit): T.Task {
  const t = T.task_new(s, args, "main", NOW);
  if (typeof t === "string") {
    throw new Error(t);
  }
  return t;
}

test("choices with descriptions and bare labels, alike: kept as answers and hints by place; a label twice keeps the first", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "Qual ambiente?", choices: [{ label: "hom", description: "Ensaio, sem risco." }, "prod", { label: "hom", description: "outra" }] });
  expect(t.choices).toEqual(["hom", "prod"]);
  expect(t.hints).toEqual(["Ensaio, sem risco.", ""]);
  expect(add(s, { title: "Sim ou não?", choices: ["sim", "não"] }).hints).toEqual(["", ""]);
  expect(T.task_new(s, { title: "x", choices: "sim" }, "main", NOW)).toContain("label, description");
});

test("an edit's choices replace both; the answer is still a label", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "Qual ambiente?", choices: ["hom"] });
  const e = T.task_edit(s, { id: t.id, choices: [{ label: "local", description: "No notebook." }] }, NOW) as T.Task;
  expect([e.choices, e.hints]).toEqual([["local"], ["No notebook."]]);
  expect(T.task_resolve(s, t.id, "done", "local", "pode", NOW)).not.toBeTypeOf("string");
});

test("tasks.json keeps the hints; an older one, without them, reads with none", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Qual ambiente?", choices: [{ label: "hom", description: "Ensaio." }, "prod"] });
  T.tasks_save(s);
  T.tasks_forget();
  expect(T.tasks_load(dir).tasks[0].hints).toEqual(["Ensaio.", ""]);
  const old = { id: "P1", title: "Antiga", state: "open", choices: ["sim", "não"] };
  expect(T.task_read(old, NOW)?.hints).toEqual(["", ""]);
});

test("Unii reads each choice with what it means, in a task's line and in the turn's block", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "Qual ambiente?", choices: [{ label: "hom", description: "Ensaio." }, "prod"] });
  expect(T.task_line(t, NOW)).toContain("options: hom (Ensaio.) | prod");
  expect(T.tasks_block(s, NOW)).toContain("hom (Ensaio.)");
});
