// View
// ====
// What a view of the chat holds and draws, shared by the web (main.ts)
// and the terminal (Term.ts), with no DOM: `view_hear` takes the server's
// messages, `view_act` the person's acts, and both answer what to send
// (by the Link). The main chat shows what its agent sees (Server.ts): the
// view's parts as blocks ("nx"), from the turn on each message whole
// (0x) and its thoughts, then what streams or what the turn waits on. An
// agent's page is its log, kept live. The AI notice (AI) opens the chat
// and comes again before a message in another 3-hour window.

import type { Kind, Parked, Vendor } from "./AskAI.ts";
import * as Call from "./Call.ts";
import * as Md from "./Md.ts";
import { LABELS, type Fall, type Move, Pick } from "./Pick.ts";
import { GLYPH, WHO } from "./Theme.ts";
import type { Timer } from "./Timer.ts";
import type { Field, Task, Values } from "./Tasks.ts";
import * as Deps from "./TaskDeps.ts";

// Types
// =====

// the n messages from id on (n a power of two)
export type Part = [number, number];

// a message logged: its kind, its text, its date (ISO), its images
export type Entry = { kind: Kind; text: string; date?: string; images?: string[] };

// a summary: its text, its last message's date
export type Node = { text: string; to: string };

export type Live = { kind: Kind; text: string };

// log: null while it loads; pick: what its agent runs on (null: not
// known yet, or its model no longer offered)
export type Page = { name: string; log: Entry[] | null; live: Live[]; pick: Pick | null };

// an import's time done and in all (weighed as Server.ts Chat.time), why
// paused, its messages, its nodes not built by level
export type Progress = { done: number; total: number; why: string | null; msgs: number; open: number[] };

// an import's minutes a unit of its time (the compactor, measured on a
// real import: 990 s for 162,900)
const PACE = 1e-4;

// a new chat's messages: the hello (Server.ts)
export const OPENING = 1;

// what a turn waits on while nothing streams: nothing (""), SUMMARIES,
// or the first piece of the model it names (a request out, no tool
// running; a running tool shows its call)
export const SUMMARIES = "summaries";
export type Wait = string;

// agents: those at work; runs: what each runs on (Tools.shown);
// vendors, models, profiles: those offered;
// limits: the calls waiting for a usage
// limit, by TURN or agent name; timers: the chat's schedules, each
// message's head; talk: conversation mode (null: standard) (Server.ts
// Chat.state)
export type State = {
  busy      : boolean;
  wait      : Wait;
  agents    : string[];
  runs      : Record<string, Pick>;
  labels?   : Record<string, string>; // the agents' labels, by name (Tools.start)
  pick      : Pick | null;
  vendors   : Vendor[];
  models    : string[];
  profiles? : Record<string, Fall[]>;
  importing : Progress | null;
  limits    : Record<string, Parked>;
  timers    : Timer[];
  mcp       : Plug[];
  tasks     : Task[]; // the pending list: open, then closed lately (Tasks.tasks_view)
  skills    : Skilled[]; // the skills on the devices open now (Machine.skills), for the terminal to complete
  talk      : Talk | null;
};

// conversation mode (Memory.ts): its first message whole, the share of
// its space its messages take (0 to 1)
export type Talk = { from: number; used: number };

// an MCP server of the server's config (Mcp.ts), on or off in this chat
export type Plug = { name: string; on: boolean };

// a skill on a device open now, as the state lists it (Server.ts)
export type Skilled = { name: string; description: string; device: string };

// fold: the tops shown (null: not folded); nodes and whole: the summaries
// ("id+n") and messages known; open: the blocks opened (true) or shut by
// hand; minds: the thoughts after each message; pages: the agents' asked
// for; page: the one shown (null: UniiChat's); the Link's: this view's
// id, acts not answered, socket (up: it showed the chat)
export type View = State & {
  parts : Part[];
  turn  : number;
  fold  : Part[] | null;
  nodes : Map<string, Node>;
  whole : Map<number, Entry>;
  open  : Map<string, boolean>;
  live  : Live[];
  minds : Map<number, string[]>;
  pages : Map<string, Page>;
  page  : Page | null;
  notes : string[];
  tab   : string;
  out   : Post[];
  ws    : WebSocket | null;
  up    : boolean;
  flush : () => void;
};

export type Pack = { nodes?: Record<string, Node>; whole?: Record<string, Entry> };

// the server's messages (Server.ts documents them)
export type Server =
  | ({ $: "know" } & Pack)
  | { $: "view"; parts: Part[]; turn: number }
  | { $: "zoom"; id: number; n: number; parts: Part[] }
  | { $: "root"; parts: Part[] }
  | ({ $: "entry"; agent?: string; id?: number } & Entry)
  | { $: "delta"; agent?: string; kind: Kind; text: string; fresh?: boolean }
  | { $: "live"; agent?: string; live: Live[] }
  | ({ $: "state" } & State)
  | { $: "agent"; name: string; found: boolean; pick?: Pick | null }
  | { $: "note"; text: string }
  | ({ $: "ack"; id: string } & Answer)
  | { $: "jobs"; ids: string[] }
  | { $: "job"; id: string; job: unknown };

// a message a person sends: its text, its images
export type Sent = { text: string; images?: Blob[] };

// an act's answer: why refused (status: HTTP's), a recording's words, an
// import's still running; a body, made anew for each post (what fetch
// takes)
export type Answer = { error?: string; status?: number; text?: string; going?: boolean };
export type Body   = () => any;

// the acts a view sends (out: a job's output): changes, then reads; a
// message's body is its images (sizes given), then its text
export type Client =
  | { $: "say"; sizes: number[]; body: Body }
  | { $: "import"; body: Body }
  | { $: "voice"; type: string; body: Body }
  | { $: "stop"; name?: string } // all work, or the agent named, or TURN
  | { $: "goal"; text: string | null } // the goal set (/goal), or none (/halt)
  | { $: "go"; on: boolean } // the import's: resume (true) or pause
  | { $: "pick"; to: Pick }
  | { $: "mcp"; name: string; on: boolean } // an MCP server turned on or off in this chat
  | { $: "talk"; on: boolean } // conversation mode on, or standard
  | { $: "out"; job: string; out: object }
  | { $: "unschedule"; id: string } // a schedule cancelled
  | { $: "task"; task: string; state: Task["state"]; answer?: string; note?: string; go?: boolean; fields?: Record<string, unknown> } // a pending task resolved (go: Unii told now; fields: answers laid over its draft)
  | { $: "task_draft"; task: string; fields: Record<string, unknown> } // a task's fields answered, kept as a draft
  | { $: "task_say"; task: string; text: string } // a message in a task's thread (a message of the chat, marked)
  | { $: "tasks_tell" } // the resolutions untold, told to Unii now
  | { $: "zoom"; part: Part }
  | { $: "root" }
  | { $: "agent"; name: string };

// an act not answered: with its id, the socket it went by, what its
// answer does, what a message said (shown while offline: view_tail)
export type Post = { msg: Client & { id: string }; ws: WebSocket | null; done: (a: Answer) => void; said: string };

// how a view reaches the server: a socket by its query, a post, what it
// does with a message, and, one lost (up: it showed the chat), whether to
// open another
export type Link = {
  open : (query: string) => WebSocket;
  post : (path: string, body: any) => Promise<Response>;
  hear : (msg: Server) => void;
  lost : (up: boolean) => Promise<boolean>;
};

// what a person does
export type Act =
  | ({ $: "Send" } & Sent)                      // Enter: a message, or, empty, interrupt
  | { $: "Move"; move: Move; to?: string }      // the pick moves (to: to that value)
  | { $: "Open"; id: number; n: number }        // a click on a block
  | { $: "Shut"; id: number; n: number }        // a click on an open block's bar
  | { $: "Fold"; on: boolean }                  // fold all, unfold all
  | { $: "Goto"; name: string | null }          // a tab, a name, the logo (null: UniiChat)
  | { $: "Unschedule"; id: string }             // a schedule's Cancel
  | { $: "Plug"; name: string }                 // an MCP server turned on if off, else off
  | { $: "Task"; task: string; state: Task["state"]; answer?: string; note?: string; go?: boolean; fields?: Record<string, unknown> } // a pending task's Concluir, Descartar, Reabrir, or a choice
  | { $: "TaskDraft"; task: string; fields: Record<string, unknown> } // a task's field answered (not concluded)
  | { $: "TaskSay"; task: string; text: string }  // a message in a task's thread
  | { $: "TasksTell" }                          // Avisar o Unii agora
  | { $: "Talk"; on: boolean }                  // conversation mode, or standard

// what a page draws, top to bottom
export type Row =
  | { $: "Sum"; id: number; n: number; text: string; call: Call.Call | null }                     // a block: nx, its summary (call: a tool call's, word for word)
  | { $: "Box"; id: number; n: number; text: string; rows: Row[] }                              // a block open: its bar
  | { $: "Msg"; id: number | null; kind: Kind; who: string; text: string; body: Md.Block[]; call: Call.Call | null; images: string[] } // a message whole: 0x (who: its speaker or "↳ result", named on its block; call: a tool call's, drawn as Call.ts reads it)
  | { $: "Cap"; text: string }                                                                  // a line about the page

export type Tab = { name: string | null; here: boolean; text: string; sub?: string }; // sub: a labeled agent's name, shown after its label

// hint: the knob's value, named (a tooltip; the site's note when it
// changes); choices: its menu (the site's; none: shown only)
export type Knob = { text: string; move: Move; hint: string; choices: Choice[] };

// a value a knob can take: text, as shown (a model by its label alone,
// its vendor heading its group); to, as the move takes it; here, the
// pick's; vendor, the vendor of a model first of its vendor's
export type Choice = { text: string; to: string; move: Move; here: boolean; vendor: string | null };

// what /api/prompts gives: each prompt as used, and its built-in default
export type Prompts = Record<"prompt" | "compact", { text: string; def: string }>;

// Constants
// =========

export const MAIN = "UniiChat";

// UniiChat's turn, as a stop names it among the agents at work
export const TURN = "Unii's turn";

// the messages' version, in a view's query; one more for each change an
// older view would misread
export const WIRE = 3;

// the Link's: the most a live socket hears nothing (ms); the wait to open
// another; the server's tick; a client's close as it quits
export const PING  = 10000;
export const RETRY = 1000;
export const TICK  = "+";
export const QUIT  = 4000;

// the most a socket message may be (bytes; Bun's own cap is 16 MiB),
// room for a tool's largest output, an image (Machine.ts). A bigger one
// closes its socket (Server.ts)
export const FRAME = 2 ** 22;

export const HINT = "Message UniiChat";

// the disclosure both views show (EU AI Act art. 50, California SB 243,
// New York GBL art. 47, Anthropic's usage policy)
export const AI = "Unii is an AI, not a person, and can make mistakes.";

// the AI notice's period (ms)
const NOTICE = 3 * 60 * 60 * 1000;

const WAIT = "compressing…";
const SUMS = "compressing earlier messages…";

// under the messages sent while offline, still kept to send
const UNSENT = "Sends once connected.";

// the kinds an image may be, each by its mark at a byte of its first HEAD
const MARKS: Array<[string, number, string]> = [
  ["image/png", 0, "\x89PNG"],
  ["image/jpeg", 0, "\xFF\xD8\xFF"],
  ["image/gif", 0, "GIF8"],
  ["image/webp", 8, "WEBP"],
];
export const HEAD   = 12;
export const IMAGES = "Images are png, jpeg, gif or webp.";

// what models get of an image: scaled to FIT px at most, or as is if no
// larger and of IMAGE bytes at most; PIXELS, the most decoded (Memory.ts
// sends a larger one as is)
export const FIT    = 1568;
export const IMAGE  = 2 ** 20;
export const PIXELS = 2 ** 28;

// how a line of one tool call starts
const TOOL = "tool: ";
const FOLD = "The whole chat, folded into the fewest blocks.";

// Constructors
// ============

export function Cap(text: string): Row {
  return { $: "Cap", text };
}

// View
// ====

export function view_new(): View {
  return {
    busy      : false,
    wait      : "",
    agents    : [],
    runs      : {},
    pick      : null,
    vendors   : [],
    models    : LABELS,
    importing : null,
    limits    : {},
    timers    : [],
    mcp       : [],
    tasks     : [],
    skills    : [],
    talk      : null,
    parts     : [],
    turn      : Infinity,
    fold      : null,
    nodes     : new Map(),
    whole     : new Map(),
    open      : new Map(),
    live      : [],
    minds     : new Map(),
    pages     : new Map(),
    page      : null,
    notes     : [],
    tab       : crypto.randomUUID(),
    out       : [],
    ws        : null,
    up        : false,
    flush     : () => {},
  };
}

export function view_hear(v: View, msg: Server): Client[] {
  switch (msg.$) {
    case "know": {
      view_learn(v, msg);
      return [];
    }
    case "view": {
      v.parts = msg.parts;
      v.turn  = msg.turn;
      return v.fold === null ? [] : [{ $: "root" }];
    }
    case "zoom":
    case "jobs":
    case "job": {
      return [];
    }
    case "root": {
      v.fold = v.fold === null ? null : msg.parts;
      return [];
    }
    case "entry": {
      view_entry(v, msg);
      return [];
    }
    case "delta": {
      const live = view_live(v, msg.agent);
      if (live !== null) {
        live_push(live, msg.kind, msg.text, msg.fresh);
      }
      return [];
    }
    case "live": {
      const live = view_live(v, msg.agent);
      if (live !== null) {
        live_set(live, msg.live);
      }
      return [];
    }
    case "state": {
      const { $, ...state } = msg;
      Object.assign(v, state);
      AGENT_LABELS.clear();
      Object.entries(v.labels ?? {}).forEach(([name, label]) => AGENT_LABELS.set(name, label));
      for (const page of v.pages.values()) {
        page.pick = v.runs[page.name] ?? page.pick;
      }
      return [];
    }
    case "agent": {
      const page = v.pages.get(msg.name);
      if (page === undefined) {
        return [];
      }
      if (msg.found) {
        page.log = [];
        page.pick = msg.pick ?? page.pick;
        return [];
      }
      v.pages.delete(msg.name);
      if (v.page === page) {
        v.page = null;
      }
      v.notes.push("No agent " + msg.name + ".");
      return [];
    }
    case "note": {
      v.notes.push(msg.text);
      return [];
    }
    case "ack": {
      const post = v.out.find((p) => p.msg.id === msg.id);
      v.out = v.out.filter((p) => p !== post);
      post?.done(msg);
      return [];
    }
    default: {
      // a kind newer than this view: a unii runs the release it was
      // installed with (Term.ts), behind the server's
      return [];
    }
  }
}

export function view_act(v: View, act: Act): Client[] {
  switch (act.$) {
    case "Send": {
      const text   = act.text.trim();
      const images = act.images ?? [];
      // a `/word` reaching here is no command (the terminal ran its
      // own), but /goal (a message, sent as typed, set as the goal),
      // /halt, and a skill's name on an open device (sent as typed: the
      // server loads that skill for the turn, Chat.invoked): else it
      // errs, never goes to the AI as a message
      const word   = /^\/[a-z]+(?=\s|$)/i.exec(text)?.[0];
      const skill  = word !== undefined && v.skills.some((s) => "/" + s.name === word);
      const goal   = word === "/goal" ? text.slice(word.length).trim() : null;
      if (!view_typing(v)) {
        return [];
      }
      if (text === "" && images.length === 0) {
        return v.busy ? [{ $: "stop", name: TURN }] : [];
      }
      if (word === "/halt") {
        return [{ $: "goal", text: null }];
      }
      if (goal === "") {
        v.notes.push("/goal needs one: /goal <message>.");
        return [];
      }
      if (word !== undefined && goal === null && !skill) {
        v.notes.push(word + " is no command; nothing was sent. The terminal's /help lists its commands; the site's are in its ☰ menu.");
        return [];
      }
      const blob = new Blob([...images, text]);
      const say: Client = { $: "say", sizes: images.map((b) => b.size), body: () => blob };
      v.fold = null;
      return goal === null ? [say] : [{ $: "goal", text: goal }, say];
    }
    case "Move": {
      // from the last pick asked for and not acked, else the chat's
      const from = v.out.flatMap((p) => (p.msg.$ === "pick" ? [p.msg.to] : [])).at(-1) ?? v.pick;
      if (from === null) {
        return [];
      }
      const to = Pick.move(from, act.move, v, act.to);
      if (act.move === "speed" && Pick.options(from, "speed", v).length === 1) {
        v.notes.push(from.model + " has no fast.");
        return [];
      }
      if (to === null) {
        const parts = Pick.options(from, act.move, v).map(([part]) => part);
        v.notes.push("No " + [act.move, act.to].join(" ").trim() + "; one of: " + [...new Set(parts)].join(", ") + ".");
        return [];
      }
      return [{ $: "pick", to }];
    }
    case "Open": {
      v.open.set(act.id + "+" + act.n, true);
      return act.n === 1 ? [] : [{ $: "zoom", part: [act.id, act.n] }];
    }
    case "Shut": {
      v.open.set(act.id + "+" + act.n, false);
      return [];
    }
    case "Fold": {
      v.open.clear();
      v.fold = act.on ? [] : null;
      return act.on ? [{ $: "root" }] : [];
    }
    case "Goto": {
      if (act.name === null) {
        v.page = null;
        return [];
      }
      const known = v.pages.get(act.name);
      v.page = known ?? { name: act.name, log: null, live: [], pick: v.runs[act.name] ?? null };
      v.pages.set(act.name, v.page);
      return known === undefined ? [{ $: "agent", name: act.name }] : [];
    }
    case "Unschedule": {
      return [{ $: "unschedule", id: act.id }];
    }
    case "Talk": {
      return [{ $: "talk", on: act.on }];
    }
    case "Plug": {
      // from the last asked for and not acked, else the chat's
      const asked = v.out.flatMap((p) => (p.msg.$ === "mcp" && p.msg.name === act.name ? [p.msg.on] : [])).at(-1);
      const on = asked ?? v.mcp.find((p) => p.name === act.name)?.on;
      if (on === undefined) {
        const names = v.mcp.map((p) => p.name).join(", ");
        v.notes.push("No MCP server " + act.name + (names === "" ? "; the server's config sets none." : "; one of: " + names + "."));
        return [];
      }
      return [{ $: "mcp", name: act.name, on: !on }];
    }
    case "Task": {
      const t = v.tasks.find((x) => x.id === act.task);
      if (t === undefined) {
        v.notes.push("Pendência " + act.task + " não encontrada.");
        return [];
      }
      if (act.answer !== undefined && !t.choices.includes(act.answer)) {
        v.notes.push("A pendência " + t.id + " não tem a opção “" + act.answer + "”.");
        return [];
      }
      const waits = Deps.waits(v.tasks, t);
      if (act.state !== "open" && t.state === "open" && waits.length > 0) {
        v.notes.push(task_waits_said(t, waits));
        return [];
      }
      const note = act.note?.trim() ?? "";
      const fields = act.state === "done" && act.fields !== undefined && Object.keys(act.fields).length > 0 ? { fields: act.fields } : {};
      return [{ $: "task", task: t.id, state: act.state, ...(act.answer === undefined ? {} : { answer: act.answer }), ...(note === "" ? {} : { note }), ...(act.go ? { go: true } : {}), ...fields }];
    }
    case "TaskDraft": {
      const t = v.tasks.find((x) => x.id === act.task);
      if (t === undefined) {
        v.notes.push("Pendência " + act.task + " não encontrada.");
        return [];
      }
      return [{ $: "task_draft", task: t.id, fields: act.fields }];
    }
    case "TaskSay": {
      const t = v.tasks.find((x) => x.id === act.task);
      const text = act.text.trim();
      if (t === undefined || text === "") {
        v.notes.push(t === undefined ? "Pendência " + act.task + " não encontrada." : "Escreva uma mensagem sobre a pendência " + t.id + ".");
        return [];
      }
      return [{ $: "task_say", task: t.id, text }];
    }
    case "TasksTell": {
      return [{ $: "tasks_tell" }];
    }
  }
}

// Pending list
// ============

// the open tasks the user can resolve now (those that free others
// first, then the user's), those that wait for others (TaskDeps.ts),
// and those closed lately, as the server sent them (Tasks.tasks_view)
export function view_tasks(v: View): { open: Task[]; waiting: Task[]; closed: Task[] } {
  const blocked = Deps.blocked_ids(v.tasks);
  const open = v.tasks.filter((t) => t.state === "open");
  return { open: open.filter((t) => !blocked.has(t.id)), waiting: open.filter((t) => blocked.has(t.id)), closed: v.tasks.filter((t) => t.state !== "open") };
}

// why a task that waits can't be resolved yet
export function task_waits_said(t: Task, waits: string[]): string {
  return "A pendência " + t.id + " aguarda " + waits.join(", ") + ": resolva " + (waits.length === 1 ? "essa pendência" : "essas pendências") + " antes. Nada foi alterado.";
}

// "libera 3": how many open tasks wait for t (through others too); ""
// for none
export function task_frees_said(v: View, t: Task): string {
  const n = Deps.frees(v.tasks, t);
  return n === 0 ? "" : "libera " + n;
}

// the header's ✓ count: the open free to resolve; none, but some that
// wait: "+2" (so never a bare 0 beside a list that isn't empty)
export function tasks_count_said(open: number, waiting: number): string {
  return open === 0 && waiting > 0 ? "+" + waiting : String(open);
}

// what the list says with none open free to resolve
export function tasks_none_said(waiting: number): string {
  return waiting === 0 ? "Nenhuma pendência aberta." : "Nenhuma pendência para resolver agora.";
}

// "+2 aguardando outras pendências"; "" for none
export function tasks_waiting_said(n: number): string {
  return n === 0 ? "" : "+" + n + " aguardando outras pendências";
}

// the resolutions Unii hasn't seen yet
// (a task freed isn't one: Unii learns of it in its next turn)
export function view_untold(v: View): Task[] {
  return v.tasks.filter((t) => !t.told && !t.freed);
}

// a command's words ("P7 sim pode mesclar", "7 2", "p7"): its task, the
// choice it names (the longest that starts the rest, as written; else by
// its number), the comment after; else why not. A task with choices
// whose rest starts with a number none of them is (/ok P1 4 with 3):
// refused, nothing done, rather than "4" taken as a comment
export function task_args(v: View, arg: string, choose: boolean): { task: Task; answer?: string; note: string; fields?: Record<string, unknown> } | string {
  const m = /^\s*[Pp]?(\d+)(?=\s|$)\s*([\s\S]*)$/.exec(arg);
  if (m === null) {
    return "Qual pendência? Informe o id, como P7.";
  }
  const id = "P" + Number(m[1]);
  const task = v.tasks.find((t) => t.id === id);
  if (task === undefined) {
    return "Pendência " + id + " não encontrada.";
  }
  const given = choose ? fields_args(task, m[2]) : { fields: {}, rest: m[2] };
  if (typeof given === "string") {
    return given;
  }
  const rest = given.rest.trim();
  const fields = Object.keys(given.fields).length === 0 ? {} : { fields: given.fields };
  if (!choose || task.choices.length === 0) {
    return { task, note: rest, ...fields };
  }
  const low = rest.toLowerCase();
  const said = [...task.choices].sort((a, b) => b.length - a.length).find((c) => low === c.toLowerCase() || low.startsWith(c.toLowerCase() + " "));
  const num = said === undefined ? /^(\d+)(?=\s|$)/.exec(rest) : null;
  if (num !== null && (Number(num[1]) < 1 || Number(num[1]) > task.choices.length)) {
    const n = task.choices.length;
    return "Opção " + num[1] + " inválida: a pendência " + id + " tem " + n + (n === 1 ? " opção (1)." : " opções (1 a " + n + ").") + " Nada foi alterado.";
  }
  const answer = said ?? (num !== null ? task.choices[Number(num[1]) - 1] : undefined);
  const used = said !== undefined ? said.length : num !== null ? num[1].length : 0;
  return { task, answer, note: rest.slice(used).trim(), ...fields };
}

// a task's field by its id (any case) or its number from 1
export function field_ref(t: Task, ref: string): Field | null {
  const fields = t.fields ?? [];
  const by = fields.find((f) => f.id === ref) ?? fields.find((f) => f.id.toLowerCase() === ref.toLowerCase());
  const n = /^\d+$/.test(ref) ? Number(ref) : 0;
  return by ?? (n >= 1 && n <= fields.length ? fields[n - 1] : null);
}

// an answer as typed for a field: a choice by its text (any case) or
// number, many by commas, sim/não (s, n), a text as is; "" clears; else
// why not
export function field_value(f: Field, typed: string): string | string[] | { error: string } {
  const one = (x: string): string | null => {
    const low = x.trim().toLowerCase();
    if (f.kind === "yesno") {
      return ["sim", "s", "yes", "y"].includes(low) ? "sim" : ["não", "nao", "n", "no"].includes(low) ? "não" : null;
    }
    const n = /^\d+$/.test(low) ? Number(low) : 0;
    return f.choices.find((c) => c.toLowerCase() === low) ?? (n >= 1 && n <= f.choices.length ? f.choices[n - 1] : null);
  };
  if (f.kind === "text" || typed.trim() === "") {
    return f.kind === "multi" ? [] : typed;
  }
  const all = f.kind === "multi" ? typed.split(",").filter((x) => x.trim() !== "") : [typed];
  const got = all.map(one);
  const bad = all.find((_, k) => got[k] === null);
  if (bad !== undefined) {
    return { error: "O campo “" + f.label + "” não tem a opção “" + bad.trim() + "”. Opções: " + f.choices.map((c, k) => k + 1 + ") " + c).join(", ") + ". Nada foi alterado." };
  }
  return f.kind === "multi" ? (got as string[]) : got[0]!;
}

// the answers typed in a command's words (campo=valor, a value in
// quotes if it has spaces; a field by id or number), taken out of them;
// none for a task without fields; else why not. A quote left open
// (obs="sem fechar) or text stuck after the closing one (obs="a"b) is
// refused, rather than the answer cut where it seems to end
export function fields_args(t: Task, words: string): { fields: Record<string, unknown>; rest: string } | string {
  const fields: Record<string, unknown> = {};
  if ((t.fields ?? []).length === 0) {
    return { fields, rest: words };
  }
  let why: string | null = null;
  const rest = words.replace(/(^|\s)([A-Za-z0-9][A-Za-z0-9_-]*)=("[^"]*"(?=\s|$)|“[^”]*”(?=\s|$)|\S*)/g, (all, pre: string, ref: string, raw: string) => {
    if (/^["“]/.test(raw) && !/^("[^"]*"|“[^”]*”)$/.test(raw)) {
      why = why ?? "O valor de “" + ref + "” tem " + (/^("[^"]*"|“[^”]*”)./.test(raw) ? "texto colado depois da aspa de fechamento" : "uma aspa sem par") + ": feche as aspas e separe o resto com um espaço. Nada foi alterado.";
      return all;
    }
    const f = field_ref(t, ref);
    if (f === null) {
      why = why ?? "A pendência " + t.id + " não tem o campo “" + ref + "”. Campos: " + t.fields.map((x, k) => k + 1 + ") " + x.id).join(", ") + ". Nada foi alterado.";
      return all;
    }
    const value = field_value(f, /^["“]/.test(raw) ? raw.slice(1, -1) : raw);
    if (typeof value === "object" && !Array.isArray(value)) {
      why = why ?? value.error;
      return all;
    }
    fields[f.id] = value;
    return pre;
  });
  return why ?? { fields, rest };
}

// a task's thread state: "aguardando o Unii" (the user wrote), "sua vez"
// (Unii replied); "" neither
export function task_talk_said(t: Task): string {
  return t.talk === "unii" ? "aguardando o Unii" : t.talk === "user" ? "sua vez" : "";
}

// Copy
// ====

// what /copy takes from the chat: Unii's last answer known whole (n 0),
// else its n-th code block (from 1, as they come, those in quotes and
// lists too); else why not
export function view_copy(v: View, n: number): { text: string; what: string } | string {
  const last = [...v.whole].filter(([, e]) => e.kind === "unii").sort((a, b) => b[0] - a[0])[0]?.[1];
  if (last === undefined) {
    return "Nenhuma resposta do Unii para copiar.";
  }
  if (n === 0) {
    return { text: last.text, what: "a última resposta" };
  }
  const codes = (blocks: Md.Block[]): Md.Code[] => blocks.flatMap((b) => (b.$ === "Code" ? [b] : b.$ === "Quot" ? codes(b.x) : b.$ === "List" ? b.x.flatMap(codes) : []));
  const all = codes(Md.md_parse(last.text));
  if (n > all.length) {
    return all.length === 0 ? "A última resposta não tem bloco de código." : "A última resposta tem " + all.length + (all.length === 1 ? " bloco" : " blocos") + " de código: /copy 1" + (all.length === 1 ? "." : " a /copy " + all.length + ".");
  }
  return { text: all[n - 1].x, what: "o bloco de código " + n };
}

// the footer's line of the pending list ("" with none open): ids that
// fit in w, else the count alone
// (those that wait for others: only how many, "+2 aguardando")
export function tasks_footer(v: View, w: number): string {
  const { open, waiting } = view_tasks(v);
  if (open.length === 0 && waiting.length === 0) {
    return "";
  }
  const wait = waiting.length === 0 ? "" : " · +" + waiting.length + " aguardando";
  const n = open.length + (open.length === 1 ? " aberta" : " abertas");
  const long = "Pendências: " + n + (open.length === 0 ? "" : " (" + open.map((t) => t.id).join(", ") + ")") + wait + " · /p";
  const mid = "Pendências: " + open.length + wait + " · /p";
  const short = "Pendências: " + open.length + " · /p";
  return [long, mid, short].find((x) => x.length <= w) ?? "";
}

// whose a task is, as the views say it: "com você", "com o Unii", "com X"
export function assignee_said(t: Task): string {
  return t.assignee === "user" ? "com você" : t.assignee === "unii" ? "com o Unii" : "com " + t.assignee;
}

// where a task came from, as its badge says it ("" not known): chat,
// agendamento, agente X, Slack, GitHub
export function origin_said(t: Task): string {
  const o = t.origin ?? "";
  return o.startsWith("agent:") ? "agente " + o.slice(6) : ({ chat: "chat", timer: "agendamento", slack: "Slack", github: "GitHub" } as Record<string, string>)[o] ?? "";
}

// the open tasks free to resolve, the user's first, then each other
// assignee's, in the order given: [assignee, its tasks]
export function tasks_by_assignee(open: Task[]): [string, Task[]][] {
  const keys = [...new Set(["user", ...open.map((t) => t.assignee)])];
  return keys.map((k) => [k, open.filter((t) => t.assignee === k)] as [string, Task[]]).filter(([, ts]) => ts.length > 0);
}

// the pending list as Markdown, for the terminal's /p (one: its whole;
// waiting: those that wait for others, listed, the rest left out)
export function tasks_md(v: View, one: Task | null = null, waiting = false): string {
  const STATE = { open: "aberta", done: "concluída", dropped: "descartada" };
  const tag = (t: Task) => (t.ref === null ? "" : " · " + t.ref) + (origin_said(t) === "" ? "" : " · origem: " + origin_said(t));
  const opts = (t: Task) => (t.choices.length === 0 ? "" : " · opções: " + t.choices.map((c, k) => k + 1 + ") " + c).join("  "));
  if (one !== null) {
    const said = [one.answer === null ? "" : "Resposta: " + one.answer + ".", one.note === null ? "" : "Comentário: " + one.note].filter((x) => x !== "").join(" ");
    const waits = Deps.waits(v.tasks, one);
    const frees = task_frees_said(v, one);
    const deps = (one.state === "open" && waits.length > 0 ? " · aguarda " + waits.join(", ") : "") + (frees === "" ? "" : " · " + frees);
    const talk = task_talk_said(one) === "" ? "" : " · " + task_talk_said(one);
    const head = "**" + one.id + "** " + one.title + "\n\n" + STATE[one.state] + " · " + assignee_said(one) + tag(one) + deps + talk + opts(one);
    return [head, said, one.detail, fields_md(one), thread_md(one)].filter((x) => x !== "").join("\n\n");
  }
  const { open, waiting: wait, closed } = view_tasks(v);
  const frees = (t: Task) => (task_frees_said(v, t) === "" ? "" : " · **" + task_frees_said(v, t) + "**");
  const extra = (t: Task) => ((t.fields ?? []).length === 0 ? "" : " · " + t.fields.length + (t.fields.length === 1 ? " campo" : " campos")) + (task_talk_said(t) === "" ? "" : " · **" + task_talk_said(t) + "**");
  const line = (t: Task) => "- **" + t.id + "** " + t.title + frees(t) + tag(t) + opts(t) + extra(t);
  const whose = (t: Task | undefined) => (t === undefined || t.assignee === "user" ? "" : " (" + assignee_said(t) + ")");
  const who = (id: string) => id + whose(v.tasks.find((t) => t.id === id));
  const waits = (t: Task) => "- " + t.id + " " + t.title + whose(t) + " — aguarda " + Deps.waits(v.tasks, t).map(who).join(", ");
  const group = ([a, ts]: [string, Task[]]) => "**" + (a === "user" ? "Suas pendências" : "Pendências " + assignee_said(ts[0])) + " (" + ts.length + ")**\n\n" + ts.map(line).join("\n");
  if (waiting) {
    return wait.length === 0 ? "Nenhuma pendência aguardando outras." : "**Aguardando outras pendências (" + wait.length + ")**\n\n" + wait.map(waits).join("\n");
  }
  const done = (t: Task) => "- " + t.id + " " + STATE[t.state] + ": " + t.title + (t.answer === null ? "" : " — resposta: " + t.answer);
  const parts = [
    open.length === 0 ? tasks_none_said(wait.length) : tasks_by_assignee(open).map(group).join("\n\n"),
    wait.length === 0 ? "" : "_" + tasks_waiting_said(wait.length) + "_ · `/p aguardando` mostra quais",
    closed.length === 0 ? "" : "**Resolvidas recentemente**\n\n" + closed.slice(0, 10).map(done).join("\n"),
    "`/p P7` detalha · `/ok P7 [opção] [campo=valor] [comentário]` conclui · `/ok!` conclui e avisa o Unii · `/rascunho P7 campo=valor` · `/conversa P7 mensagem` · `/descartar P7` · `/reabrir P7` · `/avisar`",
  ];
  return parts.filter((x) => x !== "").join("\n\n");
}

// a task's fields as Markdown: each numbered, its kind and choices,
// whether required, and its answer (concluded) or draft; "" for none
function fields_md(t: Task): string {
  const fields = t.fields ?? [];
  if (fields.length === 0) {
    return "";
  }
  const KIND = { choice: "escolha uma", multi: "escolha várias", text: "texto", yesno: "sim ou não" };
  const values: Values = (t.state === "done" ? t.answers : t.draft) ?? {};
  const said = (f: Field) => {
    const v = Object.hasOwn(values, f.id) ? values[f.id] : undefined;
    return v === undefined || v.length === 0 ? "_sem resposta_" : Array.isArray(v) ? v.join(", ") : v;
  };
  const opts = (f: Field) => (f.kind === "choice" || f.kind === "multi" ? ": " + f.choices.map((c, k) => k + 1 + ") " + c).join("  ") : "");
  const head = t.state === "done" ? "**Respostas**" : "**Campos** (respostas salvas como rascunho até concluir)";
  return head + "\n\n" + fields.map((f, k) => k + 1 + ". " + f.label + " `" + f.id + "` (" + KIND[f.kind] + opts(f) + (f.required ? ", obrigatório" : "") + ") — " + said(f)).join("\n");
}

// a task's thread as Markdown, its newest messages; "" for none
function thread_md(t: Task): string {
  const thread = t.thread ?? [];
  if (thread.length === 0) {
    return "";
  }
  const talk = task_talk_said(t);
  return "**Conversa**" + (talk === "" ? "" : " · " + talk) + "\n\n" + thread.map((m) => "- **" + (m.who === "user" ? "Você" : "Unii") + ":** " + m.text.replace(/\n+/g, " ")).join("\n");
}

export function view_body(v: View): Row[] {
  if (v.page !== null) {
    return page_rows(v, v.page);
  }
  if (v.fold !== null) {
    const tops = v.fold.flatMap(([id, n]) => part_rows(v, id, n, Infinity, false));
    return [Cap(FOLD), ...tops];
  }
  return [Cap(AI), ...view_rows(v, v.parts).flat()];
}

// the chat's parts given, in order, as rows each (part_due)
export function view_rows(v: View, parts: Part[]): Row[][] {
  return parts.map(([id, n], k) => {
    const rows = part_rows(v, id, n, v.turn, true);
    return part_due(v, [id, n], parts[k - 1]) ? [Cap(AI), ...rows] : rows;
  });
}

// whether rows show a block whose summary isn't known yet (WAIT)
export function rows_wait(v: View, rows: Row[]): boolean {
  return rows.some((row) => (row.$ === "Sum" && !v.nodes.has(row.id + "+" + row.n)) || (row.$ === "Box" && rows_wait(v, row.rows)));
}

// live: what of the stream to draw (the terminal's: what it has not
// printed yet)
export function view_tail(v: View, live = view_stream(v)): Row[] {
  if (v.page === null && v.fold !== null) {
    return [];
  }
  const rows = live.flatMap((l) => entry_rows(null, l.kind, l.text));
  const load = v.page === null && v.importing !== null ? [Cap(progress_show(v.importing))] : [];
  const said = v.page === null && !v.up ? v.out.flatMap((p) => entry_rows(null, "user", p.said)) : [];
  const kept = said.length > 0 ? [...said, Cap(UNSENT)] : [];
  const limit = v.limits[v.page === null ? TURN : v.page.name];
  if (limit !== undefined) {
    return [...rows, Cap(limit_show(limit)), ...kept, ...load];
  }
  if (v.page !== null || rows.length > 0 || v.wait === "") {
    return [...rows, ...kept, ...load];
  }
  return [Cap(v.wait === SUMMARIES ? SUMS : "waiting for " + v.wait + "…"), ...kept, ...load];
}

// a call waiting for a usage limit: when it asks again, in the viewer's
// time (its weekday too if not today), and whether it then surely resumes
export function limit_show(limit: Parked, now = Date.now()): string {
  const at  = new Date(limit.until);
  const day = at.toDateString() === new Date(now).toDateString() ? {} : { weekday: "short" as const };
  return "waiting for the usage limit, " + (limit.known ? "resumes" : "tries again") + " at " + at.toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit" });
}

// what streams on the page shown
export function view_stream(v: View): Live[] {
  return v.page === null ? v.live : v.page.live;
}

// an import's progress
export function progress_show(p: Progress): string {
  const n = (k: number) => k.toLocaleString("en-US");
  const merges = p.open.reduce((x, y) => x + y, 0);
  const phase = p.open[0] > 0 ? "Summarizing messages: " + n(p.msgs - p.open[0]) + " of " + n(p.msgs) : "Merging the top of the tree: " + merges + (merges === 1 ? " merge" : " merges") + " left · about " + Math.ceil((p.total - p.done) * PACE) + " min";
  return phase + (p.why === null ? "" : " · paused");
}

// the chat, each agent at work, and the page shown while its agent is
// done (so it can be left: the tabs were the way back, and hid)
export function view_tabs(v: View): Tab[] {
  const at    = v.page === null ? null : v.page.name;
  const names = at === null || v.agents.includes(at) ? v.agents : [...v.agents, at];
  return [null, ...names].map((name) => {
    const here  = name === at;
    const label = name === null ? undefined : AGENT_LABELS.get(name);
    const text  = (here ? GLYPH.here : GLYPH.tab) + " " + (label ?? name ?? MAIN);
    return label === undefined ? { name, here, text } : { name, here, text, sub: name! };
  });
}

// Agents
// ======

// the agents' labels, by name, as the last state told (State.labels):
// one for whatever names an agent, as a message's [Name] (Paint.ts,
// Html.ts)
const AGENT_LABELS = new Map<string, string>();

export function agent_label(name: string): string | undefined {
  return AGENT_LABELS.get(name);
}

// the agent a person means by arg (Term.ts /stop, /tab), any case: one
// whose name is arg; else the one whose label is arg (of several, the one
// at work); else the one at work whose name or label starts with arg; else
// the one done whose label does. Several that fit: them all, to choose
// from (none acted on); none: arg itself
export function agent_find(v: View, arg: string): { name: string } | { many: string[] } {
  const low   = arg.toLowerCase();
  const known = [...new Set([...v.agents, ...Object.keys(v.labels ?? {})])];
  const label = (a: string) => (AGENT_LABELS.get(a) ?? "").toLowerCase();
  const one   = (names: string[]) => (names.length === 0 ? null : names.length === 1 ? { name: names[0] } : { many: names });
  const named = known.find((a) => a.toLowerCase() === low);
  if (named !== undefined) {
    return { name: named };
  }
  const exact = known.filter((a) => label(a) === low);
  const exact_work = exact.filter((a) => v.agents.includes(a));
  const found = exact.length > 1 && exact_work.length === 1 ? { name: exact_work[0] } : one(exact);
  const work = v.agents.filter((a) => a.toLowerCase().startsWith(low) || (label(a) !== "" && label(a).startsWith(low)));
  const done = known.filter((a) => !v.agents.includes(a) && label(a) !== "" && label(a).startsWith(low));
  return found ?? one(work) ?? one(done) ?? { name: arg };
}

// what a person reads when arg fits several agents (View.agent_find)
export function agents_many(arg: string, many: string[]): string {
  return "Mais de um agente corresponde a \"" + arg + "\": " + many.map(agent_shown).join(", ") + ". Digite mais do nome ou do rótulo.";
}

// an agent as people read it in plain text: its label, then its name;
// its name alone if it has none
export function agent_shown(name: string): string {
  const label = AGENT_LABELS.get(name);
  return label === undefined ? name : label + " (" + name + ")";
}

export function view_fold(v: View): string | null {
  if (v.page !== null) {
    return null;
  }
  return v.fold === null ? "fold all" : "unfold all";
}

export function view_typing(v: View): boolean {
  return v.page === null;
}

export function view_running(v: View): boolean {
  return v.busy || v.agents.length > 0;
}

export function view_pick(v: View): Knob[] {
  return v.pick === null ? [] : view_knobs(v, v.pick, true);
}

// the pick over the box: the chat's, or on an agent's page what that
// agent runs on, shown only (none while not known)
export function view_shown(v: View): Knob[] {
  if (v.page === null) {
    return view_pick(v);
  }
  return v.page.pick === null ? [] : view_knobs(v, v.page.pick, false);
}

// a pick's knobs; menus: with their choices
function view_knobs(v: View, pick: Pick, menus: boolean): Knob[] {
  const { model, effort, speed, profile } = pick;
  const ranks = (v.profiles?.[profile ?? ""] ?? []).map((f) => f.model.label).join(", ");
  // a model two vendors offer: its vendor in the hint, not in its name
  const whose = Pick.twin(pick.vendor, model, v.vendors) ? ", " + pick.vendor : "";
  const choices = (move: Move) => (menus ? view_choices(pick, move, v) : []);
  return [
    { text: profile ?? model, move: "model", hint: profile === undefined ? model + whose : profile + ": " + ranks, choices: choices("model") },
    { text: effort, move: "effort", hint: effort + " effort", choices: choices("effort") },
    { text: speed, move: "speed", hint: speed, choices: choices("speed") },
  ];
}

// every value of a knob, in the order a move steps through them; the
// model's: the profiles first (headed "profiles", each by its name),
// then the models, each vendor's headed by it
function view_choices(pick: Pick, move: Move, v: View): Choice[] {
  return Pick.options(pick, move, v).map(([text, to], i, all) => {
    const head = (p: Pick) => p.profile !== undefined ? "profiles" : p.vendor;
    const vendor = move === "model" && (i === 0 || head(all[i - 1][1]) !== head(to)) ? head(to) : null;
    const here = move !== "model" ? Pick.label(to) === Pick.label(pick) : to.profile !== undefined ? to.profile === pick.profile : pick.profile === undefined && Pick.label(to) === Pick.label(pick);
    // a model by "vendor:model" (two vendors may offer one)
    const by = move === "model" && to.profile === undefined ? to.vendor + ":" + text : text;
    return { text: move === "model" ? to.profile ?? to.model : text, to: by, move, here, vendor };
  });
}

export function view_count(v: View): number {
  return v.parts.reduce((end, [id, n]) => Math.max(end, id + n), 0);
}

function view_learn(v: View, pack: Pack): void {
  for (const [key, node] of Object.entries(pack.nodes ?? {})) {
    v.nodes.set(key, node);
  }
  for (const [id, entry] of Object.entries(pack.whole ?? {})) {
    v.whole.set(Number(id), entry);
  }
}

// a message: on its agent's page, in Unii's chat, or, a thought (not
// logged), after the last message
function view_entry(v: View, msg: Server & { $: "entry" }): void {
  const { $, agent, id, ...entry } = msg;
  const last = v.parts[v.parts.length - 1];
  if (agent !== undefined) {
    const log = v.pages.get(agent)?.log;
    if (Array.isArray(log)) {
      log.push(entry);
    }
  } else if (id !== undefined) {
    v.whole.set(id, entry);
    v.parts.push([id, 1]);
  } else if (msg.kind === "mind" && last !== undefined) {
    const at = last[0] + last[1] - 1;
    v.minds.set(at, [...(v.minds.get(at) ?? []), msg.text]);
  }
}

// null: a page not asked for
function view_live(v: View, agent: string | undefined): Live[] | null {
  if (agent === undefined) {
    return v.live;
  }
  return v.pages.get(agent)?.live ?? null;
}

// Link
// ====
// What TCP, WebSocket and HTTP do is theirs; the Link adds only what
// they can't. A socket that dies loses what was in flight: each act has
// an id and is kept until answered (its ack, or its post's answer); those
// not answered go again once the next socket shows the chat (none on a
// live one); the server does each once (Server.ts Chat.apply). An act
// with a body is a post of its own; one unanswered means the link is
// lost. A page sees no pings: the server ticks each PING / 2, and a view
// drops a socket silent for a PING.

export function link_open(v: View, link: Link): void {
  const ws   = link.open("?tab=" + v.tab + "&wire=" + WIRE);
  let heard  = Date.now();
  const tick = setInterval(() => Date.now() - heard > PING && drop(), PING / 2);
  async function drop(): Promise<void> {
    const up = v.up;
    ws.onmessage = null;
    ws.onclose   = null;
    clearInterval(tick);
    ws.close();
    [v.ws, v.up] = [null, false];
    if (await link.lost(up)) {
      setTimeout(() => link_open(v, link), RETRY);
    }
  }
  // sends, in order, the acts not sent on this socket
  function flush(): void {
    for (const post of v.up && v.ws === ws ? v.out.filter((p) => p.ws !== ws) : []) {
      post.ws = ws;
      if ("body" in post.msg) {
        upload(post);
      } else {
        ws.send(JSON.stringify(post.msg));
      }
    }
  }
  async function upload(post: Post): Promise<void> {
    const { body, ...rest } = post.msg as any;
    const query = Object.entries(rest).map(([k, x]) => k + "=" + encodeURIComponent(String(x)));
    const res = await link.post("/api/act?" + query.join("&"), await body()).catch(() => null);
    const out = await res?.json().catch(() => null);
    if (out != null) {
      link.hear({ $: "ack", id: post.msg.id, ...out });
    } else if (post.ws === ws && v.ws === ws) {
      drop();
    }
  }
  [v.ws, v.flush] = [ws, flush];
  ws.onmessage = (ev) => {
    heard = Date.now();
    if (ev.data === TICK) {
      return;
    }
    const msg = JSON.parse(String(ev.data));
    const join = msg.$ === "view" && !v.up;
    if (join) {
      v.up = true;
      v.pages.clear();
    }
    link.hear(msg);
    if (join) {
      view_act(v, { $: "Goto", name: v.page?.name ?? null }).forEach((out) => link_send(v, out));
      flush();
    }
  };
  ws.onclose = () => drop();
}

// an act, kept until answered; by default a refusal is a note; said: a
// message's text
export function link_send(v: View, msg: Client, done = (a: Answer) => link_note(v, a), said = ""): void {
  v.out.push({ msg: { id: crypto.randomUUID(), ...msg }, ws: null, done, said });
  v.flush();
}

export function link_note(v: View, a: Answer): void {
  if (a.error !== undefined) {
    v.notes.push(a.error);
  }
}

// a JSON post's answer, ok if its status was
export async function post(url: string, body: object, auth: Record<string, string> = {}): Promise<any> {
  const headers = { ...auth, "content-type": "application/json" };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).catch(() => null);
  const out = res === null ? { error: "Can't reach the server." } : await res.json().catch(() => (res.ok ? {} : { error: "HTTP " + res.status }));
  return { ...out, ok: res?.ok === true, status: res?.status ?? 0 };
}

// Part
// ====

// a block's name, as /open and /close take it: its first message's id,
// then its size past 1x
export function block_name(id: number, n: number): string {
  return "#" + id + (n === 1 ? "" : "+" + n);
}

// whether the AI notice comes before part, after the part `before`: a
// message from the turn on, in another window than that part's
export function part_due(v: View, part: Part, before: Part | undefined): boolean {
  const last = before === undefined ? NaN : part_window(v, before);
  return part[1] === 1 && part[0] >= v.turn && !Number.isNaN(last) && part_window(v, part) !== last;
}

// the window (NOTICE) of a part's last date (NaN: not known)
function part_window(v: View, [id, n]: Part): number {
  const date = n === 1 ? v.whole.get(id)?.date : v.nodes.get(id + "+" + n)?.to;
  return Math.floor(Date.parse(date ?? "") / NOTICE);
}

// t: the turn; talk: whether talk opens by itself (not in Fold all). Open:
// the person's choice (Open, Shut) if made, else a message of the user or
// Unii (tool calls, reports and the rest stay folded)
function part_rows(v: View, id: number, n: number, t: number, talk: boolean): Row[] {
  const key   = id + "+" + n;
  const entry = v.whole.get(id);
  const half  = n / 2;
  if (n === 1 && id >= t && entry !== undefined) {
    const minds = v.minds.get(id) ?? [];
    const after = minds.flatMap((x) => entry_rows(null, "mind", x));
    return [...whole_rows(id, entry), ...after];
  }
  const open  = talk && n === 1 && ["user", "unii"].includes(entry?.kind ?? "");
  if (!(v.open.get(key) ?? open)) {
    return sum_rows(id, n, v.nodes.get(key));
  }
  const text = n === 1 ? "fold" : GLYPH.open + " " + n + "x · fold";
  if (n > 1) {
    const rows = [...part_rows(v, id, half, t, talk), ...part_rows(v, id + half, half, t, talk)];
    return [{ $: "Box", id, n, text, rows }];
  }
  const rows = entry === undefined ? [] : whole_rows(id, entry);
  return [{ $: "Box", id, n, text, rows }];
}

// a message's rows, or a summary's block, made once: neither changes once
// known, so a redraw remakes only the rows that changed
const ROWS = new WeakMap<Entry | Node, Row[]>();

function whole_rows(id: number | null, entry: Entry): Row[] {
  const rows = ROWS.get(entry) ?? entry_rows(id, entry.kind, entry.text, entry.images);
  ROWS.set(entry, rows);
  return rows;
}

// a block whose summary isn't known yet says WAIT
function sum_rows(id: number, n: number, node: Node = { text: WAIT, to: "" }): Row[] {
  const rows = ROWS.get(node) ?? [{ $: "Sum", id, n, text: Md.md_flat(node.text), call: sum_call(n, node.text) }];
  ROWS.set(node, rows);
  return rows;
}

// Page
// ====

// an agent's page, its log (once it comes) from message `from` on
export function page_rows(v: View, page: Page, from = 0): Row[] {
  const head = Cap(agent_shown(page.name) + (v.agents.includes(page.name) ? " · at work" : " · done"));
  return [head, ...(page.log ?? []).slice(from).flatMap((e) => whole_rows(null, e))];
}

// Live
// ====

// a piece joins the message streaming, if of its kind, unless it starts
// one (fresh: a tool call, as two calls never join)
export function live_push(live: Live[], kind: Kind, text: string, fresh = false): void {
  const top = live[live.length - 1];
  if (top !== undefined && top.kind === kind && !fresh) {
    top.text += text;
  } else {
    live.push({ kind, text });
  }
}

// the whole stream, told anew (a view joining, a call's entry): one that
// goes on with the stream held extends it in place, each message staying
// the one it was (the terminal prints a message once: Term.ts flow), as
// after a reconnect; another replaces it
function live_set(live: Live[], now: Live[]): void {
  const goes = live.every((l, k) => now[k]?.kind === l.kind && now[k].text.startsWith(l.text));
  const held = goes ? live : [];
  const next = now.map((l, k) => (k < held.length ? Object.assign(held[k], l) : l));
  live.splice(0, live.length, ...next);
}

// the call a line of one message holds, when the line is a tool call
// word for word (the compactor keeps a short message as it is)
function sum_call(n: number, text: string): Call.Call | null {
  const call = n === 1 && text.startsWith(TOOL) ? Call.call_parse(text.slice(TOOL.length)) : null;
  return call === null || call.name === "" ? null : call;
}

// Image
// =====

// an image's kind by its first HEAD bytes (each kind's mark, at its
// byte); null: none of them. Said as IMAGES where one is refused.
export function image_kind(head: Uint8Array): string | null {
  const text = String.fromCharCode(...head.subarray(0, HEAD));
  return MARKS.find(([, at, mark]) => text.slice(at, at + mark.length) === mark)?.[0] ?? null;
}

// Entry
// =====

export function entry_rows(id: number | null, kind: Kind, text: string, images: string[] = []): Row[] {
  const call = kind === "tool" ? Call.call_parse(text) : null;
  const report = kind === "work" ? Call.report_read(text) : null;
  const body = call === null ? entry_body(kind, report?.text ?? text) : [];
  const who = report === null ? WHO[kind] ?? "" : agent_shown(report.name);
  return call === null && body.length === 0 && images.length === 0 ? [] : [{ $: "Msg", id, kind, who, text, body, call, images }];
}

// the length of a streaming message's head printed now: all of it once
// ended, as one block (a frame or fill is drawn whole), else none; none
// of one logged whole (a call, a result, the user's, a report)
export function entry_settled(kind: Kind, text: string, ended: boolean): number {
  return ["user", "work", "echo", "tool"].includes(kind) || !ended ? 0 : text.length;
}

function entry_body(kind: Kind, text: string): Md.Block[] {
  switch (kind) {
    case "user":
    case "work": {
      return Md.md_plain(text);
    }
    case "echo": {
      return Md.md_output(text);
    }
    default: {
      return Md.md_parse(text);
    }
  }
}
