import type { Kind } from "./AskAI.ts";

type Look = { dim: boolean; it: boolean };

// the terminal's fill and the text on it ("7": its light gray, "0": its
// black), a diff's lines ("2": its green, "1": its red), as ANSI
// palette colors, so they follow the terminal's theme; the terminal's
// marks: a tool's name, the pick's model, effort and speed, the tab
// shown, offline, a command (Term.ts's list), a task's id, how many it
// frees, a task done (Panel.ts)
export const ANSI = {
  block : "7", ink: "0", add: "2", del: "1", you: "4",
  tool  : "6", model: "6", effort: "3", speed: "5", here: "2", off: "1",
  cmd   : "6", id: "3", frees: "5", done: "2",
};

export const WHO: Record<string, string> = { work: "Report", note: "Note" };

export const KIND: Record<Kind, Look> = {
  user : { dim: false, it: false },
  work : { dim: false, it: false },
  unii : { dim: false, it: false },
  tool : { dim: true, it: false },
  echo : { dim: true, it: false },
  note : { dim: true, it: true },
  mind : { dim: true, it: true },
};

export const FILLED: Kind[] = ["tool"];
export const FRAMED: Kind[] = ["user", "work"];

// a tool's mark in the terminal: a Nerd Font icon (the terminal's font
// must be one; the site draws its own, web/src/Icons.ts)
const TOOL: Record<string, string> = {
  zoom       : "\uf002", // nf-fa-search
  date       : "\uf073", // nf-fa-calendar
  shell      : "\uf489", // nf-oct-terminal
  read       : "\uf02d", // nf-fa-book
  write      : "\uf016", // nf-fa-file_o
  edit       : "\uf040", // nf-fa-pencil
  spawn      : "\uf234", // nf-fa-user_plus
  tell       : "\uf075", // nf-fa-comment
  computer   : "\uf245", // nf-fa-mouse_pointer
  schedule   : "\uf017", // nf-fa-clock_o
  schedules  : "\uf017",
  unschedule : "\uf017",
};
const TOOL_ANY = "\uf013"; // nf-fa-cog

export const GLYPH = {
  tab   : "◯",
  here  : "●",
  input : "> ",
  open  : "▾",
};

export function tool_glyph(name: string): string {
  return TOOL[name] ?? TOOL_ANY;
}

export function theme_css(): string {
  return Object.entries(KIND).map(([k, look]) => look_css(k, look)).join("");
}

function look_css(kind: string, look: Look): string {
  const ink   = look.dim ? "mid" : "ink";
  const style = look.it ? "italic" : "normal";
  const body  = "--fg:var(--" + ink + ");--it:" + style;
  return ".msg." + kind + "{" + body + "}";
}
