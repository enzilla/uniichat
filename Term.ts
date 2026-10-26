// Term
// ====
// `unii [url]`: a terminal view of the agent (Server.ts). It feeds a View
// the server's messages and the person's acts, and prints what it says
// (Paint.ts, Screen.ts) into the terminal's own scrollback; or, on the
// full screen (Panel.ts, the default unless --classic), draws the chat
// whole beside the pending list at each paint. Every act of
// the site is a command here (COMMANDS, /help). From a pipe, each line is
// a message. Its file is tui.json (Client.ts): the server it opens by
// default (the last one signed in to) and its sign-in to each, by host.

import * as child from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import type { Kind } from "./AskAI.ts";
import * as Client from "./Client.ts";
import * as Import from "./Import.ts";
import * as Modal from "./Modal.ts";
import * as Paint from "./Paint.ts";
import * as Panel from "./Panel.ts";
import { type Move, Pick } from "./Pick.ts";
import * as Screen from "./Screen.ts";
import * as Theme from "./Theme.ts";
import * as View from "./View.ts";

// Types
// =====

// the terminal: its sign-in; ended: input's; pending: commands at
// work; last: UniiChat's message printed last (-1: none); wait: parts up
// to it not printed (term_settle); out: lines to print; wipe: first;
// due: a paint; settle: the page's print at a new size; imgs: for the
// next message; flow: how much of each message streaming is printed
// (Infinity: logged); logs: of each agent's page, the messages printed;
// panel: the full screen's (null: the classic scrollback, or a pipe);
// menu: the commands' menu over the input (Menu); chooser: a list to
// choose from over the input, while open (Chooser)
type Term = {
  v       : View.View;
  scr     : Screen.Screen;
  url     : string;
  token   : string;
  ended   : boolean;
  pending : number;
  last    : number;
  wait    : View.Part[];
  out     : Paint.Line[];
  wipe    : boolean;
  due     : boolean;
  settle  : Timer | undefined;
  imgs    : Blob[];
  flow    : Map<View.Live, number>;
  logs    : Map<string, number>;
  panel   : Panel.Panel | null;
  menu    : Menu;
  chooser : Chooser | null;
  asked   : Set<string> | null;
  busy    : boolean | null;
  focus   : boolean;
  modal   : Modal.Modal | null;
  kept    : Kept | null;
};

// what a task's window keeps of the chat while open: the input's text,
// the lines under the chat, how far it was scrolled
type Kept = { draft: string; extra: Paint.Line[]; scroll: number };

// a choice of a list (a command without its value: /model, /mcp): its
// title, its items, the one picked, the text typed that filters them
type Chooser = { title: string; items: Choice[]; sel: number; typed: string };

// an item: as shown, a note dimmed beside it, whether it is the one now,
// what choosing it does
type Choice = { text: string; note: string; now: boolean; run: () => void };

// the commands' menu: the item picked, the input it was for, whether Esc
// shut it for that input
type Menu = { sel: number; text: string; shut: boolean };

// a command the menu offers: as typed, what it does, where (a skill's
// device; "": the terminal's own)
type Item = { name: string; text: string; where: string };

// a line of /help: how it is typed ("": keys only), its keys, what it
// does; it runs on its argument, or by a key on "" (or the key's name)
type Cmd = [use: string, keys: string, text: string, run: (t: Term, arg: string) => void | Promise<void>];

// Constants
// =========

// paths on Windows take \\, not /
const WIN = process.platform === "win32";

// the margin left of each line
const MARGIN = 2;

// a paint's frame: a stream's pieces come faster than a screen shows
// them (ms)
const FRAME = 16;

// a size held this long is settled: a drag's sizes come faster, and each
// would print the whole page again (ms)
const SETTLE = 100;

// where Claude Code and Codex keep their sessions
const CODEX   = process.env.CODEX_HOME ?? os.homedir() + "/.codex";
const IMPORTS = [
  (process.env.CLAUDE_CONFIG_DIR ?? os.homedir() + "/.claude") + "/projects",
  CODEX + "/sessions",
  CODEX + "/archived_sessions",
];

// what /import takes: its day; a site's export (its zip, or its
// conversations.json)
const SINCE  = /\bsince +(\d{4}-\d\d-\d\d)\b/;
const EXPORT = /\.(zip|json)$/i;
const HOW = "Pick with /import [claude] [chatgpt] [since 2026-06-01] [tools] [sessions] [-#n] [<export>.zip] [go] (-#n: not session n; go: import); /import pause or resume: the import running. Exports, on each website: " + Object.entries(Import.EXPORTS).map(([app, how]) => app + ": " + how).join("; ") + "; it emails you a zip.";

// the keys on an agent's page, which has no input: a tab back, quit,
// suspend and Esc (UniiChat's turn interrupted; agents go on); none that
// types, sends or moves the pick
const PAGE_KEYS = ["Tab", "Ctrl+D", "Ctrl+Z", "Esc"];

// the full screen: whether this terminal draws it (main), the chat's
// share of the width then
let FULL = false;

// offline's ink, on the rule under the input
const OFFLINE = { ...Paint.INK, b: true, c: Theme.ANSI.off };

// the pick's moves by Shift and an arrow
const ARROWS: Record<string, Move> = { "Shift+Left": "prev", "Shift+Right": "next", "Shift+Up": "up", "Shift+Down": "down" };

// all a person can do here, by group (the editing keys are Screen's)
function term_groups(v: View.View): [group: string, cmds: Cmd[]][] {
  return [
    ["Chat", [
      ["",                  "Enter",                   "send; on an empty input, interrupt UniiChat",    term_enter],
      ["",                  "Esc",                     "interrupt UniiChat's turn; agents go on",        (t) => term_act(t, { $: "Send", text: "" })],
      ["",                  "Ctrl+C, Ctrl+D",          "clear; on an empty input, interrupt, quit",      term_clear],
      ["/goal <message>",   "",                        "send a message as the goal: at each turn's end, UniiChat asks itself if it is met, and goes on till it is", (t, a) => term_act(t, { $: "Send", text: "/goal " + a })],
      ["/halt",             "",                        "drop the goal; the turn running ends as it would", (t) => term_act(t, { $: "Send", text: "/halt" })],
      ["/image <path>",     "",                        "attach an image to the next message",            term_image],
      ["/open #id",         "",                        "open block #id, as it shows, and keep it open",  (t, a) => term_block(t, a, true)],
      ["/close #id",        "",                        "close block #id and keep it closed",             (t, a) => term_block(t, a, false)],
      ["/fold",             "Ctrl+F",                  "the chat in the fewest blocks; again: unfold (Ctrl+F eaten? type /fold)", term_fold],
      ["/mode [mode]",      "",                        "the memory mode, standard or conversation (messages stay word for word in Unii's view); with one, that one", term_mode],
      ["/import [...]",     "",                        "import your Claude and ChatGPT chats (alone: options)", term_import],
      ["/export",           "",                        "save the memory as ./unii-memory.json",          term_export],
      ["/copy [n]",         "",                        "copia a última resposta do Unii; com n, o n-ésimo bloco de código dela (pelo terminal: funciona via ssh)", term_copy],
      ["/tree",             "",                        "the whole memory, in the browser (its link prints too)", (t) => term_browse(t, "The memory tree", t.url + "/tree")],
      ["",                  "Ctrl+Z",                  "suspend; fg brings it back",                     (t) => Screen.screen_suspend(t.scr)],
      ["/quit",             "",                        "leave: the chat goes on without this terminal",  term_quit],
      ["/help",             "",                        "this list",                                      term_help],
    ]],
    ["Pick", [
      ["",                  "Shift+Left, Shift+Right", "the model before, the next",                     (t, k) => term_move(t, ARROWS[k])],
      ["",                  "Shift+Up, Shift+Down",    "more effort, less",                              (t, k) => term_move(t, ARROWS[k])],
      ["",                  "Shift+Tab",               "the next effort, around (low after max), typing or not", (t) => term_round(t, "effort")],
      ["",                  "Alt+M",                   "the next speed, around (slow, fast, ultrafast)", (t) => term_round(t, "speed")],
      ["/model [name]",     "",                        "the models to pick from; with a name, that one", (t, a) => term_pick(t, "model", a)],
      ["/effort [level]",   "",                        "the efforts; with one, that one",                (t, a) => term_pick(t, "effort", a)],
      ["/speed [speed]",    "",                        "the speeds; with one, that one",                 (t, a) => term_pick(t, "speed", a)],
      ["/mcp [name]",       "",                        "the MCP servers, on or off in this chat; with a name, that one turned on or off", term_mcp],
    ]],
    ["Agents", [
      ["",                  "Tab",                     "the next tab",                                   term_cycle],
      ["/tab [name]",       "",                        "the tabs; with a name, that one",               term_tab],
      ["/stop [name]",      "",                        "stop all work, agents too; or that agent",       term_stop],
    ]],
    ["Sign-in", [
      ["/logout",           "",                        "sign this terminal out and quit",               term_logout],
    ]],
    ["Pendências", [
      ["/p [P7|aguardando]", "",                       "a lista de pendências; com um id, o detalhe dela; aguardando: as que esperam outras", term_tasks],
      ["/abrir P7",         "",                        "na tela cheia: abre a pendência numa janela, com o detalhe, as opções, os campos (respondidos como rascunho) e a conversa sobre ela (lá: ↑↓ escolhe a pergunta, 1-9 responde, s ou n no sim ou não, Enter num texto o escreve; Enter conclui pedindo a justificativa, ! conclui e avisa, d descarta, r reabre, Tab escreve sobre ela, Esc fecha)", term_open_arg],
      ["/mesa [projeto]",   "",                        "a Mesa: as pendências por vez (agora, aguardando o Unii, em andamento, aguardando outras, resolvidas); com um projeto, só as dele", term_desk],
      ["/ok P7 [opção] [campo=valor] [comentário]", "", "conclui a pendência (com as respostas dos campos: 1=a 2=\"um texto\"); o Unii é avisado em até 1 min, ou na hora se a opção é marcada “o Unii executa”", (t, a) => term_task(t, a, "done", false)],
      ["/aceitar P7 [comentário]", "",                 "conclui a pendência com as respostas que o Unii recomenda; se ela tem opções e nenhuma é recomendada, só preenche os campos recomendados (rascunho) e a opção fica com você: /ok P7 opção", term_accept],
      ["/cobrar P7",        "",                        "pendência do Unii: cobra o andamento (uma mensagem na conversa dela)", term_chase],
      ["/ok! P7 [opção] [campo=valor] [comentário]", "", "conclui a pendência e avisa o Unii agora",     (t, a) => term_task(t, a, "done", true)],
      ["/rascunho P7 campo=valor", "",                 "responde campos da pendência sem concluir (salvo como rascunho)", term_draft],
      ["/conversa P7 [mensagem]", "",                  "conversa sobre a pendência sem concluir: a mensagem inicia um turno do Unii; sem mensagem, mostra a conversa", term_talk],
      ["/descartar P7 [comentário]", "",               "descarta a pendência",                          (t, a) => term_task(t, a, "dropped", false)],
      ["/reabrir P7",       "",                        "reabre uma pendência resolvida",                 (t, a) => term_task(t, a, "open", false)],
      ["/avisar",           "",                        "avisa o Unii agora das pendências resolvidas que ele ainda não viu", (t) => term_send(t, { $: "tasks_tell" })],
      ["",                  "Ctrl+P",                  "na tela cheia: o foco vai à coluna de pendências e agentes e volta (lá: setas, Enter ou o abre a pendência numa janela, espaço marca, 1-9 opção, ! marca e avisa, d descarta, c comenta, a avisa, Enter num agente abre a aba dele, Esc sai; o clique na caixa marca, no título abre)", term_focus],
      ["",                  "PageUp, PageDown",        "na tela cheia: rola a conversa (a roda do mouse também; Shift e arrastar seleciona texto)", term_page_key],
    ]],
  ];
}

function term_commands(v: View.View): Cmd[] {
  return term_groups(v).flatMap(([, cmds]) => cmds);
}

// Term
// ====

function term_new(url: string, token: string): Term {
  const t: Term = {
    v       : View.view_new(),
    scr     : Screen.screen_new((key) => term_press(t, key)),
    url,
    token,
    ended   : false,
    pending : 0,
    last    : -1,
    wait    : [],
    out     : [],
    wipe    : false,
    due     : false,
    settle  : undefined,
    imgs    : [],
    flow    : new Map(),
    logs    : new Map(),
    panel   : null,
    menu    : { sel: 0, text: "", shut: false },
    chooser : null,
    asked   : null,
    busy    : null,
    focus   : true,
    modal   : null,
    kept    : null,
  };
  t.scr.first = (key) => term_menu_key(t, key);
  process.stdin.on("end", () => {
    if (t.scr.ed.text.trim() !== "") {
      term_enter(t);
    }
    t.ended = true;
    term_idle(t);
  });
  process.stdout.on("resize", () => term_resize(t));
  for (const sig of ["SIGHUP", "SIGTERM", "SIGINT"]) {
    process.on(sig, () => term_bye(t));
  }
  return t;
}

// connects, by View's link
function term_connect(t: Term): void {
  View.link_open(t.v, {
    open : (query) => new WebSocket(t.url.replace(/^http/, "ws") + "/ws" + query, { headers: Client.auth(t.token) } as any),
    post : (path, body) => fetch(t.url + path, { method: "POST", headers: Client.auth(t.token), body }),
    hear : (msg) => term_hear(t, msg),
    lost : (up) => term_lost(t, up),
  });
}

// a socket lost (up: it had opened): the footer says offline; one that
// never opened, if the server refuses this terminal's session, quits
async function term_lost(t: Term, up: boolean): Promise<boolean> {
  term_draw(t);
  if (!up && !await Client.signed(t.url, t.token)) {
    term_note(t, "This terminal is signed out: run unii again to sign in.");
    process.exitCode = 1;
    term_quit(t);
    return false;
  }
  return true;
}

// an act to the server (a message shown while it waits offline); a
// message refused goes back in the input
function term_send(t: Term, msg: View.Client, sent?: View.Sent): void {
  const said = sent === undefined ? "" : sent.text.trim();
  View.link_send(t.v, msg, (a) => {
    if (a.error !== undefined) {
      term_note(t, a.error);
    }
    if (a.error !== undefined && sent !== undefined) {
      term_back(t, sent);
    }
    term_idle(t);
  }, said);
}

// a message of the server: to the view, then to the jobs and the page
function term_hear(t: Term, msg: View.Server): void {
  const first = msg.$ === "view" && t.v.parts.length === 0;
  const was   = t.v.page;
  for (const out of View.view_hear(t.v, msg)) {
    term_send(t, out);
  }
  term_went(t, was);
  if (t.panel === null) {
    term_print(t, msg);
  }
  if (first) {
    term_history(t);
  }
  term_draw(t);
  if (msg.$ === "state") {
    term_asks(t);
    term_ended(t);
    term_idle(t);
  }
}

// Unii's turn ended (busy, then not, failed or not): the bell, with a
// desktop notification where the terminal takes one (Screen.screen_notify);
// on the full screen only while the terminal isn't in focus (it tells),
// on the classic one always the bell alone. UNII_NO_BELL=1: none
function term_ended(t: Term): void {
  const was = t.busy;
  t.busy = t.v.busy;
  if (was !== true || t.v.busy || !t.scr.tty || process.env.UNII_NO_BELL === "1" || (t.panel !== null && t.focus)) {
    return;
  }
  const last = View.view_copy(t.v, 0);
  const said = typeof last === "string" ? "" : last.text.split("\n").find((l) => l.trim() !== "")?.slice(0, 120) ?? "";
  process.stdout.write(t.panel === null ? "\x07" : Screen.screen_notify(process.env, "O Unii terminou", said));
}

// a question Unii asked (a task of the user's with choices, Panel.panel_asks)
// opens the chooser with them, unless another is open or something is
// being typed: then a note says so, the task waits in the list. Those
// listed at the first state aren't new
function term_asks(t: Term): void {
  if (t.asked === null) {
    t.asked = new Set(t.v.tasks.map((task) => task.id));
    return;
  }
  for (const task of Panel.panel_asks(t.v, t.asked)) {
    if (t.chooser !== null || t.modal !== null || t.scr.ed.text !== "" || t.panel === null) {
      term_note(t, "O Unii perguntou (" + task.id + "): " + task.title + " — abra com /abrir " + task.id + " (ou Enter na coluna) para ver as opções e responder.");
      continue;
    }
    term_open(t, task.id);
  }
}

// an act of the person: to the view; the messages it sends the server
function term_act(t: Term, act: View.Act): View.Client[] {
  const was = t.v.page;
  const out = View.view_act(t.v, act);
  out.forEach((msg) => term_send(t, msg, act.$ === "Send" ? act : undefined));
  term_went(t, was);
  return out;
}

// a message the server refused, back in the input, unless another is in
// it; from a pipe, the end, failed
function term_back(t: Term, sent: View.Sent): void {
  if (!t.scr.tty) {
    process.exitCode = 1;
    term_quit(t);
    return;
  }
  if (t.scr.ed.text !== "" || t.imgs.length > 0) {
    return;
  }
  Screen.ed_type(t.scr.ed, sent.text);
  t.imgs = sent.images ?? [];
}

// the page shown was `was`: another prints below, after its name (a
// wipe and whole print took seconds on a long page); an agent's has no
// input (a pipe's lines still go on)
function term_went(t: Term, was: View.Page | null): void {
  t.scr.off = t.scr.tty && !View.view_typing(t.v);
  if (t.v.page !== was && t.panel !== null) {
    t.panel.scroll = 0;
  } else if (t.v.page !== was) {
    term_rows(t, t.v.page === null ? [View.Cap(View.MAIN)] : [], false);
    term_show(t);
  }
}

// the input's history: the user's messages known
function term_history(t: Term): void {
  const sent = [...t.v.whole].sort((a, b) => a[0] - b[0]).flatMap(([, e]) => (e.kind === "user" ? [e.text] : []));
  t.scr.ed.hist = sent;
  t.scr.ed.at   = sent.length;
}

// input's end: quits once all it sent is answered and no work runs
function term_idle(t: Term): void {
  if (t.ended && t.pending <= 0 && t.v.out.length === 0 && !View.view_running(t.v)) {
    term_quit(t);
  }
}

// Keys
// ----

// a key ("": text typed): its line of COMMANDS (an agent's page: of
// PAGE_KEYS)
function term_press(t: Term, key: string): void {
  if (key === "FocusIn" || key === "FocusOut") {
    t.focus = key === "FocusIn";
    return;
  }
  if (t.chooser !== null && key !== "") {
    term_chooser_key(t, t.chooser, key);
    return term_draw(t);
  }
  if (t.panel !== null && (t.panel.focus || key.startsWith("Mouse:")) && term_panel(t, t.panel, key)) {
    return term_draw(t);
  }
  if (t.modal !== null && key !== "" && term_modal(t, t.modal, key)) {
    return term_draw(t);
  }
  if (t.panel !== null && term_panel(t, t.panel, key)) {
    return term_draw(t);
  }
  const cmd = term_commands(t.v).find((c) => c[1] !== "" && c[1].split(", ").includes(key));
  if (cmd !== undefined && (!t.scr.off || PAGE_KEYS.includes(key))) {
    cmd[3](t, cmd[0] === "" ? key : "");
  }
  term_draw(t);
}

// Enter: runs a command, or sends the input; text not sent stays (it
// was lost: an unknown /word)
function term_enter(t: Term): void {
  const text = Screen.ed_take(t.scr.ed);
  if (term_command(t, text)) {
    return;
  }
  if (!View.view_typing(t.v)) {
    term_note(t, "Messages go to UniiChat: Tab or /tab goes back.");
  } else if (term_act(t, { $: "Send", text, images: t.imgs }).length > 0) {
    t.imgs = [];
    if (t.panel !== null) {
      [t.panel.extra, t.panel.scroll] = [[], 0];
    }
    return;
  }
  Screen.ed_type(t.scr.ed, text);
}

// Ctrl+C or Ctrl+D: clears the input; on an empty one, Ctrl+C interrupts
// UniiChat's turn (never quits), Ctrl+D quits, as it does on an agent's
// page (its input's text kept)
function term_clear(t: Term, key: string): void {
  if (t.scr.ed.text !== "" && !t.scr.off) {
    Screen.ed_take(t.scr.ed);
  } else if (key === "Ctrl+D") {
    term_quit(t);
  } else {
    term_act(t, { $: "Send", text: "" });
  }
}

// the next tab
function term_cycle(t: Term): void {
  const tabs = View.view_tabs(t.v);
  const at   = tabs.findIndex((tab) => tab.here) + 1;
  term_act(t, { $: "Goto", name: tabs[at % tabs.length].name });
}

// a key on the full screen, if its: the list's while focused (Esc lets
// it go), the mouse's; true if taken
function term_panel(t: Term, p: Panel.Panel, key: string): boolean {
  const out = key.startsWith("Mouse:") ? Panel.panel_mouse(p, t.v, key) : p.focus ? Panel.panel_key(p, t.v, key) : undefined;
  if (out === undefined && p.focus && key === "Esc") {
    term_focus(t);
    return true;
  }
  if (out === undefined) {
    return key.startsWith("Mouse:");
  }
  t.scr.grab = p.focus || t.modal?.focus === "acts";
  if (out?.$ === "act") {
    term_act(t, out.act);
  } else if (out?.$ === "note") {
    term_note(t, out.text);
  } else if (out?.$ === "type") {
    term_focus(t);
    Screen.ed_take(t.scr.ed);
    Screen.ed_type(t.scr.ed, out.text);
  } else if (out?.$ === "open") {
    term_open(t, out.task);
  }
  return true;
}

// A task's window
// ---------------

// a task's window opened (Modal.ts) over the chat, the list's focus let
// go; the chat's input, its lines under it and its scroll kept for its
// close; another task's, if one was open, takes its place
function term_open(t: Term, id: string): void {
  const p = t.panel;
  if (p === null) {
    return term_note(t, "A janela da pendência é da tela cheia (unii sem --classic). Aqui, /p " + id + ".");
  }
  if (t.kept === null) {
    t.kept = { draft: Screen.ed_take(t.scr.ed), extra: p.extra, scroll: p.scroll };
    [p.extra, p.scroll] = [[], 0];
  }
  p.focus = false;
  t.modal = Modal.modal_new(id);
  t.scr.grab = true;
}

// /abrir P7
function term_open_arg(t: Term, arg: string): void {
  const got = View.task_args(t.v, arg, false);
  return typeof got === "string" ? term_note(t, got) : term_open(t, got.task.id);
}

// the window closed: the chat as it was
function term_close(t: Term): void {
  const p = t.panel;
  const kept = t.kept;
  [t.modal, t.kept] = [null, null];
  Screen.ed_take(t.scr.ed);
  if (p !== null && kept !== null) {
    [p.extra, p.scroll] = [kept.extra, kept.scroll];
    Screen.ed_type(t.scr.ed, kept.draft);
  }
  t.scr.grab = p?.focus ?? false;
}

// a key while a task's window is open: the acts' keys (Modal.modal_key),
// or, writing a comment, a field's text or a message in the input,
// Enter, Esc, Tab and Ctrl+C; PageUp, PageDown scroll it. True if taken
function term_modal(t: Term, m: Modal.Modal, key: string): boolean {
  const out = m.focus === "acts" ? Modal.modal_key(m, t.v, key)
    : key === "Enter" ? Modal.modal_enter(m, t.v, Screen.ed_take(t.scr.ed))
    : key === "Esc" || key === "Ctrl+C" || (key === "Tab" && m.focus === "talk") ? Modal.modal_back(m, key === "Ctrl+C" ? "Ctrl+C" : "Esc")
    : undefined;
  if (out === undefined) {
    return false;
  }
  if (m.focus === "acts") {
    Screen.ed_take(t.scr.ed);
  }
  if (out?.$ === "close") {
    term_close(t);
  } else if (out?.$ === "note") {
    term_note(t, out.text);
  } else if (out?.$ === "fill") {
    Screen.ed_type(t.scr.ed, out.text);
  } else if (out?.$ === "act") {
    term_act(t, out.act);
  }
  t.scr.grab = t.modal !== null && t.modal.focus === "acts";
  return true;
}

// Ctrl+P: the keys to the pending list, or back to the input
function term_focus(t: Term): void {
  const p = t.panel;
  if (p === null || Panel.panel_width(Screen.screen_width()) === 0) {
    return term_note(t, p === null ? "A coluna de pendências é da tela cheia: unii sem --classic. Aqui, /p." : "A tela é estreita para a coluna de pendências: /p as lista.");
  }
  p.focus = !p.focus;
  // back from the list to a task's window: its acts' keys again
  t.scr.grab = p.focus || t.modal?.focus === "acts";
}

// PageUp, PageDown: the chat half a screen up, down
function term_page_key(t: Term, key: string): void {
  const half = Math.max(1, Math.floor((process.stdout.rows || 24) / 2));
  if (t.panel !== null) {
    Panel.panel_scroll(t.panel, key === "PageUp" ? half : -half);
  }
}

// Menu
// ----

// the most items the menu shows at once
const MENU = 8;

// the commands that fit a /word being typed (none once a space follows
// it, or Esc shut it): this terminal's, then the devices' skills; those
// that start with it first, then those that hold it
function term_menu(t: Term): Item[] {
  const text = t.scr.ed.text;
  const m = t.menu;
  if (m.text !== text) {
    [m.sel, m.text, m.shut] = [0, text, false];
  }
  if (m.shut || t.scr.off || t.panel?.focus || t.chooser !== null || !/^\/\S*$/.test(text)) {
    return [];
  }
  const own    = term_commands(t.v).filter((c) => c[0] !== "").map((c): Item => ({ name: c[0].split(" ")[0], text: c[2], where: "" }));
  const skills = t.v.skills.map((s): Item => ({ name: "/" + s.name, text: s.description, where: s.device }));
  const all    = [...own, ...skills].filter((x, k, xs) => xs.findIndex((y) => y.name === x.name) === k);
  const typed  = text.toLowerCase();
  const starts = all.filter((x) => x.name.toLowerCase().startsWith(typed));
  const holds  = all.filter((x) => !starts.includes(x) && x.name.toLowerCase().includes(typed.slice(1)));
  const found  = [...starts, ...holds];
  m.sel = Math.min(m.sel, Math.max(0, found.length - 1));
  return found.length === 1 && found[0].name === text ? [] : found;
}

// a key while the menu shows: the arrows pick, Tab puts the item picked in
// the input, Enter too (once it is there, Enter runs it), Esc shuts it;
// true if taken
function term_menu_key(t: Term, key: string): boolean {
  const items = term_menu(t);
  const n = items.length;
  if (n === 0) {
    return false;
  }
  const item = items[t.menu.sel];
  switch (key) {
    case "Up":
    case "Down": {
      t.menu.sel = (t.menu.sel + (key === "Up" ? n - 1 : 1)) % n;
      return true;
    }
    case "Tab":
    case "Enter": {
      if (key === "Enter" && item.name === t.scr.ed.text.trim()) {
        return false;
      }
      Screen.ed_take(t.scr.ed);
      Screen.ed_type(t.scr.ed, item.name + " ");
      return true;
    }
    case "Esc": {
      t.menu.shut = true;
      return true;
    }
  }
  return false;
}

// the menu's lines, w wide: the items around the one picked, each its
// name (bold, picked) in the command's color, what it does dimmed, a
// skill's device; then its keys
function term_menu_lines(t: Term, w: number): Paint.Line[] {
  const items = term_menu(t);
  if (items.length === 0) {
    return [];
  }
  const from = Math.max(0, Math.min(t.menu.sel - MENU + 1, items.length - MENU));
  const seen = items.slice(Math.max(0, from), Math.max(0, from) + MENU);
  const room = Math.min(28, Math.max(...seen.map((x) => Paint.text_width(x.name)))) + 2;
  const line = (x: Item): Paint.Line => {
    const here = x === items[t.menu.sel];
    const name = Paint.Run((here ? "▸ " : "  ") + x.name.padEnd(room), { ...Paint.INK, b: here, c: Theme.ANSI.cmd });
    const what = Paint.Run(Paint.text_clean(x.text) + (x.where === "" ? "" : " · " + x.where), Paint.DIM);
    return Paint.runs_wrap([name, what], w, true)[0];
  };
  const more = items.length > MENU ? " · " + items.length + " comandos" : "";
  return [...seen.map(line), [Paint.Run("  Tab completa · ↑↓ escolhe · Esc fecha" + more, Paint.DIM)]];
}

// Chooser
// -------

// the most items a chooser shows at once
const CHOOSER = 10;

// a list to choose from opens over the input, the one now picked; on a
// pipe, its items are a note instead (none to choose)
function term_choose(t: Term, title: string, items: Choice[]): void {
  if (!t.scr.tty || items.length === 0) {
    return term_note(t, title + ": " + (items.length === 0 ? "nenhum." : items.map((c) => c.text + (c.now ? " (atual)" : "")).join(", ") + "."));
  }
  t.chooser = { title, items, sel: Math.max(0, items.findIndex((c) => c.now)), typed: "" };
  t.scr.grab = true;
}

// the items the text typed fits (in its order: those that start with it,
// then those that hold it)
function chooser_seen(c: Chooser): Choice[] {
  const typed = c.typed.toLowerCase();
  const text  = (x: Choice) => (x.text + " " + x.note).toLowerCase();
  return [...c.items.filter((x) => x.text.toLowerCase().startsWith(typed)), ...c.items.filter((x) => !x.text.toLowerCase().startsWith(typed) && text(x).includes(typed))];
}

// a key while a chooser is open: the arrows pick (around), Enter chooses,
// a digit chooses that item, Esc shuts it, a character filters,
// Backspace takes one back; it takes every key
function term_chooser_key(t: Term, c: Chooser, key: string): void {
  const seen = chooser_seen(c);
  const shut = () => {
    t.chooser = null;
    t.scr.grab = t.panel?.focus ?? false;
  };
  if (key === "Up" || key === "Down") {
    c.sel = seen.length === 0 ? 0 : (c.sel + (key === "Up" ? seen.length - 1 : 1)) % seen.length;
  } else if (key === "Enter" || (c.typed === "" && /^[1-9]$/.test(key) && Number(key) <= seen.length)) {
    const item = key === "Enter" ? seen[c.sel] : seen[Number(key) - 1];
    shut();
    item?.run();
  } else if (key === "Esc" || key === "Ctrl+C") {
    shut();
  } else if (key === "Backspace") {
    [c.typed, c.sel] = [c.typed.slice(0, -1), 0];
  } else if (Paint.text_width(key) === 1 && !key.includes("+")) {
    [c.typed, c.sel] = [c.typed + key, 0];
  }
}

// the chooser's lines, w wide: its title and keys, the items around the
// one picked (numbered, the one now marked), the filter typed
function term_chooser_lines(t: Term, w: number): Paint.Line[] {
  const c = t.chooser;
  if (c === null) {
    return [];
  }
  const seen = chooser_seen(c);
  c.sel = Math.min(c.sel, Math.max(0, seen.length - 1));
  const from = Math.max(0, Math.min(c.sel - CHOOSER + 1, seen.length - CHOOSER));
  const room = Math.min(32, Math.max(0, ...seen.map((x) => Paint.text_width(x.text)))) + 2;
  const head = [Paint.Run(c.title, { ...Paint.INK, b: true, c: Theme.ANSI.cmd }), Paint.Run("  ↑↓ escolhe · Enter confirma · Esc cancela · digite para filtrar", Paint.DIM)];
  const line = (x: Choice, k: number): Paint.Line => {
    const here = x === seen[c.sel];
    const mark = Paint.Run((here ? "▸ " : "  ") + (from + k < 9 && c.typed === "" ? from + k + 1 + ". " : "   "), here ? { ...Paint.INK, b: true } : Paint.DIM);
    const text = Paint.Run(x.text.padEnd(room), { ...Paint.INK, b: here, c: here ? Theme.ANSI.cmd : "" });
    const note = Paint.Run((x.now ? "atual" + (x.note === "" ? "" : " · ") : "") + x.note, x.now ? { ...Paint.INK, c: Theme.ANSI.here } : Paint.DIM);
    return Paint.runs_wrap([mark, text, note], w, true)[0];
  };
  const list = seen.length === 0 ? [[Paint.Run("  nada encontrado", Paint.DIM)]] : seen.slice(from, from + CHOOSER).map(line);
  const more = seen.length > CHOOSER ? [[Paint.Run("  " + seen.length + " itens", Paint.DIM)]] : [];
  const typed = c.typed === "" ? [] : [[Paint.Run("  filtro: ", Paint.DIM), Paint.Run(c.typed, { ...Paint.INK, b: true })]];
  return [Paint.runs_wrap(head, w, true)[0], ...list, ...more, ...typed];
}

// Commands
// --------

// a command typed (`/name arg`): runs it (pending while it works on);
// false if the text is none
function term_command(t: Term, text: string): boolean {
  const word = text.trim().split(/\s+/)[0];
  const cmd = term_commands(t.v).find(([use]) => use !== "" && use.split(" ")[0] === word);
  const run = cmd?.[3](t, text.trim().slice(word.length).trim());
  if (run instanceof Promise) {
    t.pending += 1;
    run.finally(() => {
      t.pending -= 1;
      term_idle(t);
    });
  }
  return cmd !== undefined;
}

// the commands and keys by group, in two columns, then the editing keys
function term_help(t: Term): void {
  const how   = (c: Cmd) => [c[0], c[1]].filter((x) => x !== "").join(", ");
  const left  = Math.max(...term_commands(t.v).map((c) => Paint.text_width(how(c)))) + 2;
  const right = Math.max(20, term_inner() - left);
  const row   = (c: Cmd) => Paint.runs_wrap([Paint.Run(c[2])], right, false).map((l, k) => [Paint.Run((k === 0 ? how(c) : "").padEnd(left)), ...l]);
  const bold  = { ...Paint.INK, b: true };
  const group = ([name, cmds]: [string, Cmd[]]) => [[Paint.Run(name, bold)], ...cmds.flatMap(row)];
  const edit  = Paint.runs_wrap([Paint.Run(Screen.EDITING)], term_inner(), false);
  t.out = t.out.concat(term_inset([[], ...term_groups(t.v).flatMap(group), [Paint.Run("Editing", bold)], ...edit]));
}

// attaches the image at a path (as typed or dropped: quoted, escaped, ~)
// to the next message, its bytes as read now (a Bun file inside a Blob
// adds nothing to it, Bun 1.3.14: the server got the text alone and
// refused the message); a file of another kind is refused here
async function term_image(t: Term, arg: string): Promise<void> {
  const file = arg.replace(/^(['"])(.*)\1$/, "$2").replace(/\\(.)/g, "$1").replace(/^~(?=\/|$)/, os.homedir());
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    term_note(t, "No file " + arg + ".");
    return;
  }
  const bytes = await Bun.file(file).bytes();
  if (View.image_kind(bytes) === null) {
    term_note(t, "Not attached: " + arg + " is no image. " + View.IMAGES);
    return;
  }
  t.imgs.push(new Blob([bytes]));
  term_note(t, "Attached " + arg + "; it goes with the next message (" + t.imgs.length + " waiting).");
}

// stops all that runs, or the agent named
function term_stop(t: Term, arg: string): void {
  if (arg === "") {
    return term_send(t, { $: "stop" });
  }
  const name = term_agent(t, arg);
  if (name === null) {
    return;
  }
  if (!t.v.agents.includes(name)) {
    term_note(t, "No agent " + arg + " at work.");
    return;
  }
  term_send(t, { $: "stop", name });
  term_note(t, "Parando " + Paint.text_clean(View.agent_shown(name)) + ".");
}

// the agent arg means (View.agent_find); null if several fit, listed for
// the person to say which
function term_agent(t: Term, arg: string): string | null {
  const found = View.agent_find(t.v, arg);
  if ("name" in found) {
    return found.name;
  }
  term_note(t, Paint.text_clean(View.agents_many(arg, found.many)));
  return null;
}

// the person's choice for block #id or #id+n (its name, View.block_name),
// open or closed, whatever it shows now: it holds until Fold all
function term_block(t: Term, arg: string, open: boolean): void {
  const name = /^#?(\d+)(?:\+(\d+))?$/.exec(arg);
  const id   = Number(name?.[1]);
  const n    = Number(name?.[2] ?? 1);
  if (name === null || block_row(View.view_body(t.v), id, n) === undefined) {
    term_note(t, arg === "" ? "Which block? " + (open ? "/open" : "/close") + " #id, as each block shows it." : "No block " + arg + " here.");
    return;
  }
  term_act(t, { $: open ? "Open" : "Shut", id, n });
  if (t.panel === null && (!open || n === 1)) {
    term_shown(t, id, n, open);
  }
}

// block #id+n as chosen, printed below what is printed, then a note: the
// scrollback is never written over, so the reader keeps their place, and
// an opened block shows where one reads (it may be far above); the page
// shows the choice in place at its next whole print
function term_shown(t: Term, id: number, n: number, open: boolean): void {
  const row = block_row(View.view_body(t.v), id, n);
  term_rows(t, open && row !== undefined ? [row] : [], false);
  term_note(t, (open ? "Opened " : "Closed ") + View.block_name(id, n) + ".");
}

// the row of block #id+n, among rows or inside their boxes
function block_row(rows: View.Row[], id: number, n: number): View.Row | undefined {
  for (const r of rows) {
    if ((r.$ === "Sum" || r.$ === "Box") && r.id === id && r.n === n) {
      return r;
    }
    const inner = r.$ === "Box" ? block_row(r.rows, id, n) : undefined;
    if (inner !== undefined) {
      return inner;
    }
  }
  return undefined;
}

// folds all (printed when the tops come), or unfolds
function term_fold(t: Term): void {
  if (t.v.page !== null) {
    return;
  }
  const on = t.v.fold === null;
  term_act(t, { $: "Fold", on });
  if (!on) {
    term_page(t);
  }
}

// shows an agent's chat, by the start of its name or label, or UniiChat's; no
// name lists the tabs
function term_tab(t: Term, arg: string): void {
  const main = arg.toLowerCase() === View.MAIN.toLowerCase();
  if (arg === "") {
    const tabs = View.view_tabs(t.v).map((tab): Choice => ({ text: Paint.text_clean(View.agent_label(tab.name ?? "") ?? tab.name ?? View.MAIN), note: tab.sub ?? "", now: tab.here, run: () => term_act(t, { $: "Goto", name: tab.name }) }));
    return term_choose(t, "Abas", tabs);
  }
  const name = main ? null : term_agent(t, arg);
  if (main || name !== null) {
    term_act(t, { $: "Goto", name });
  }
}

// moves the pick one step (a key)
function term_move(t: Term, move: Move): void {
  term_act(t, { $: "Move", move });
}

// the pick's effort or speed: the next value its model offers, the
// first after the last
function term_round(t: Term, move: "effort" | "speed"): void {
  const pick = t.v.pick;
  if (pick === null) {
    return;
  }
  const values = [...new Set(Pick.options(pick, move, t.v).map(([value]) => value))];
  if (values.length < 2) {
    return term_note(t, pick.model + " só tem " + (move === "speed" ? "a velocidade " : "o esforço ") + pick[move] + ".");
  }
  const next   = values[(values.indexOf(pick[move]) + 1) % values.length];
  if (next !== undefined && next !== pick[move]) {
    term_act(t, { $: "Move", move, to: next });
  }
}

// a part of the pick: to the value given, or, none, the values it may
// take, the pick's marked
function term_pick(t: Term, move: Move, arg: string): void {
  const knob = View.view_pick(t.v).find((k) => k.move === move);
  if (arg !== "" || knob === undefined || t.v.pick === null) {
    term_act(t, { $: "Move", move, to: arg });
    return;
  }
  // a model two vendors offer is listed under each (/model vendor:model
  // picks the other's), the profiles under their own head
  const pick  = t.v.pick;
  const opts  = Pick.options(pick, move, t.v);
  const head  = (p: Pick) => (p.profile !== undefined ? "profiles" : p.vendor);
  const now   = ([part, p]: [string, Pick]) => (part === knob.text && head(p) === head(pick) ? part + " (now)" : part);
  const heads = [...new Set(opts.map(([, p]) => head(p)))];
  const group = (v: string) => [...new Set(opts.filter(([, p]) => head(p) === v).map(now))].join(", ");
  const twins = move === "model" && heads.length > 1 && opts.some(([part, p]) => p.profile === undefined && Pick.twin(p.vendor, part, t.v.vendors));
  const list  = twins ? heads.map((v) => v + ": " + group(v)).join("; ") : [...new Set(opts.map(now))].join(", ");
  const how   = twins ? "/model <model>, or /model <vendor>:<model>" : "/" + move + " <" + move + ">";
  if (!t.scr.tty) {
    return term_note(t, move[0].toUpperCase() + move.slice(1) + "s: " + list + ". Pick one with " + how + ".");
  }
  // each value once (a model under each vendor offering it, when two do),
  // its vendor or "profiles" beside it
  const seen  = new Set<string>();
  const items = opts.flatMap(([part, p]): Choice[] => {
    const to = twins && p.profile === undefined ? head(p) + ":" + part : part;
    if (seen.has(to)) {
      return [];
    }
    seen.add(to);
    return [{ text: part, note: move === "model" ? head(p) : "", now: part === knob.text && head(p) === head(pick), run: () => term_act(t, { $: "Move", move, to }) }];
  });
  term_choose(t, { model: "Modelo", effort: "Esforço", speed: "Velocidade" }[move as string] ?? move, items);
}

// the MCP servers the server's config sets, on or off in this chat; with
// a name, that one switched
function term_mcp(t: Term, arg: string): void {
  if (arg !== "") {
    term_act(t, { $: "Plug", name: arg });
    return;
  }
  const list = t.v.mcp.map((p) => p.name + (p.on ? " (on)" : " (off)"));
  if (t.scr.tty && list.length > 0) {
    return term_choose(t, "Servidores MCP (Enter liga ou desliga)", t.v.mcp.map((p): Choice => ({ text: p.name, note: p.on ? "ligado" : "desligado", now: false, run: () => term_act(t, { $: "Plug", name: p.name }) })));
  }
  term_note(t, list.length === 0 ? "No MCP servers: the server's config sets none." : "MCP servers: " + list.join(", ") + ". Turn one on or off with /mcp <name>.");
}

// /copy: Unii's last answer, or its n-th code block, to the clipboard of
// the terminal shown, by OSC 52 (over ssh too; tmux passes it on with
// set-clipboard on)
function term_copy(t: Term, arg: string): void {
  const n = arg === "" ? 0 : Number(arg);
  if (!Number.isInteger(n) || n < 0) {
    return term_note(t, "Use /copy para a última resposta, ou /copy 2 para o segundo bloco de código dela.");
  }
  const got = View.view_copy(t.v, n);
  if (typeof got === "string") {
    return term_note(t, got);
  }
  process.stdout.write("\x1b]52;c;" + Buffer.from(got.text).toString("base64") + "\x07");
  const size = Buffer.byteLength(got.text);
  const tmux = process.env.TMUX ? " No tmux, precisa de set -g set-clipboard on." : "";
  term_note(t, "Copiado: " + got.what + " (" + size + (size === 1 ? " byte" : " bytes") + ")." + tmux);
}

// the memory mode (Html.ts MODES), or with a name, that one
function term_mode(t: Term, arg: string): void {
  if (arg === "standard" || arg === "conversation") {
    term_act(t, { $: "Talk", on: arg === "conversation" });
    return;
  }
  const talk = t.v.talk;
  const now = talk === null ? "standard" : "conversation, from message " + talk.from + ", " + Math.round(talk.used * 100) + "% of its space used";
  term_note(t, (arg === "" ? "" : "No mode " + arg + ". ") + "The memory mode is " + now + ". /mode standard or /mode conversation switches it.");
}

async function term_export(t: Term): Promise<void> {
  const res  = await term_get(t, "/export", "export");
  const file = process.cwd() + "/unii-memory.json";
  if (res !== null) {
    await Bun.write(file, res);
    term_note(t, "Your data is in " + file + ".");
  }
}

// this computer's Claude and ChatGPT chats, and the websites' exports
// given (EXPORT), not imported yet, as the words want (claude, chatgpt;
// Import.Want: since a day; tools; -#n: not session n): without go,
// what it finds (sessions: and the list); with go, sent;
// pause, resume: the import running
async function term_import(t: Term, arg: string): Promise<void> {
  if (/^(pause|resume)$/.test(arg)) {
    return term_send(t, { $: "go", on: arg === "resume" });
  }
  const given = arg.replace(SINCE, "").split(/\s+/).filter((w) => w !== "");
  const files = given.filter((w) => EXPORT.test(w)).map((w) => w.replace(/^~(?=\/)/, os.homedir()));
  const words = given.filter((w) => !EXPORT.test(w)).map((w) => w.toLowerCase());
  const apps  = Import.APPS.filter((app) => words.includes(app.toLowerCase()));
  const want  = { off: [] as string[], since: arg.match(SINCE)?.[1] ?? "", tools: words.includes("tools") };
  if (words.some((w) => !/^(tools|sessions|go|-#\d+)$/.test(w) && !Import.APPS.some((app) => app.toLowerCase() === w))) {
    term_note(t, "Not understood. " + HOW);
    return;
  }
  term_note(t, "Looking for Claude and ChatGPT chats on this computer…");
  const read = await Promise.all([...IMPORTS.map(term_sessions), ...files.map(export_sessions)]).catch((e) => String(e.message ?? e));
  if (typeof read === "string") {
    term_note(t, "Not imported: " + read);
    return;
  }
  const sessions = read.flat().filter((s) => apps.length === 0 || apps.includes(s.app));
  const done  = await term_get(t, "/api/imported", "read what Unii has");
  if (done === null) {
    return;
  }
  const old   = await done.json();
  const shown = Import.import_plan(sessions, want, old).sessions;
  want.off    = shown.filter((s, k) => words.includes("-#" + (k + 1))).map(Import.import_id);
  const plan  = Import.import_plan(sessions, want, old);
  const found = "Found " + Import.import_count(plan.msgs, "new ") + ". ";
  if (plan.msgs === 0) {
    term_note(t, plan.first === "" ? Import.OLD : found + HOW);
    return;
  }
  if (!words.includes("go")) {
    const which = words.includes("sessions") ? shown.map((s, k) => "\n- #" + (k + 1) + " " + s.app + ": " + Import.import_line(s) + (want.off.includes(Import.import_id(s)) ? " (left out)" : "")).join("") + "\n" : "";
    const go    = "To import them, type:\n\n```\n/import " + (arg + " go").trim() + "\n```";
    term_rows(t, View.entry_rows(null, "note", found + which + "\n" + go + "\n\n" + HOW), false);
    return;
  }
  term_note(t, found + "Sending them…");
  term_send(t, { $: "import", body: () => Import.import_body(plan.picked) });
}

// a dir's sessions (none if it is missing), a file at a time
async function term_sessions(dir: string): Promise<Import.Session[]> {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map((f) => dir + "/" + (WIN ? String(f).replaceAll("\\", "/") : f)).filter(Import.import_file) : [];
  const found: Import.Session[] = [];
  for (const f of files) {
    found.push(...[await Import.import_session(Bun.file(f), "log")].filter((s) => s !== null));
  }
  return found;
}

// a site's export file's sessions
async function export_sessions(path: string): Promise<Import.Session[]> {
  if (!fs.existsSync(path)) {
    throw new Error("no file " + path);
  }
  return Import.import_export(Bun.file(path));
}

// the pending list (Tasks.ts), printed as a note with its links; with an
// id, that task whole
function term_tasks(t: Term, arg: string): void {
  if (arg === "") {
    term_rows(t, View.entry_rows(null, "note", View.tasks_md(t.v)), false);
    return;
  }
  if (/^aguardando$/i.test(arg.trim())) {
    term_rows(t, View.entry_rows(null, "note", View.tasks_md(t.v, null, true)), false);
    return;
  }
  const got = View.task_args(t.v, arg, false);
  if (typeof got === "string") {
    return term_note(t, got);
  }
  term_rows(t, View.entry_rows(null, "note", View.tasks_md(t.v, got.task)), false);
}

// the Mesa (View.desk_md): the tasks by whose move it is; a project's
// only, given one
function term_desk(t: Term, arg: string): void {
  term_rows(t, View.entry_rows(null, "note", View.desk_md(t.v, arg.trim())), false);
}

// a task resolved: done (with a choice, by its text or number), dropped,
// opened again; each with a comment; go: Unii told now
function term_task(t: Term, arg: string, state: "done" | "dropped" | "open", go: boolean): void {
  const got = View.task_args(t.v, arg, state === "done");
  if (typeof got === "string") {
    return term_note(t, got);
  }
  // an option that's an order to Unii (acts, R5) tells it at once, as
  // the server does anyway: said so here too
  const order = state === "done" && got.answer !== undefined && View.act_unii(got.task, got.answer);
  term_act(t, { $: "Task", task: got.task.id, state, ...(got.answer === undefined ? {} : { answer: got.answer }), note: got.note, go: go || order, ...(got.fields === undefined ? {} : { fields: got.fields }) });
}

// a task concluded with the answers Unii recommends (View.task_accept)
function term_accept(t: Term, arg: string): void {
  const got = View.task_args(t.v, arg, false);
  if (typeof got === "string") {
    return term_note(t, got);
  }
  term_act(t, { $: "TaskAccept", task: got.task.id, ...(got.note === "" ? {} : { note: got.note }) });
}

// a task of Unii's asked after ("Cobrar agora"): a message in its thread
function term_chase(t: Term, arg: string): void {
  const got = View.task_args(t.v, arg, false);
  if (typeof got === "string") {
    return term_note(t, got);
  }
  term_act(t, { $: "TaskSay", task: got.task.id, text: View.CHASE });
}

// a task's fields answered (campo=valor), kept as a draft: not concluded
function term_draft(t: Term, arg: string): void {
  const got = View.task_args(t.v, arg, false);
  if (typeof got === "string") {
    return term_note(t, got);
  }
  const given = View.fields_args(got.task, got.note);
  if (typeof given === "string") {
    return term_note(t, given);
  }
  if (Object.keys(given.fields).length === 0) {
    return term_note(t, (got.task.fields ?? []).length === 0 ? "A pendência " + got.task.id + " não tem campos." : "Informe as respostas como campo=valor, por exemplo /rascunho " + got.task.id + " 1=a.");
  }
  term_act(t, { $: "TaskDraft", task: got.task.id, fields: given.fields });
}

// a message about a task, in its thread (a turn of Unii's, the task
// not concluded); none: the task whole, its thread with it
function term_talk(t: Term, arg: string): void {
  const got = View.task_args(t.v, arg, false);
  if (typeof got === "string") {
    return term_note(t, got);
  }
  if (got.note === "") {
    return term_rows(t, View.entry_rows(null, "note", View.tasks_md(t.v, got.task)), false);
  }
  term_act(t, { $: "TaskSay", task: got.task.id, text: got.note });
}

// the footer's line of the pending list, if any is open
function term_tasks_line(v: View.View, w: number): Paint.Line[] {
  const text = View.tasks_footer(v, w);
  return text === "" ? [] : [[Paint.Run(text, Paint.DIM)]];
}

async function term_logout(t: Term): Promise<void> {
  await View.post(t.url + "/api/logout", {}, Client.auth(t.token));
  const conf = Client.read("tui");
  delete conf.tokens?.[Client.host(t.url)];
  Client.write("tui", conf);
  term_note(t, "Signed out. Run unii to sign in again.");
  term_quit(t);
}

// a GET of the server; failing, a note says it could not do `what`
async function term_get(t: Term, path: string, what: string): Promise<Response | null> {
  const res = await fetch(t.url + path, { headers: Client.auth(t.token) }).catch(() => null);
  if (res === null || !res.ok) {
    term_note(t, "Could not " + what + ": " + (res === null ? "no connection" : "HTTP " + res.status) + ".");
    return null;
  }
  return res;
}

// quits, telling the server, once all printed is out
// (a write's callback comes after those before it), with exitCode
function term_quit(t: Term): void {
  t.v.ws?.close(View.QUIT);
  term_paint(t);
  process.stdout.write("", () => process.exit());
}

// quits at a signal (the terminal may be gone: nothing printed)
function term_bye(t: Term): void {
  t.v.ws?.close(View.QUIT);
  process.exit(0);
}

// a page for the browser: its link printed (a terminal reached over ssh
// has no browser of its own), then opened in the browser here, if any
function term_browse(t: Term, what: string, url: string): void {
  term_note(t, what + ": " + url);
  browse(url);
}

// a link opened in the browser here, if any: a Linux with no desktop has
// no xdg-open (spawning one missing throws)
function browse(url: string): void {
  const open = Bun.which(process.platform === "darwin" ? "open" : "xdg-open");
  if (open !== null) {
    child.spawn(open, [url], { detached: true, stdio: "ignore" }).unref();
  }
}

// a note printed above the footer
function term_note(t: Term, text: string): void {
  t.v.notes.push(text);
  term_draw(t);
}

// Printing
// --------

// what a server message prints, as it comes
function term_print(t: Term, msg: View.Server): void {
  const v     = t.v;
  const main  = v.page === null;
  switch (msg.$) {
    case "view": {
      if (main && v.fold === null) {
        term_after(t);
      }
      return;
    }
    case "know": {
      if (main) {
        term_settle(t);
      }
      return;
    }
    case "entry": {
      if (msg.agent !== v.page?.name) {
        return;
      }
      // a page's log comes again at each reconnect
      const text = term_logged(t, msg.kind, msg.text);
      const page = msg.agent ?? "";
      const n    = v.page?.log?.length ?? 0;
      if (main ? msg.id !== undefined && msg.id <= t.last : n <= (t.logs.get(page) ?? 0)) {
        return;
      }
      t.logs.set(page, n);
      t.last = main && msg.id !== undefined ? msg.id : t.last;
      const due  = main && msg.id !== undefined && View.part_due(v, [msg.id, 1], v.parts[v.parts.length - 2]);
      const head = due ? [View.Cap(View.AI)] : [];
      term_rows(t, [...head, ...View.entry_rows(msg.id ?? null, msg.kind, text, msg.images)], false);
      return;
    }
    case "root": {
      if (main && v.fold !== null) {
        term_page(t);
      }
      return;
    }
    case "zoom": {
      if (main) {
        term_shown(t, msg.id, msg.n, true);
      }
      return;
    }
  }
}

// the page shown, whole, alone on the screen and its scrollback (a new
// size, /fold): no other is printed then
function term_page(t: Term): void {
  if (t.panel !== null) {
    return term_draw(t);
  }
  term_rows(t, [], true);
  [t.last, t.wait, t.logs] = [-1, [], new Map()];
  term_show(t);
}

// what of the page shown was never printed, then its stream again
function term_show(t: Term): void {
  const page = t.v.page;
  t.flow = new Map([...t.flow].filter(([, done]) => done === Infinity));
  if (page !== null) {
    const from = t.logs.get(page.name) ?? 0;
    t.logs.set(page.name, Math.max(from, page.log?.length ?? 0));
    return term_rows(t, View.page_rows(t.v, page, from), false);
  }
  if (t.v.fold === null) {
    return term_after(t);
  }
  t.last = Math.max(t.last, View.view_count(t.v) - 1);
  term_rows(t, View.view_body(t.v), false);
}

// a new view of the chat: the parts holding a message past the one
// printed last print as they settle, after the AI notice if none is,
// since a terminal's scrollback is never written over; what changed
// above (new summaries) shows at the next whole print (a resize, /fold)
function term_after(t: Term): void {
  const head = t.last < 0 ? [View.Cap(View.AI)] : [];
  t.wait = t.wait.concat(t.v.parts.filter(([id, n]) => id + n - 1 > t.last));
  t.last = Math.max(t.last, View.view_count(t.v) - 1);
  term_rows(t, head, false);
  term_settle(t);
}

// prints the parts not printed, in order, up to one whose summary isn't
// known yet: from it on they show in the footer till it is (an import's
// blocks, the oldest built last)
function term_settle(t: Term): void {
  const rows = View.view_rows(t.v, t.wait);
  const wait = rows.findIndex((r) => View.rows_wait(t.v, r));
  const done = wait < 0 ? rows.length : wait;
  t.wait = t.wait.slice(done);
  term_rows(t, rows.slice(0, done).flat(), false);
}

// prints what streams that no piece to come changes, a message at a
// time: whole once a message after it started, else its settled blocks;
// a message with a part left holds back those after it
function term_flow(t: Term): void {
  const live = View.view_stream(t.v);
  for (const [l, done] of t.flow) {
    if (done === Infinity && !live.includes(l)) {
      t.flow.delete(l);
    }
  }
  for (const [k, l] of live.entries()) {
    const done  = t.flow.get(l) ?? 0;
    const end   = done + View.entry_settled(l.kind, l.text.slice(done), k < live.length - 1);
    const piece = piece_trim(l.text.slice(done, end));
    if (piece !== "") {
      t.flow.set(l, end);
      term_rows(t, View.entry_rows(null, l.kind, piece), false);
    }
    if (piece_trim(l.text.slice(t.flow.get(l) ?? 0)) !== "") {
      return;
    }
  }
}

// the part of a message logged not printed yet: what follows the printed
// head of the first message streaming of its kind that it starts with;
// that one prints no more
function term_logged(t: Term, kind: Kind, text: string): string {
  const fresh = View.view_stream(t.v).filter((l) => !t.flow.has(l)).map((l): [View.Live, number] => [l, 0]);
  const heads = [...t.flow].filter(([, done]) => done < Infinity).concat(fresh);
  const at    = heads.findIndex(([l, done]) => l.kind === kind && text.startsWith(l.text.slice(0, done).trim()));
  if (at < 0) {
    return text;
  }
  for (const [l] of heads.slice(0, at + 1)) {
    t.flow.set(l, Infinity);
  }
  const [l, done] = heads[at];
  return piece_trim(text.slice(l.text.slice(0, done).trim().length));
}

// a piece of a message as printed: no blank lines around it
function piece_trim(text: string): string {
  return text.replace(/^\s*\n/, "").trimEnd();
}

// rows to print above the footer (with wipe: alone on the screen), after
// the notes before them, painted
function term_rows(t: Term, rows: View.Row[], wipe: boolean): void {
  t.out  = wipe ? [] : t.out;
  t.wipe = t.wipe || wipe;
  t.out  = t.out.concat(term_lines(t.v.notes.splice(0).map(View.Cap)), term_lines(rows));
  term_draw(t);
}

// rows as lines, after a blank line, in the margin
function term_lines(rows: View.Row[]): Paint.Line[] {
  return term_inset(rows.length === 0 ? [] : [[], ...Paint.rows_lines(rows, term_inner())]);
}

function term_inset(lines: Paint.Line[]): Paint.Line[] {
  const pad = Paint.Run(" ".repeat(MARGIN));
  return lines.map((l) => [pad, ...l]);
}

// the width inside the margins: the chat's, on the full screen
function term_inner(): number {
  const w = Screen.screen_width();
  return w - (FULL ? Panel.panel_width(w) : 0) - 2 * MARGIN;
}

// a new size: the page laid out again, at the new width, once the size
// settles
function term_resize(t: Term): void {
  clearTimeout(t.settle);
  t.settle = setTimeout(() => term_page(t), SETTLE);
}

// a paint, a frame from now, unless one is due
function term_draw(t: Term): void {
  if (!t.due) {
    t.due = true;
    setTimeout(() => term_paint(t), FRAME);
  }
}

// prints the lines due, the notes and what of the stream settled, then
// the footer: the rest of the stream (its last lines that fit), the rule,
// the input, a rule (offline while the socket is not open), the tabs.
// The screen's top row stays free: an erase from the top left clears
// the screen, which tmux keeps in its scrollback at each paint
function term_paint(t: Term): void {
  t.out = t.out.concat(term_lines(t.v.notes.splice(0).map(View.Cap)));
  if (t.panel !== null) {
    return term_frame(t, t.panel);
  }
  term_flow(t);
  const w     = Screen.screen_width();
  const iw    = term_inner();
  const room  = (process.stdout.rows || 24) - 1;
  const off   = t.scr.off;
  const input = off ? null : Screen.screen_input(t.scr, iw, room - 3, View.HINT + " · /help");
  // with no input, the rule under it only to say offline
  const under = off && t.v.up ? [] : [Paint.rule_text(t.v.up ? "" : "offline", iw, OFFLINE)];
  const menu  = t.chooser !== null ? term_chooser_lines(t, iw) : term_menu_lines(t, iw);
  const own   = term_inset([...menu, Paint.rule_line(t.v, iw), ...(input?.lines ?? []), ...under, ...term_tasks_line(t.v, iw), Paint.tabs_line(t.v, iw)]);
  const rest  = View.view_stream(t.v).map((l) => ({ kind: l.kind, text: l.text.slice(t.flow.get(l) ?? 0) }));
  const held  = t.v.page === null ? View.view_rows(t.v, t.wait).flat() : [];
  const tail  = term_lines([...held, ...View.view_tail(t.v, rest)]).flatMap((l) => Paint.runs_wrap(l, w, true));
  const above = tail.slice(Math.max(0, tail.length - room + own.length));
  const at    = input === null ? null : { row: above.length + menu.length + 1 + input.at.row, col: input.at.col + MARGIN };
  Screen.screen_paint(t.scr, t.out, t.wipe, [...above, ...own], at);
  t.out  = [];
  t.wipe = false;
  t.due  = false;
}

// the full screen: the chat whole (its stream, what waits for the
// usage limit or a summary) and what was printed under it, the pending
// list beside, the footer as term_paint's at the full width (the list's
// line in it only if the column doesn't fit); the cursor in the input
function term_frame(t: Term, p: Panel.Panel): void {
  Panel.panel_extra(p, t.out);
  const w     = Screen.screen_width();
  const fw    = w - 2 * MARGIN;
  const h     = process.stdout.rows || 24;
  const m     = t.modal;
  const off   = t.scr.off || p.focus || m?.focus === "acts";
  const hint  = m !== null ? Modal.modal_hint(m) : p.focus ? "Ctrl+P ou Esc volta à mensagem" : View.HINT + " · /help";
  const input = t.scr.off ? null : Screen.screen_input(t.scr, fw, Math.max(1, Math.floor(h / 3)), hint);
  const under = t.scr.off && t.v.up ? [] : [Paint.rule_text(t.v.up ? "" : "offline", fw, OFFLINE)];
  const tasks = Panel.panel_width(w) === 0 ? term_tasks_line(t.v, fw) : [];
  const menu  = t.chooser !== null ? term_chooser_lines(t, fw) : term_menu_lines(t, fw);
  const foot  = term_inset([...menu, Paint.rule_line(t.v, fw), ...(input?.lines ?? []), ...under, ...tasks, Paint.tabs_line(t.v, fw)]);
  // ponytail: the whole chat laid out at each paint (a frame apart while
  // it streams); bounded by the memory's view, cache by its parts if a
  // long one lags
  const body  = m !== null ? term_inset([[], ...Modal.modal_lines(m, t.v, term_inner())]) : term_lines([...View.view_body(t.v), ...View.view_tail(t.v)]);
  const lines = Panel.panel_frame(p, t.v, body, foot, w, h);
  const at    = input === null || off ? null : { row: h - foot.length + menu.length + 1 + input.at.row, col: input.at.col + MARGIN };
  Screen.screen_frame(t.scr, lines, at);
  t.out = [];
  t.wipe = false;
  t.due = false;
}

// Main
// ====

// the chat in this terminal: signed in first, if not yet (the server
// it signs in to becomes the default); on the full screen unless classic
export async function main(given: string | undefined, classic = false): Promise<void> {
  const conf = Client.read("tui");
  const url = Client.server(given, conf);
  const tokens = conf.tokens ?? {};
  let token: string | undefined = tokens[Client.host(url)];
  if (!await Client.signed(url, token)) {
    token = await Client.login(url, "o terminal em " + os.hostname());
    Client.write("tui", { ...conf, url, tokens: { ...tokens, [Client.host(url)]: token } });
  }
  const t = term_new(url, token!);
  if (!classic && t.scr.tty) {
    FULL = true;
    t.panel = Panel.panel_new();
    Screen.screen_full(t.scr);
  }
  term_connect(t);
}
