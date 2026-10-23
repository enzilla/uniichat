// Modal.test
// ==========
// `bun test Modal.test.ts`: a task's window (Modal.ts): its keys as the
// acts they ask, by focus (a choice waits for its comment: Enter
// confirms, Esc skips it, Ctrl+C cancels; Tab writes about the task), and
// what it draws; the pending list opening it (Panel.ts).

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Modal from "./Modal.ts";
import * as Paint from "./Paint.ts";
import * as Panel from "./Panel.ts";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-modal-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

// P1: choices with what each means; P2: none; P3: done
function view(): View.View {
  T.tasks_forget();
  const s = T.tasks_load(fs.mkdtempSync(ROOT + "/chat-"));
  T.task_new(s, { title: "Qual ambiente usar?", detail: "Para o **teste de carga**.", ref: "hospitalar#644", choices: [{ label: "hom", description: "Ensaio, sem risco." }, { label: "prod", description: "Real, à noite." }] }, "main", NOW);
  T.task_new(s, { title: "Revisar o PR" }, "main", NOW);
  T.task_new(s, { title: "Backup" }, "main", NOW);
  T.task_resolve(s, "P3", "done", null, null, NOW);
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  return v;
}

const text = (lines: Paint.Line[]) => lines.map((l) => l.map((r) => r.x).join("")).join("\n");

test("a choice asks for its comment: Enter confirms it with the comment, Esc skips it, Ctrl+C cancels", () => {
  const v = view();
  const m = Modal.modal_new("P1");
  expect(Modal.modal_key(m, v, "2")).toBe(null);
  expect(m.focus).toBe("note");
  expect(Modal.modal_hint(m)).toStartWith("Escolher “prod”");
  expect(Modal.modal_enter(m, "  só depois das 22h ")).toEqual({ $: "act", act: { $: "Task", task: "P1", state: "done", answer: "prod", note: "só depois das 22h", go: false } });
  expect(m.focus).toBe("acts");
  Modal.modal_key(m, v, "1");
  expect(Modal.modal_back(m, "Esc")).toEqual({ $: "act", act: { $: "Task", task: "P1", state: "done", answer: "hom", go: false } });
  Modal.modal_key(m, v, "1");
  expect(Modal.modal_back(m, "Ctrl+C")).toBe(null);
  expect([m.focus, m.pick]).toEqual(["acts", null]);
});

test("! before a choice tells Unii now; a number out of range, or Enter where there are choices, only says so", () => {
  const v = view();
  const m = Modal.modal_new("P1");
  expect(Modal.modal_key(m, v, "!")?.$).toBe("note");
  Modal.modal_key(m, v, "1");
  expect(Modal.modal_enter(m, "")).toEqual({ $: "act", act: { $: "Task", task: "P1", state: "done", answer: "hom", go: true } });
  expect(Modal.modal_key(m, v, "3")?.$).toBe("note");
  expect(Modal.modal_key(m, v, "Enter")?.$).toBe("note");
  expect(m.focus).toBe("acts");
});

test("without choices Enter marks it done, d drops it (each with a comment); a closed one reopens; Esc closes", () => {
  const v = view();
  const m = Modal.modal_new("P2");
  Modal.modal_key(m, v, "Enter");
  expect(Modal.modal_enter(m, "feito")).toEqual({ $: "act", act: { $: "Task", task: "P2", state: "done", note: "feito", go: false } });
  Modal.modal_key(m, v, "d");
  expect(Modal.modal_back(m, "Esc")).toEqual({ $: "act", act: { $: "Task", task: "P2", state: "dropped", go: false } });
  expect(Modal.modal_key(Modal.modal_new("P3"), v, "r")).toEqual({ $: "act", act: { $: "Task", task: "P3", state: "open" } });
  expect(Modal.modal_key(Modal.modal_new("P3"), v, "Enter")).toEqual({ $: "act", act: { $: "Task", task: "P3", state: "open" } });
  expect(Modal.modal_key(m, v, "Esc")).toEqual({ $: "close" });
});

test("Tab writes about the task: Enter sends the message with its task, nothing for none; Esc back to the acts", () => {
  const v = view();
  const m = Modal.modal_new("P1");
  Modal.modal_key(m, v, "Tab");
  expect(m.focus).toBe("talk");
  expect(Modal.modal_enter(m, "qual a diferença?")).toEqual({ $: "act", act: { $: "Send", text: "qual a diferença?", task: "P1" } });
  expect(Modal.modal_enter(m, "  ")).toBe(null);
  expect(Modal.modal_back(m, "Esc")).toBe(null);
  expect(m.focus).toBe("acts");
});

test("it draws the task whole, each choice with what it means, and its thread without the marks", () => {
  const v = view();
  v.whole = new Map<number, View.Entry>([
    [1, { kind: "user", text: View.task_mark(v.tasks[0]) + "\nqual a diferença?" }],
    [2, { kind: "unii", text: "hom é o ensaio." }],
  ]);
  v.threads = { P1: [2] };
  const all = text(Modal.modal_lines(Modal.modal_new("P1"), v, 70));
  expect(all).toContain("P1 Qual ambiente usar?");
  expect(all).toContain("aberta · com você · hospitalar#644");
  expect(all).toContain("teste de carga");
  expect(all).toContain("1  hom");
  expect(all).toContain("Ensaio, sem risco.");
  expect(all).toContain("Conversa (2)");
  expect(all).toContain("qual a diferença?");
  expect(all).toContain("hom é o ensaio.");
  expect(all).not.toContain("[Sobre a pendência");
  expect(text(Modal.modal_lines(Modal.modal_new("P2"), v, 70))).toContain("Nenhuma mensagem sobre esta pendência ainda.");
});

test("the pending list opens a task's window by Enter, o or a click on its title; space still marks it", () => {
  const v = view();
  const p = Panel.panel_new();
  expect(Panel.panel_key(p, v, "Enter")).toEqual({ $: "open", task: "P1" });
  expect(Panel.panel_key(p, v, "o")).toEqual({ $: "open", task: "P1" });
  expect(Panel.panel_key({ ...Panel.panel_new(), sel: "P2" }, v, " ")).toEqual({ $: "act", act: { $: "Task", task: "P2", state: "done", go: false } });
  Panel.panel_frame(p, v, [], [], 120, 30);
  const [row, hit] = [...p.hits].find(([, h]) => h.id === "P2" && h.box > 0)!;
  expect(Panel.panel_mouse(p, v, "Mouse:0:" + (hit.box + 4) + ":" + row + ":M")).toEqual({ $: "open", task: "P2" });
});
