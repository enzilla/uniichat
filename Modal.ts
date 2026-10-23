// Modal
// =====
// A task's window on the full screen (Term.ts): the task whole (its
// state, who is responsible, where it came from, ref, what it waits for
// and frees, its detail as Markdown), what it asks (its choices and its
// fields, each answer kept as a draft as it is given, Tasks.task_draft)
// and its thread (Tasks.Talk, kept with the task: it outlives the chat's
// summaries; whose turn it is in it), over the chat, the pending list
// still beside it. Its keys, by focus: acts (Up and Down go along what it
// asks; 1-9 picks a choice, a field's choice or toggles one of many, s
// and n answer yes or no, Enter on a text field writes it; Enter marks
// the task done, ! done and Unii told now, d drops, r reopens, Tab
// writes about it, Esc closes); note (a resolution picked waits for its
// comment, optional: Enter confirms, Esc skips it, Ctrl+C cancels);
// field (a text field's answer: Enter keeps it, Esc leaves it as it was);
// talk (a message about the task, its thread's: Enter, Tab or Esc back to
// the acts). Each act is the web's (View.Act Task, TaskDraft, TaskSay).

import type { Field, Task, Value } from "./Tasks.ts";
import * as Tasks from "./Tasks.ts";
import * as Deps from "./TaskDeps.ts";
import * as Paint from "./Paint.ts";
import * as Theme from "./Theme.ts";
import * as View from "./View.ts";

// Types
// =====

// the task shown, the focus, the row of what it asks the keys answer
// (its choices first, if any, then each field), the resolution waiting
// for its comment, and whether the next choice tells Unii now (! before
// a digit)
export type Modal = { task: string; focus: "acts" | "note" | "field" | "talk"; row: number; pick: Pick | null; go: boolean };

// a resolution picked, its comment yet to come
type Pick = { state: Task["state"]; answer?: string; go: boolean };

// a row of what a task asks: its choices, or one of its fields
type Row = { $: "choices" } | { $: "field"; f: Field };

// what a key asks of Term.ts: an act, a note, a text put in the input,
// the window closed
export type Out = { $: "act"; act: View.Act } | { $: "note"; text: string } | { $: "fill"; text: string } | { $: "close" };

// Constants
// =========

const BOLD = { ...Paint.INK, b: true };
const STATE: Record<Task["state"], string> = { open: "aberta", done: "concluída", dropped: "descartada" };
const KIND: Record<Field["kind"], string> = { choice: "uma opção", multi: "várias opções", text: "texto", yesno: "sim ou não" };

// the input's hint, by focus
export const HINTS = {
  acts  : "↑↓ campo · 1-9 responde · Enter conclui · ! conclui e avisa · d descarta · r reabre · Tab escreve · Esc fecha",
  note  : "Comentário ou justificativa (opcional) · Enter confirma · Esc pula · Ctrl+C cancela",
  field : "Resposta do campo · Enter guarda no rascunho · Esc deixa como estava",
  talk  : "Mensagem sobre a pendência · Enter envia · Tab ou Esc volta às ações",
};

// Modal
// =====

export function modal_new(task: string): Modal {
  return { task, focus: "acts", row: 0, pick: null, go: false };
}

// the task shown, if still listed
export function modal_task(m: Modal, v: View.View): Task | null {
  return v.tasks.find((t) => t.id === m.task) ?? null;
}

// what a task asks, row by row
function rows(t: Task): Row[] {
  return [...(t.choices.length === 0 ? [] : [{ $: "choices" as const }]), ...t.fields.map((f): Row => ({ $: "field", f }))];
}

// the row the keys answer, kept within the task's
function row(m: Modal, t: Task): Row | null {
  const all = rows(t);
  m.row = Math.max(0, Math.min(m.row, all.length - 1));
  return all[m.row] ?? null;
}

// Keys
// ----

// a key while the acts have the focus (null: done here; undefined: not
// the window's)
export function modal_key(m: Modal, v: View.View, key: string): Out | null | undefined {
  const t = modal_task(m, v);
  if (key === "Esc") {
    return { $: "close" };
  }
  if (key === "Tab") {
    m.focus = "talk";
    return null;
  }
  if (t === null) {
    return /^[1-9!drsn]$|^Enter$/.test(key) ? { $: "note", text: "A pendência " + m.task + " não está mais na lista." } : undefined;
  }
  const open = t.state === "open";
  const r = row(m, t);
  if (key === "Up" || key === "Down") {
    m.row += key === "Up" ? -1 : 1;
    row(m, t);
    return null;
  }
  if (open && r?.$ === "field" && (/^[1-9sn]$/.test(key) || (key === "Enter" && r.f.kind === "text"))) {
    return field_key(m, t, r.f, key);
  }
  const n = t.choices.length;
  const pick = (p: Pick): null => {
    [m.pick, m.focus, m.go] = [p, "note", false];
    return null;
  };
  // concluding: the required fields first all answered (Tasks.task_resolve
  // refuses it too; said here before the comment is asked)
  const ready = (go: boolean): Out | null => {
    const missing = Tasks.fields_missing(t, t.draft);
    return missing.length > 0 ? { $: "note", text: "Responda " + (missing.length === 1 ? "o campo obrigatório" : "os campos obrigatórios") + " antes de concluir: " + missing.map((f) => "“" + f.label + "”").join(", ") + "." } : pick({ state: "done", go });
  };
  if (/^[1-9]$/.test(key) && open) {
    const k = Number(key);
    if (k > n) {
      return { $: "note", text: n === 0 ? "A pendência " + t.id + " não tem opções: Enter a conclui." : "A pendência " + t.id + " tem as opções 1 a " + n + "." };
    }
    const missing = Tasks.fields_missing(t, t.draft);
    return missing.length > 0 ? ready(false) : pick({ state: "done", answer: t.choices[k - 1], go: m.go });
  }
  switch (key) {
    case "Enter": {
      if (!open) {
        return { $: "act", act: { $: "Task", task: t.id, state: "open" } };
      }
      return n === 0 ? ready(false) : { $: "note", text: "Escolha a opção com 1 a " + n + (rows(t).length > 1 ? " (na linha das opções: ↑↓)" : "") + "." };
    }
    case "!": {
      if (!open) {
        return undefined;
      }
      if (n === 0) {
        return ready(true);
      }
      m.go = true;
      return { $: "note", text: "Escolha a opção com 1 a " + n + "; o Unii será avisado em seguida." };
    }
    case "d": {
      return open ? pick({ state: "dropped", go: false }) : undefined;
    }
    case "r": {
      return open ? undefined : { $: "act", act: { $: "Task", task: t.id, state: "open" } };
    }
  }
  return undefined;
}

// a key on a field's row: a choice (1-9), one of many toggled, yes or no
// (s, n, 1, 2), each kept as the draft at once; Enter on a text field
// writes it, its answer so far in the input
function field_key(m: Modal, t: Task, f: Field, key: string): Out | null {
  const now = t.draft[f.id];
  const draft = (value: Value): Out => ({ $: "act", act: { $: "TaskDraft", task: t.id, fields: { [f.id]: value } } });
  if (f.kind === "text") {
    if (key !== "Enter") {
      return { $: "note", text: "“" + f.label + "” é um texto: Enter o escreve." };
    }
    m.focus = "field";
    return { $: "fill", text: typeof now === "string" ? now : "" };
  }
  const options = f.kind === "yesno" ? ["sim", "não"] : f.choices;
  const k = key === "s" ? 1 : key === "n" ? 2 : Number(key);
  if ((f.kind !== "yesno" && !/^[1-9]$/.test(key)) || k > options.length) {
    return { $: "note", text: "“" + f.label + "” tem as opções 1 a " + options.length + (f.kind === "yesno" ? " (s ou n)" : "") + "." };
  }
  const got = options[k - 1];
  if (f.kind !== "multi") {
    return draft(got);
  }
  const had = Array.isArray(now) ? now : [];
  return draft(had.includes(got) ? had.filter((x) => x !== got) : [...had, got]);
}

// Enter in the note, field or talk focus, with the input's text: the
// resolution with its comment, the text field's answer, or the message
// about the task
export function modal_enter(m: Modal, v: View.View, text: string): Out | null {
  if (m.focus === "talk") {
    return text.trim() === "" ? null : { $: "act", act: { $: "TaskSay", task: m.task, text } };
  }
  if (m.focus === "field") {
    m.focus = "acts";
    const t = modal_task(m, v);
    const r = t === null ? null : row(m, t);
    return t === null || r?.$ !== "field" ? null : { $: "act", act: { $: "TaskDraft", task: t.id, fields: { [r.f.id]: text.trim() } } };
  }
  return modal_resolve(m, text);
}

// Esc in the note focus skips the comment (the resolution goes without
// it); in the field and talk focus, back to the acts. Ctrl+C in the note
// focus cancels the resolution
export function modal_back(m: Modal, key: "Esc" | "Ctrl+C"): Out | null {
  if (m.focus === "note" && key === "Esc") {
    return modal_resolve(m, "");
  }
  [m.focus, m.pick] = ["acts", null];
  return null;
}

function modal_resolve(m: Modal, note: string): Out | null {
  const p = m.pick;
  [m.focus, m.pick] = ["acts", null];
  if (p === null) {
    return null;
  }
  return { $: "act", act: { $: "Task", task: m.task, state: p.state, ...(p.answer === undefined ? {} : { answer: p.answer }), ...(note.trim() === "" ? {} : { note: note.trim() }), go: p.go } };
}

// the input's hint now, the resolution picked named in it
export function modal_hint(m: Modal): string {
  if (m.focus !== "note" || m.pick === null) {
    return HINTS[m.focus];
  }
  const what = m.pick.state === "dropped" ? "Descartar" : m.pick.answer === undefined ? "Concluir" : "Escolher “" + m.pick.answer + "”";
  return what + (m.pick.go ? " e avisar o Unii" : "") + " · " + HINTS.note;
}

// Drawing
// -------

// the window's lines, w wide: the task's head (its id and title, its
// state and the rest of what to know), its detail, its choices and
// fields (the row the keys answer marked; a field's options under it),
// its thread
export function modal_lines(m: Modal, v: View.View, w: number): Paint.Line[] {
  const t = modal_task(m, v);
  if (t === null) {
    return [[Paint.Run("A pendência " + m.task + " não está mais na lista. Esc fecha.", Paint.DIM)]];
  }
  const open = t.state === "open";
  const rule = [Paint.Run("─".repeat(Math.max(0, w)), Paint.DIM)];
  const head = Paint.runs_wrap([Paint.Run(t.id + " ", { ...BOLD, c: Theme.ANSI.id }), Paint.Run(Paint.text_clean(t.title), BOLD)], w, false);
  const waits = Deps.waits(v.tasks, t);
  const frees = View.task_frees_said(v, t);
  const origin = View.origin_said(t);
  const meta = [STATE[t.state], t.assignee === "user" ? "com você" : t.assignee === "unii" ? "com o Unii" : "com " + t.assignee, ...(t.ref === null ? [] : [t.ref]), ...(origin === "" ? [] : ["origem: " + origin]), ...(open && waits.length > 0 ? ["aguarda " + waits.join(", ")] : []), ...(frees === "" ? [] : [frees])];
  const said = [...(t.answer === null ? [] : ["Resposta: " + t.answer]), ...(t.answers === null ? [] : [Tasks.values_said(t.fields, t.answers)].filter((x) => x !== "")), ...(t.note === null ? [] : ["Comentário: “" + t.note + "”"])];
  const md = (text: string) => Paint.rows_lines(View.entry_rows(null, "unii", text), w);
  const detail = t.detail === "" ? [] : [[], ...md(t.detail)];
  row(m, t);
  const here = (k: number) => open && rows(t).length > 1 && m.row === k;
  const asks = rows(t).flatMap((r, k) => (r.$ === "choices" ? choices_lines(m, t, here(k), w) : field_lines(t, r.f, here(k), w)));
  const talk = View.task_talk_said(t);
  const thread = t.thread.length === 0
    ? [[Paint.Run("Nenhuma mensagem sobre esta pendência ainda. Tab escreve uma; o Unii responde aqui e no chat.", Paint.DIM)]]
    : t.thread.flatMap((x, k) => [...(k === 0 ? [] : [[] as Paint.Line]), [Paint.Run(x.who === "user" ? "Você" : "Unii", { ...BOLD, c: x.who === "user" ? Theme.ANSI.you : Theme.ANSI.tool })], ...(x.who === "unii" ? md(x.text) : Paint.runs_wrap([Paint.Run(Paint.text_clean(x.text))], w, false))]);
  return [
    ...head,
    ...Paint.runs_wrap([Paint.Run(meta.join(" · "), Paint.DIM)], w, false),
    ...(said.length === 0 ? [] : Paint.runs_wrap([Paint.Run(Paint.text_clean(said.join(" · ")), { ...Paint.INK, c: Theme.ANSI.done })], w, false)),
    rule,
    ...detail,
    ...asks,
    [],
    [Paint.Run("Conversa" + (t.thread.length === 0 ? "" : " (" + t.thread.length + ")"), BOLD), ...(talk === "" ? [] : [Paint.Run(" · " + talk, { ...Paint.INK, c: t.talk === "user" ? Theme.ANSI.here : Theme.ANSI.effort })])],
    ...thread,
  ];
}

// the task's choices: a head (marked if the keys answer it), each choice
// numbered (the one picked or the answer marked)
function choices_lines(m: Modal, t: Task, here: boolean, w: number): Paint.Line[] {
  const head = [Paint.Run((here ? "▸ " : "") + (t.state === "open" ? "Opções" : "Opções oferecidas"), BOLD)];
  return [[], head, ...t.choices.flatMap((c, k) => option_lines(k, c, t.descriptions[k] ?? "", m.pick?.answer === c || t.answer === c, w))];
}

// a field: its label, kind and whether required, its answer in the draft
// (or as concluded); its options, numbered, the ones given marked
function field_lines(t: Task, f: Field, here: boolean, w: number): Paint.Line[] {
  const value = t.answers?.[f.id] ?? t.draft[f.id];
  const given = (o: string) => (Array.isArray(value) ? value.includes(o) : value === o);
  const head = Paint.runs_wrap([Paint.Run((here ? "▸ " : "") + Paint.text_clean(f.label), BOLD), Paint.Run((f.required ? " *" : "") + " · " + KIND[f.kind], f.required ? { ...Paint.INK, c: Theme.ANSI.off } : Paint.DIM)], w, false);
  const options = f.kind === "yesno" ? ["sim", "não"] : f.choices;
  const text = f.kind !== "text" ? [] : [[Paint.Run("     " + (typeof value === "string" && value !== "" ? "“" + Paint.text_clean(value) + "”" : "(sem resposta: Enter escreve)"), typeof value === "string" && value !== "" ? { ...Paint.INK, c: Theme.ANSI.done } : Paint.DIM)]];
  return [[], ...head, ...options.flatMap((o, k) => option_lines(k, o, f.descriptions[k] ?? "", given(o), w, f.kind === "multi")), ...text];
}

// an option's lines: its number and label, bold and marked if given;
// what picking it means under it, dimmed and wrapped
function option_lines(k: number, label: string, means: string, given: boolean, w: number, many = false): Paint.Line[] {
  const mark = Paint.Run((many ? (given ? "  [x] " : "  [ ] ") : given ? "▸ " : "  ") + (k + 1) + "  ", { ...BOLD, c: Theme.ANSI.cmd });
  const pad = Paint.Run(" ".repeat(many ? 9 : 5));
  const under = means === "" ? [] : Paint.runs_wrap([Paint.Run(Paint.text_clean(means), Paint.DIM)], Math.max(4, w - pad.x.length), false).map((l) => [pad, ...l]);
  return [Paint.runs_wrap([mark, Paint.Run(Paint.text_clean(label), given ? { ...BOLD, c: Theme.ANSI.done } : BOLD)], w, true)[0], ...under];
}
