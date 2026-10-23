// TaskHtml.test
// =============
// `bun test TaskHtml.test.ts`: the web's task window (Html.ts
// task_window_html): the task's item as the list makes it, whole (its
// detail shown, its fields with the draft, its thread open), and the
// list's title opening it.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";
import * as Html from "./web/src/Html.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-taskhtml-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function tasks(): T.Task[] {
  T.tasks_forget();
  const s = T.tasks_load(fs.mkdtempSync(ROOT + "/chat-"));
  T.task_new(s, { title: "Janela de deploy", detail: "Depois do **PR 644**.", fields: [
    { id: "amb", label: "Ambiente", kind: "choice", choices: ["hom", "prod"] },
    { id: "obs", label: "Observação", kind: "text", required: false },
  ] }, "main", NOW);
  T.task_draft(s, "P1", { amb: "prod" });
  T.task_say(s, "P1", "qual a janela?", NOW);
  return T.tasks_view(s, NOW);
}

test("the list's title opens the window; the window holds the item whole: detail shown, draft checked, thread open", () => {
  const ts = tasks();
  expect(Html.tasks_html(ts).now[0]).toContain(`data-open="P1"`);
  const win = Html.task_window_html(ts, "P1");
  expect(win).toContain(`id="task-title"`);
  expect(win).not.toContain("<summary>Detalhes</summary>");
  expect(win).toContain("<strong>PR 644</strong>");
  expect(win).toMatch(/value="prod" checked/);
  expect(win).toMatch(/<details class="thread" data-keep="thread" open>/);
  expect(win).toContain("qual a janela?");
  expect(win).toContain(`data-keep="note"`);
});

test("a task no longer listed says so", () => {
  expect(Html.task_window_html(tasks(), "P9")).toContain("A pendência P9 não está mais na lista.");
});
