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
import * as Theme from "./Theme.ts";
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

// an agent's id among the items: this, then its name
const AGENT = "@";

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

// all the keys move along: those tasks, then the agents at work (each
// "@" and its name)
function panel_ids(v: View.View): string[] {
  return [...panel_items(v).map((t) => t.id), ...v.agents.map((name) => AGENT + name)];
}

// the item picked, kept to one still listed (none: the first); its task,
// if it is one
function panel_pick(p: Panel, v: View.View): Task | null {
  const ids = panel_ids(v);
  p.sel = p.sel !== null && ids.includes(p.sel) ? p.sel : ids[0] ?? null;
  return panel_items(v).find((t) => t.id === p.sel) ?? null;
}

// the questions Unii asked since seen: the open tasks of the user's with
// choices that none waits on and seen hasn't, added to it
export function panel_asks(v: View.View, seen: Set<string>): Task[] {
  const fresh = View.view_tasks(v).open.filter((t) => t.who === "user" && t.choices.length > 0 && !seen.has(t.id));
  fresh.forEach((t) => seen.add(t.id));
  return fresh;
}

// Keys
// ----

// a key while the list is focused: what it asks (null: done here, as a
// move; undefined: not the list's)
export function panel_key(p: Panel, v: View.View, key: string): Out | null | undefined {
  const t = panel_pick(p, v);
  const items = panel_items(v);
  const ids = panel_ids(v);
  const at = t === null ? -1 : items.indexOf(t);
  const here = p.sel === null ? -1 : ids.indexOf(p.sel);
  switch (key) {
    case "Up":
    case "k": {
      p.sel = ids[Math.max(0, here - 1)] ?? null;
      return null;
    }
    case "Down":
    case "j": {
      p.sel = ids[Math.min(ids.length - 1, here + 1)] ?? null;
      return null;
    }
    case "a": {
      return { $: "act", act: { $: "TasksTell" } };
    }
  }
  if (p.sel?.startsWith(AGENT)) {
    return key === "Enter" || key === " " ? { $: "act", act: { $: "Goto", name: p.sel.slice(AGENT.length) } } : undefined;
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
// press on a task picks it and focuses the list, on its box also marks
// it; on an agent, opens its tab
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
  return Number(col) <= hit.box || hit.id.startsWith(AGENT) ? panel_key(p, v, " ") ?? null : null;
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
// wait, those closed lately, the agents at work (Unii's subagents); its
// keys at its foot. The item picked stays in sight (those above it cut
// first; with none picked below, the agents cut first); where each task is drawn noted in
// hits, for the mouse (x: the screen's columns left of the column's rule)
function panel_lines(p: Panel, v: View.View, w: number, h: number, x: number): Paint.Line[] {
  const { open, waiting, closed } = View.view_tasks(v);
  panel_pick(p, v);
  const sel   = { id: p.sel };
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
  if (v.agents.length > 0) {
    body.push({ line: blank }, { line: [Paint.Run("Agentes", BOLD), Paint.Run(" (" + v.agents.length + ")", Paint.DIM)] });
    v.agents.forEach((name) => agent_lines(v, name, AGENT + name === sel.id ? (p.focus ? "▸" : "›") : " ", w).forEach((line) => body.push({ line, id: AGENT + name })));
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

// a task's lines: the mark (picked or not), its box (green, done), id
// (yellow, open) and title, wrapped under the title's start; a dim line
// of what more there is to know (it frees others, in magenta; it is
// Unii's, its ref, more), and its choices, numbered
function task_lines(v: View.View, t: Task, mark: string, more: string[], w: number): Paint.Line[] {
  const ink   = t.state === "open" ? (mark === " " ? Paint.INK : BOLD) : Paint.DIM;
  const id    = t.state === "open" ? { ...Paint.INK, c: Theme.ANSI.id } : Paint.DIM;
  const box   = { ...(mark === " " ? Paint.DIM : BOLD), ...(t.state === "done" ? { d: false, c: Theme.ANSI.done } : {}) };
  const text  = Paint.runs_wrap([Paint.Run(t.id + " ", id), Paint.Run(Paint.text_clean(t.title), ink)], Math.max(4, w - INDENT), false);
  const pad   = Paint.Run(" ".repeat(INDENT));
  const lines = text.map((l, k) => (k === 0 ? [Paint.Run(mark + " ", mark === " " ? Paint.DIM : BOLD), Paint.Run(BOX[t.state], box), Paint.Run(" "), ...l] : [pad, ...l]));
  const frees = View.task_frees_said(v, t);
  const said  = [...(t.who === "unii" ? ["com o Unii"] : []), ...(t.ref === null ? [] : [t.ref]), ...(t.answer === null ? [] : ["resposta: " + t.answer]), ...more].map(Paint.text_clean).join(" · ");
  const runs  = [...(frees === "" ? [] : [Paint.Run(frees, { ...Paint.INK, c: Theme.ANSI.frees })]), ...(frees !== "" && said !== "" ? [Paint.Run(" · ", Paint.DIM)] : []), ...(said === "" ? [] : [Paint.Run(said, Paint.DIM)])];
  const tail  = runs.length === 0 ? [] : Paint.runs_wrap(runs, Math.max(4, w - INDENT), false).map((l) => [pad, ...l]);
  // each choice, and under it what it means (dimmed), wrapped
  const opts  = mark === " " || t.state !== "open" ? [] : t.choices.flatMap((c, k) => [
    [pad, Paint.Run(k + 1 + ") ", BOLD), Paint.Run(Paint.text_clean(c))],
    ...(t.hints?.[k] ? Paint.runs_wrap([Paint.Run(Paint.text_clean(t.hints[k]), Paint.DIM)], Math.max(4, w - INDENT - 3), false).map((l) => [pad, Paint.Run("   "), ...l]) : []),
  ]);
  return [...lines, ...tail, ...opts];
}

// an agent's lines: the mark, its label (else its name), bold when
// picked; then dimmed its name (under a label), what it runs on, and the
// usage limit it waits for, if any
function agent_lines(v: View.View, name: string, mark: string, w: number): Paint.Line[] {
  const label = View.agent_label(name);
  const run   = v.runs[name];
  const limit = v.limits[name];
  const head  = Paint.runs_wrap([Paint.Run(mark + " ● ", { ...Paint.INK, c: Theme.ANSI.here }), Paint.Run(Paint.text_clean(label ?? name), mark === " " ? Paint.INK : BOLD)], w, false);
  const said  = [...(label === undefined ? [] : [name]), ...(run === undefined ? [] : [run.model + " · " + run.effort]), ...(limit === undefined ? [] : [View.limit_show(limit)])].join(" · ");
  const pad   = Paint.Run(" ".repeat(4));
  const tail  = said === "" ? [] : Paint.runs_wrap([Paint.Run(Paint.text_clean(said), Paint.DIM)], Math.max(4, w - 4), false).map((l) => [pad, ...l]);
  return [...head, ...tail];
}

// a line cut or padded to w columns
function line_fit(l: Paint.Line, w: number): Paint.Line {
  const cut = Paint.runs_wrap(l, w, true)[0] ?? [];
  const n   = cut.reduce((k, r) => k + Paint.text_width(r.x), 0);
  return [...cut, Paint.Run(" ".repeat(Math.max(0, w - n)))];
}
