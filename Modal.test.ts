// Modal.test
// ==========
// `bun test Modal.test.ts`: a task's window (Modal.ts): its keys as the
// acts they ask, by focus (a choice waits for its comment: Enter
// confirms, Esc skips it, Ctrl+C cancels; a field's answer kept as the
// draft; Tab writes about the task, in its thread), and what it draws;
// the pending list opening it (Panel.ts).

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

// P1: choices; P2: none; P3: done; P4: fields of each kind (the text one
// required), its thread with a message each
function view(): View.View {
  T.tasks_forget();
  const s = T.tasks_load(fs.mkdtempSync(ROOT + "/chat-"));
  T.task_new(s, { title: "Qual ambiente usar?", detail: "Para o **teste de carga**.", ref: "hospitalar#644", choices: ["hom", "prod"] }, "main", NOW);
  T.task_new(s, { title: "Revisar o PR" }, "main", NOW);
  T.task_new(s, { title: "Backup" }, "main", NOW);
  T.task_resolve(s, "P3", "done", null, null, NOW);
  T.task_new(s, { title: "Janela de deploy", fields: [
    { id: "amb", label: "Ambiente", kind: "choice", choices: ["hom", "prod"] },
    { id: "times", label: "Times avisados", kind: "multi", choices: ["infra", "produto", "suporte"], required: false },
    { id: "obs", label: "Observação", kind: "text" },
    { id: "ok", label: "Pode reiniciar?", kind: "yesno", required: false },
  ] }, "main", NOW);
  T.task_say(s, "P4", "qual janela é melhor?", NOW);
  T.task_reply(s, "P4", "Depois das **22h**.", NOW);
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
  expect(Modal.modal_enter(m, v, "  só depois das 22h ")).toEqual({ $: "act", act: { $: "Task", task: "P1", state: "done", answer: "prod", note: "só depois das 22h", go: false } });
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
  expect(Modal.modal_enter(m, v, "")).toEqual({ $: "act", act: { $: "Task", task: "P1", state: "done", answer: "hom", go: true } });
  expect(Modal.modal_key(m, v, "3")?.$).toBe("note");
  expect(Modal.modal_key(m, v, "Enter")?.$).toBe("note");
  expect(m.focus).toBe("acts");
});

test("without choices Enter marks it done, d drops it (each with a comment); a closed one reopens; Esc closes", () => {
  const v = view();
  const m = Modal.modal_new("P2");
  Modal.modal_key(m, v, "Enter");
  expect(Modal.modal_enter(m, v, "feito")).toEqual({ $: "act", act: { $: "Task", task: "P2", state: "done", note: "feito", go: false } });
  Modal.modal_key(m, v, "d");
  expect(Modal.modal_back(m, "Esc")).toEqual({ $: "act", act: { $: "Task", task: "P2", state: "dropped", go: false } });
  expect(Modal.modal_key(Modal.modal_new("P3"), v, "r")).toEqual({ $: "act", act: { $: "Task", task: "P3", state: "open" } });
  expect(Modal.modal_key(Modal.modal_new("P3"), v, "Enter")).toEqual({ $: "act", act: { $: "Task", task: "P3", state: "open" } });
  expect(Modal.modal_key(m, v, "Esc")).toEqual({ $: "close" });
});

test("Tab writes about the task: Enter sends the message to its thread, nothing for none; Esc back to the acts", () => {
  const v = view();
  const m = Modal.modal_new("P1");
  Modal.modal_key(m, v, "Tab");
  expect(m.focus).toBe("talk");
  expect(Modal.modal_enter(m, v, "qual a diferença?")).toEqual({ $: "act", act: { $: "TaskSay", task: "P1", text: "qual a diferença?" } });
  expect(Modal.modal_enter(m, v, "  ")).toBe(null);
  expect(Modal.modal_back(m, "Esc")).toBe(null);
  expect(m.focus).toBe("acts");
});

test("it draws the task whole and its choices", () => {
  const v = view();
  const all = text(Modal.modal_lines(Modal.modal_new("P1"), v, 70));
  expect(all).toContain("P1 Qual ambiente usar?");
  expect(all).toContain("aberta · com você · hospitalar#644");
  expect(all).toContain("teste de carga");
  expect(all).toContain("1  hom");
  expect(text(Modal.modal_lines(Modal.modal_new("P2"), v, 70))).toContain("Nenhuma mensagem sobre esta pendência ainda.");
});

test("a field's answer is kept as the draft at once: a choice, one of many toggled, yes or no, a text by Enter", () => {
  const v = view();
  const m = Modal.modal_new("P4");
  const draft = (fields: object) => ({ $: "act", act: { $: "TaskDraft", task: "P4", fields } });
  expect(Modal.modal_key(m, v, "2")).toEqual(draft({ amb: "prod" }));
  Modal.modal_key(m, v, "Down");
  expect(Modal.modal_key(m, v, "3")).toEqual(draft({ times: ["suporte"] }));
  v.tasks.find((t) => t.id === "P4")!.draft = { times: ["suporte", "infra"] };
  expect(Modal.modal_key(m, v, "3")).toEqual(draft({ times: ["infra"] }));
  Modal.modal_key(m, v, "Down");
  expect(Modal.modal_key(m, v, "Enter")).toEqual({ $: "fill", text: "" });
  expect(m.focus).toBe("field");
  expect(Modal.modal_enter(m, v, " só à noite ")).toEqual(draft({ obs: "só à noite" }));
  expect(m.focus).toBe("acts");
  Modal.modal_key(m, v, "Down");
  expect(Modal.modal_key(m, v, "n")).toEqual(draft({ ok: "não" }));
  expect(Modal.modal_key(m, v, "5")?.$).toBe("note");
  Modal.modal_key(m, v, "Down");
  expect(m.row).toBe(3);
});

test("concluding waits for the required fields, then asks the comment; the draft goes as the answers", () => {
  const v = view();
  const m = Modal.modal_new("P4");
  const missing = Modal.modal_key(m, v, "Enter");
  expect(missing?.$).toBe("note");
  expect(missing?.$ === "note" && missing.text).toContain("“Ambiente”, “Observação”");
  expect(m.focus).toBe("acts");
  v.tasks.find((t) => t.id === "P4")!.draft = { amb: "hom", obs: "ok" };
  expect(Modal.modal_key(m, v, "!")).toBe(null);
  expect(Modal.modal_enter(m, v, "combinado")).toEqual({ $: "act", act: { $: "Task", task: "P4", state: "done", note: "combinado", go: true } });
});

test("it draws the fields (required marked, answers given), the thread kept with the task and whose turn it is", () => {
  const v = view();
  v.tasks.find((t) => t.id === "P4")!.draft = { amb: "prod", times: ["infra"] };
  const all = text(Modal.modal_lines(Modal.modal_new("P4"), v, 80));
  expect(all).toContain("▸ Ambiente * · uma opção");
  expect(all).toContain("▸ 2  prod");
  expect(all).toContain("[x] 1  infra");
  expect(all).toContain("Observação * · texto");
  expect(all).toContain("(sem resposta: Enter escreve)");
  expect(all).toContain("Conversa (2) · sua vez");
  expect(all).toContain("qual janela é melhor?");
  expect(all).toContain("Depois das 22h.");
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

test("as a drawer it says what it asks in a line and fits its room: the choices first, the detail and the thread as room is left", () => {
  const v = view();
  const one = Modal.modal_drawer(Modal.modal_new("P1"), v, 70, 12);
  expect(one.length).toBeLessThanOrEqual(12);
  expect(text(one)).toContain("P1  Qual ambiente usar?");
  expect(text(one)).toContain("Escolha uma das 2 opções.");
  expect(text(one)).toContain("1  hom");
  expect(text(one)).toContain("teste de carga");
  const four = Modal.modal_drawer(Modal.modal_new("P4"), v, 70, 40);
  expect(text(four)).toContain("Responda às 2 perguntas e conclua.");
  expect(text(four)).toContain("Conversa (2)");
  expect(text(four)).toContain("Depois das");
  const small = Modal.modal_drawer(Modal.modal_new("P4"), v, 70, 8);
  expect(small.length).toBeLessThanOrEqual(8);
  expect(text(small)).toContain("/p P4 mostra tudo");
  expect(text(small)).not.toContain("Conversa");
});
