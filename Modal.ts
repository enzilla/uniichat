// Modal
// =====
// A task's window on the full screen (Term.ts): the task whole (its
// state, who acts, ref, what it waits for and frees, its detail as
// Markdown, its choices with what each means) and its thread (View.
// task_thread: the messages about it and Unii's answers), over the chat,
// the pending list still beside it. Its keys, by focus: acts (1-9 picks a
// choice, Enter marks it done, ! done and Unii told now, d drops, r
// reopens, Tab writes, Esc closes); note (a resolution picked waits for
// its comment, optional: Enter confirms, Esc skips it, Ctrl+C cancels);
// talk (the input sends a message about the task: Enter, Tab or Esc back
// to the acts). Each act is the web's (View.Act Task, Send with its task).

import type { Task } from "./Tasks.ts";
import * as Deps from "./TaskDeps.ts";
import * as Paint from "./Paint.ts";
import * as Theme from "./Theme.ts";
import * as View from "./View.ts";

// Types
// =====

// the task shown, the focus, the resolution waiting for its comment, and
// whether the next choice tells Unii now (! before a digit)
export type Modal = { task: string; focus: "acts" | "note" | "talk"; pick: Pick | null; go: boolean };

// a resolution picked, its comment yet to come
type Pick = { state: Task["state"]; answer?: string; go: boolean };

// what a key asks of Term.ts: an act, a note, the window closed
export type Out = { $: "act"; act: View.Act } | { $: "note"; text: string } | { $: "close" };

// Constants
// =========

const BOLD = { ...Paint.INK, b: true };
const STATE: Record<Task["state"], string> = { open: "aberta", done: "concluída", dropped: "descartada" };

// the input's hint, by focus
export const HINTS = {
  acts : "1-9 escolhe · Enter conclui · ! conclui e avisa · d descarta · r reabre · Tab escreve · Esc fecha",
  note : "Comentário ou justificativa (opcional) · Enter confirma · Esc pula · Ctrl+C cancela",
  talk : "Mensagem sobre a pendência · Enter envia · Tab ou Esc volta às ações",
};

// Modal
// =====

export function modal_new(task: string): Modal {
  return { task, focus: "acts", pick: null, go: false };
}

// the task shown, if still listed
export function modal_task(m: Modal, v: View.View): Task | null {
  return v.tasks.find((t) => t.id === m.task) ?? null;
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
    return /^[1-9!dr]$|^Enter$/.test(key) ? { $: "note", text: "A pendência " + m.task + " não está mais na lista." } : undefined;
  }
  const open = t.state === "open";
  const n = t.choices.length;
  const pick = (p: Pick): null => {
    [m.pick, m.focus, m.go] = [p, "note", false];
    return null;
  };
  if (/^[1-9]$/.test(key) && open) {
    const k = Number(key);
    return k <= n ? pick({ state: "done", answer: t.choices[k - 1], go: m.go }) : { $: "note", text: n === 0 ? "A pendência " + t.id + " não tem opções: Enter a conclui." : "A pendência " + t.id + " tem as opções 1 a " + n + "." };
  }
  switch (key) {
    case "Enter": {
      if (!open) {
        return { $: "act", act: { $: "Task", task: t.id, state: "open" } };
      }
      return n === 0 ? pick({ state: "done", go: false }) : { $: "note", text: "Escolha a opção com 1 a " + n + "." };
    }
    case "!": {
      if (!open) {
        return undefined;
      }
      if (n === 0) {
        return pick({ state: "done", go: true });
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

// Enter in the note or talk focus, with the input's text: the
// resolution with its comment, or the message about the task
export function modal_enter(m: Modal, text: string): Out | null {
  if (m.focus === "talk") {
    return text.trim() === "" ? null : { $: "act", act: { $: "Send", text, task: m.task } };
  }
  return modal_resolve(m, text);
}

// Esc in the note focus skips the comment (the resolution goes without
// it); in the talk focus, back to the acts. Ctrl+C in the note focus
// cancels the resolution
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
// state and the rest of what to know), its detail, its choices (the one
// picked marked), its thread
export function modal_lines(m: Modal, v: View.View, w: number): Paint.Line[] {
  const t = modal_task(m, v);
  if (t === null) {
    return [[Paint.Run("A pendência " + m.task + " não está mais na lista. Esc fecha.", Paint.DIM)]];
  }
  const rule = [Paint.Run("─".repeat(Math.max(0, w)), Paint.DIM)];
  const head = Paint.runs_wrap([Paint.Run(t.id + " ", { ...BOLD, c: Theme.ANSI.id }), Paint.Run(Paint.text_clean(t.title), BOLD)], w, false);
  const waits = Deps.waits(v.tasks, t);
  const frees = View.task_frees_said(v, t);
  const meta = [STATE[t.state], t.who === "user" ? "com você" : "com o Unii", ...(t.ref === null ? [] : [t.ref]), ...(t.state === "open" && waits.length > 0 ? ["aguarda " + waits.join(", ")] : []), ...(frees === "" ? [] : [frees])];
  const said = [...(t.answer === null ? [] : ["Resposta: " + t.answer]), ...(t.note === null ? [] : ["Comentário: “" + t.note + "”"])];
  const md = (text: string) => Paint.rows_lines(View.entry_rows(null, "unii", text), w);
  const detail = t.detail === "" ? [] : [[], ...md(t.detail)];
  const choices = t.choices.length === 0 ? [] : [[], [Paint.Run(t.state === "open" ? "Opções" : "Opções oferecidas", BOLD)], ...t.choices.flatMap((c, k) => choice_lines(t, k, m.pick?.answer === c || t.answer === c, w))];
  const thread = View.task_thread(v, t.id);
  const talk = thread.length === 0
    ? [[Paint.Run("Nenhuma mensagem sobre esta pendência ainda. Tab escreve uma; o Unii responde aqui e no chat.", Paint.DIM)]]
    : Paint.rows_lines(thread.flatMap((e) => View.entry_rows(e.id, e.kind, View.task_unmark(e.text), e.images)), w);
  return [
    ...head,
    ...Paint.runs_wrap([Paint.Run(meta.join(" · "), Paint.DIM)], w, false),
    ...(said.length === 0 ? [] : Paint.runs_wrap([Paint.Run(Paint.text_clean(said.join(" · ")), { ...Paint.INK, c: Theme.ANSI.done })], w, false)),
    rule,
    ...detail,
    ...choices,
    [],
    [Paint.Run("Conversa" + (thread.length === 0 ? "" : " (" + thread.length + ")"), BOLD)],
    ...talk,
  ];
}

// a choice's lines: its number and label (bold and marked, if picked or
// the answer), what it means under it, dimmed and wrapped
function choice_lines(t: Task, k: number, here: boolean, w: number): Paint.Line[] {
  const mark = Paint.Run((here ? "▸ " : "  ") + (k + 1) + "  ", { ...BOLD, c: Theme.ANSI.cmd });
  const label = Paint.Run(Paint.text_clean(t.choices[k]), here ? { ...BOLD, c: Theme.ANSI.done } : BOLD);
  const hint = t.hints?.[k] ? Paint.runs_wrap([Paint.Run(Paint.text_clean(t.hints[k]), Paint.DIM)], Math.max(4, w - 5), false).map((l) => [Paint.Run("     "), ...l]) : [];
  return [[mark, label], ...hint];
}
