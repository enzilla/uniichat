// Pipeline
// ========
// The pipeline's panel (R6, uniichat-ux-r1.md §6): where each front (a
// task's ref) is, from the demand to the merge, read from what the serve
// already keeps, nothing typed by hand:
// - the agents' logs (Memory.ts docs/agent/<name>.jsonl): each one's note
//   (model, label <front>-<role>), its task, its report and when it
//   started and ended; one at work now is told by the live agents
//   (Tools.working). Its role is read from its label (…-impl, …-verif):
//   each verifier's run is one cycle of verification, its verdict and
//   its notes by severity read from its report (best effort: the first
//   lines say the verdict; listed notes say their severity), unless a
//   task's prs (R5) gives them, which wins;
// - the tasks (tasks.json): who has the front now (the user, Unii),
//   since when, and how long the user took to decide;
// - the pull requests the agents' tasks and the tasks' prs name, their
//   state read live from GitHub (`gh pr view`, Pipeline.GH), cached.
// And AGENTES.md, written by the serve as an agent starts and ends
// (agents_md): the table vigia.ts reads, so no one keeps it by hand.

import * as fs from "node:fs";
import type { PrCheck, Store, Task } from "./Tasks.ts";
import { ROLE_SAID, VERDICT_SAID, sevs_said, when_said } from "./View.ts";

// Types
// =====

export type Role     = "impl" | "verif" | "survey";
export type RunState = "working" | "done" | "cut";
export type Verdict  = PrCheck["verdict"];
export type Sevs     = { high: number; medium: number; low: number };

// an agent's run, as its log says it: its name, label, model, front,
// role; when it started and last wrote (its end, once not at work);
// whether it's at work, reported or was cut (a restart, a stop without
// report); a verifier's verdict and notes (noted: its report listed them
// by severity), the PRs its task names ("repo#n"), the head each was
// given at and the link of those named with their owner, the tasks its task marks ("(P48)") or that link it (agent),
// and its report's first line
export type Run = {
  name    : string;
  label   : string | null;
  model   : string | null;
  ref     : string;
  role    : Role;
  start   : string;
  end     : string;
  state   : RunState;
  verdict : Verdict | null;
  notes   : Sevs;
  noted   : boolean;
  prs     : string[];
  heads   : Record<string, string>;
  links   : Record<string, string>;
  tasks   : string[];
  said    : string;
};

// a pull request read live: open, merged or closed, its head, its checks
export type Ci   = "ok" | "failed" | "running" | "none";
export type Live = { state: "OPEN" | "MERGED" | "CLOSED"; head: string; ci: Ci };

// a PR of a front: its key ("auth#307"), its link if known (owner and
// repo: one named only "auth#307" has none, unless another mention or a
// task's prs gives it), how many cycles verified it, the head and
// verdict of the last, and its state live (null: not read yet, or no
// link, or gh failed)
export type FrontPr = { key: string; url: string | null; cycles: number; head: string | null; verdict: Verdict | null; live: Live | null };

// a cycle: a verifier's run, numbered in its front, with the work it
// verified (the runs of other roles since the cycle before)
export type Cycle = { n: number; run: Run; after: Run[] };

// where a front is: an agent implementing or verifying, the user's move,
// waiting on others (outside the list: CI, a merge on GitHub; or a task
// it waits for), stalled with Unii (none at work, nothing with the user),
// or closed (nothing open). A task of the user's that waits for others
// (after, waits_for) is the others' move, not theirs
export type Stage = "impl" | "verif" | "user" | "others" | "stalled" | "closed";

// a task as the panel shows it
export type FrontTask = { id: string; title: string; assignee: string; state: Task["state"] };

// a front: its ref, stage and since when, its tasks open, its runs and
// cycles, its PRs, the notes still open by severity (the last cycle's,
// while no work followed it; fixing: work followed), and its metrics:
// idle (how long, over its life, no agent was at work and no task was
// the user's: waiting on Unii), decide (how long the user took, from
// when each task became theirs to when they closed it: each, ms) and
// cycles per PR
export type Front = {
  ref    : string;
  stage  : Stage;
  since  : string;
  tasks  : FrontTask[];
  runs   : Run[];
  cycles : Cycle[];
  prs    : FrontPr[];
  open   : Sevs;
  fixing : boolean;
  idle   : number;
  decide : number[];
  first  : string;
};

// the panel: the fronts (the active first), and the totals over them
export type Panel = { at: string; fronts: Front[]; refreshing: boolean };

// Constants
// =========

// where the agents' logs are, in a chat's dir (Memory.ts AGENTS)
const AGENTS_DIR = "/docs/agent/";

// an agent's note (Tools.ts SUB_ROLE)
const NOTE = /^subagent(?: on (\S+))?(?: at effort (\S+))?(?:, labeled (.+))?$/s;

// a role, by its label's words
const VERIF  = /(^|-)(verif\w*|verificador\w*|revis\w*|review\w*)(-|$)/i;
const SURVEY = /(^|-)(levantamento|diagnostico|diagnóstico|survey|avaliacao|avaliação)(-|$)/i;

// a pull request named in a text: its link, or "owner/repo#n", "repo#n"
const PR_URL = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/gi;
// (an owner as GitHub's: letters, digits and "-", no "."; "evil.com/x#4"
// names none)
const PR_REF = /(?:^|[^\w\/.#-])(?:([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/)?([A-Za-z][\w.-]*)#(\d+)\b/g;
const NOT_REPO = /^(pr|prs|pull|issue|n|no|nº|item|p)$/i;

// a head given in a text: "head 6178ccf", "commit 33236f0", "em `d0ff55e`"
const HEAD = /\b(?:head|commit|sobre|em)\s+`?([0-9a-f]{7,40})\b/i;

// the ids a text marks between parentheses, only ids (vigia.ts marcados)
const MARKED = /\(\s*(P\d+(?:\s*(?:,|;|\be\b)\s*P\d+)*)\s*\)/g;

// how long a PR read live is kept: open, then merged or closed
export const LIVE_OPEN = 120e3;
export const LIVE_DONE = 3600e3;

// how many PRs are read at once, and the longest a read may take
const LIVE_AT_ONCE = 3;
const LIVE_TIMEOUT = 15e3;

// the most PRs read live per panel (the active fronts' first)
export const LIVE_MOST = 24;

// AGENTES.md: where the serve's part of it starts and ends (the rest of
// the file, written by hand, is kept as it is)
export const MD_START = "<!-- unii: agentes gerados pelo serve (início); não edite entre estas marcas -->";
export const MD_END   = "<!-- unii: agentes gerados pelo serve (fim) -->";

// Agents' logs
// ============

// an agent's log as read: its note, its task, its last report, when it
// started and last wrote, what its last line was
type Raw = { note: string; task: string; report: string; start: string; end: string; last: string };

// each log read once while it doesn't change (by size and time)
const RAWS = new Map<string, { size: number; mtime: number; raw: Raw | null }>();

function raw_read(file: string): Raw | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const had = RAWS.get(file);
  if (had !== undefined && had.size === st.size && had.mtime === st.mtimeMs) {
    return had.raw;
  }
  let raw: Raw | null = null;
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
    const roots = lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter((r) => r !== null && typeof r === "object");
    if (roots.length > 0) {
      const text = (r: any) => (typeof r?.text === "string" ? r.text : "");
      const date = (r: any) => (typeof r?.date === "string" ? r.date : new Date(st.mtimeMs).toISOString());
      const first = roots[0];
      const task = roots.find((r: any) => r.kind === "user");
      const report = [...roots].reverse().find((r: any) => r.kind === "unii");
      raw = { note: first.kind === "note" ? text(first) : "", task: text(task), report: text(report), start: date(first), end: date(roots[roots.length - 1]), last: String(roots[roots.length - 1].kind ?? "") };
    }
  } catch {
    raw = null;
  }
  RAWS.set(file, { size: st.size, mtime: st.mtimeMs, raw });
  return raw;
}

// every agent's run of a chat's dir, by when it started (working: the
// names at work now)
export function runs_read(dir: string, working: Set<string>, refs: string[], tasks: Task[] = []): Run[] {
  const at = dir + AGENTS_DIR;
  const files = fs.existsSync(at) ? fs.readdirSync(at).filter((f) => /^[A-Za-z-]+\.jsonl$/.test(f)) : [];
  const out: Run[] = [];
  for (const f of files) {
    const name = f.slice(0, -".jsonl".length);
    const raw = raw_read(at + f);
    if (raw !== null) {
      out.push(run_of(name, raw, working.has(name), refs, tasks));
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

// a run from its log (pure, for the tests)
export function run_of(name: string, raw: Raw, working: boolean, refs: string[], tasks: Task[] = []): Run {
  const m = NOTE.exec(raw.note.trim());
  const label = m?.[3]?.replace(/\s+/g, " ").trim() || null;
  const role = label !== null ? role_of(label) : role_in(raw.task);
  const state: RunState = working ? "working" : raw.last === "unii" && raw.report !== "" ? "done" : "cut";
  const found = verdict_of(raw.report);
  const verdict = role === "verif" && state === "done" ? found.verdict : null;
  const { prs, heads, links } = prs_named(raw.task);
  const linked = tasks.filter((t) => t.agent !== null && (t.agent === name || (label !== null && t.agent === label))).map((t) => t.id);
  const marked = [...raw.task.split("\n")[0].matchAll(MARKED)].flatMap((x) => x[1].match(/P\d+/g) ?? []);
  return {
    name, label, model: m?.[1] ?? null, ref: label !== null ? ref_of(label, refs) : ref_in(raw.task, refs), role,
    start: raw.start, end: raw.end, state, verdict,
    notes: verdict === null ? zero() : found.notes, noted: verdict !== null && found.noted,
    prs, heads, links, tasks: [...new Set([...marked, ...linked])],
    said: first_line(raw.report),
  };
}

// a label's role: verifying, surveying, else implementing (whatever
// else an agent does is work a verifier may check)
export function role_of(label: string | null): Role {
  if (label === null) {
    return "impl";
  }
  return VERIF.test(label) ? "verif" : SURVEY.test(label) ? "survey" : "impl";
}

// an unlabeled agent's role, as its task's first words say it ("Você é
// verificador…", "Verifique…")
export function role_in(task: string): Role {
  const head = fold(task.slice(0, 200));
  return /verific|revis|review/.test(head) ? "verif" : /levantamento|diagnostic/.test(head) ? "survey" : "impl";
}

// a label's front: the longest of the list's that it is or starts with
// ("num-2337" for "num-2337-svc-impl"); else its issue ("num-3307" for
// "num-3307-ressalva-impl"), else its first word
export function ref_of(label: string, refs: string[]): string {
  const l = label.toLowerCase();
  const by = [...refs].sort((a, b) => b.length - a.length).find((r) => l === r.toLowerCase() || l.startsWith(r.toLowerCase() + "-"));
  if (by !== undefined) {
    return by;
  }
  const issue = /^([a-z]+-\d+)(-|$)/.exec(l);
  return issue !== null ? issue[1] : l.split("-")[0];
}

// an unlabeled agent's front (agents of before labels): the longest of
// the list's its task's first lines name, else the issue they name
// ("NUM-2337" is num-2337), else none (NO_REF)
export const NO_REF = "sem frente";
export function ref_in(task: string, refs: string[]): string {
  const head = task.slice(0, 400).toLowerCase();
  const by = [...refs].sort((a, b) => b.length - a.length).find((r) => new RegExp("(^|[^\\w-])" + r.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^\\w-])").test(head));
  if (by !== undefined) {
    return by;
  }
  const issue = /\b([a-z]+-\d{2,})\b/.exec(head);
  return issue !== null ? issue[1] : NO_REF;
}

// a label's theme: its words but its role's, a head's or a round's
// ("num-2337-svc-normalizacao" for "num-2337-svc-normalizacao-verif"):
// the work a verifier checks is the theme's
const ROLE_WORD = /^(impl\w*|implementacao\d*|verif\w*|verificador\d*|revis\w*|review\w*|fix\d*|corre\w*|[0-9a-f]{7,40})$/i;
export function theme_of(label: string | null): string {
  const words = label === null ? [] : label.toLowerCase().split("-");
  return words.filter((w, k) => !ROLE_WORD.test(w) && !(/^\d+$/.test(w) && k > 0 && ROLE_WORD.test(words[k - 1]))).join("-");
}

function zero(): Sevs {
  return { high: 0, medium: 0, low: 0 };
}

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
}

// what a text says of a verdict, by the first word of one it has: "Aprovado;
// o PR anterior foi reprovado" is approved, "Reprovado; aprovado só
// depois de…" rejected; said in the first person too ("aprovei o #18",
// SmoothPretzel; "reprovei"), in the present ("aprovo o PR…", YellowHare;
// "reprovo")
const REJECTED = /reprovad|reprovei|\breprovo\b|rejeitad|rejeitei|\brejeito\b|\brejected\b|\bnao\s+aprov(?:ad|ou|ei|o\b)/;
const APPROVED = /aprovad|aprovou|aprovei|\baprovo\b|\bapproved\b/;
const WITH_NOTES = /^(?:aprovad[oa]s?\s*,?\s*(?:com|c\/)\s*(?:(?:\d+|uma|duas|tres)\s*)?(?:ressalva|observac)|aprov(?:ou|ei|o)\b(?:\s+(?:o|a|os|as)\s+[^.;:\n]{0,80}?)?\s*,?\s*(?:com|c\/)\s*(?:(?:\d+|uma|duas|tres)\s*)?(?:ressalva|observac)|approved with)/;
function verdict_said(s: string): Verdict | null {
  const r = s.search(REJECTED);
  const a = s.search(APPROVED);
  if (r < 0 && a < 0) {
    return null;
  }
  if (r >= 0 && (a < 0 || r <= a)) {
    return "rejected";
  }
  return WITH_NOTES.test(s.slice(a)) ? "approved_with_notes" : "approved";
}

// a line that labels the verdict: "**Veredito: …", "Veredito (NUM-2337):
// …", "Veredito final — …", a heading "## Veredito"; not a line that
// only cites the word ("O veredito do anterior foi reprovado.")
const VERDICT_LABEL = /^[\s>#*_`-]*(?:veredito|verdict)\b(?:\s*\([^)\n]{0,80}\)|\s+final)?[*_`\s]*(?:[:—–]|-\s|$)/;

// a report's verdict and the line that says it, within its first 600
// characters: its line labeled "Veredito:", or the first line after a
// label that says none ("**Veredito:**\nREPROVADO"); else its first line
// that says one, by the word said first
export function verdict_line(report: string): { verdict: Verdict; at: number } | null {
  const top: string[] = [];
  let n = 0;
  for (const line of report.split("\n")) {
    if (n >= 600) {
      break;
    }
    top.push(fold(line.slice(0, 600 - n)));
    n += line.length + 1;
  }
  for (let k = 0; k < top.length; k++) {
    const label = VERDICT_LABEL.exec(top[k]);
    if (label === null) {
      continue;
    }
    const said = verdict_said(top[k].slice(label[0].length));
    if (said !== null) {
      return { verdict: said, at: k };
    }
    for (let j = k + 1; j < top.length; j++) {
      const next = verdict_said(top[j]);
      if (next !== null) {
        return { verdict: next, at: j };
      }
    }
  }
  for (let k = 0; k < top.length; k++) {
    const said = verdict_said(top[k]);
    if (said !== null) {
      return { verdict: said, at: k };
    }
  }
  return null;
}

// "sem ressalvas" said of all of them: not followed by a word that
// qualifies which ("bloqueantes", "altas", "novas", "de merge"); on a
// folded text (lower case, no accents). "sem ressalvas pendentes" (or
// "abertas", "restantes") is of all of them too: none left open, so the
// list, if any, is of the ones fixed (decided 25/10, NuttyOyster). A
// lookahead, not a lookbehind (Safari before 16.4)
const NO_NOTES = /sem\s+(?:nenhuma\s+)?(?:ressalvas|ressalva(?!s))(?![\s*_`]*(?:que\s+)?(?:bloquei|bloqueant|impeditiv|impeca|critic|alta|media|grave|serias?\b|nova|novo|adiciona|relevant|significativ|importante|maior|de\s+merge|para\s+(?:o\s+)?merge|ao\s+merge|de\s+(?:severidade|gravidade|nivel)\b))/;

// a report's verdict (verdict_line) and its notes by severity: the list
// items after its verdict's line under a heading on notes, each by the
// first severity it says, and the items that open with their severity
// ("1. MÉDIA: …", "- Baixa — …") outside another heading ("Não
// testado:"). noted: some was found
export function verdict_of(report: string): { verdict: Verdict | null; notes: Sevs; noted: boolean } {
  const top = fold(report.slice(0, 600));
  const notes = zero();
  const found = verdict_line(report);
  if (found === null) {
    return { verdict: null, notes, noted: false };
  }
  const verdict = found.verdict;
  // after the verdict's line: a line on the notes ("**Ressalvas
  // baixas:**", "Ressalvas") opens their list, its severity, if said,
  // given to its items that say none; another heading closes it. An item
  // counts by its own severity, else the list's; an item outside a list
  // of notes counts only if it says it's one ("- **Ressalva média:** …")
  // or opens with its severity ("- **A1 (ALTA, bloqueante)** …")
  let noted = false;
  // where a line is: after no heading yet, under one on notes, under
  // another ("**Não testado:**", "**O que passou**")
  let within: "none" | "notes" | "other" = "none";
  let given: keyof Sevs | null = null;
  let group: keyof Sevs | null = null;
  for (const line of report.split("\n").slice(found.at + 1)) {
    const item = /^(\s*)(\d+[.)]|[-*•])\s/.exec(line);
    const own = sev_in(line.slice(0, 160));
    if (item === null) {
      if (line.trim() !== "") {
        group = null;
      }
      // a paragraph labeled by a note and its severity, its text on the
      // same line ("**Ressalva baixa (…):** em verdict_of…", LunarWhale,
      // SmoothPretzel): one note; a label with no text after it heads a
      // list (below)
      // one its label says fixed ("**Ressalva baixa (corrigida):** ok",
      // WhitePelican) isn't open: none
      // a numbered note, its text on the line or on the next ("**Ressalva
      // 1 (média)**\nTexto", ProudCougar): one note too
      const para = NOTE_PARA.exec(fold(line)) ?? NOTE_NUM.exec(fold(line));
      if (para !== null && !fixed(para[0])) {
        notes[sev_in(para[1]) ?? "low"] += 1;
        noted = true;
      }
      // a heading on notes fixed ("**Ressalvas corrigidas:**") heads
      // none open: its items aren't notes
      if (/ressalva|observa[cç]/i.test(line) && fixed(label_of(line))) {
        within = "other";
        given = null;
      } else if (para !== null && /^[\s>#*_`]*(?:ressalva|observacao)\s/.test(fold(line))) {
        // one note, said on its line ("**Ressalva baixa:** um título
        // …", WarmParrot): its items are its details ("- `### …` com
        // `1. **MÉDIA** a` conta 1 média"), not notes
        within = "other";
        given = null;
      } else if (/ressalva|observa[cç]/i.test(line)) {
        within = "notes";
        given = own;
      } else if (/^\s*(\*\*|#|_)/.test(line) || /:\s*$/.test(line)) {
        within = "other";
        given = null;
      }
      continue;
    }
    // an item its label says fixed ("- **Ressalva média (resolvida):**
    // …") isn't open: none, nor what it heads
    if (fixed(label_of(line))) {
      if (item[1].length < 2) {
        group = null;
      }
      continue;
    }
    const top_level = item[1].length < 2;
    // an item that heads its own list by a severity ("- **Baixas e
    // informativas:**"), under no heading: its items count by it, it not
    // (under a heading on notes, an item is a note, its items its words)
    if (top_level) {
      group = within === "none" && SEV_HEAD.test(line) && /:[*_`\s]*$/.test(line) ? own : null;
      if (group !== null) {
        continue;
      }
    } else if (group !== null) {
      if (/^\s*(?:\d+[.)]|[-*•])\s+[*_`]*\s*informa(?:cao|ção|tiv\w*)?\b|^\s*(?:\d+[.)]|[-*•])\s+[*_`]*\s*info\b/i.test(line)) {
        continue;
      }
      notes[own ?? group] += 1;
      noted = true;
      continue;
    }
    // under another heading ("**O que conferi:**"), an item that only
    // cites notes ("- PolarKoala foi de aprovado para aprovado com
    // ressalvas, com 1 baixa", WhitePelican) isn't one: it must open
    // with its label ("- **Ressalva média:** …")
    const cites = /ressalva|observa[cç]/i.test(line);
    const says = (within === "other" ? cites && NOTE_ITEM.test(fold(line)) : cites) || (top_level && within !== "other" && SEV_FIRST.test(line));
    const sev = own ?? (within === "notes" ? given : null);
    if (sev === null || !(says || (within === "notes" && top_level))) {
      continue;
    }
    notes[sev] += 1;
    noted = true;
  }
  // approved without notes: none, and none listed (noted only for notes);
  // not "sem ressalvas bloqueantes" or "sem ressalvas novas", that
  // qualify which ones it hasn't: its list counts (GoldenJay, LunarWhale)
  if (verdict === "approved" && NO_NOTES.test(top)) {
    return { verdict, notes: zero(), noted: false };
  }
  // approved with notes, none found in the report ("Aprovado, com uma
  // ressalva", none listed; WhitePelican): the ones its verdict's line
  // says, at least one, of the severity it gives them, else low, so
  // the count agrees with the verdict
  if (verdict === "approved_with_notes" && !noted) {
    const said = notes_said(fold(report.split("\n")[found.at] ?? ""));
    notes[said.sev] += said.n;
    noted = true;
  }
  return { verdict, notes, noted };
}

// a note's label says it's fixed: "corrigida", "resolvida", "sanada"
// (or "fixed", "resolved"); not "não corrigida", "ainda não resolvida",
// "sem correção", "not fixed"; on a folded label (label_of)
const FIXED_WORD = /\b(?:corrigid|resolvid|sanad|fixed\b|resolved\b)/;
const NOT_FIXED = /\b(?:nao|not|unfixed)\s+(?:\w+\s+){0,2}(?:corrigid|resolvid|sanad|fixed\b|resolved\b)/;
function fixed(label: string): boolean {
  return FIXED_WORD.test(label) && !NOT_FIXED.test(label);
}

// a heading's text after its ":" says all its notes fixed, and nothing
// else: "corrigidas", "todas corrigidas em abc", "ambas resolvidas";
// not "corrigida só a primeira", "corrigidas, exceto a 2" (ProudCougar,
// 25/10). On a folded text, without its marks
const ALL_FIXED = /^\s*(?:(?:todas?|tudo|ambas|as\s+(?:\d+|duas|tres|quatro|cinco))\s+(?:(?:as\s+)?ressalvas\s+)?)?(?:(?:ja\s+)?(?:foram|estao)\s+)?(?:corrigid|resolvid|sanad|fixed|resolved)\w*(?:\s*\([^)]*\)|\s+(?:em|no|na|pelo|pela|por|in)\s+[^,;]*)?\s*\.?\s*$/;

// a line's label, folded: a heading's whole title ("### Ressalvas
// corrigidas", "## Ressalvas (corrigidas)", WarmParrot), up to its ":"
// if it has one, with what follows only if that says all fixed
// (ALL_FIXED: "### Ressalvas: corrigida só a primeira" is "ressalvas",
// open), else its words
// up to its first ":" (within 160 characters), else its first bold
// words ("1. **MÉDIA (corrigida)** x"), else none (""): "Baixa:
// corrigida em abc" says it of the text, not of the label, so it stays
// a note
function label_of(line: string): string {
  const heading = /^\s*#{1,6}\s+(.*)$/.exec(fold(line.slice(0, 160)));
  if (heading !== null) {
    const title = heading[1].replace(/[*_`]/g, "").trim();
    const colon = title.indexOf(":");
    if (colon < 0) {
      return title;
    }
    const rest = title.slice(colon + 1);
    return ALL_FIXED.test(rest) ? title.slice(0, colon) + " " + rest.trim() : title.slice(0, colon);
  }
  const f = fold(line.slice(0, 160)).replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "");
  // a quote opens it: what it says is cited, not its label
  // ("1. \"Ressalva baixa (corrigida): ok\" conta 1 nota", WhitePelican)
  if (/^[\s*_]*["“”'‘’«]/.test(f)) {
    return "";
  }
  const colon = f.indexOf(":");
  if (colon >= 0) {
    return f.slice(0, colon);
  }
  const bold = /^\s*(\*\*|__)([^*_\n]+)\1/.exec(f);
  return bold !== null ? bold[2] : "";
}

// how many notes, and of what severity, a verdict's line says it has:
// "aprovado com duas ressalvas baixas" 2 low, "com 3 ressalvas, todas
// médias" 3 medium; "com ressalvas" (no number) at least one; no
// severity said, low. On a folded line
const COUNT_WORD: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5 };
function notes_said(line: string): { n: number; sev: keyof Sevs } {
  const m = /(?:com|c\/|with)\s*(\d+|uma?|dois|duas|tres|quatro|cinco)?\s*(?:ressalvas?|observac(?:ao|oes)|notes?)([^.;(\n]{0,30})/.exec(line);
  if (m === null) {
    return { n: 1, sev: "low" };
  }
  const n = m[1] === undefined ? 1 : /^\d+$/.test(m[1]) ? Math.max(1, Number(m[1])) : COUNT_WORD[m[1]];
  // the severity said right after it, "baixas", ", todas baixas"; not
  // one it denies ("nenhuma alta")
  const sev = /^[\s,*_`]*(?:(?:todas?|tudo|ambas)\s+)?(altas?|medias?|baixas?|high|medium|low)\b/.exec(m[2]);
  return { n, sev: sev === null ? "low" : sev_in(sev[1])! };
}

// an item that opens with a note's label: "- **Ressalva média:** …",
// "1. Observação baixa — …"; on a folded line
const NOTE_ITEM = /^\s*(?:\d+[.)]|[-*•])\s+[*_`]*\s*(?:ressalvas?|observac(?:ao|oes))\b/;

// a paragraph that opens with a label on a note with its severity, then
// says it on the same line: "**Ressalva baixa (o problema…):** em…",
// "Observação média: …", one numbered with its severity after its number
// ("Ressalva 1 (média): …", "**Observação B2 — baixa:** …", ProudCougar);
// not "**Ressalva 1:** corrigida" (no severity), nor "**Ressalvas
// baixas:**" alone (a heading). On a folded line
const NOTE_PARA = /^[\s>*_`]*(?:ressalvas?|observac(?:ao|oes))\s+(?:(?:n[o.]?\s*)?[a-z]?\d+[a-z]?[\s*_`]*[(\[,—–-]?\s*)?(altas?|medias?|baixas?)\b[^:\n]{0,160}:[*_`\s]*[^*_`\s]/;

// a line that labels one note by its number and severity, its text
// maybe on the next line: "**Ressalva 1 (média)**", "### Ressalva 2 —
// baixa"; to its ":" or its end, so a "(corrigida)" after its severity
// is in it (fixed). Singular: "Ressalvas 1 e 2 (baixas)" heads a list.
// On a folded line
const NOTE_NUM = /^[\s>#*_`]*(?:ressalva|observacao)\s+(?:n[o.]?\s*)?[a-z]?\d+[a-z]?[\s*_`]*[(\[,—–-]?\s*(alta|media|baixa)\b[^:\n]*/;

// an item that opens with its severity: "1. MÉDIA: …", "- **A1 (ALTA,
// bloqueante)** …", "1. A: baixa", "- Baixa — …"; not a word that
// goes on ("- Baixa cobertura de iPhone")
const SEV_FIRST = /^\s*(?:\d+[.)]|[-*•])\s+[*_`(\[]*\s*(?:[A-Z]\d*\s*[(:.—-]?\s*)?(altas?|high|m[eé]dias?|medium|baixas?|low)(?=[\s*_`)\]]*(?:[:.,;—–()-]|$))/i;

// an item that opens with a severity, said as it may go on ("- **Baixas e
// informativas:**")
const SEV_HEAD = /^\s*(?:\d+[.)]|[-*•])\s+[*_`(\[]*\s*(altas?|high|m[eé]dias?|medium|baixas?|low)(?![\p{L}\d])/iu;

// the first severity a text says ("MÉDIA", "baixas", "high")
function sev_in(s: string): keyof Sevs | null {
  const m = /\b(altas?|high|m[eé]dias?|medium|baixas?|low)\b/i.exec(s);
  if (m === null) {
    return null;
  }
  const f = fold(m[1]).replace(/s$/, "");
  return f === "alta" || f === "high" ? "high" : f === "media" || f === "medium" ? "medium" : "low";
}

function first_line(s: string): string {
  const line = s.split("\n").map((l) => l.replace(/[*_`#>]/g, "").trim()).find((l) => l !== "") ?? "";
  return line.length > 240 ? line.slice(0, 239) + "…" : line;
}

// the PRs a text names, as "repo#n" (lower case), with the head given
// near each (its next 160 characters), and the link of each named with
// its owner ("Numih/auth#307", a GitHub link)
export function prs_named(text: string): { prs: string[]; heads: Record<string, string>; links: Record<string, string> } {
  const found: { key: string; at: number; end: number; link: string | null }[] = [];
  for (const m of text.matchAll(PR_URL)) {
    found.push({ key: m[2].toLowerCase() + "#" + m[3], at: m.index!, end: m.index! + m[0].length, link: "https://github.com/" + m[1] + "/" + m[2] + "/pull/" + m[3] });
  }
  for (const m of text.matchAll(PR_REF)) {
    if (NOT_REPO.test(m[2]) || found.some((f) => m.index! >= f.at && m.index! < f.end)) {
      continue;
    }
    found.push({ key: m[2].toLowerCase() + "#" + m[3], at: m.index!, end: m.index! + m[0].length, link: m[1] === undefined ? null : "https://github.com/" + m[1] + "/" + m[2] + "/pull/" + m[3] });
  }
  found.sort((a, b) => a.at - b.at);
  const heads: Record<string, string> = {};
  const links: Record<string, string> = {};
  for (const f of found) {
    const head = HEAD.exec(text.slice(f.end, f.end + 160));
    if (head !== null && heads[f.key] === undefined) {
      heads[f.key] = head[1].toLowerCase();
    }
    if (f.link !== null && links[f.key] === undefined) {
      links[f.key] = f.link;
    }
  }
  return { prs: [...new Set(found.map((f) => f.key))], heads, links };
}

// two keys of one PR, one named shorter ("messaging#17" and
// "dp-bk-messaging#17"): the longer one's
export function pr_same(a: string, b: string): boolean {
  const [ra, na] = a.split("#");
  const [rb, nb] = b.split("#");
  return na === nb && (ra === rb || ra.endsWith("-" + rb) || rb.endsWith("-" + ra));
}

// Fronts
// ======

// the panel's fronts: of every ref of the list, its tasks' and its runs'
export function fronts(store: Store, runs: Run[], live: Map<string, Live>, now: number): Front[] {
  const refs = new Map<string, string>();
  const add = (r: string | null) => r !== null && r.trim() !== "" && !refs.has(r.toLowerCase()) && refs.set(r.toLowerCase(), r);
  store.refs.forEach(add);
  store.tasks.forEach((t) => add(t.ref));
  runs.forEach((r) => add(r.ref));
  const out: Front[] = [];
  for (const [low, ref] of refs) {
    const tasks = store.tasks.filter((t) => (t.ref ?? "").toLowerCase() === low);
    const mine = runs.filter((r) => r.ref.toLowerCase() === low);
    if (tasks.length === 0 && mine.length === 0) {
      continue;
    }
    out.push(front_of(ref, tasks, mine, store.tasks, live, now));
  }
  const rank: Record<Stage, number> = { user: 0, stalled: 1, verif: 2, impl: 3, others: 4, closed: 5 };
  return out.sort((a, b) => rank[a.stage] - rank[b.stage] || (a.stage === "closed" ? b.since.localeCompare(a.since) : a.since.localeCompare(b.since)));
}

function front_of(ref: string, tasks: Task[], runs: Run[], all: Task[], live: Map<string, Live>, now: number): Front {
  const open = tasks.filter((t) => t.state === "open");
  const shut = new Set(all.filter((t) => t.state !== "open").map((t) => t.id));
  const blocked = (t: Task) => t.after.some((id) => !shut.has(id) && all.some((u) => u.id === id));
  const working = runs.filter((r) => r.state === "working");
  const nowIso = new Date(now).toISOString();
  // runs with their verdict and notes as a task's prs gives them, if any
  const checks = tasks.flatMap((t) => t.prs ?? []);
  const runs_ = runs.map((r) => {
    if (r.role !== "verif") {
      return r;
    }
    const by = checks.filter((p) => p.verifier !== null && (p.verifier === r.name || p.verifier === r.label));
    if (by.length === 0) {
      return r;
    }
    const notes = zero();
    by.forEach((p) => p.notes.forEach((n) => (notes[n.sev] += 1)));
    const worst = by.some((p) => p.verdict === "rejected") ? "rejected" : by.some((p) => p.verdict === "approved_with_notes") ? "approved_with_notes" : by.every((p) => p.verdict === "approved") ? "approved" : r.verdict;
    return { ...r, verdict: worst, notes, noted: true };
  });
  // stage
  let stage: Stage;
  let since: string;
  const last_end = runs_.filter((r) => r.state !== "working").map((r) => r.end).sort().pop() ?? null;
  const verifying = working.filter((r) => r.role === "verif");
  const user = open.filter((t) => t.assignee === "user" && !blocked(t) && (t.waits_for ?? null) === null);
  const outside = open.filter((t) => (t.waits_for ?? null) !== null || blocked(t));
  if (verifying.length > 0) {
    stage = "verif";
    since = verifying.map((r) => r.start).sort()[0];
  } else if (working.length > 0) {
    stage = "impl";
    since = working.map((r) => r.start).sort()[0];
  } else if (user.length > 0) {
    stage = "user";
    since = user.map((t) => t.ready ?? t.made).sort()[0];
  } else if (outside.length > 0) {
    stage = "others";
    since = outside.map((t) => t.moved ?? t.changed).sort()[0];
  } else if (open.length > 0) {
    stage = "stalled";
    since = [last_end, ...open.map((t) => t.moved ?? t.changed)].filter((x): x is string => x !== null).sort().pop() ?? nowIso;
  } else {
    stage = "closed";
    since = [last_end, ...tasks.map((t) => t.closed ?? t.changed)].filter((x): x is string => x !== null).sort().pop() ?? nowIso;
  }
  // cycles: each verifier's run, with the work it checks: the runs
  // before it not yet given to a cycle, of its theme if any is
  const cycles: Cycle[] = [];
  const given = new Set<string>();
  for (const r of runs_) {
    if (r.role !== "verif") {
      continue;
    }
    const before = runs_.filter((x) => x.role !== "verif" && !given.has(x.name) && x.start <= r.start);
    const theme = theme_of(r.label);
    const same = before.filter((x) => theme !== "" && theme_of(x.label) === theme);
    const work = same.length > 0 ? same : before.filter((x) => theme_of(x.label) === "" || !runs_.some((v) => v.role === "verif" && v.start > r.start && theme_of(v.label) === theme_of(x.label)));
    work.forEach((x) => given.add(x.name));
    cycles.push({ n: cycles.length + 1, run: r, after: work });
  }
  // the work after the last cycle, not verified yet: fixing its notes
  const after = runs_.filter((x) => x.role !== "verif" && !given.has(x.name) && cycles.length > 0 && x.start > cycles[cycles.length - 1].run.start);
  const lastCycle = cycles[cycles.length - 1] ?? null;
  const fixing = lastCycle !== null && after.some((r) => r.role === "impl");
  const userChecks = open.flatMap((t) => t.prs ?? []);
  let notes = zero();
  if (userChecks.length > 0) {
    userChecks.forEach((p) => p.notes.forEach((n) => (notes[n.sev] += 1)));
  } else if (lastCycle !== null && !fixing && stage !== "closed") {
    notes = { ...lastCycle.run.notes };
  }
  // PRs
  const prs = front_prs(runs_, tasks, live);
  // metrics
  const first = [...runs_.map((r) => r.start), ...tasks.map((t) => t.made)].sort()[0] ?? nowIso;
  const busy: [number, number][] = [
    ...runs_.map((r) => [Date.parse(r.start), r.state === "working" ? now : Date.parse(r.end)] as [number, number]),
    ...tasks.filter((t) => t.assignee === "user").map((t) => [Date.parse(t.ready ?? t.made), t.closed !== null && t.state !== "open" ? Date.parse(t.closed) : now] as [number, number]),
  ];
  const endAt = stage === "closed" ? Date.parse(since) : now;
  const idle = idle_ms(Date.parse(first), endAt, busy);
  const decide = tasks.filter((t) => t.assignee === "user" && t.state !== "open" && t.closed !== null && t.closed_by !== "unii")
    .map((t) => Date.parse(t.closed!) - Date.parse(t.ready ?? t.made)).filter((ms) => Number.isFinite(ms) && ms >= 0);
  return {
    ref, stage, since,
    tasks: open.map((t) => ({ id: t.id, title: t.title, assignee: t.assignee, state: t.state })),
    runs: runs_, cycles, prs, open: notes, fixing, idle, decide, first,
  };
}

// a front's PRs: those its runs' tasks and its tasks' prs name, one key
// each (a shorter name folded into the longer: pr_same)
function front_prs(runs: Run[], tasks: Task[], live: Map<string, Live>): FrontPr[] {
  const keys: string[] = [];
  const links = new Map<string, string>();
  const keyOf = (k: string): string => {
    const same = keys.find((x) => pr_same(x, k));
    if (same === undefined) {
      keys.push(k);
      return k;
    }
    if (k.length > same.length) {
      keys[keys.indexOf(same)] = k;
      const l = links.get(same);
      if (l !== undefined) {
        links.delete(same);
        links.set(k, l);
      }
      return k;
    }
    return same;
  };
  for (const r of runs) {
    r.prs.forEach((k) => keyOf(k));
    Object.entries(r.links ?? {}).forEach(([k, l]) => links.has(keyOf(k)) || links.set(keyOf(k), l));
  }
  for (const t of tasks) {
    for (const p of t.prs ?? []) {
      const n = prs_named(p.url);
      n.prs.forEach((k) => links.set(keyOf(k), n.links[k] ?? p.url));
    }
    const n = prs_named(t.title + "\n" + t.detail + "\n" + (t.origin_url ?? ""));
    n.prs.forEach((k) => keyOf(k));
    Object.entries(n.links).forEach(([k, l]) => links.has(keyOf(k)) || links.set(keyOf(k), l));
  }
  return keys.map((key) => {
    const verifs = runs.filter((r) => r.role === "verif" && r.prs.some((k) => pr_same(k, key)));
    const last = verifs[verifs.length - 1] ?? null;
    const headKey = last === null ? undefined : Object.keys(last.heads).find((k) => pr_same(k, key));
    const check = tasks.flatMap((t) => t.prs ?? []).filter((p) => prs_named(p.url).prs.some((k) => pr_same(k, key))).pop() ?? null;
    const url = links.get(key) ?? null;
    return {
      key, url, cycles: verifs.length,
      head: check?.head ?? (headKey === undefined ? null : last!.heads[headKey]),
      verdict: check?.verdict ?? last?.verdict ?? null,
      live: url === null ? null : live.get(url) ?? null,
    };
  });
}

// how long, from `from` to `to`, none of the spans was going on (ms)
export function idle_ms(from: number, to: number, busy: [number, number][]): number {
  if (!(to > from)) {
    return 0;
  }
  const spans = busy.map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let covered = 0;
  let at = from;
  for (const [a, b] of spans) {
    if (b <= at) {
      continue;
    }
    covered += b - Math.max(a, at);
    at = b;
  }
  return to - from - covered;
}

// Pull requests, live
// ===================

// how a PR is read: `gh pr view` (replaced in the tests)
export const GH: { read: (url: string) => Promise<Live | null> } = { read: gh_read };

const LIVE = new Map<string, { live: Live | null; at: number }>();
let reading = 0;
const queue: string[] = [];

async function gh_read(url: string): Promise<Live | null> {
  try {
    const proc = Bun.spawn(["gh", "pr", "view", url, "--json", "state,headRefOid,statusCheckRollup"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const kill = setTimeout(() => proc.kill(), LIVE_TIMEOUT);
    const text = await new Response(proc.stdout).text();
    clearTimeout(kill);
    if ((await proc.exited) !== 0) {
      return null;
    }
    return live_of(JSON.parse(text));
  } catch {
    return null;
  }
}

// gh's answer as a Live (pure, for the tests)
export function live_of(x: any): Live | null {
  const state = x?.state;
  if (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") {
    return null;
  }
  const checks: any[] = Array.isArray(x.statusCheckRollup) ? x.statusCheckRollup : [];
  const said = checks.map((c) => String(c?.conclusion || c?.state || c?.status || "").toUpperCase());
  const ci: Ci = said.length === 0 ? "none"
    : said.some((s) => /FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE/.test(s)) ? "failed"
    : said.some((s) => /PENDING|QUEUED|IN_PROGRESS|EXPECTED|WAITING|REQUESTED|^$/.test(s)) ? "running" : "ok";
  return { state, head: typeof x.headRefOid === "string" ? x.headRefOid.toLowerCase() : "", ci };
}

// the PRs read so far, and whether any of `urls` is being read again:
// those not read, or read too long ago, are asked for (at most
// LIVE_AT_ONCE at a time), not awaited; done: called as each ends
export function live_get(urls: string[], now: number, done: () => void = () => {}): { live: Map<string, Live>; refreshing: boolean } {
  const live = new Map<string, Live>();
  let refreshing = false;
  for (const url of urls) {
    const had = LIVE.get(url);
    if (had?.live) {
      live.set(url, had.live);
    }
    const ttl = had?.live && had.live.state !== "OPEN" ? LIVE_DONE : LIVE_OPEN;
    if (had === undefined || now - had.at > ttl) {
      refreshing = true;
      if (!queue.includes(url)) {
        queue.push(url);
      }
    }
  }
  live_pump(done);
  return { live, refreshing: refreshing || reading > 0 };
}

function live_pump(done: () => void): void {
  while (reading < LIVE_AT_ONCE && queue.length > 0) {
    const url = queue.shift()!;
    reading += 1;
    GH.read(url).catch(() => null).then((live) => {
      LIVE.set(url, { live, at: Date.now() });
      reading -= 1;
      done();
      live_pump(done);
    });
  }
}

// forget what was read (the tests)
export function live_clear(): void {
  LIVE.clear();
  queue.length = 0;
}

// The panel
// =========

// the panel of a chat's dir: its fronts, and the PRs read live (those of
// the active fronts first, at most LIVE_MOST)
export function panel(store: Store, dir: string, working: Set<string>, now: number): Panel {
  const runs = runs_read(dir, working, store.refs, store.tasks);
  const first = fronts(store, runs, new Map(), now);
  const urls = first.flatMap((f) => f.prs.filter((p) => p.url !== null && p.live?.state !== "MERGED").map((p) => p.url!));
  const { live, refreshing } = live_get([...new Set(urls)].slice(0, LIVE_MOST), now);
  return { at: new Date(now).toISOString(), fronts: fronts(store, runs, live, now), refreshing };
}

// AGENTES.md
// ==========

// a run's row of the table vigia.ts reads: Nome de papel | Nome técnico |
// Projeto | Papel (its tasks marked "(P48)") | Modelo | Estado ("em
// andamento" first, while at work)
export function md_row(r: Run): string {
  // a pipe in a cell is a "/": vigia.ts splits a row by every "|", an
  // escaped one too
  const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim() || "—";
  const notes = sevs_said(r.notes);
  const state = r.state === "working" ? "em andamento desde " + when_said(r.start)
    : r.state === "cut" ? "interrompido (sem relato), " + when_said(r.end)
    : "concluído" + (r.verdict === null ? "" : ": " + VERDICT_SAID[r.verdict] + (notes === "nenhuma" ? "" : " (ressalvas: " + notes + ")")) + ", " + when_said(r.end);
  const role = ROLE_SAID[r.role] + (r.prs.length > 0 ? " " + r.prs.join(", ") : "") + (r.tasks.length > 0 ? " (" + r.tasks.join(", ") + ")" : "");
  return "| " + [r.label ?? "", r.name, r.ref, role, r.model ?? "padrão", state].map(cell).join(" | ") + " |";
}

// the serve's part of AGENTES.md: its marks, a note, the table
export function md_block(runs: Run[]): string {
  return [
    MD_START,
    "## Agentes (gerado pelo serve)",
    "Escrito pelo serve quando um agente começa e termina (uniichat, R6). Não edite à mão: a próxima escrita desfaz.",
    "",
    "| Nome de papel | Nome técnico | Projeto | Papel | Modelo | Estado |",
    "|---|---|---|---|---|---|",
    ...runs.map(md_row),
    MD_END,
  ].join("\n");
}

// the file with the serve's part put in: in the place of its first part
// (an end mark and the start mark nearest before it), if there; else
// after what's there (a file written by hand keeps all it had). Other
// parts are taken out, and a mark with no pair (an end with no start
// before it, a start with no end after it) too: never two parts
export function md_merge(had: string, block: string): string {
  const PLACE = "\u0000unii-agentes\u0000";
  let rest = had;
  let placed = false;
  for (let from = 0; ;) {
    const b = rest.indexOf(MD_END, from);
    if (b < 0) {
      break;
    }
    const a = rest.lastIndexOf(MD_START, b);
    if (a < from) {
      from = b + MD_END.length;
      continue;
    }
    const after = rest.slice(b + MD_END.length);
    rest = rest.slice(0, a) + (placed ? after.replace(/^\n/, "") : PLACE + after);
    from = placed ? a : a + PLACE.length;
    placed = true;
  }
  for (const mark of [MD_START, MD_END]) {
    rest = rest.split(mark + "\n").join("").split(mark).join("");
  }
  if (placed) {
    return rest.replace(PLACE, () => block);
  }
  return rest.trim() === "" ? block + "\n" : rest.replace(/\n*$/, "\n\n") + block + "\n";
}

// where the serve writes AGENTES.md: UNII_AGENTES (the file vigia.ts
// reads, ~/orquestracao/AGENTES.md), else the chat's dir
export function md_file(dir: string): string {
  const env = process.env.UNII_AGENTES ?? "";
  return env !== "" ? env : dir + "/AGENTES.md";
}

// write it, if what it says changed; a failure is said in the log, never
// thrown (an agent's start or end goes on)
export function agents_md(store: Store, dir: string, working: Set<string>): void {
  const file = md_file(dir);
  try {
    const runs = runs_read(dir, working, store.refs, store.tasks);
    const had = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const next = md_merge(had, md_block(runs));
    if (next !== had) {
      fs.writeFileSync(file + ".new", next);
      fs.renameSync(file + ".new", file);
    }
  } catch (err: any) {
    console.error("unii: AGENTES.md not written (" + file + "): " + String(err?.message ?? err));
  }
}
