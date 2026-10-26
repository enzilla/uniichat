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

import type { Again, Kind, Parked, Vendor } from "./AskAI.ts";
import * as Call from "./Call.ts";
import * as Md from "./Md.ts";
import { LABELS, type Fall, type Move, Pick } from "./Pick.ts";
import { GLYPH, WHO } from "./Theme.ts";
import type { Timer } from "./Timer.ts";
import type { Evidence, Field, PrCheck, Task, Values } from "./Tasks.ts";
import * as Deps from "./TaskDeps.ts";
import type { Ci, Front, FrontPr, Live as PipeLive, Role, Sevs, Stage } from "./Pipeline.ts";

// Types
// =====

// the n messages from id on (n a power of two)
export type Part = [number, number];

// a message logged: its kind, its text, its date (ISO), its images; a
// tool call's id on it and its result, the call's tool on the result
// (Memory.ts Pair)
export type Entry = { kind: Kind; text: string; date?: string; images?: string[]; of?: string; tool?: string };

// what a result is of: its call's tool as logged ("": not known), and
// whether it stands apart from its call (something came between them:
// Server.ts Chat.flush), so it names its tool ("↳ shell result")
export type Of = { tool: string; apart: boolean };

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

// the summaries a turn waits on: built since it began waiting, in all
export type Sums = { done: number; total: number };

// agents: those at work; runs: what each runs on (Tools.shown);
// vendors, models, profiles: those offered;
// limits: the calls waiting for a usage
// limit, by TURN or agent name; sums: the summaries a turn waits on
// (null: none); again: how the chat's summaries last
// failed, waiting to ask again (Memory `again`); timers: the chat's schedules, each
// message's head; talk: conversation mode (null: standard); build: the
// web app's (main.ts renew); site: the server's address (config site:
// the terminal's links to its media) (Server.ts
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
  sums      : Sums | null;
  again     : Again | null;
  timers    : Timer[];
  mcp       : Plug[];
  tasks     : Task[]; // the pending list: open, then closed lately (Tasks.tasks_view)
  skills    : Skilled[]; // the skills on the devices open now (Machine.skills), for the terminal to complete
  talk      : Talk | null;
  build?    : string;
  site?     : string;
};

// conversation mode (Memory.ts): its first message whole, the share of
// its space its messages take (0 to 1), their bytes and the space's (the
// pick's model's: Memory.talk_room)
export type Talk = { from: number; used: number; size: number; room: number };

// an MCP server of a device (Mcp.ts), on or off in this chat
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
  | { $: "TaskAccept"; task: string; note?: string; fields?: Record<string, unknown> } // "Aceitar as recomendadas": the choice and the fields' answers Unii recommends (fields: those given, kept), concluded
  | { $: "TasksTell" }                          // Avisar o Unii agora
  | { $: "Talk"; on: boolean }                  // conversation mode, or standard

// what a page draws, top to bottom
export type Row =
  | { $: "Sum"; id: number; n: number; text: string; call: Call.Call | null }                     // a block: nx, its summary (call: a tool call's, word for word)
  | { $: "Box"; id: number; n: number; text: string; rows: Row[] }                              // a block open: its bar
  | { $: "Msg"; id: number | null; kind: Kind; who: string; text: string; body: Md.Block[]; call: Call.Call | null; images: string[] } // a message whole: 0x (who: its speaker, or a result apart from its call that no block names, "↳ shell result"; call: a tool call's, drawn as Call.ts reads it)
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

// a view's word that its page is in use (shown and focused; said again on
// input, at most each USE_PING), or no longer: no push goes out while one
// is (Server.ts Chat.phone)
export const ACTIVE   = "active";
export const IDLE     = "idle";
export const USE_PING = 20000;

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

// the kinds of the media store the chat shows, and their other names
// (kept in Md.ts, whose md_pasted reads them too)
export const MEDIA = Md.MEDIA;
export const MEDIA_AS = Md.MEDIA_AS;

// a file in the media store, by its name: its hash's head, then its
// extension (media_ext)
export const STORED = /^[0-9a-f]{16}\.([a-z0-9]{1,10})$/;

// a media file in the store, by its url (/media/<name>, or an older
// image's /image/<name>): image, video, audio or html (a page); null: none
// (any other file of the store is a file: store_file)
export function media_kind(url: string): string | null {
  const m = /^\/(?:media|image)\/[0-9a-f]{16}\.([a-z0-9]{1,10})$/.exec(url);
  return m === null ? null : ext_kind(m[1]);
}

// the kind of a file of the media store by its extension (media_kind)
export function ext_kind(ext: string): string | null {
  const type = MEDIA.get(ext);
  return type === undefined ? null : type === "text/html" ? "html" : type.split("/")[0];
}

// whether a url is a file of the media store that isn't media: one to
// download (a pdf, a zip, a file with no extension: .bin)
export function store_file(url: string): boolean {
  return url.startsWith("/media/") && STORED.test(url.slice("/media/".length)) && media_kind(url) === null;
}

// the media store's extension for a file's name: its own, lowercased, its
// letters and digits only, at most 10 (a kind named two ways, as the
// first: jpg, jpeg); "": none
export function media_ext(file: string): string {
  const dot = file.lastIndexOf(".");
  const ext = dot < 0 ? "" : file.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return MEDIA_AS.get(ext) ?? ext;
}

// a file's size as people read it: 834 B, 12.3 KB, 1.2 MB, 3.4 GB
export function size_show(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  const k = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024))));
  const n = bytes / 1024 ** k;
  return (k === 0 ? String(bytes) : n >= 100 ? n.toFixed(0) : n.toFixed(1)) + " " + units[k];
}

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

// the bytes a token takes, low (code, JSON and paths run about 3; prose
// about 4), so conversation mode never thinks the model has more room
// than it does (Memory.talk_room)
export const TOKEN = 3;

// conversation mode's fill in tokens (TOKEN bytes each), as its meter's
// tooltip says it: "about 120K of 707K tokens"
export function talk_tokens(talk: Talk): string {
  const k = (bytes: number) => Math.round(bytes / TOKEN / 1000) + "K";
  return "about " + k(talk.size) + " of " + k(talk.room) + " tokens";
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
    sums      : null,
    again     : null,
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
    tab       : uuid(),
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
      v.tasks = Array.isArray(v.tasks) ? v.tasks.map(task_whole) : [];
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
        v.notes.push("No MCP server " + act.name + (names === "" ? "; none is set up." : "; one of: " + names + "."));
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
      // an order received (the evidence round): canceled (dropped), never
      // closed by the user; Unii closes it with evidence of the execution
      const ordered = t.state === "open" && (t.order ?? null) !== null;
      if (ordered && act.state === "done") {
        v.notes.push("A pendência " + t.id + " é uma ordem sua já recebida pelo Unii: ela só fecha com a evidência da execução. Para desistir dela, cancele-a (/descartar " + t.id + ").");
        return [];
      }
      if (act.state === "dropped" && t.state === "open" && t.assignee !== "user" && !ordered) {
        v.notes.push("A pendência " + t.id + " está com o Unii: use “Cobrar agora” ou “Pode fechar”.");
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
    case "TaskAccept": {
      const t = v.tasks.find((x) => x.id === act.task);
      if (t === undefined) {
        v.notes.push("Pendência " + act.task + " não encontrada.");
        return [];
      }
      // choices, none recommended (task_accept_mode "fill"): the fields'
      // recommended answers kept as a draft, the choice left to the user
      if (task_accept_mode(t) === "fill") {
        v.notes.push(task_fill_said(t));
        return view_act(v, { $: "TaskDraft", task: t.id, fields: task_accept_fill(t, act.fields ?? t.draft ?? {}) });
      }
      const got = task_accept(t, act.fields ?? t.draft ?? {});
      if (typeof got === "string") {
        v.notes.push(got);
        return [];
      }
      return view_act(v, { $: "Task", task: t.id, state: "done", ...(got.answer === undefined ? {} : { answer: got.answer }), ...(act.note === undefined ? {} : { note: act.note }), fields: got.fields });
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
// an open task with no change in COLD (its state, an edit, a message
// in its thread) is old: it goes down to "Antigas", folded, in the
// lists (Panel.ts, Html.ts); any change brings it back. Never closed
// ones (those go to the archive, Tasks.tasks_archive)
export const COLD = 7 * 86400e3;
export function task_cold(t: Task, now = Date.now()): boolean {
  if (t.state !== "open") {
    return false;
  }
  const last = Math.max(Date.parse(t.changed), ...(t.thread ?? []).map((x) => Date.parse(x.at)).filter((n) => Number.isFinite(n)));
  return now - last >= COLD;
}

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

// "P1", "P1 e P2", "P1, P2 e P3" (pt-BR)
export function and_said(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " e " + xs[xs.length - 1];
}

// whose a task is, short, beside its id: "sua", "do Unii", "de X"; ""
// for one not in the list
export function whose_short(t: Task | undefined): string {
  return t === undefined ? "" : t.assignee === "user" ? "sua" : t.assignee === "unii" ? "do Unii" : "de " + t.assignee;
}

// an id with whose it is: "P46 (sua)"
export function id_whose(tasks: Task[], id: string): string {
  const w = whose_short(tasks.find((u) => u.id === id));
  return w === "" ? id : id + " (" + w + ")";
}

// which tasks t frees (through others too), named: "libera P70",
// "libera P70 e P71", past FREES_SAID "libera P70, P71 e mais 3"; ""
// for none
export const FREES_SAID = 3;
export function task_frees_named(tasks: Task[], t: Task): string {
  const ids = Deps.frees_ids(tasks, t);
  if (ids.length === 0) {
    return "";
  }
  return "libera " + (ids.length <= FREES_SAID ? and_said(ids) : ids.slice(0, FREES_SAID - 1).join(", ") + " e mais " + (ids.length - FREES_SAID + 1));
}

// what t waits for, each with whose it is: "aguarda P46 (sua) e P52
// (do Unii)"; "" for nothing
export function task_waits_named(tasks: Task[], t: Task): string {
  const ids = Deps.waits(tasks, t);
  return ids.length === 0 ? "" : "aguarda " + and_said(ids.map((id) => id_whose(tasks, id)));
}

// the tab's title with the user's count of tasks before it: "(2) UniiChat";
// none, the title alone
export function turn_title(title: string, n: number): string {
  return n > 0 ? "(" + n + ") " + title : title;
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
  const rest = words.replace(/(^|\s)([A-Za-z0-9][A-Za-z0-9_-]*)=("[^"]*"(?=\s|$)|“[^”]*”(?=\s|$)|\S*)/g, (all: string, pre: string, ref: string, raw: string, at: number) => {
    if (/^["“]/.test(raw) && !/^("[^"]*"|“[^”]*”)$/.test(raw)) {
      // the value as typed from its quote on (raw stops at a space: obs="a b"c
      // is raw "a, though its quote is closed, with c stuck after it)
      const typed = words.slice(at + pre.length + ref.length + 1);
      const stuck = /^("[^"\s]*"|“[^”\s]*”)\S/.test(raw) || /^("[^"]*"|“[^”]*”)[^\s"“”]/.test(typed);
      why = why ?? "O valor de “" + ref + "” tem " + (stuck ? "texto colado depois da aspa de fechamento" : "uma aspa sem par") + ": feche as aspas e separe o resto com um espaço. Nada foi alterado.";
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

// Turn
// ====

// what a view knows of Unii's turn, to say why a task waits for Unii:
// busy, a turn runs; wait, what it waits on (State.wait: SUMMARIES, a
// model's name, ""); limited, the turn waits for a usage limit; up, the
// view is connected to the server
export type Turn = { busy: boolean; wait: Wait; limited: boolean; up: boolean };

// the turn as a view's state says it
export function turn_of(v: { busy: boolean; wait: Wait; limits?: Record<string, unknown>; up: boolean }): Turn {
  return { busy: v.busy, wait: v.wait, limited: Object.hasOwn(v.limits ?? {}, TURN), up: v.up };
}

// since when a task waits for Unii: the user's last message in its
// thread (none kept: its last change)
export function task_talk_since(t: Task): string {
  const mine = (t.thread ?? []).filter((m) => m.who === "user");
  return mine.length === 0 ? t.changed : mine[mine.length - 1].at;
}

// why Unii hasn't answered yet, by its turn
export function turn_why(turn: Turn): string {
  if (!turn.up) {
    return "sem conexão com o servidor";
  }
  if (turn.limited) {
    return "esperando o limite de uso do serviço de IA";
  }
  if (!turn.busy) {
    return "nenhum turno em andamento (o servidor pode ter reiniciado)";
  }
  return turn.wait === SUMMARIES ? "compactando mensagens antigas" : turn.wait !== "" ? "esperando a resposta de " + turn.wait : "turno em andamento";
}

// a task the user wrote about and Unii hasn't answered: "aguardando o
// Unii há 5 min · compactando mensagens antigas" (no turn known: the
// time alone); else as task_talk_said ("sua vez", or "")
export function task_talk_wait_said(t: Task, now: number, turn: Turn | null = null): string {
  if (t.state !== "open" || t.talk !== "unii") {
    return task_talk_said(t);
  }
  const ms = Math.max(0, now - Date.parse(task_talk_since(t)));
  const ago = Number.isFinite(ms) ? " há " + (ms < 3600e3 ? Math.floor(ms / 60e3) + " min" : hours_said(ms)) : "";
  return "aguardando o Unii" + ago + (turn === null ? "" : " · " + turn_why(turn));
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

// The Mesa (the desk): the pending list as a screen of its own (main.ts,
// Html.desk_html), each task in one group, by whose move it is: "now",
// the user's (theirs and free, or Unii answered in its thread); "unii",
// the user wrote in its thread and Unii hasn't answered; "others",
// someone else's (Unii's, an agent's) at work; "waiting", waiting for
// other open tasks (TaskDeps.ts); "closed", resolved lately
export type Desk = "now" | "unii" | "others" | "old" | "waiting" | "closed";
export const DESK: [Desk, string][] = [
  ["now", "Agora"],
  ["unii", "Aguardando o Unii"],
  ["others", "Em andamento"],
  ["old", "Antigas (sem mudança há 7 dias)"],
  ["waiting", "Aguardando outras pendências"],
  ["closed", "Resolvidas recentemente"],
];

// a task's group in the Mesa (blocked: the ids waiting, Deps.blocked_ids)
export function desk_group(t: Task, blocked: Set<string>): Desk {
  if (t.state !== "open") {
    return "closed";
  }
  if (t.talk === "unii") {
    return "unii";
  }
  if (blocked.has(t.id)) {
    return "waiting";
  }
  return t.assignee === "user" || t.talk === "user" || Deps.status_of(t) === "waiting_user" ? "now" : "others";
}

// whether a task is the user's move now (the Mesa opens on it: P19)
export function desk_turn(tasks: Task[]): boolean {
  const blocked = Deps.blocked_ids(tasks);
  return tasks.some((t) => desk_group(t, blocked) === "now");
}

// the projects (refs) of the tasks, sorted, each once
export function desk_refs(tasks: Task[]): string[] {
  return [...new Set(tasks.flatMap((t) => (t.ref === null ? [] : [t.ref])))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// a text as a search compares it: no case, no accents, spaces as one
export function desk_fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// whether a task is in the search (q: every word in its id, title,
// detail, ref, assignee, fields or thread; "": all) and in the project
// (ref: "" all, else that ref)
export function desk_match(t: Task, q: string, ref: string): boolean {
  if (ref !== "" && t.ref !== ref) {
    return false;
  }
  const words = desk_fold(q).split(" ").filter((w) => w !== "");
  if (words.length === 0) {
    return true;
  }
  const hay = desk_fold([t.id, t.title, t.detail, t.ref ?? "", t.assignee, ...(t.fields ?? []).map((f) => f.label), ...(t.thread ?? []).map((m) => m.text)].join(" "));
  return words.every((w) => hay.includes(w));
}

// the Mesa's list: each group with tasks in the search, in DESK's
// order, its tasks as the server sorts them; "now" as P3 asks
// (TaskDeps.now_order: priority, then how many it frees, then the one to act on longest: ready_at)
export function desk_list(tasks: Task[], q = "", ref = "", now: number | null = null): { group: Desk; label: string; tasks: Task[] }[] {
  const blocked = Deps.blocked_ids(tasks);
  const shown = tasks.filter((t) => desk_match(t, q, ref));
  const order = Deps.now_order(tasks);
  // the old ones (task_cold, as of now; null: none) out of "now", "unii"
  // and "others", in "old"
  const of_group = (t: Task): Desk => {
    const g = desk_group(t, blocked);
    return now !== null && (g === "now" || g === "unii" || g === "others") && task_cold(t, now) ? "old" : g;
  };
  return DESK.map(([group, label]) => {
    const of = shown.filter((t) => of_group(t) === group);
    return { group, label, tasks: group === "now" ? [...of].sort(order) : of };
  }).filter((g) => g.tasks.length > 0);
}

// the task to show after `at` moves by `by` in the list (ids: its order);
// none shown, or gone: the first (going up, the last)
export function desk_step(ids: string[], at: string | null, by: number): string | null {
  if (ids.length === 0) {
    return null;
  }
  const k = at === null ? -1 : ids.indexOf(at);
  if (k === -1) {
    return by < 0 ? ids[ids.length - 1] : ids[0];
  }
  return ids[Math.max(0, Math.min(ids.length - 1, k + by))];
}

// the task to offer after the one shown was resolved (or waits): the
// next of "now" after it in the list's order, going on from the top
// past the last; order: the list as it was while the one shown was
// still in it (a task resolved leaves "now" for "closed", so the list
// of now no longer says where it was); not given, or it's not in it:
// the list of now. The one shown in neither (gone), or none of "now"
// in the order (all new): the first of "now". None: null
export function desk_next(tasks: Task[], sel: string | null, q = "", ref = "", order: string[] = []): Task | null {
  const groups = desk_list(tasks, q, ref);
  const now = (groups.find((g) => g.group === "now")?.tasks ?? []).filter((t) => t.id !== sel);
  if (now.length === 0) {
    return null;
  }
  const list = sel !== null && order.includes(sel) ? order : groups.flatMap((g) => g.tasks.map((t) => t.id));
  const k = sel === null ? -1 : list.indexOf(sel);
  if (k >= 0) {
    const ahead = [...list.slice(k + 1), ...list.slice(0, k)];
    const next = ahead.map((id) => now.find((t) => t.id === id)).find((t) => t !== undefined);
    if (next !== undefined) {
      return next;
    }
  }
  return now[0];
}

// how long a task stays the user's before it's late (ms), when its kind
// says no other: TaskDeps.LATE, the same value the late push
// (TaskPush.LATE) reads; by kind: TaskDeps.late_after
export const TASK_LATE = Deps.LATE;

// a task late (open, the user's move, theirs to act on (TaskDeps.ready_at)
// for longer than its kind allows, TaskDeps.late_after): how long it's
// been theirs, "atrasada há 30 h" (under 2 days) or "atrasada há 3 d";
// else "". Late, it stays where it is (P5: none expires)
export function task_late_said(t: Task, blocked: Set<string>, now: number): string {
  const age = now - Date.parse(Deps.ready_at(t));
  if (t.state !== "open" || t.assignee !== "user" || blocked.has(t.id) || t.talk === "unii" || !(age > Deps.late_after(t))) {
    return "";
  }
  return "atrasada há " + hours_said(age);
}

// a task's kind and its limit, as the views say it ("aprovação de PR,
// prazo 24 h"); "" for none
export const KIND_SAID: Record<Deps.TaskKind, string> = { pr: "aprovação de PR", decision: "decisão", test: "teste", action: "ação sua", restart: "reinício", info: "informação" };
// what a task asks of the user, in one line (the drawer's and the
// list's, under its title): what to answer or do to conclude it
const ASK_KIND: Record<Deps.TaskKind, string> = { pr: "Revise o PR e conclua com o seu parecer.", decision: "Decida e conclua.", test: "Teste e conclua com o resultado.", action: "Faça e marque como concluída.", restart: "Reinicie e marque como concluída.", info: "Leia e conclua." };
export function task_ask_said(t: Task): string {
  if (t.state !== "open") {
    return t.state === "done" ? "Concluída." : "Descartada.";
  }
  if (t.assignee !== "user") {
    return "Está com " + (t.assignee === "unii" ? "o Unii" : t.assignee) + ": você só acompanha, cobra ou libera para fechar.";
  }
  const asks = (t.fields ?? []).filter((f) => f.required).length;
  const n = t.choices.length;
  if (asks > 0) {
    return "Responda " + (asks === 1 ? "à pergunta" : "às " + asks + " perguntas") + (n > 0 ? " e escolha uma opção." : " e conclua.");
  }
  if (n > 0) {
    return "Escolha uma das " + n + " opções.";
  }
  const k = Deps.kind_of(t);
  return k === null ? "Conclua quando estiver feito, ou descarte." : ASK_KIND[k];
}

export function task_kind_said(t: Task): string {
  const k = Deps.kind_of(t);
  return k === null ? "" : KIND_SAID[k] + (Number.isFinite(Deps.LATE_BY[k]) ? ", prazo " + Deps.LATE_BY[k] / 3600e3 + " h" : ", sem prazo");
}

// The task's contract (R5)
// ------------------------

// what a task waits for outside the list, as the views say it ("aguarda:
// CI do #42"); "" for none
export function task_waits_for_said(t: Task): string {
  return t.state !== "open" || (t.waits_for ?? null) === null ? "" : "aguarda: " + t.waits_for;
}

// whether a choice is an order to Unii (acts): picking it tells it at
// once; how the views mark it
export function act_unii(t: Task, c: string): boolean {
  return (t.acts ?? {})[c] === "unii";
}
export const ACT_SAID = "o Unii executa";

// a verdict and a note's severity, as the views say them
export const VERDICT_SAID: Record<PrCheck["verdict"], string> = { approved: "aprovado", approved_with_notes: "aprovado com ressalvas", rejected: "reprovado", pending: "aguardando verificação" };
export const SEV_SAID: Record<PrCheck["notes"][number]["sev"], [string, string]> = { high: ["alta", "altas"], medium: ["média", "médias"], low: ["baixa", "baixas"] };

// a pull request's label, "repo#n" (its link as given, else as is)
export function pr_label(url: string): string {
  const m = /^https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/.exec(url);
  return m === null ? url : m[1] + "#" + m[2];
}

// a pull request's notes, counted by severity ("1 alta e 2 baixas");
// "sem ressalvas" for none
export function pr_notes_said(p: PrCheck): string {
  const by = (["high", "medium", "low"] as const).map((v) => [v, p.notes.filter((n) => n.sev === v).length] as const).filter(([, n]) => n > 0);
  return by.length === 0 ? "sem ressalvas" : "ressalvas: " + and_said(by.map(([v, n]) => n + " " + SEV_SAID[v][n === 1 ? 0 : 1]));
}

// a verification card as Markdown lines (the terminal's /p)
export function pr_md(p: PrCheck): string {
  const head = "- **" + pr_label(p.url) + "** " + p.url + " · head `" + p.head.slice(0, 12) + "` · " + VERDICT_SAID[p.verdict] + (p.verifier === null ? "" : " por " + p.verifier) + " · " + pr_notes_said(p);
  const notes = p.notes.map((n) => "  - ressalva " + SEV_SAID[n.sev][0] + ": " + n.text);
  const untested = p.untested.length === 0 ? [] : ["  - não testado: " + p.untested.join("; ")];
  return [head, ...notes, ...untested].join("\n");
}

// a task's priority as the views say it, if not normal ("prioridade
// alta"); else ""
export function task_priority_said(t: Task): string {
  const p = Deps.priority_of(t);
  return p === "high" ? "prioridade alta" : p === "low" ? "prioridade baixa" : "";
}

// "3 h" under 2 days, else "3 d" (ms: how long)
function hours_said(ms: number): string {
  const h = Math.floor(ms / 3600e3);
  return h < 48 ? h + " h" : Math.floor(h / 24) + " d";
}

// how long a task of someone else's (Unii's, an agent's) has not
// moved on (Tasks.task_moves: linking or swapping its agent alone
// doesn't count; a list of an older server, without moved: its last
// change), once STALL or more: "parada há 3 h" (late: past TASK_LATE,
// what the stalled tasks' watch, vigia.ts, charges); else "" (closed,
// the user's, waiting for others, or the user wrote in its thread: then
// it's Unii's answer that's awaited, task_talk_wait_said)
export const STALL = 3600e3;
export function task_stalled_said(t: Task, blocked: Set<string>, now: number): { text: string; late: boolean } {
  const age = now - Date.parse(t.moved ?? t.changed ?? t.made);
  if (t.state !== "open" || t.assignee === "user" || blocked.has(t.id) || t.talk === "unii" || !(age >= STALL)) {
    return { text: "", late: false };
  }
  return { text: "parada há " + hours_said(age), late: age > TASK_LATE };
}

// the agent linked to a task of someone else's, as the views say it:
// "agente WiseDolphin", or, open and with none, "sem agente"; the
// user's, or closed with none: ""
export function task_agent_said(t: Task): string {
  const a = t.agent ?? null;
  return a !== null ? "agente " + a : t.state === "open" && t.assignee !== "user" ? "sem agente" : "";
}

// The evidence round
// ------------------
// Each task says its status beside its state (Tasks.ts, TaskDeps.ts):
// an order received, waiting for the user, blocked; once closed, the
// evidence that closed it, or "sem evidência" (closed before the round);
// one of Unii's, its next step and when it's due, overdue past it.

// an evidence as the views say it (pt-BR)
export function evidence_said(e: Evidence): string {
  const sum = e.summary === undefined ? "" : " — " + e.summary;
  switch (e.type) {
    case "slack":
      return "Mensagem enviada no Slack (canal " + e.channel + ", ts " + e.ts + ")" + sum;
    case "pr_merged": {
      const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/.exec(e.url ?? "");
      const merge = (e.confirmed ?? "").split(" ")[1];
      return "PR mesclado: " + (m === null ? e.url : m[2] + "#" + m[3]) + (merge === undefined ? "" : " (merge " + merge.slice(0, 12) + ")") + sum;
    }
    case "commit_tests":
      return "Commit " + (e.sha ?? "").slice(0, 12) + " em " + e.repo + ": " + e.passed + " " + (e.passed === 1 ? "teste passou" : "testes passaram") + ", " + e.failed + " falhas (" + e.command + ")" + sum;
    case "tfc":
      return "Run do Terraform Cloud " + e.run + ": " + e.status + sum;
    case "file":
      return "Arquivo " + e.path + (e.size === undefined ? "" : " (" + e.size + " bytes)") + sum;
    case "reason":
      return "Motivo: " + e.text;
    case "user":
      return (e.migrated ? "Resolução do usuário (registro anterior)" : "Resolução do usuário") + (e.answer == null ? "" : ": " + e.answer) + (e.note == null ? "" : " — “" + e.note + "”");
    case "restart":
      return "Serve reiniciado pelo Unii, como o usuário ordenou" + sum;
  }
}

// a task's status as the views say it: "ordem recebida", "aguardando
// você", "bloqueada", "aberta"; closed: "concluída", "descartada"
export function task_status_said(t: Task): string {
  if (t.state !== "open") {
    return t.state === "done" ? "concluída" : "descartada";
  }
  if ((t.order ?? null) !== null) {
    return "ordem recebida";
  }
  const st = Deps.status_of(t);
  return st === "blocked" ? "bloqueada" : st === "waiting_user" ? "aguardando você" : "aberta";
}

// whether a closed task has no evidence ("sem evidência")
export function task_unproven(t: Task): boolean {
  return t.state !== "open" && (t.evidence ?? []).length === 0;
}
export const UNPROVEN_SAID = "sem evidência";

// a task's marks of the evidence round, each [class, text]: an order
// received ("ordem recebida: Sim, reinicie"), waiting for the user
// ("aguardando você: o token"), blocked ("bloqueada: …; desbloqueia:
// …"), overdue ("prazo vencido há 3 h"), closed without evidence
export function task_marks(t: Task, tasks: Task[], now: number): [string, string][] {
  const out: [string, string][] = [];
  if (t.state !== "open") {
    return task_unproven(t) ? [["unproven", UNPROVEN_SAID]] : [];
  }
  if ((t.order ?? null) !== null) {
    out.push(["order", "ordem recebida" + (t.order!.answer === null ? "" : ": " + t.order!.answer)]);
  }
  const st = Deps.status_of(t);
  if (st === "waiting_user") {
    out.push(["waiting-user", "aguardando você" + ((t.status_why ?? null) === null ? "" : ": " + t.status_why)]);
  }
  if (st === "blocked") {
    out.push(["blocked", "bloqueada" + ((t.status_why ?? null) === null ? "" : ": " + t.status_why) + ((t.unblock ?? null) === null ? "" : "; desbloqueia: " + t.unblock)]);
  }
  const late = Deps.overdue_ms(tasks, t, now);
  if (late > 0) {
    out.push(["late overdue", "prazo vencido há " + (late < 3600e3 ? Math.max(1, Math.floor(late / 60e3)) + " min" : hours_said(late))]);
  }
  return out;
}

// a task's next step and when it's due ("Próximo passo: revisar o PR ·
// prazo 27/10 14:00"); "" for none (closed, or neither)
export function task_next_said(t: Task): string {
  if (t.state !== "open") {
    return "";
  }
  const due = Deps.due_at(t);
  const when = due === null ? "" : "prazo " + new Date(due).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const step = t.next_step ?? null;
  return step === null && when === "" ? "" : step === null ? "Próximo passo não informado · " + when : "Próximo passo: " + step + (when === "" ? "" : " · " + when);
}

// what makes a task done, as the views say it ("" for none said)
export function task_done_when_said(t: Task): string {
  return (t.done_when ?? null) === null ? "" : "Pronto quando: " + t.done_when;
}

// Recommendations
// ---------------
// Unii recommends a task's choice (recommend) and a field's answer
// (Field.recommend); a task of before, a choice marked "(recomendado)"
// or "(recomendada)" in its text (the only one so marked: for a multi,
// all those). "Aceitar as recomendadas" (task_accept) concludes with
// them in one act (P2, 25/10/2026)

const REC_MARK = /\(\s*recomendad[oa]s?\s*\)/i;

// whether a choice's own text says it's recommended
export function rec_marked(c: string): boolean {
  return REC_MARK.test(c);
}

// the choice of a task recommended (null: none)
export function task_rec(t: Task): string | null {
  if (t.recommend != null && t.choices.includes(t.recommend)) {
    return t.recommend;
  }
  const marked = t.choices.filter(rec_marked);
  return marked.length === 1 ? marked[0] : null;
}

// the answer of a field recommended (undefined: none)
export function field_rec(f: Field): Values[string] | undefined {
  if (f.recommend !== undefined && f.recommend.length > 0) {
    return f.recommend;
  }
  const marked = f.choices.filter(rec_marked);
  if (f.kind === "multi") {
    return marked.length > 0 ? marked : undefined;
  }
  return (f.kind === "choice" || f.kind === "yesno") && marked.length === 1 ? marked[0] : undefined;
}

// whether a choice (of the task, or of a field) is the one recommended
export function rec_is(rec: Values[string] | string | null | undefined, c: string): boolean {
  return rec === c || (Array.isArray(rec) && rec.includes(c));
}

// what "Aceitar as recomendadas" does to a task: null, not offered (not
// open, not the user's, nothing recommended); "conclude", concludes it
// with the recommended (its choice, if it has choices, recommended);
// "fill", only fills its fields' recommended answers, as a draft: it has
// choices, none recommended, and fields recommended, so the user still
// picks the choice that concludes it (R1, GreenWasp)
export type AcceptMode = "conclude" | "fill";
export function task_accept_mode(t: Task): AcceptMode | null {
  if (t.state !== "open" || t.assignee !== "user") {
    return null;
  }
  const fields = (t.fields ?? []).some((f) => field_rec(f) !== undefined);
  if (t.choices.length === 0) {
    return fields ? "conclude" : null;
  }
  return task_rec(t) !== null ? "conclude" : fields ? "fill" : null;
}

// whether a task offers "Aceitar as recomendadas" (task_accept_mode)
export function task_accepts(t: Task): boolean {
  return task_accept_mode(t) !== null;
}

// the button's words: one recommendation, many, or only filled
export function task_accept_said(t: Task): string {
  return task_accept_mode(t) === "fill" ? "Preencher as recomendadas" : t.fields.length === 0 ? "Aceitar a recomendada" : "Aceitar as recomendadas";
}

// what the user is told once the recommended answers are filled and a
// choice is still theirs to pick
export function task_fill_said(t: Task): string {
  return "Respostas recomendadas preenchidas em " + t.id + ". Escolha uma opção para concluir: " + t.choices.join(" | ") + " (no terminal: /ok " + t.id + " opção).";
}

// an answer not given: none, an empty text, no choice
function value_empty(x: unknown): boolean {
  return x === undefined || x === null || (typeof x === "string" && x.trim() === "") || (Array.isArray(x) && x.length === 0);
}

// the answers given so far (by field id), each empty one that has a
// recommendation taking it
export function task_accept_fill(t: Task, values: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const f of t.fields ?? []) {
    const given = Object.hasOwn(values, f.id) ? values[f.id] : undefined;
    const rec = field_rec(f);
    if (!value_empty(given)) {
      fields[f.id] = given;
    } else if (rec !== undefined) {
      fields[f.id] = rec;
    }
  }
  return fields;
}

// "Aceitar as recomendadas" over the answers given so far (values: by
// field id; those given stay, the empty take the recommended): the
// choice and the answers to conclude with, else why not (the user's
// words: a required field with no answer and none recommended)
export function task_accept(t: Task, values: Record<string, unknown>): { answer?: string; fields: Record<string, unknown> } | string {
  if (!task_accepts(t)) {
    return "A pendência " + t.id + " não tem recomendação para aceitar.";
  }
  const fields = task_accept_fill(t, values);
  if (task_accept_mode(t) === "fill") {
    return task_fill_said(t);
  }
  const missing = (t.fields ?? []).filter((f) => f.required && value_empty(fields[f.id]));
  if (missing.length > 0) {
    return "Sem recomendação para " + (missing.length === 1 ? "o campo obrigatório " : "os campos obrigatórios ") + missing.map((f) => "“" + f.label + "”").join(", ") + ": responda " + (missing.length === 1 ? "esse campo" : "esses campos") + " e conclua.";
  }
  const answer = task_rec(t);
  return { ...(answer === null ? {} : { answer }), fields };
}

// what "Cobrar agora" says in a task of Unii's thread (P6)
export const CHASE = "Cobrança: qual é o andamento desta pendência e o próximo passo?";

// the GitHub pull requests a task points to (its detail, its origin's
// link), each once, in order, at most LINKS: the link and "repo#n"
export const LINKS = 8;
export function task_prs(t: Task): { url: string; label: string }[] {
  const text = (t.detail ?? "") + " " + (t.origin_url ?? "");
  const seen = new Map<string, string>();
  // those verified (R5) first, each as given
  for (const p of t.prs ?? []) {
    if (!seen.has(p.url) && seen.size < LINKS) {
      seen.set(p.url, pr_label(p.url));
    }
  }
  for (const m of text.matchAll(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g)) {
    const url = m[0];
    if (!seen.has(url) && seen.size < LINKS) {
      seen.set(url, m[2] + "#" + m[3]);
    }
  }
  return [...seen].map(([url, label]) => ({ url, label }));
}

// the Mesa as Markdown, for the terminal's /mesa: its groups, each task
// a line (ref: that project's only)
export function desk_md(v: View, ref = ""): string {
  const groups = desk_list(v.tasks, "", ref);
  if (groups.length === 0) {
    return ref === "" ? "A Mesa está vazia: nenhuma pendência." : "Nenhuma pendência do projeto “" + ref + "”. Projetos: " + (desk_refs(v.tasks).join(", ") || "nenhum") + ".";
  }
  const line = (t: Task, g: Desk) => {
    const prio = g === "closed" ? "" : task_priority_said(t);
    const more = [
      ...(prio === "" ? [] : ["**" + prio + "**"]),
      ...(t.ref === null || ref !== "" ? [] : [t.ref]),
      ...(t.assignee === "user" ? [] : [assignee_said(t)]),
      ...(g === "waiting" ? ["aguarda " + Deps.waits(v.tasks, t).join(", ")] : []),
      ...(task_waits_for_said(t) === "" ? [] : [task_waits_for_said(t)]),
      ...(g === "closed" ? [t.state === "done" ? "concluída" : "descartada"] : []),
      ...task_marks(t, v.tasks, Date.now()).map(([, x]) => "**" + x + "**"),
      ...(g === "closed" || g === "waiting" || task_frees_said(v, t) === "" ? [] : [task_frees_said(v, t)]),
    ];
    return "- **" + t.id + "** " + t.title + (more.length === 0 ? "" : " · " + more.join(" · "));
  };
  const parts = groups.map((g) => "**" + g.label + " (" + g.tasks.length + ")**\n\n" + g.tasks.slice(0, g.group === "closed" ? 10 : undefined).map((t) => line(t, g.group)).join("\n"));
  return [...parts, "`/p P7` detalha · `/conversa P7 mensagem` conversa · `/ok P7` conclui · `/mesa projeto` filtra por projeto"].join("\n\n");
}

// a task as an older or newer server sends it, made whole: its assignee
// from `who` (its older name) if it has none (else "user"), what later
// phases added, empty; so no view takes an older server's task for the
// user's, nor breaks on what it lacks
export function task_whole(t: any): Task {
  const named = typeof t?.assignee === "string" && t.assignee !== "";
  if (named && Array.isArray(t.after) && Array.isArray(t.fields) && Array.isArray(t.thread) && Array.isArray(t.choices) && t.draft !== undefined && t.origin !== undefined && t.agent !== undefined && Array.isArray(t.prs) && t.acts !== undefined && Array.isArray(t.evidence) && t.status !== undefined && t.order !== undefined) {
    return t;
  }
  return {
    ...t,
    assignee   : named ? t.assignee : t?.who === "unii" ? "unii" : "user",
    origin     : t?.origin ?? null,
    origin_url : t?.origin_url ?? null,
    agent      : t?.agent ?? null,
    kind       : t?.kind ?? null,
    priority   : t?.priority ?? "normal",
    prs        : Array.isArray(t?.prs) ? t.prs : [],
    acts       : t?.acts ?? {},
    waits_for  : t?.waits_for ?? null,
    ready      : t?.ready ?? t?.made,
    choices    : Array.isArray(t?.choices) ? t.choices : [],
    after      : Array.isArray(t?.after) ? t.after : [],
    fields     : Array.isArray(t?.fields) ? t.fields : [],
    draft      : t?.draft ?? {},
    answers    : t?.answers ?? null,
    thread     : Array.isArray(t?.thread) ? t.thread : [],
    talk       : t?.talk ?? null,
    done_when  : t?.done_when ?? null,
    evidence   : Array.isArray(t?.evidence) ? t.evidence : [],
    status     : t?.status ?? "open",
    status_why : t?.status_why ?? null,
    unblock    : t?.unblock ?? null,
    order      : t?.order ?? null,
    next_step  : t?.next_step ?? null,
    next_due   : t?.next_due ?? null,
  };
}

// the pending list as Markdown, for the terminal's /p (one: its whole;
// waiting: those that wait for others, listed, the rest left out)
export function tasks_md(v: View, one: Task | null = null, waiting = false): string {
  const STATE = { open: "aberta", done: "concluída", dropped: "descartada" };
  const tag = (t: Task) => (t.ref === null ? "" : " · " + t.ref) + (origin_said(t) === "" ? "" : " · origem: " + origin_said(t));
  const opts = (t: Task) => (t.choices.length === 0 ? "" : " · opções: " + t.choices.map((c, k) => k + 1 + ") " + c + (t.descriptions?.[k] ? " (" + t.descriptions[k] + ")" : "") + (rec_is(task_rec(t), c) && !rec_marked(c) ? " (recomendada)" : "") + (act_unii(t, c) ? " (" + ACT_SAID + ")" : "")).join("  "));
  if (one !== null) {
    const said = [one.answer === null ? "" : "Resposta: " + one.answer + ".", one.note === null ? "" : "Comentário: " + one.note].filter((x) => x !== "").join(" ");
    const waits = Deps.waits(v.tasks, one);
    const frees = task_frees_said(v, one);
    const deps = (one.state === "open" && waits.length > 0 ? " · aguarda " + waits.join(", ") : "") + (frees === "" ? "" : " · " + frees);
    const talk = task_talk_said(one) === "" ? "" : " · " + task_talk_said(one);
    const kind = task_kind_said(one) === "" ? "" : " · " + task_kind_said(one);
    const outside = task_waits_for_said(one) === "" ? "" : " · " + task_waits_for_said(one);
    const marks = task_marks(one, v.tasks, Date.now()).map(([, x]) => " · **" + x + "**").join("");
    const head = "**" + one.id + "** " + one.title + "\n\n" + STATE[one.state] + marks + " · " + assignee_said(one) + tag(one) + kind + deps + outside + talk + opts(one);
    const round = [task_done_when_said(one), task_next_said(one)].filter((x) => x !== "").join("\n");
    const proof = one.state === "open" ? "" : (one.evidence ?? []).length === 0 ? "**Evidência:** nenhuma registrada (" + UNPROVEN_SAID + "). `/reabrir " + one.id + "` reabre." : "**Evidência**\n\n" + one.evidence.map((e) => "- " + evidence_said(e)).join("\n");
    const acts = one.state === "open" && one.choices.some((c) => act_unii(one, c)) ? "_As opções marcadas “" + ACT_SAID + "” avisam o Unii na hora, com `/ok " + one.id + " opção`._" : "";
    const prs = (one.prs ?? []).length === 0 ? "" : "**Verificação**\n\n" + one.prs.map(pr_md).join("\n");
    return [head, acts, said, round, proof, prs, one.detail, fields_md(one), thread_md(one)].filter((x) => x !== "").join("\n\n");
  }
  const { open, waiting: wait, closed } = view_tasks(v);
  const frees = (t: Task) => (task_frees_said(v, t) === "" ? "" : " · **" + task_frees_said(v, t) + "**");
  const extra = (t: Task) => ((t.fields ?? []).length === 0 ? "" : " · " + t.fields.length + (t.fields.length === 1 ? " campo" : " campos")) + (task_talk_said(t) === "" ? "" : " · **" + task_talk_said(t) + "**");
  const marks = (t: Task) => task_marks(t, v.tasks, Date.now()).map(([, x]) => " · **" + x + "**").join("");
  const line = (t: Task) => "- **" + t.id + "** " + t.title + marks(t) + frees(t) + tag(t) + opts(t) + extra(t);
  const whose = (t: Task | undefined) => (t === undefined || t.assignee === "user" ? "" : " (" + assignee_said(t) + ")");
  const who = (id: string) => id + whose(v.tasks.find((t) => t.id === id));
  const waits = (t: Task) => "- " + t.id + " " + t.title + whose(t) + " — aguarda " + Deps.waits(v.tasks, t).map(who).join(", ");
  const group = ([a, ts]: [string, Task[]]) => "**" + (a === "user" ? "Suas pendências" : "Pendências " + assignee_said(ts[0])) + " (" + ts.length + ")**\n\n" + ts.map(line).join("\n");
  if (waiting) {
    return wait.length === 0 ? "Nenhuma pendência aguardando outras." : "**Aguardando outras pendências (" + wait.length + ")**\n\n" + wait.map(waits).join("\n");
  }
  const done = (t: Task) => "- " + t.id + " " + STATE[t.state] + ": " + t.title + (t.answer === null ? "" : " — resposta: " + t.answer) + (task_unproven(t) ? " — **" + UNPROVEN_SAID + "**" : "");
  const parts = [
    open.length === 0 ? tasks_none_said(wait.length) : tasks_by_assignee(open).map(group).join("\n\n"),
    wait.length === 0 ? "" : "_" + tasks_waiting_said(wait.length) + "_ · `/p aguardando` mostra quais",
    closed.length === 0 ? "" : "**Resolvidas recentemente**\n\n" + closed.slice(0, 10).map(done).join("\n"),
    "`/p P7` detalha · `/ok P7 [opção] [campo=valor] [comentário]` conclui · `/ok!` conclui e avisa o Unii na hora · `/aceitar P7` aceita as recomendadas · `/cobrar P7` cobra o Unii · `/rascunho P7 campo=valor` · `/conversa P7 mensagem` · `/descartar P7` · `/reabrir P7` · `/avisar`",
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
  const rec = (f: Field, c: string) => (rec_is(field_rec(f), c) && !rec_marked(c) ? " (recomendada)" : "");
  const opts = (f: Field) => (f.kind === "choice" || f.kind === "multi" ? ": " + f.choices.map((c, k) => k + 1 + ") " + c + (f.descriptions?.[k] ? " (" + f.descriptions[k] + ")" : "") + rec(f, c)).join("  ") : f.kind === "text" && typeof field_rec(f) === "string" ? ", recomendado: “" + field_rec(f) + "”" : "");
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
  return [Cap(v.wait === SUMMARIES ? sums_show(v.sums, v.again) : "waiting for " + v.wait + "…"), ...kept, ...load];
}

// summaries a turn waits on, how many are done, and why they don't come
// if they fail (Again): what it says, when it asks again in the
// viewer's time
export function sums_show(sums: Sums | null, again: Again | null, now = Date.now()): string {
  const head = sums === null ? SUMS : SUMS.replace(/…$/, "") + ": " + sums.done + " of " + sums.total;
  if (again === null) {
    return head;
  }
  const at   = new Date(again.until);
  const day  = at.toDateString() === new Date(now).toDateString() ? {} : { weekday: "short" as const };
  const when = again.limit ? "at " + at.toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit" }) : "in " + Math.max(1, Math.ceil((again.until - now) / 60e3)) + " min";
  const why  = again.why.length > 120 ? again.why.slice(0, 120) + "…" : again.why.replace(/\.$/, "");
  return head + " · compactor: " + why + ", asking again " + when;
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

// what Unii is doing now, for a line always in sight while it works
// (Term.ts, main.ts): its step (the tool it runs, what it reads, thinks
// or writes, what it waits for) and the subagents at work, each by its
// label; null while nothing runs
export type Activity = { step: string; agents: { name: string; label: string }[] };
export function activity_of(v: View): Activity | null {
  if (!view_running(v)) {
    return null;
  }
  const agents = v.agents.map((name) => ({ name, label: agent_label(name) ?? name }));
  if (!v.busy) {
    return { step: agents.length === 1 ? "Um subagente em andamento" : agents.length + " subagentes em andamento", agents };
  }
  const live = v.live;
  const last = live.at(-1);
  const call = [...live].reverse().find((l) => l.kind === "tool");
  const said = (c: Call.Call) => {
    const line = Call.call_line(c);
    const name = c.name === "" ? "uma ferramenta" : c.name;
    return name + (line === "" ? "" : ": " + (line.length > 120 ? line.slice(0, 119) + "…" : line));
  };
  const step = Object.hasOwn(v.limits ?? {}, TURN) ? "Aguardando o limite de uso para continuar"
    : last?.kind === "tool" ? "Executando " + said(Call.call_parse(last.text))
    : last?.kind === "mind" ? "Pensando…"
    : last?.kind === "unii" ? "Escrevendo a resposta…"
    : call !== undefined ? "Analisando o resultado de " + said(Call.call_parse(call.text))
    : v.wait === SUMMARIES ? "Resumindo mensagens para a memória…"
    : v.wait !== "" ? "Aguardando " + v.wait + "…"
    : "Trabalhando…";
  return { step, agents };
}

// a spinner's frame, by the time (one each 120 ms)
export const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function spin_frame(now = Date.now()): string {
  return SPIN[Math.floor(now / 120) % SPIN.length];
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
  v.out.push({ msg: { id: uuid(), ...msg }, ws: null, done, said });
  v.flush();
}

// a random id, as crypto.randomUUID makes one: that is only in a secure
// context, and a page on a LAN's plain http is none
export function uuid(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))].map((b, k) => (k === 6 ? (b & 15) | 64 : k === 8 ? (b & 63) | 128 : b).toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
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
    return [...whole_rows(id, entry, v.whole.get(id - 1)), ...after];
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
  const rows = entry === undefined ? [] : whole_rows(id, entry, v.whole.get(id - 1));
  return [{ $: "Box", id, n, text, rows }];
}

// a message's rows, or a summary's block, made once: neither changes once
// known, so a redraw remakes only the rows that changed. A result's
// depend on the message before it too (entry_of), not known yet or known
// later (a block opened): made once each way
const ROWS  = new WeakMap<Entry | Node, Row[]>();
const APART = new WeakMap<Entry, Row[]>();

function whole_rows(id: number | null, entry: Entry, before: Entry | undefined): Row[] {
  const of = entry_of(entry, before);
  const made = of.apart ? APART : ROWS;
  const rows = made.get(entry) ?? entry_rows(id, entry.kind, entry.text, entry.images, of);
  made.set(entry, rows);
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
  const log = page.log ?? [];
  return [head, ...log.slice(from).flatMap((e, k) => whole_rows(null, e, log[from + k - 1]))];
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

// what a result is of, by its entry and the message before it (none: not
// known, as when a block holds it): apart unless that is its call (or a
// page of the result before it). A result logged before calls had ids
// (none) is never apart
export function entry_of(entry: Entry, before: Entry | undefined): Of {
  return { tool: entry.tool ?? "", apart: entry.kind === "echo" && entry.of !== undefined && before?.of !== entry.of };
}

// a result apart from its call is named by its tool on its first block
// (Md.md_output), or above it if none (a diff alone)
export function entry_rows(id: number | null, kind: Kind, text: string, images: string[] = [], of: Of = { tool: "", apart: false }): Row[] {
  const call = kind === "tool" ? Call.call_parse(text) : null;
  const report = kind === "work" ? Call.report_read(text) : null;
  const label = of.apart ? "↳ " + (of.tool === "" ? "" : Call.tool_name(of.tool) + " ") + "result" : "result";
  const body = call === null ? entry_body(kind, report?.text ?? text, label, of.tool) : [];
  const named = body.some((b) => b.$ === "File" && b.k.startsWith(label));
  const who = report !== null ? agent_shown(report.name) : WHO[kind] ?? (kind === "echo" && of.apart && !named ? label : "");
  // (an image pasted in the text shows there: Server.ts Chat.pictured)
  const pics = images.filter((name) => !text.includes("/media/" + name));
  return call === null && body.length === 0 && pics.length === 0 ? [] : [{ $: "Msg", id, kind, who, text, body, call, images: pics }];
}

// the length of a streaming message's head printed now: all of it once
// ended, as one block (a frame or fill is drawn whole), else none; none
// of one logged whole (a call, a result, the user's, a report)
export function entry_settled(kind: Kind, text: string, ended: boolean): number {
  return ["user", "work", "echo", "tool"].includes(kind) || !ended ? 0 : text.length;
}

// a result named by `label`; a show call's draws its media (Md.md_shown)
function entry_body(kind: Kind, text: string, label: string, tool: string): Md.Block[] {
  switch (kind) {
    case "user":
    case "work": {
      return Md.md_plain(text);
    }
    case "echo": {
      return Call.tool_name(tool) === "show" ? Md.md_shown(text, label) : Md.md_output(text, label);
    }
    default: {
      return Md.md_parse(text);
    }
  }
}

// The pipeline's panel (R6)
// -------------------------
// Pipeline.ts reads where each front is; these say it, for the panel's
// page (Html.pipeline_html)

// a front's stage, as the panel says it
export const STAGE_SAID: Record<Stage, string> = { impl: "implementando", verif: "verificando", user: "com você", others: "com terceiros", stalled: "parada com o Unii", closed: "encerrada" };

// a PR's state and checks read live, as the panel says them
export const PR_STATE_SAID: Record<PipeLive["state"], string> = { OPEN: "aberto", MERGED: "mesclado", CLOSED: "fechado" };
export const CI_SAID: Record<Ci, string> = { ok: "CI ok", failed: "CI falhou", running: "CI rodando", none: "sem CI" };

// a role, as the panel says it
export const ROLE_SAID: Record<Role, string> = { impl: "implementação", verif: "verificação", survey: "levantamento" };

// how long, said short: "agora" under a minute, "12 min", "5 h" under 2
// days, else "3 d"
export function span_said(ms: number): string {
  if (!(ms >= 60e3)) {
    return "agora";
  }
  if (ms < 3600e3) {
    return Math.floor(ms / 60e3) + " min";
  }
  return hours_said(ms);
}

// how long something took: span_said, but "menos de 1 min" under a
// minute
export function took_said(ms: number): string {
  return ms >= 0 && ms < 60e3 ? "menos de 1 min" : span_said(ms);
}

// when, said short, in the page's time: "24/10 14:26"
export function when_said(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

// notes counted by severity: "1 alta e 2 baixas"; "nenhuma" for none
export function sevs_said(s: Sevs): string {
  const by = (["high", "medium", "low"] as const).filter((v) => s[v] > 0);
  return by.length === 0 ? "nenhuma" : and_said(by.map((v) => s[v] + " " + SEV_SAID[v][s[v] === 1 ? 0 : 1]));
}

// a PR's head live against the one verified: the same ("head igual ao
// verificado"), or not ("head mudou: verificado X, agora Y"); "" when
// either isn't known
export function pr_head_said(p: FrontPr): { text: string; same: boolean } | null {
  if (p.head === null || p.live === null || p.live.head === "") {
    return null;
  }
  const same = p.live.head.startsWith(p.head) || p.head.startsWith(p.live.head);
  return same ? { text: "head igual ao verificado (" + p.head.slice(0, 7) + ")", same } : { text: "head mudou: verificado " + p.head.slice(0, 7) + ", agora " + p.live.head.slice(0, 7), same };
}

// the panel's totals: the fronts active (not closed), with the user,
// stalled with Unii; the median of cycles per PR (of the PRs verified)
// and of the user's time to decide, over every front; and how long the
// active fronts sat with no one at work (idle, summed)
export type Totals = { active: number; user: number; stalled: number; cycles: number | null; decide: number | null; decided: number; idle: number };
export function pipeline_totals(fronts: Front[]): Totals {
  const active = fronts.filter((f) => f.stage !== "closed");
  const cycles = fronts.flatMap((f) => f.prs.filter((p) => p.cycles > 0).map((p) => p.cycles));
  const decide = fronts.flatMap((f) => f.decide);
  return {
    active: active.length,
    user: active.filter((f) => f.stage === "user").length,
    stalled: active.filter((f) => f.stage === "stalled").length,
    cycles: median_of(cycles),
    decide: median_of(decide),
    decided: decide.length,
    idle: active.reduce((n, f) => n + f.idle, 0),
  };
}

export function median_of(xs: number[]): number | null {
  if (xs.length === 0) {
    return null;
  }
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}
