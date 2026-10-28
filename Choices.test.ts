// Choices.test
// ============
// `bun test Choices.test.ts`: what each answer offered means (Tasks.ts
// descriptions, by place): given as { label, description } or a bare
// label, for a task's choices and its fields' alike; kept apart from the
// labels, so a tasks.json without them reads as before; said in Unii's
// block, the terminal's window and the web's.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Modal from "./Modal.ts";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Render.tsx";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-choices-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function store(): T.Store {
  T.tasks_forget();
  return T.tasks_load(fs.mkdtempSync(ROOT + "/chat-"));
}

function add(s: T.Store, args: T.Edit): T.Task {
  const t = T.task_new(s, args, "main", NOW);
  if (typeof t === "string") {
    throw new Error(t);
  }
  return t;
}

test("choices and a field's choices take { label, description } or a bare label; the labels stay the answers", () => {
  const s = store();
  const t = add(s, { title: "Ambiente", choices: [{ label: "hom", description: "Ensaio, sem risco." }, "prod"], fields: [
    { id: "times", label: "Times", kind: "multi", choices: [{ label: "infra", description: "Quem reinicia." }, { label: "suporte" }], required: false },
  ] });
  expect([t.choices, t.descriptions]).toEqual([["hom", "prod"], ["Ensaio, sem risco.", ""]]);
  expect([t.fields[0].choices, t.fields[0].descriptions]).toEqual([["infra", "suporte"], ["Quem reinicia.", ""]]);
  expect(add(s, { title: "Sem", choices: ["sim", "não"] }).descriptions).toEqual([]);
  expect(T.task_resolve(s, t.id, "done", "hom", null, NOW)).toMatchObject({ answer: "hom" });
});

test("kept in tasks.json and read again; a tasks.json without descriptions reads with none", () => {
  const s = store();
  add(s, { title: "Ambiente", choices: [{ label: "hom", description: "Ensaio." }, { label: "prod", description: "Real." }] });
  T.tasks_forget();
  expect(T.tasks_load(s.dir).tasks[0].descriptions).toEqual(["Ensaio.", "Real."]);
  const dir = fs.mkdtempSync(ROOT + "/old-");
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 2, rev: 0, tasks: [{ id: "P1", title: "Antiga", state: "open", choices: ["a", "b"], fields: [{ id: "x", label: "X", kind: "choice", choices: ["c", "d"] }] }] }));
  T.tasks_forget();
  const old = T.tasks_load(dir).tasks[0];
  expect([old.choices, old.descriptions, old.fields[0].descriptions]).toEqual([["a", "b"], [], []]);
});

test("Unii reads them in the block; the terminal's window and the web's Mesa show them under each label", () => {
  const s = store();
  add(s, { title: "Ambiente", choices: [{ label: "hom", description: "Ensaio, sem risco." }, "prod"], fields: [
    { id: "amb", label: "Onde", kind: "choice", choices: [{ label: "a", description: "Primeiro." }, "b"] },
  ] });
  expect(T.tasks_block(s, NOW)).toContain("options: hom (Ensaio, sem risco.) | prod");
  expect(T.tasks_block(s, NOW)).toContain("choice: a (Primeiro.) | b");
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  const shown = Modal.modal_lines(Modal.modal_new("P1"), v, 80).map((l) => l.map((r) => r.x).join("")).join("\n");
  expect(shown).toContain("Ensaio, sem risco.");
  expect(shown).toContain("Primeiro.");
  const html = Html.desk_html(v.tasks, "", "", "P1", NOW).detail.join("");
  expect(html).toContain("<small>Ensaio, sem risco.</small>");
  expect(html).toContain("<small>Primeiro.</small>");
});
