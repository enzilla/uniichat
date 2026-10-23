// Panel
// =====
// The terminal's full screen (Term.ts, unless `unii --classic`): the
// chat on the left, laid out whole at each paint and scrolled by the
// person (PageUp, PageDown, the wheel; at its bottom it follows what
// comes), the pending list (Tasks.ts, View.view_tasks) in a column on
// the right, Term's footer under both. The list takes the keys while
// focused (Ctrl+P): each act is the web's (View.Act Task, TasksTell), so
// View and the server judge it as they judge a button there. A click on
// a task picks it; on its box, marks it. A screen too narrow has no
// column: the footer's line and /p stand in for it.

import type { Task } from "./Tasks.ts";
import * as Deps from "./TaskDeps.ts";
import * as Paint from "./Paint.ts";
import * as View from "./View.ts";

// Types
// =====

// focus: the list takes the keys; sel: the task picked; scroll: the
// chat's lines below the screen (0: it follows); most: how far it may
// scroll; lines: the chat's at the last frame (lines that came since keep
// a scrolled reader's place); extra: notes and commands' output, under
// the chat till the next message; hits: by screen row (1 at the top), the task drawn there and
// the column its box ends at
export type Panel = {
  focus  : boolean;
  sel    : string | null;
  scroll : number;
  most   : number;
  lines  : number;
  extra  : Paint.Line[];
  hits   : Map<number, { id: string; box: number }>;
};

// what a key in the list asks of Term.ts: an act, a text put in the input
// (the list let go), a note
export type Out = { $: "act"; act: View.Act } | { $: "type"; text: string } | { $: "note"; text: string };

// Constants
// =========

// the column's width: a share of the screen, within bounds; none below
// NARROW columns
const SHARE  = 0.32;
const LEAST  = 30;
const MOST   = 46;
const NARROW = 90;

// the extra lines kept (the oldest dropped)
const EXTRA = 500;

// the wheel's lines per notch
const WHEEL = 3;

// a task's box, by state; its indent (mark, box, spaces)
const BOX: Record<Task["state"], string> = { open: "[ ]", done: "[x]", dropped: "[-]" };
const INDENT = 6;

const BOLD = { ...Paint.INK, b: true };

// the list's keys, as its foot shows them (focused, or not)
const KEYS_ON  = ["␣ marca · 1-9 opção · ! marca e avisa", "d descarta · c comenta · a avisa · Esc sai"];
const KEYS_OFF = ["Ctrl+P: pendências"];

// Panel
// =====

export function panel_new(): Panel {
  return { focus: false, sel: null, scroll: 0, most: 0, lines: 0, extra: [], hits: new Map() };
}

// the column's width for a screen w wide (0: none)
export function panel_width(w: number): number {
  return w < NARROW ? 0 : Math.min(MOST, Math.max(LEAST, Math.floor(w * SHARE)));
}

// lines for under the chat (a note, a command's output), the oldest
// dropped past EXTRA
export function panel_extra(p: Panel, lines: Paint.Line[]): void {
  p.extra = p.extra.concat(lines).slice(-EXTRA);
}

// the tasks the keys move along: the open ones the user can resolve now,
// then those closed lately (those that wait for others can't be)
function panel_items(v: View.View): Task[] {
  const { open, closed } = View.view_tasks(v);
  return [...open, ...closed];
}

// the task picked, kept to one still listed (none: the first)
function panel_pick(p: Panel, v: View.View): Task | null {
  const items = panel_items(v);
  const found = items.find((t) => t.id === p.sel) ?? items[0] ?? null;
  p.sel = found?.id ?? null;
  return found;
}

// Keys
// ----

// a key while the list is focused: what it asks (null: done here, as a
// move; undefined: not the list's)
export function panel_key(p: Panel, v: View.View, key: string): Out | null | undefined {
  const t = panel_pick(p, v);
  const items = panel_items(v);
  const at = t === null ? -1 : items.indexOf(t);
  switch (key) {
    case "Up":
    case "k": {
      p.sel = items[Math.max(0, at - 1)]?.id ?? null;
      return null;
    }
    case "Down":
    case "j": {
      p.sel = items[Math.min(items.length - 1, at + 1)]?.id ?? null;
      return null;
    }
    case "a": {
      return { $: "act", act: { $: "TasksTell" } };
    }
  }
  if (t === null) {
    return /^[ x!dcr1-9]$|^Enter$/.test(key) ? { $: "note", text: "Nenhuma pendência." } : undefined;
  }
  const open = t.state === "open";
  // an open task resolved: the pick goes on to the open one after it
  // (none: before it), as it leaves for the closed ones
  const next = items.slice(at + 1).concat(items.slice(0, at).reverse()).find((u) => u.state === "open");
  const done = (out: Out) => {
    p.sel = open && out.$ === "act" && next !== undefined ? next.id : p.sel;
    return out;
  };
  const choose = (k: number) => (k >= 1 && k <= t.choices.length ? done(panel_act(t, "done", false, t.choices[k - 1])) : { $: "note" as const, text: "A pendência " + t.id + (t.choices.length === 0 ? " não tem opções." : " tem as opções 1 a " + t.choices.length + ".") });
  switch (key) {
    case " ":
    case "x":
    case "Enter": {
      return !open ? panel_act(t, "open", false) : t.choices.length === 0 ? done(panel_act(t, "done", false)) : { $: "note", text: "Escolha a opção da " + t.id + " com 1 a " + t.choices.length + "." };
    }
    case "!": {
      return !open ? undefined : t.choices.length === 0 ? done(panel_act(t, "done", true)) : { $: "type", text: "/ok! " + t.id + " " };
    }
    case "d": {
      return open ? done(panel_act(t, "dropped", false)) : undefined;
    }
    case "r": {
      return open ? undefined : panel_act(t, "open", false);
    }
    case "c": {
      return { $: "type", text: (open ? "/ok " : "/reabrir ") + t.id + " " };
    }
  }
  return /^[1-9]$/.test(key) && open ? choose(Number(key)) : undefined;
}

function panel_act(t: Task, state: Task["state"], go: boolean, answer?: string): Out {
  return { $: "act", act: { $: "Task", task: t.id, state, ...(answer === undefined ? {} : { answer }), go } };
}

// a mouse event ("Mouse:b:col:row:M"): the wheel scrolls the chat; a
// press on a task picks it and focuses the list, on its box also marks it
export function panel_mouse(p: Panel, v: View.View, key: string): Out | null {
  const [b, col, row, end] = key.split(":").slice(1);
  if (b === "64" || b === "65") {
    panel_scroll(p, b === "64" ? WHEEL : -WHEEL);
    return null;
  }
  const hit = b === "0" && end === "M" ? p.hits.get(Number(row)) : undefined;
  if (hit === undefined) {
    return null;
  }
  p.sel = hit.id;
  p.focus = true;
  return Number(col) <= hit.box ? panel_key(p, v, " ") ?? null : null;
}

// the chat scrolled by n lines (up: more), within what there is
export function panel_scroll(p: Panel, n: number): void {
  p.scroll = Math.max(0, Math.min(p.most, p.scroll + n));
}

// Drawing
// -------

// the screen: the chat's lines (cw wide, Term.ts laid them out) and the
// extra ones, the bottom shown (less what is scrolled), the column beside
// them, the footer under both; h rows in all
export function panel_frame(p: Panel, v: View.View, body: Paint.Line[], foot: Paint.Line[], w: number, h: number): Paint.Line[] {
  const side = panel_width(w);
  const cw   = w - side;
  const room = Math.max(1, h - foot.length);
  const all  = body.concat(p.extra);
  p.scroll  += p.scroll > 0 ? Math.max(0, all.length - p.lines) : 0;
  p.lines    = all.length;
  p.most     = Math.max(0, all.length - room);
  p.scroll   = Math.min(p.scroll, p.most);
  const top  = Math.max(0, all.length - room - p.scroll);
  const chat = all.slice(top, top + room);
  if (p.scroll > 0) {
    chat[room - 1] = [Paint.Run("  ↓ " + p.scroll + (p.scroll === 1 ? " linha abaixo" : " linhas abaixo") + " · PageDown", Paint.DIM)];
  }
  const col  = side === 0 ? [] : panel_lines(p, v, side - 2, room, cw);
  const rows = Array.from({ length: room }, (_, k) => (side === 0 ? chat[k] ?? [] : [...line_fit(chat[k] ?? [], cw), Paint.Run("│ ", Paint.DIM), ...line_fit(col[k] ?? [], side - 2)]));
  return [...rows, ...foot];
}

// the column, w wide and h tall: its head, the open tasks, those that
// wait, those closed lately; its keys at its foot. The task picked stays
// in sight (those above it cut first); where each task is drawn noted in
// hits, for the mouse (x: the screen's columns left of the column's rule)
function panel_lines(p: Panel, v: View.View, w: number, h: number, x: number): Paint.Line[] {
  const { open, waiting, closed } = View.view_tasks(v);
  const sel   = panel_pick(p, v);
  const blank = [] as Paint.Line;
  const head  = [Paint.Run("Pendências", BOLD), Paint.Run(open.length === 0 ? "" : " (" + open.length + ")", Paint.DIM)];
  const body: { line: Paint.Line; id?: string; box?: boolean }[] = [];
  const add   = (t: Task, more: string[]) => task_lines(v, t, t.id === sel?.id ? (p.focus ? "▸" : "›") : " ", more, w).forEach((line, k) => body.push({ line, id: t.id, box: k === 0 }));
  open.forEach((t) => add(t, []));
  if (open.length === 0) {
    body.push({ line: [Paint.Run("Nenhuma pendência aberta.", Paint.DIM)] });
  }
  if (waiting.length > 0) {
    body.push({ line: blank }, { line: [Paint.Run(View.tasks_waiting_said(waiting.length), Paint.DIM)] });
    waiting.forEach((t) => task_lines(v, t, " ", ["aguarda " + Deps.waits(v.tasks, t).join(", ")], w).forEach((line) => body.push({ line: line.map((r) => Paint.Run(r.x, { ...r.s, d: true })) })));
  }
  if (closed.length > 0) {
    body.push({ line: blank }, { line: [Paint.Run("Resolvidas", Paint.DIM)] });
    closed.forEach((t) => add(t, t.told ? [] : ["o Unii ainda não viu"]));
  }
  const keys  = (p.focus ? KEYS_ON : KEYS_OFF).flatMap((k) => Paint.runs_wrap([Paint.Run(k, Paint.DIM)], w, false));
  const room  = Math.max(0, h - 2 - keys.length - 1);
  const first = body.findIndex((b) => b.id !== undefined && b.id === sel?.id);
  const last  = body.length - 1 - [...body].reverse().findIndex((b) => b.id !== undefined && b.id === sel?.id);
  const from  = first < 0 ? 0 : Math.max(0, Math.min(first, last - room + 1));
  const seen  = body.slice(from, from + room);
  p.hits = new Map();
  // the box's last column: past the rule and its space, the mark and its
  // space, the box's 3 (1-based); 0 on a task's other lines
  seen.forEach((b, k) => b.id !== undefined && p.hits.set(3 + k, { id: b.id, box: b.box ? x + 7 : 0 }));
  const pad = Array.from({ length: Math.max(0, h - 2 - seen.length - keys.length) }, () => blank);
  return [head, blank, ...seen.map((b) => b.line), ...pad, ...keys].slice(0, h);
}

// a task's lines: the mark (picked or not), its box, id and title, wrapped
// under the title's start; a dim line of what more there is to know (it
// frees others, it is Unii's, its ref, more), and its choices, numbered
function task_lines(v: View.View, t: Task, mark: string, more: string[], w: number): Paint.Line[] {
  const ink   = t.state === "open" ? (mark === " " ? Paint.INK : BOLD) : Paint.DIM;
  const text  = Paint.runs_wrap([Paint.Run(t.id + " ", Paint.DIM), Paint.Run(Paint.text_clean(t.title), ink)], Math.max(4, w - INDENT), false);
  const pad   = Paint.Run(" ".repeat(INDENT));
  const lines = text.map((l, k) => [k === 0 ? Paint.Run(mark + " " + BOX[t.state] + " ", mark === " " ? Paint.DIM : BOLD) : pad, ...l]);
  const frees = View.task_frees_said(v, t);
  const meta  = [...(frees === "" ? [] : [frees]), ...(t.who === "unii" ? ["com o Unii"] : []), ...(t.ref === null ? [] : [t.ref]), ...(t.answer === null ? [] : ["resposta: " + t.answer]), ...more];
  const tail  = meta.length === 0 ? [] : Paint.runs_wrap([Paint.Run(Paint.text_clean(meta.join(" · ")), Paint.DIM)], Math.max(4, w - INDENT), false).map((l) => [pad, ...l]);
  const opts  = mark === " " || t.state !== "open" ? [] : t.choices.map((c, k) => [pad, Paint.Run(k + 1 + ") ", BOLD), Paint.Run(Paint.text_clean(c))]);
  return [...lines, ...tail, ...opts];
}

// a line cut or padded to w columns
function line_fit(l: Paint.Line, w: number): Paint.Line {
  const cut = Paint.runs_wrap(l, w, true)[0] ?? [];
  const n   = cut.reduce((k, r) => k + Paint.text_width(r.x), 0);
  return [...cut, Paint.Run(" ".repeat(Math.max(0, w - n)))];
}
