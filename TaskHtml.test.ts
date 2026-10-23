// TaskHtml.test
// =============
// `bun test TaskHtml.test.ts`: a task's window on the web (Html.task_html)
// and the list's title that opens it (Html.tasks_html).

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-taskhtml-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function view(): View.View {
  T.tasks_forget();
  const s = T.tasks_load(fs.mkdtempSync(ROOT + "/chat-"));
  T.task_new(s, { title: "Qual ambiente <usar>?", detail: "Para o **teste**.", ref: "hospitalar#644", choices: [{ label: "hom", description: "Ensaio, sem risco." }, "prod"] }, "main", NOW);
  T.task_new(s, { title: "Backup" }, "main", NOW);
  T.task_resolve(s, "P2", "done", null, "feito", NOW);
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  return v;
}

test("an open task's window: its head escaped, detail, each choice with what it means, the comment, its acts, its thread unmarked, its box", () => {
  const v = view();
  v.whole = new Map<number, View.Entry>([[1, { kind: "user", text: View.task_mark(v.tasks[0]) + "\nqual a diferença?" }], [2, { kind: "unii", text: "hom é o ensaio." }]]);
  v.threads = { P1: [2] };
  const html = Html.task_html(v, v.tasks[0]).join("\n");
  expect(html).toContain('id="task-title">Qual ambiente &lt;usar&gt;?');
  expect(html).toContain("Aberta · com você");
  expect(html).toContain("<strong>teste</strong>");
  expect(html).toContain('<b>hom</b><small>Ensaio, sem risco.</small>');
  expect(html).toContain('<b>prod</b></button>');
  expect(html).toContain('class="note"');
  expect(html).toContain("Avisar o Unii agora");
  expect(html).not.toContain(">Concluir<"); // with choices, a choice concludes it
  expect(html).toContain("Conversa (2)");
  expect(html).toContain("qual a diferença?");
  expect(html).not.toContain("Sobre a pendência");
  expect(html).toContain('id="task-say"');
});

test("a closed task's window: its answer and comment, Reabrir, no choices; the list's title opens a window", () => {
  const v = view();
  const html = Html.task_html(v, v.tasks.find((t) => t.id === "P2")!).join("\n");
  expect(html).toContain("Concluída");
  expect(html).toContain("Comentário: “feito”");
  expect(html).toContain(">Reabrir<");
  expect(html).not.toContain('class="opts"');
  expect(Html.tasks_html(v.tasks).open[0]).toContain('data-open="P1"');
});
