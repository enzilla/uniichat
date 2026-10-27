import type { Ask, Block, Kind, Say } from "./AskAI.ts";
import type { Out } from "./Agent.ts";
import { report_text } from "./Call.ts";
import { clip_page } from "./Clip.ts";
import * as config from "./Config.ts";
import * as Instructions from "./Instructions.ts";
import { Limit } from "./Limit.ts";
import { INT, STR, TOOLS, VIDEO_LIMIT, spec, type Job, type Skill, type Spec } from "./Machine.ts";
import { Mcp, type Server, type Servers } from "./Mcp.ts";
import { Memory } from "./Memory.ts";
import PROMPT from "./prompt.txt" with { type: "text" };
import COMPACT_PROMPT from "./compact.txt" with { type: "text" };
import { EFFORTS, Pick } from "./Pick.ts";
import * as Rank from "./Rank.ts";
import * as Tasks from "./Tasks.ts";
import * as Evidence from "./Evidence.ts";
import * as Restart from "./Restart.ts";
import { Run, type CallHooks, type Heard, type InboxHooks, type LoopHooks } from "./Run.ts";
import type { Msg } from "./Server.ts";
import * as Timer from "./Timer.ts";
import { PING, type Pending } from "./View.ts";
import { err_why } from "./Err.ts";
import { get, list as items, rec, text_of } from "./Json.ts";



// id, its skills, its Claude Code's MCP servers' names and its
// instructions as last looked at (Tools.look); the MCP servers it told
// of (Tools.servers), and why some were left out
type Device = {
  who    : string;
  host   : string;
  terms  : Map<string, Link>;
  jobs   : Map<string, Running>;
  skills : Skill[];
  mcps   : string[];
  rules  : Instructions.Part[];
  paths  : string[];
  proj   : Instructions.Part[];
  shown  : Set<string>;
  mcp    : config.McpServer[];
  why    : string;
  clash  : string;
};

type Running = { term: string; job: Job; out: Promise<Out>; end: (out: Out) => void };

type Link = { send: (msg: object) => void; live: () => boolean; work: string; scratch: string | null; shell: string | null };

// a task to spawn, with what it runs on
export type Spawn = { task: string; role: Agent["role"]; label: string };

// at work, the view its calls get and its replies so far
export type Agent = {
  name    : string;
  label   : string | null; // what the user reads it as (Tools.start)
  role    : { effort: string | null; model: string | null };
  why     : string | null;
  view    : Block[];
  replies : string[];
  run     : Run<Say, Say>;
};

type Log = {
  push   : (run: Run<Say, Say>, kind: Kind, text: string) => void;
  note   : (text: string) => void;
  on     : (run: Run<Say, Say>, ev: Heard) => void;
  report : (text: string, take: boolean, origin?: string) => void;
  change : () => void;
  timed  : () => void;
  restart? : (how: Restart.How) => void; // the process restarted, as `how` says, once the tool answered (Server.ts)
  agents?  : () => void; // an agent started: AGENTES.md written again (Pipeline.agents_md; as it ends, its report does it, Server.ts Chat.report)
};

export type Tools = {
  mem     : Memory;
  devices : Map<string, Device>;
  agents  : Map<string, Agent>;
  labels  : Map<string, string>; // every agent's label it has, by name (Tools.labels)
  mcp     : Servers;
  next    : config.McpServer[] | null;
  left    : boolean;
  key     : string;
  url     : string;
  main    : Run<Pending, Msg>;
  log     : Log;
  origin? : string; // where the master's turn now came from (Tasks.Origin; Server.ts Chat.call)
};

export const SEARCHES = 10;

const HALT = 5000;

// how long past a device's own limit for a shell or view_video job the
// server waits before ending it (ms), and how long it waits on a quick
// job (read, write, edit, skill) (Tools.job_limit)
const SPARE = 30_000;
const QUICK = 120_000;

const GRACE = 3 * PING;

const CHATS = new Map<string, Tools>();
let HTTP: ReturnType<typeof Bun.serve> | null = null;

const RUNNING = new Map<string, Set<AbortController>>();
const SESSION = "mcp-session-id";

// the two prompts: the user prompt, every turn's (prompt.txt), and the
// compaction prompt, every summary's and nothing else (compact.txt, after
// upstream #37 by @tinqr: with one prompt for both, a turn sometimes came
// back a summary). Each is replaced by its file in the server's dir,
// written by hand or on the Settings page (Server.ts)
export const PROMPTS = {
  prompt  : { def: PROMPT.trim(), file: config.DIR + "/prompt.md" },
  compact : { def: COMPACT_PROMPT.trim(), file: config.DIR + "/compact.md" },
};

const SUB_HEAD = `You are a subagent of Unii, an AI agent that works for one user in a
single chat that never ends. Unii gave you a task. Do it yourself, with
your tools, following the user's instructions at the end of this
prompt: they say who the user is, how their files are organized and how
they want work done.

Your first message holds the view below, then your chat with Unii so far,
its lines as "i|kind: text": what you are (note), your task (user), and
later all you did and were told. The view shows you what Unii knows: what the user wants,
decided and taught. Use it as context only, and do what your task says,
not what the user's last message says, since Unii may have given you
just part of the work. Your final reply is your report to Unii. Unii may
send you more messages; one sent while you work reaches you once your
current reply is done, as a new message: answer the last.`;

const VIEW_DOC = `The view: the whole chat between Unii and the user, oldest first, inside
<chat> tags, as one-line summaries. Each line is

  id+n|text   the n messages from id on, summarized (newlines shown as spaces)

A summary tags each item with its kind: user (the user's words), unii
(Unii's replies), tool (Unii's tool calls), echo (their results), note
(memories from before this chat), or work (the report of a subagent,
starting "[Name]", or a scheduled message from the timer, starting "[Timer id]"). A short message is its own line, word for word. Recent lines
cover one message each; the older the messages, the more a line covers.
A message not summarized yet shows as "(not summarized yet: zoom it)".
No message appears in full, not even the last ones. A text too long for
one message is split over several in a row.

Navigating: zoom(id, n) opens line id+n into the two lines of n/2
messages it was made from; zoom(id, 1) gives message id in full, with
the images its "[image <file>]" lines name. Zoom whenever a summary
only mentions something you need, such as what your last reply said, a
decision, a past attempt or where a file is, before you act, guess or
ask. date(id) gives the date and time of message id. zoom("Name") gives
an agent's whole chat.`;

// model and effort if not the configured ones, and its label if given
// (one line, last: older notes, without, read the same)
const SUB_NOTE   = "subagent";
const SUB_ON     = " on ";
const SUB_AT     = " at effort ";
const SUB_AS     = ", labeled ";
const SUB_ROLE   = new RegExp("^" + SUB_NOTE + "(?:" + SUB_ON + "(\\S+))?(?:" + SUB_AT + "(\\S+))?(?:" + SUB_AS + "(.+))?$", "s"); // s: a label edited by hand with a line break (U+2028...) still reads

// a label's most characters (graphemes: an emoji's parts are never cut
// apart), and most code points, so marks piled on them can't make it long
const LABEL = 60;
const LABEL_POINTS = 2 * LABEL;
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

const MODELS = [...new Set(Pick.models(config.OFFER.vendors, config.OFFER.models).map(([, m]) => m.label))];

const TASK = { type: "object", properties: {
  task   : STR,
  model  : { type: "string", enum: MODELS, description: "Its model; by default, the one it'd run on. Set it ONLY when the user asks for that model or vendor in this chat, since another vendor may come with additional costs." },
  effort : { type: "string", enum: EFFORTS, description: "How hard it thinks; by default, as hard as you." },
  label  : { type: "string", description: "A short label the user reads as this subagent's name instead of its generated one: <project>-<role>, as num-3182-verifier or uniichat-links-impl. Give one for every task. You still name it by its generated name in tell, stop and zoom." },
}, required: ["task"] };

const DEVICES = `Devices: the user's computers that run unii's device now, by name, listed
at the start of each message. Your shell, read, write, edit, view_video and
show tools run on the one their \`device\` field names. A computer is listed only
while its device runs, and leaves the list when it stops: a task that needs
one not listed can't be done now, so tell the user it isn't available. Each
names its work dir, where the user's projects are, and its scratch dir, which
holds your own folder: put your scratch files and git worktrees there, never
among the user's projects. When you start work in a folder or repository, read
its AGENTS.md if it has one, and check its \`.agents/skills/\` for a SKILL.md
that fits the task.`;
const DEVICES_NONE = "(None is open now.)";
const MEDIA_AT = "Media and files in the chat, /media/<name>, are the files {dir}<name> on the server's computer.";

const SKILLS = "Skills on the devices open now, by device: when a task matches one's description, load it with the skill tool first, then follow it (skills_search finds them by words).";

// the most skills skills_search answers with
const FOUND = 10;

const LOOK = 3000;

const SUB = SUB_HEAD + "\n\n" + VIEW_DOC + "\n\n" + DEVICES;
const AGENT_PROMPT = "Unii's own prompt follows, for the user's instructions in it. Where it speaks to Unii, it speaks of the agent you work for, not of you.";

const OWN: Spec[] = [
  spec("zoom", "Open the line id+n of the view into the two lines of n/2 under it; n = 1 gives the message whole. With an agent's name as id, give that agent's whole chat. A long text comes in pages from character at, saying where to go on.", { id: { type: ["integer", "string"] }, n: INT, at: INT }, ["id"]),
  spec("date", "The date and time of message id.", { id: INT }, ["id"]),
];
// a choice offered: its label, and what picking it means (Tasks.ts
// choices_read; a bare label is read too)
const CHOICE = { type: "object", properties: { label: STR, description: STR }, required: ["label"] };

// a task's fields (Tasks.ts fields_read)
const FIELDS_SPEC = {
  type: "array",
  description: "Questions asked at once, each answered apart (at most 12): id (letters, digits, - or _), label (the question, in the user's language), kind: choice (one of choices), multi (any of choices), text, yesno (sim or não); choices for choice and multi (2 to 9), each a label and a description of what picking it means; required (true by default: the user can't conclude without it); recommend: the answer you recommend, if any (one of its choices' labels; for multi, a list of them; for yesno, sim or não; for text, a text), which the user takes with one click (\"Aceitar as recomendadas\") instead of writing \"(recomendado)\" in a choice.",
  items: { type: "object", properties: { id: STR, label: STR, kind: { type: "string", enum: ["choice", "multi", "text", "yesno"] }, choices: { type: "array", items: CHOICE }, required: { type: "boolean" }, recommend: { type: ["string", "array"], items: STR } }, required: ["id", "label", "kind"] },
};

// the choice Unii recommends (Tasks.ts recommend_read)
const RECOMMEND_SPEC = { type: "string", description: "The choice you recommend (one of choices): the user sees it marked and takes it, with the fields' recommendations, in one click (\"Aceitar as recomendadas\"). Give it rather than writing \"(recomendado)\" in the choice. With choices and none recommended, the click only fills the fields' recommendations and the user still picks the choice." };

// where a task came from, and its source's link (Tasks.ts)
const ORIGIN_SPEC = { type: "string", description: "Where it came from, always given (never taken from the turn): chat (the user asked for it), timer (a schedule's turn), agent:<name> (a subagent's report asked for it), slack or github. A task you add after an agent's report, of your own accord, is chat or timer, not that agent's." };
const ORIGIN_URL_SPEC = { type: "string", description: "A link (http/https) to its source, such as the Slack message or the GitHub issue." };
// the task's contract (R5, Tasks.ts): its pull requests as verified, who
// acts on each choice, what outside the list it waits for, a new front
const PRS_SPEC = {
  type: "array",
  description: "The pull requests it's about, each as verified: url (the GitHub pull link), head (the commit verified, 7 to 40 hex), verdict (approved, approved_with_notes, rejected, pending), verifier (the verifier agent's name), notes ([{sev: high, medium or low, text}]: its notes by severity), untested (what wasn't tested). Required for kind pr: a PR's approval without its link and head is refused. The views show each as a verification card.",
  items: { type: "object", properties: { url: STR, head: STR, verdict: { type: "string", enum: ["approved", "approved_with_notes", "rejected", "pending"] }, verifier: STR, notes: { type: "array", items: { type: "object", properties: { sev: { type: "string", enum: ["high", "medium", "low"] }, text: STR }, required: ["sev", "text"] } }, untested: { type: "array", items: STR } }, required: ["url", "head"] },
};
const ACTS_SPEC = { type: "object", additionalProperties: { type: "string", enum: ["user", "unii"] }, description: "By choice, who acts once the user picks it: user (it reports what they did, \"Mesclado\") or unii (an order to you, \"Sim, reinicie\": you're told at once, not in the minute's batch). Choices not named: none said." };
const WAITS_FOR_SPEC = { type: "string", description: "What outside the list it waits for (\"CI do #42\", \"merge no GitHub\"), beside after (tasks); \"\" for none." };
const REF_SPEC = { type: "string", description: "Its front: one of the list's (an unknown one is refused, with the nearest and the list), as uniichat-ux or num-2337. \"\" for none." };
const REF_NEW_SPEC = { type: "boolean", description: "true: ref starts a new front, added to the list. Only for a front truly new, never a variant of one listed." };
const KIND_SPEC = "What it is, as when it's late counts, from when it became the user's to act on: pr (a PR's approval: needs prs) 24 h, decision 72 h, test 2 h, action (a step only the user can do) 24 h, restart (the serve's restart, only while agents are at work: with no choices it gets its template, \"Sim, reinicie\" (yours) or \"Eu reinicio depois\"; with none at work, use the restart tool) 24 h, info (only to read) never, priority low unless given, and listed after every task to act on; none: 24 h (a GitHub pull link in its title makes it pr, a title opening with \"Teste\" makes it test). Whatever its kind, a task of the user's that cites a GitHub pull in its title or detail needs prs. A late one only says so: it never expires.";
// the evidence round (Evidence.ts, Tasks.ts)
const EVIDENCE_SPEC = {
  type: ["object", "array"],
  description: "What closes it (state done or dropped): evidence of a concrete, documented solution, checked by the system; without it the close is refused. One object or a list (at most 5), each {type, ..., summary?}: slack {channel: the channel's id (C…/D…/G…), ts: the message's ts} (a message you sent); pr_merged {url} (read live on GitHub: must be MERGED); commit_tests {repo: owner/repo, sha, command, passed, failed: 0} (the commit read live on GitHub); tfc {run: run-<16>, status: applied or planned_and_finished}; file {path: absolute, on the server's computer, must exist}; reason {text: at least 40 characters} (only to drop: why it no longer applies). On a task closed already without evidence (sem evidência), it's added.",
  items: { type: "object" },
};
const DONE_WHEN_SPEC = { type: "string", description: "What concretely makes it done (\"PR #19 mesclado e serve reiniciado\", \"resposta enviada a Enzo no Slack\"): its evidence must show it when it's closed. Required." };
const NEXT_STEP_SPEC = { type: "string", description: "Your next concrete step on it (required for a task of yours): the views show it, and once its due passes the task is overdue." };
const NEXT_DUE_SPEC = { type: "string", description: "When the next step is due: a time (ISO) or from now (\"4h\", \"30m\", \"2d\"). None: the server's setting (4 h by default) after the task last moved. Past it, the task is overdue: said to you in each turn's block, shown in the views, pushed to the user once." };
const STATUS_SPEC = { type: "string", enum: ["open", "waiting_user", "blocked"], description: "An open task's status: open (being worked on); waiting_user (yours, waiting for something only the user can give: status_why says what; it shows in their Agora); blocked (status_why: why; unblock: what unblocks it). An order received is the user's pick, never set." };
const AGENT_SPEC = { type: "string", description: "The agent at work on it now, by name (its generated name or its label): for a task of yours, who follows it up, so the views show it and a task with no agent at work is seen as stalled. \"\" for none." };
const BOSS: Spec[] = [
  spec("spawn", "Start one subagent per task, in parallel, and return their names at once. Each one's report reaches you as a message \"[Name] report\" when it finishes. One that hits an AI service's usage limit waits for the reset and goes on by itself, as you do (Agents at work shows it waiting); stop ends it. A subagent sees the view and the user's instructions, but knows what you want only from its task. Each task names its own model and effort, if any.", { tasks: { type: "array", items: TASK } }, ["tasks"]),
  spec("tell", "Send a message to a subagent, by name. One at work gets it once its current reply is done (it waits, queued, as the user's messages do for you), and its report answers it; an idle one goes on from its chat, and its reply reaches you as a message \"[Name] reply\". To change what one at work is doing now, stop it, then tell it.", { name: STR, message: STR }, ["name", "message"]),
  spec("schedule", "Schedule a message to yourself: at its time it reaches you as a message \"[Timer id]\" from the timer, not the user, starting a turn as a report does, whether or not the user is online. Give `at` to send it once, or `cron` to send it again and again, and the time zone both are read in (the user's). Write the message as the task to do then, whole: by then this turn is far back in the view.", {
    message : STR,
    at      : { type: "string", description: "Once: YYYY-MM-DD HH:MM, in zone." },
    cron    : { type: "string", description: "Again and again: minute hour day month weekday, as cron, in zone (\"0 8 * * mon-fri\": weekdays at 08:00); its times at least 5 minutes apart." },
    zone    : { type: "string", description: "An IANA time zone, such as Europe/Amsterdam or UTC." },
  }, ["message", "zone"]),
  spec("schedules", "List the chat's schedules: id, when each comes next, its message.", {}, []),
  spec("unschedule", "Cancel a schedule, by its id.", { id: STR }, ["id"]),
  spec("stop", "Stop a subagent at once, by name, whatever it is doing (mid-call, waiting on a usage limit, running a tool on a device: that job is cancelled). Others keep running. Its report says it was stopped; its chat and scratch folder stay, so a later tell resumes it.", { name: STR, why: { type: "string", description: "Why, for its report." } }, ["name"]),
  spec("resume", "Wake every call on this server waiting for an AI service's usage limit (your turn, subagents, summaries), when the user says a limit was reset early. Each asks again once; one still limited waits again.", {}, []),
  // the pending list (Tasks.ts)
  spec("task_add", "Add a task to the chat's pending list, which the user sees beside the chat and resolves there, whenever they can (done, with one of its choices and a comment, or dropped). Add one for each thing you need of the user (an approval, a product decision, a step only they can do, such as restarting a server) instead of leaving the question at the end of a reply, where it gets lost; and, with assignee \"unii\", for what you must follow up yourself. Each turn's message lists the open tasks and what the user changed since your last turn: check it first and never add one already open. When one can only be resolved after another (a token before a test, a merge before a deploy), give it after: the user then sees only what they can do now, sorted by priority, then the tasks that free others, then the one theirs to act on longest. Give each its origin (where it truly came from) and its kind (pr, decision, test, action, restart, info), which says when it is late; a PR's approval (kind pr) goes with its prs as verified (link, head, verdict, notes by severity, what wasn't tested), and an option that's an order to you (\"Sim, reinicie\") with acts. Several questions or decisions on one subject go in one task as fields (each answered apart, kept as a draft, all sent when the user concludes, in your next turn's block). The user may also talk with you in a task's thread without resolving it: their message reaches you marked \"[Pendência P7: …]\"; reply with task_reply. What the user resolves reaches you on its own, within a minute, in a \"[Pendências]\" message (several at once if they came together). On a task of yours (assignee \"unii\") the user can only ask after it (\"Cobrar agora\", a message in its thread) or tell you to close it (\"Pode fechar\", done by them): keep its agent set. No task is closed without a documented solution: give done_when (what concretely makes it done); for one of yours, next_step (and next_due, else it's due 4 h after it last moved, and overdue past it). With choices, acts must name every one: a choice of yours is an order, which stays open as yours (an order received) until you close it with evidence of the execution. Whenever you tell the user you will do something later (\"vou revisar\", \"em seguida eu…\"), add it here as a task of yours in the same turn, or don't promise it. Title: short, the action or question, in the user's language.", {
    title   : STR,
    detail  : { type: "string", description: "Markdown: the context needed to decide, with links." },
    assignee   : { type: "string", enum: ["user", "unii"], description: "Who is responsible, who must act; by default the user. (who: its older name, still read.)" },
    origin     : ORIGIN_SPEC,
    origin_url : ORIGIN_URL_SPEC,
    agent      : AGENT_SPEC,
    choices : { type: "array", items: CHOICE, description: "Answers the user picks with one click, at most 9: each a short label (\"sim\", \"hom\") and a description of what picking it means or brings about, so the user decides without asking." },
    recommend : RECOMMEND_SPEC,
    acts    : ACTS_SPEC,
    kind    : { type: "string", enum: ["pr", "decision", "test", "action", "restart", "info"], description: KIND_SPEC },
    prs     : PRS_SPEC,
    waits_for : WAITS_FOR_SPEC,
    priority : { type: "string", enum: ["high", "normal", "low"], description: "Sorts \"Agora\": the higher first, then the one that frees more tasks, then the one the user could act on longest (since it became actionable, or since it was created). Normal by default; high only for what truly comes first." },
    ref     : REF_SPEC,
    ref_new : REF_NEW_SPEC,
    after   : { type: "array", items: STR, description: "Ids of the tasks this one waits for (\"P3\"), the user's or yours: while any is open it's hidden from the user and can't be resolved; once all are closed it shows, and your next turn is told it was freed." },
    fields  : FIELDS_SPEC,
    done_when : DONE_WHEN_SPEC,
    next_step : NEXT_STEP_SPEC,
    next_due  : NEXT_DUE_SPEC,
    status    : STATUS_SPEC,
    status_why: { type: "string", description: "With status waiting_user or blocked: what it waits for, or why it's blocked." },
    unblock   : { type: "string", description: "With status blocked: what unblocks it." },
  }, ["title", "origin", "done_when"]),
  spec("task_edit", "Change a task of the pending list, by its id (P7): its texts, choices, ref or the tasks it waits for (after), or its state: close (done, dropped) one that you resolved or that no longer applies, always with evidence (checked: a Slack message sent, a PR merged, a commit and its tests, a TFC run, a file; a reason only to drop), or open one again. An order received (the user picked a choice of yours) closes only done, with evidence of the execution: you can't drop it. Keep next_step and next_due current, and set status waiting_user or blocked (with why and what unblocks it) instead of letting it stand still. Done is refused while it waits for open tasks (drop it, or change its after). A closed task keeps its kind, choices and acts (what the user picked from): open it again to change them. A change by the user you haven't been told of yet stays to tell, even if you change the state meanwhile.", {
    id      : STR,
    title   : STR,
    detail  : STR,
    assignee   : { type: "string", enum: ["user", "unii"], description: "Who is responsible. (who: its older name, still read.)" },
    origin     : { type: "string", description: "Where it came from: chat, timer, agent:<name>, slack or github." },
    origin_url : { ...ORIGIN_URL_SPEC, description: "A link to its source; \"\" for none." },
    agent      : AGENT_SPEC,
    choices : { type: "array", items: CHOICE },
    recommend : { ...RECOMMEND_SPEC, description: RECOMMEND_SPEC.description + " \"\" for none." },
    acts    : { ...ACTS_SPEC, description: ACTS_SPEC.description + " Replaces them; changing the choices keeps those of the choices kept." },
    kind    : { type: "string", enum: ["pr", "decision", "test", "action", "restart", "info", ""], description: "As task_add's; \"\" for none. Making it pr needs prs." },
    prs     : { ...PRS_SPEC, description: "Its pull requests as verified, replacing the list (as task_add's): after a new verification, give the new head, verdict and notes." },
    waits_for : WAITS_FOR_SPEC,
    priority : { type: "string", enum: ["high", "normal", "low"] },
    ref     : REF_SPEC,
    ref_new : REF_NEW_SPEC,
    state   : { type: "string", enum: ["open", "done", "dropped"] },
    answer  : STR,
    note    : { type: "string", description: "How it was resolved." },
    after   : { type: "array", items: STR, description: "The ids it waits for, replacing the list; [] for none. No task that waits for this one (a cycle)." },
    fields  : { ...FIELDS_SPEC, description: "Its fields, replacing the list (add or remove questions); [] for none. The user's draft answers to fields kept (same id) stay." },
    evidence  : EVIDENCE_SPEC,
    done_when : { ...DONE_WHEN_SPEC, description: "What concretely makes it done." },
    next_step : { ...NEXT_STEP_SPEC, description: "Your next step on it (a new one: its due resets unless next_due is given)." },
    next_due  : NEXT_DUE_SPEC,
    status    : STATUS_SPEC,
    status_why: { type: "string", description: "With status waiting_user or blocked." },
    unblock   : { type: "string", description: "With status blocked." },
  }, ["id"]),
  spec("task_reply", "Reply in a task's thread, where the user talks with you about it without resolving it (their messages reach you marked \"[Pendência P7: …]\"). It's then the user's turn there. Use it for every reply to such a message; a turn that ends without one puts its last reply there. You may also write first, to ask about a task. Reply in the user's language; Markdown.", { id: STR, text: STR }, ["id", "text"]),
  spec("restart", "Restart the serve (this server), the user's standing leave (P8): only with no subagent at work, said in the chat before and after; never restart it by a shell command. Your turn ends with it: give resume, the task to go on with, which comes back to you as a \"[Restart]\" message that starts your turn once the serve is back. With agents at work it's refused: wait for their reports, or add a task of kind restart for the user (its template offers \"Sim, reinicie\", an order to you) and, once they pick it, call restart with that task's id.", { why: { type: "string", description: "What it's for, in the user's language (said in the chat)." }, resume: { type: "string", description: "What to do once it's back, whole: by then this turn is far back in the view." }, task: { type: "string", description: "The id of a task of kind restart the user resolved with an option of yours, to restart while agents are at work (each task lets one; one you closed yourself with task_edit lets none)." } }, ["why", "resume"]),
  spec("tasks", "List the pending list: the open tasks with their details; all: those closed in the last 7 days too; ref: only those whose ref contains it; id: that one whole; unproven: the closed ones without evidence (sem evidência), to prove (task_edit evidence) or open again.", { all: { type: "boolean" }, ref: STR, id: STR, unproven: { type: "boolean" } }, []),
];
const DEVICE = { device: { type: "string", description: "The name of the device to run on, one listed under Devices." } };
function kit(who: string): Spec[] {
  return TOOLS.map((t) => {
    const schema = t.schema as { properties: object; required: string[] };
    const info = t.info + " It runs on the device named; a relative path is in <scratch>/" + who + ", your scratch folder there, <scratch> being the scratch dir Devices lists for it.";
    return spec(t.name, info, { ...DEVICE, ...schema.properties }, ["device", ...schema.required]);
  });
}
const SKILL: Spec = spec("skill", "Load a skill listed under Skills: its SKILL.md, with the folder its other files are in on that device (read or run them there with your other tools).", { ...DEVICE, name: STR }, ["device", "name"]);
const INSTRUCTIONS: Spec = spec("instructions", "Load the instructions Claude Code would apply to work on a path on that device (a repository's folder, or a file): its CLAUDE.md files (or AGENTS.md), its rules, its auto memory, the rules for files like it. Call it before you work in a repository by shell; read, write and edit bring them by themselves. They hold from then on, under Instructions.", { ...DEVICE, path: STR }, ["device", "path"]);
const SKILLS_SEARCH: Spec = spec("skills_search", "Search the skills on the open devices by words (what you need done): the best fits, each with its device and what it is for.", { query: STR }, ["query"]);

export namespace Tools {

  export function serve(mem: Memory, main: Run<Pending, Msg>, log: Log): Tools {
    const key = crypto.randomUUID();
    const url = Tools.base() + key + "/";
    const run = (device: string, job: Job, signal: AbortSignal) => Tools.job(tools, device, job, signal, crypto.randomUUID());
    const mcp = Mcp.servers((text) => log.note(text), run, (device) => Tools.live(tools.devices.get(device)));
    const tools: Tools = { mem, devices: new Map(), agents: new Map(), labels: Tools.labels(mem), mcp, next: null, left: false, key, url, main, log };
    CHATS.set(key, tools);
    return tools;
  }

  export function base(): string {
    HTTP ??= Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: Tools.fetch });
    return "http://127.0.0.1:" + HTTP.port + "/";
  }

  export function at(tools: Tools, who: string): string {
    return tools.url + who;
  }

  export function prompt(which: keyof typeof PROMPTS): string {
    return Memory.file_text(PROMPTS[which].file) || PROMPTS[which].def;
  }

  export function devices(tools: Tools): Block {
    const work  = (d: Device) => [...d.terms.values()][0]?.work;
    const temp  = (d: Device) => [...d.terms.values()][0]?.scratch ?? work(d);
    const shell = (d: Device) => [...d.terms.values()][0]?.shell;
    const line  = ([name, d]: [string, Device]) => "- " + name + ", work dir " + work(d) + " (the user's projects), scratch dir " + temp(d) + (shell(d) ? ", shell " + shell(d) + " (stopping the device does not kill a process a call left running after its shell ended)" : "");
    const lines = Tools.opened(tools).map(line);
    return { text: "Devices open now:\n" + (lines.length === 0 ? DEVICES_NONE : lines.join("\n")) + "\n" + MEDIA_AT.replace("{dir}", tools.mem.dir + "/docs/media/") + "\n\n", mark: false };
  }

  // the skills block: each skill, by device (in their names' order), with
  // what it is for. A call puts it after the memory's view: skills come
  // and go (a plugin writes them by itself, several a day), and a change
  // before the view would cost the cache the whole prompt
  export function skills(tools: Tools): Block {
    const opened = Tools.opened(tools).sort(([a], [b]) => a.localeCompare(b));
    const lines = opened.flatMap(([name, d]) => d.skills.map((s) => "- " + name + ": " + s.name + ": " + s.description.replace(/\s+/g, " ")));
    return { text: lines.length === 0 ? "" : SKILLS + "\n" + lines.join("\n") + "\n\n", mark: false };
  }

  // the instructions block: each open device's (in their names' order),
  // as Claude Code would load them there (Instructions.ts): its
  // organization's, its user's, then those of the repositories and files
  // worked on so far. A call puts it first, before the memory's view,
  // where it stays the same from turn to turn while they do, so the
  // vendor's cache keeps it. hooks: only its SessionStart hooks' output
  // instead, which changes as the device's Claude Code does (a plugin
  // that lists its skills): a call puts it after the view, with the
  // skills, so a change there costs the cache only what follows the view
  export function instructions(tools: Tools, hooks = false): Block {
    const opened = Tools.opened(tools).sort(([a], [b]) => a.localeCompare(b));
    const one = ([name, d]: [string, Device]) => {
      const all = [...d.rules, ...d.proj.filter((p) => !d.rules.some((r) => r.id === p.id))];
      const parts = all.filter((p) => p.id.startsWith("hook:") === hooks);
      const head = hooks ? "# Session start on device " + name + "\n\nWhat Claude Code's SessionStart hooks there gave as context, part of its instructions above.\n\n" : "# Instructions on device " + name + "\n\nWhat Claude Code would load there, in its order: the organization's and the user's standing instructions, then those of the repositories and files worked on so far. Follow them in all work on that device, as the user's own.\n\n";
      return parts.length === 0 ? "" : head + Instructions.parts_text(parts);
    };
    const text = opened.map(one).filter((t) => t !== "").join("\n\n");
    return { text: text === "" ? "" : text + "\n\n", mark: false };
  }

  // the instructions for work on paths of a device (relative: to the
  // agent's dir), asked of it; the paths kept, so they hold in the next
  // turns' block. fresh: only the parts not shown yet (the block's, or
  // earlier ones this turn), then marked shown; else all. Null: no device
  export async function project(tools: Tools, device: string, paths: string[], who: string, signal: AbortSignal, fresh: boolean): Promise<{ text: string } | null> {
    const d = tools.devices.get(device);
    if (d === undefined || typeof Tools.open(tools, device) === "string") {
      return null;
    }
    const out = await Tools.job(tools, device, { name: "project_instructions", input: { paths }, cwd: who }, signal, crypto.randomUUID());
    let got: { parts: Instructions.Part[]; at: string[] } = { parts: [], at: [] };
    try {
      got = out.fail ? got : JSON.parse(out.text);
    } catch {}
    d.paths = [...new Set([...d.paths, ...(got.at ?? [])])];
    const parts = (got.parts ?? []).filter((p) => !fresh || !d.shown.has(p.id));
    parts.forEach((p) => d.shown.add(p.id));
    const head = fresh ? "Instructions that now hold for " + paths.join(", ") + " (as Claude Code loads them on demand; follow them):\n\n" : "";
    return { text: parts.length === 0 ? "" : head + Instructions.parts_text(parts) };
  }

  // the skills that fit a text best, at most n, each a line: its device,
  // its name, what it is for
  export function skills_fit(tools: Tools, text: string, n: number): string[] {
    const all = Tools.opened(tools).flatMap(([name, d]) => d.skills.map((s) => ({ name, s })));
    return Rank.rank(all.map(({ s }) => s.name + " " + s.description), text, n).map((k) => "- " + all[k].name + ": " + all[k].s.name + ": " + all[k].s.description.replace(/\s+/g, " "));
  }

  // each open device's skills and its Claude Code's MCP servers (each
  // then one of the chat's, Tools.claude), asked as jobs; one that fails
  // (a unii from before them) has none. A change is the chat's (its state
  // lists them: the terminal completes the skills' names, /mcp the servers)
  export async function look(tools: Tools, only: string | null = null): Promise<void> {
    const live = Tools.opened(tools).filter(([name, d]) => (only === null || name === only) && [...d.terms.values()].some((t) => t.live()));
    await Promise.all(live.map(async ([name, d]) => {
      const was = JSON.stringify([d.skills, d.mcps]);
      [d.skills, d.mcps, d.rules] = await Promise.all([Tools.ask_list(tools, name, "skills", d.skills), Tools.ask_list(tools, name, "claude_mcps", d.mcps), Tools.ask_list(tools, name, "instructions", d.rules)]);
      const proj = d.paths.length === 0 ? null : await Tools.ask_one(tools, name, "project_instructions", { paths: d.paths });
      d.proj = proj?.parts ?? d.proj;
      d.shown = new Set([...d.rules, ...d.proj].map((p) => p.id));
      if (JSON.stringify([d.skills, d.mcps]) !== was) {
        // its Claude Code's servers join the chat's as its config's do
        Tools.plug(tools);
        tools.log.change();
      }
    }));
  }

  // what a device's job answers, as JSON (null: late, failed or not JSON)
  export async function ask_one(tools: Tools, device: string, job: string, input: Record<string, unknown>): Promise<any> {
    const run = Tools.start_job(tools, device, { name: job, input, cwd: "main" }, crypto.randomUUID());
    if (typeof run === "string") {
      return null;
    }
    const timer = setTimeout(() => run.end({ text: "Late.", fail: true }), LOOK);
    const out = await run.out;
    clearTimeout(timer);
    try {
      return out.fail ? null : JSON.parse(out.text);
    } catch {
      return null;
    }
  }

  // a list a device's job answers; late, what it was; failed, none
  export async function ask_list<T>(tools: Tools, device: string, job: string, was: T[]): Promise<T[]> {
    const run = Tools.start_job(tools, device, { name: job, input: {}, cwd: "main" }, crypto.randomUUID());
    if (typeof run === "string") {
      return was;
    }
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      run.end({ text: "Late.", fail: true });
    }, LOOK);
    const out = await run.out;
    clearTimeout(timer);
    if (late) {
      return was;
    }
    try {
      const got = out.fail ? [] : JSON.parse(out.text);
      return Array.isArray(got) ? got : [];
    } catch {
      return [];
    }
  }

  // a device's Claude Code MCP server as one of the chat's: named
  // "<device>-<name>" in the letters a server's name takes (Config.ts), run
  // on that device, its program read there (Mcp.here)
  export function claude_conf(device: string, name: string): config.McpServer {
    const safe = name.replace(/[^A-Za-z0-9-]/g, "-");
    return { name: config.config_mcp_prefix(device) + "_" + safe, device, command: "", args: [], env: {}, cwd: "", url: "", headers: {}, timeout: 600, claude: name };
  }

  // a device's servers: its config.json's, then its Claude Code's (one
  // whose name a config one took left out)
  export function device_mcp(name: string, d: Device): config.McpServer[] {
    const own = new Set(d.mcp.map((m) => m.name));
    return [...d.mcp, ...d.mcps.map((m) => Tools.claude_conf(name, m)).filter((m) => !own.has(m.name))];
  }

  // the chat's MCP servers as they are, or will be from the next turn
  // (Tools.plug): each one /mcp may turn on or off
  export function known(tools: Tools): config.McpServer[] {
    const next = tools.next ?? [...tools.mcp.all.values()].map((s) => s.conf);
    return next;
  }

  // the MCP servers of the open devices' Claude Code, by the chat's name
  // (one a config server's name took is left out)
  export function claude(tools: Tools): string[] {
    return Tools.opened(tools).flatMap(([device, d]) => Tools.device_mcp(device, d).filter((m) => m.claude !== undefined).map((m) => m.name));
  }

  export function at_work(tools: Tools): Block {
    const when = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ") + " UTC";
    const names = Tools.working(tools).map(({ name, run }) => (run.limit === null ? Tools.named(tools, name) : Tools.named(tools, name) + " (waiting for the usage limit on " + run.limit.vendor + ", " + (run.limit.known ? "resumes " : "tries again ") + when(run.limit.until) + ")"));
    return { text: "Agents at work now: " + (names.length === 0 ? "none." : names.join(", ") + ".") + "\n\n", mark: false };
  }

  export async function fetch(req: Request): Promise<Response> {
    const [, key, who, ...rest] = new URL(req.url).pathname.split("/");
    const tools = CHATS.get(key);
    const caller = who === "main" || tools?.agents.has(who);
    const msg: unknown = await req.json().catch(() => ({}));
    const [asked, method, params] = [get(msg, "id"), get(msg, "method"), get(msg, "params")];
    const id = crypto.randomUUID();
    const session = req.headers.get(SESSION) ?? "";
    const scope = [key, who, session].join("/") + "/";
    if (asked === undefined && method === "notifications/cancelled" && get(params, "requestId") !== undefined) {
      RUNNING.get(scope + JSON.stringify(get(params, "requestId")))?.forEach((c) => c.abort());
    }
    const cancel = new AbortController();
    const signal = AbortSignal.any([req.signal, cancel.signal]);
    const name = scope + JSON.stringify(asked);
    if (asked !== undefined) {
      RUNNING.set(name, (RUNNING.get(name) ?? new Set()).add(cancel));
    }
    try {
      if (tools === undefined || rest.length > 0 || !caller) {
        return new Response(null, { status: 404 });
      }
      if (req.method !== "POST") {
        return new Response(null, { status: 405 });
      }
      if (asked === undefined) {
        return new Response(null, { status: 202 });
      }
      const no = { error: { code: -32601, message: "no method " + String(method) } };
      const out = await Tools.answer(tools, who, String(method), rec(params) ? params : {}, signal, id).then(
        (result) => (result === null ? no : { result }),
        (err: unknown) => ({ error: { code: -32603, message: err_why(err) } }),
      );
      return Response.json({ jsonrpc: "2.0", id: asked, ...out });
    } finally {
      const set = RUNNING.get(name);
      if (set?.delete(cancel) && set.size === 0) {
        RUNNING.delete(name);
      }
    }
  }

  export async function answer(tools: Tools, who: string, method: string, params: Record<string, unknown>, signal: AbortSignal, id: string): Promise<object | null> {
    switch (method) {
      case "initialize": {
        const protocolVersion = params.protocolVersion ?? "2025-06-18";
        return { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "unii", version: "1" } };
      }
      case "tools/list": {
        const plugged = Tools.plugged(tools, who);
        const theirs = plugged ? await Mcp.list(tools.mcp, Tools.off(tools)) : [];
        const notes = plugged ? Mcp.heard(tools.mcp, Tools.off(tools), who) : [];
        const agent = tools.agents.get(who);
        notes.forEach((text) => agent !== undefined && tools.log.push(agent.run, "note", text));
        return { tools: [...Tools.list(who), ...theirs].map((t) => ({ name: t.name, description: t.info, inputSchema: t.schema })), notes };
      }
      case "tools/call": {
        const name = String(params.name);
        const args = rec(params.arguments) ? params.arguments : {};
        const has = Tools.list(who).some((t) => t.name === name);
        const mcp = has ? null : Tools.mcp(tools, who, name);
        const no: Out = { text: "No tool " + name + ".", fail: true };
        const out = has ? await Tools.call(tools, who, name, args, signal, id) : mcp !== null ? await Mcp.call(tools.mcp, mcp, name, args, signal) : no;
        const imgs = (out.imgs ?? []).map((img) => ({ type: "image", data: img.data, mimeType: img.type }));
        return { content: [{ type: "text", text: out.text }, ...imgs], isError: out.fail };
      }
      case "ping": {
        return {};
      }
    }
    return null;
  }

  export function list(who: string): Spec[] {
    return who === "main" ? [...OWN, ...BOSS, ...kit(who), SKILL, SKILLS_SEARCH, INSTRUCTIONS] : [...OWN, ...kit(who), SKILL, SKILLS_SEARCH, INSTRUCTIONS];
  }

  export function plugged(tools: Tools, who: string): boolean {
    return who === "main" || tools.agents.has(who);
  }

  // the MCP servers the chat turned off, and the devices' Claude Code ones
  // it didn't turn on
  export function off(tools: Tools): string[] {
    const claude = [...tools.mcp.all.values()].filter((s) => s.conf.claude !== undefined && !(tools.mem.on ?? []).includes(s.conf.name));
    return [...(tools.mem.off ?? []), ...claude.map((s) => s.conf.name)];
  }

  export function mcp(tools: Tools, who: string, name: string): Server | null {
    return Tools.plugged(tools, who) ? Mcp.find(tools.mcp, Tools.off(tools), name) : null;
  }

  export function unplug(tools: Tools, name: string): void {
    const s = tools.mcp.all.get(name);
    if (s !== undefined) {
      Mcp.close(s);
    }
  }

  export async function call(tools: Tools, who: string, name: string, args: Record<string, unknown>, signal: AbortSignal, id: string): Promise<Out> {
    const mem = tools.mem;
    switch (name) {
      case "zoom": {
        const id = String(args.id);
        const n = Number(args.n ?? 1);
        const at = Number(args.at ?? 0);
        if (/^[A-Za-z]/.test(id)) {
          return { text: clip_page(Memory.agent_show(mem, id), at), fail: false };
        }
        const imgs = n === 1 && at === 0 ? Memory.images(mem, Number(id)) : [];
        return { text: Memory.zoom(mem, Number(id), n, at), fail: false, imgs };
      }
      case "date": {
        return { text: Memory.date(mem, Number(args.id)), fail: false };
      }
      case "spawn": {
        const tasks = Tools.spawns(args);
        return typeof tasks === "string" ? { text: tasks, fail: true } : { text: await Tools.spawn(tools, tasks), fail: false };
      }
      case "tell": {
        return { text: await Tools.tell(tools, String(args.name), String(args.message)), fail: false };
      }
      case "schedule": {
        return Tools.schedule(tools, Timer.timer_new(args, Date.now()));
      }
      case "schedules": {
        const lines = mem.timers.map(Timer.timer_line);
        return { text: lines.length === 0 ? "No schedules." : lines.join("\n"), fail: false };
      }
      case "unschedule": {
        const id = String(args.id);
        return Tools.unschedule(tools, id) ? { text: "Cancelled " + id + ".", fail: false } : { text: "No schedule " + id + ".", fail: true };
      }
      case "stop": {
        return await Tools.halt(tools, String(args.name), args.why === undefined ? "" : text_of(args.why, "null"));
      }
      case "resume": {
        const n = Limit.resume();
        return { text: n === 0 ? "No call was waiting for a usage limit." : "Woke " + n + " call" + (n === 1 ? "" : "s") + " waiting for a usage limit; any still limited waits again.", fail: false };
      }
      case "skill": {
        return Tools.job(tools, String(args.device), { name, input: { name: String(args.name) }, cwd: "main" }, signal, id);
      }
      case "skills_search": {
        const found = Tools.skills_fit(tools, String(args.query), FOUND);
        return { text: found.length === 0 ? "No skill fits " + JSON.stringify(String(args.query)) + "; Skills lists every name." : found.join("\n"), fail: false };
      }
      case "restart": {
        return Tools.restart(tools, args, Restart.how(process.env));
      }
      case "task_edit": {
        // the evidence of a close read live where it can be (a PR merged,
        // a commit), never taken as given (Evidence.evidence_verify)
        if (args?.evidence !== undefined && args?.evidence !== null) {
          const got = await Evidence.evidence_verify(args.evidence);
          if (typeof got === "string") {
            return { text: Tasks.task_id(args.id) + ": " + got + " Nothing was changed.", fail: true };
          }
          return Tools.task(tools, name, { ...args, evidence: got.v }, who);
        }
        return Tools.task(tools, name, args, who);
      }
      case "task_add":
      case "task_reply":
      case "tasks": {
        return Tools.task(tools, name, args, who);
      }
      case "instructions": {
        const got = await Tools.project(tools, String(args.device), [String(args.path)], who, signal, false);
        return { text: got === null ? "No device " + String(args.device) + " open." : got.text || "No instructions for " + String(args.path) + " beyond those under Instructions.", fail: got === null };
      }
      default: {
        const { device, ...input } = args;
        const out = await Tools.job(tools, String(device), { name, input, cwd: who }, signal, id);
        // a file read or changed brings the instructions that now hold
        // for it, as Claude Code loads them on demand
        const paths = name === "read" || name === "write" ? [input.path] : name === "edit" && Array.isArray(input.edits) ? input.edits.map((e: any) => e?.path) : [];
        const files = paths.filter((p: unknown) => typeof p === "string" && p !== "");
        const got = out.fail || files.length === 0 ? null : await Tools.project(tools, String(device), files, who, signal, true);
        return got === null || got.text === "" ? out : { ...out, text: out.text + "\n\n" + got.text };
      }
    }
  }

  export function schedule(tools: Tools, timer: Timer.Timer | string): Out {
    const mem = tools.mem;
    if (typeof timer !== "string" && mem.timers.length >= Timer.TIMERS) {
      timer = "The chat has " + Timer.TIMERS + " schedules, the most it keeps: cancel one first.";
    }
    if (typeof timer === "string") {
      return { text: timer, fail: true };
    }
    mem.timers = [...mem.timers, timer];
    Memory.save(mem);
    tools.log.timed();
    return { text: "Scheduled " + timer.id + ": " + Timer.timer_when(timer) + ".", fail: false };
  }

  export function unschedule(tools: Tools, id: string): boolean {
    const mem = tools.mem;
    const left = mem.timers.filter((t) => t.id !== id);
    if (left.length === mem.timers.length) {
      return false;
    }
    mem.timers = left;
    Memory.save(mem);
    tools.log.timed();
    return true;
  }

  // Tasks
  // -----

  // the pending list's tools (Tasks.ts); a change told to every view
  export function task(tools: Tools, name: string, args: any, who: string): Out {
    const s = Tasks.tasks_load(tools.mem.dir);
    const now = Date.now();
    if (name === "tasks") {
      return { text: Tasks.tasks_list(s, args, now), fail: false };
    }
    // the contract (R5): an origin given, a ref of the list's fronts
    const held = name === "task_reply" ? { args, added: null } : Tasks.tool_args(s, name, args, Tasks.origin_read(tools.origin));
    if (typeof held === "string") {
      return { text: held, fail: true };
    }
    const t = name === "task_add" ? Tasks.task_new(s, held.args, who, now, null) : name === "task_reply" ? Tasks.task_reply(s, args.id, args.text, now) : Tasks.task_edit(s, held.args, now);
    if (typeof t === "string") {
      return { text: t, fail: true };
    }
    if (held.added !== null) {
      Tasks.refs_add(s, held.added);
    }
    tools.log.change();
    if (name === "task_reply") {
      return { text: "Replied in " + t.id + "'s thread" + (t.state === "open" ? "; the user's turn there." : " (it's closed)."), fail: false };
    }
    return { text: (name === "task_add" ? "Added " : "Changed ") + Tasks.task_line(t, now, false, s.tasks).slice(2), fail: false };
  }

  // the restart tool (Restart.ts, P8): refused while agents are at work
  // (unless a task of kind restart lets it), else the mark kept, said in
  // the chat, and the process restarted by the server's hook
  export function restart(tools: Tools, args: any, how: Restart.How): Out {
    const why = Tasks.text_line(args.why, Restart.WHY);
    if (why === "") {
      return { text: "Give why: what the restart is for (it's said in the chat).", fail: true };
    }
    const dir = tools.mem.dir;
    const given = args.task === undefined || args.task === null || String(args.task).trim() === "" ? null : String(args.task);
    const task = given === null ? null : Tasks.task_find(Tasks.tasks_load(dir), given);
    const had = Restart.mark_read(dir);
    const used = had?.used ?? [];
    const working = Tools.working(tools).map((a) => a.label === null || a.label === "" ? a.name : a.name + " (" + a.label + ")");
    const no = Restart.check(how, working, task, given, used);
    if (no !== null) {
      return { text: no, fail: true };
    }
    if (tools.log.restart === undefined) {
      return { text: "This server can't restart itself.", fail: true };
    }
    const mark: Restart.Mark = { why, resume: Tasks.text_body(args.resume, Restart.RESUME), at: new Date().toISOString(), agents: working, task: task?.id ?? null, done: false, used: [...used, ...(task === null ? [] : [task.id])].slice(-Restart.USED), pid: process.pid };
    Restart.mark_write(dir, mark);
    tools.log.note(Restart.said_before(mark));
    tools.log.restart(how);
    return { text: "Restarting in " + Restart.DELAY / 1000 + " s: this turn ends there. Once the serve is back, the chat is told it restarted and you get a \"[Restart]\" message, with what you gave as resume, that starts your turn.", fail: false };
  }

  // Devices
  // -------

  export function device_name(tools: Tools, host: string, who: string, kept: Set<string>): { name: string; rejoined: boolean } {
    const own = [...tools.devices].find(([, d]) => d.who === who && d.host === host)?.[0];
    if (own !== undefined) {
      return { name: own, rejoined: true };
    }
    const held = (d: Device | undefined) => d !== undefined && (d.who === who || kept.has(d.who) || [...d.terms.values()].some((t) => t.live()));
    let name = host;
    for (let k = 2; held(tools.devices.get(name)); k++) {
      name = host + "-" + k;
    }
    return { name, rejoined: false };
  }

  export function attach(tools: Tools, term: string, host: string, who: string, link: Link, kept: Set<string>): string {
    const { name, rejoined } = Tools.device_name(tools, host, who, kept);
    if (!rejoined) {
      Tools.forget(tools, name);
    }
    const d: Device = tools.devices.get(name) ?? { who, host, terms: new Map(), jobs: new Map(), skills: [], mcps: [], rules: [], paths: [], proj: [], shown: new Set<string>(), mcp: [], why: "", clash: "" };
    d.terms.set(term, link);
    tools.devices.set(name, d);
    for (const old of [...d.terms.keys()]) {
      if (old !== term) {
        Tools.detach(tools, old, name, "restarted");
      }
    }
    Tools.sync(d, term, () => true);
    // told once looked at, even unchanged: its leave told the chat it had
    // none (Chat.leave), and a reconnect keeps what it had
    void Tools.look(tools, name).then(() => tools.log.change());
    Tools.plug(tools);
    return name;
  }

  export function sync(d: Device, term: string, fresh: (id: string) => boolean): void {
    const send = d.terms.get(term)?.send ?? (() => {});
    const mine = [...d.jobs].filter(([, j]) => j.term === term);
    send({ $: "jobs", ids: mine.map(([id]) => id) });
    mine.filter(([id]) => fresh(id)).forEach(([id, j]) => send({ $: "job", id, job: j.job }));
  }

  export function detach(tools: Tools, term: string, device: string, how = "stopped"): void {
    const d = tools.devices.get(device);
    if (d === undefined || !d.terms.delete(term)) {
      return;
    }
    for (const job of d.jobs.values()) {
      if (job.term === term) {
        job.end({ text: "The device " + device + " that ran this " + how + ".", fail: true });
      }
    }
    Tools.plug(tools);
  }

  export function detach_unless_back(tools: Tools, term: string, device: string, link: Link): void {
    if (tools.devices.get(device)?.terms.get(term) === link && !link.live()) {
      Tools.detach(tools, term, device);
    }
  }

  export function lost(tools: Tools, term: string, device: string): void {
    const link = tools.devices.get(device)?.terms.get(term);
    if (link === undefined || link.live()) {
      return;
    }
    setTimeout(() => Tools.detach_unless_back(tools, term, device, link), GRACE).unref?.();
    Tools.plug(tools);
  }

  export function forget(tools: Tools, device: string): void {
    const d = tools.devices.get(device);
    if (d === undefined) {
      return;
    }
    tools.devices.delete(device);
    d.terms.clear();
    for (const job of [...d.jobs.values()]) {
      job.end({ text: "The device " + device + " that ran this was signed out.", fail: true });
    }
    Tools.plug(tools);
  }

  export function servers(tools: Tools, device: string, mcp: unknown): void {
    const d = tools.devices.get(device);
    if (d === undefined) {
      return;
    }
    const notes: string[] = [];
    try {
      d.mcp = config.config_mcp(mcp, device, notes);
    } catch (err) {
      d.mcp = [];
      notes.push(err_why(err).replace(/^config: /, ""));
    }
    const why = notes.join("; ");
    if (why !== d.why) {
      d.why = why;
      if (why !== "") {
        console.error("unii: device " + device + ": " + why);
        tools.log.note("The device " + device + "'s MCP servers: " + why + ".");
      }
    }
    Tools.plug(tools);
  }

  export function same_prefix_note(name: string, prefix: string, other: string): string {
    return "The device " + name + "'s MCP servers are left out: their tools would be named " + prefix + "_…, as the device " + other + "'s are. Rename one of the two (name in its ~/.config/unii/device.json).";
  }

  export function plug(tools: Tools): void {
    const prefix_owner = new Map<string, string>();
    const next: config.McpServer[] = [];
    for (const [name, d] of tools.devices) {
      const prefix = config.config_mcp_prefix(name);
      const mine = Tools.device_mcp(name, d);
      const other = mine.length === 0 ? undefined : prefix_owner.get(prefix);
      const clash = other === undefined ? "" : Tools.same_prefix_note(name, prefix, other);
      if (clash !== d.clash) {
        d.clash = clash;
        if (clash !== "") {
          console.error("unii: " + clash);
          tools.log.note(clash);
        }
      }
      if (mine.length > 0 && other === undefined) {
        prefix_owner.set(prefix, name);
        if (Tools.live(d)) {
          next.push(...mine);
        }
      }
    }
    tools.next = next;
    tools.log.change();
  }

  export function left(tools: Tools): void {
    if (!tools.left && config.MCP_ENV_NOTE !== null) {
      tools.left = true;
      tools.log.note(config.MCP_ENV_NOTE);
    }
  }

  export function live(d: Device | undefined): boolean {
    return d !== undefined && [...d.terms.values()].some((t) => t.live());
  }

  export function apply(tools: Tools): void {
    if (tools.next !== null) {
      Mcp.sync(tools.mcp, tools.next);
      tools.next = null;
    }
  }

  export function prune(tools: Tools, kept: Set<string>): void {
    for (const [name, d] of [...tools.devices]) {
      if (!kept.has(d.who)) {
        Tools.forget(tools, name);
      }
    }
  }

  export function opened(tools: Tools): [string, Device][] {
    return [...tools.devices].filter(([, d]) => d.terms.size > 0);
  }

  export function open(tools: Tools, device: string): Device | string {
    const d = tools.devices.get(device);
    const open = Tools.opened(tools).map(([name]) => name).join(", ") || "none";
    if (d === undefined || d.terms.size === 0) {
      return "No device " + device + " is open (its unii device isn't running). Open: " + open + ". Only the user starts it, so don't retry or wait: end your turn, saying what is left.";
    }
    return d;
  }

  export function job(tools: Tools, device: string, job: Job, signal: AbortSignal, id: string): Promise<Out> {
    const run = tools.devices.get(device)?.jobs.get(id) ?? Tools.start_job(tools, device, job, id);
    if (typeof run === "string") {
      return Promise.resolve({ text: run, fail: true });
    }
    const stop = () => run.end({ text: "Stopped.", fail: true });
    signal.aborted ? stop() : signal.addEventListener("abort", stop, { once: true });
    const most = Tools.job_limit(run.job);
    if (most !== null) {
      const late = "(timed out after " + Math.round(most / 1000) + " s: the device didn't answer in time, and was told to kill the job. The output so far is lost.)";
      const timer = setTimeout(() => run.end({ text: late, fail: true }), most);
      run.out.finally(() => clearTimeout(timer));
    }
    return run.out;
  }

  // how long the server waits on a job (ms) before ending it, which tells
  // its device to kill it (null: no limit here; an MCP call has its own).
  // The device ends a shell or view_video job itself at its limit
  // (Machine.ts); this is a backstop past it, for a device whose unii
  // keeps none (older), or that hangs; read, write, edit and skill are
  // quick, but a hung file system could keep them
  export function job_limit(job: Job): number | null {
    switch (job.name) {
      case "shell":      return Math.min(Number(job.input?.timeout) || 3600, 3600) * 1000 + SPARE;
      case "view_video": return VIDEO_LIMIT + SPARE;
      case "read":
      case "write":
      case "edit":
      case "skill":      return QUICK;
      default:           return null;
    }
  }

  export function start_job(tools: Tools, device: string, job: Job, id: string): Running | string {
    const d = Tools.open(tools, device);
    if (typeof d === "string") {
      return d;
    }
    const terms = [...d.terms];
    const [term] = terms.filter(([, t]) => t.live()).at(-1) ?? terms[terms.length - 1];
    const run = Tools.track(d, id, term, job);
    Tools.sync(d, term, (x) => x === id);
    return run;
  }

  export function track(d: Device, id: string, term: string, job: Job): Running {
    const { promise, resolve } = Promise.withResolvers<Out>();
    const end = (out: Out) => {
      if (d.jobs.delete(id)) {
        Tools.sync(d, term, () => false);
        resolve(out);
      }
    };
    const run = { term, job, out: promise, end };
    d.jobs.set(id, run);
    return run;
  }

  export function out(x: unknown): Out {
    const imgs = items(get(x, "imgs")).flatMap((img) => {
      const [type, data] = [get(img, "type"), get(img, "data")];
      return typeof type === "string" && typeof data === "string" ? [{ type, data }] : [];
    });
    return { text: text_of(get(x, "text")), fail: get(x, "fail") === true, ...(get(x, "imgs") === undefined ? {} : { imgs }) };
  }

  export function done(tools: Tools, device: string, id: string, out: Out): void {
    tools.devices.get(device)?.jobs.get(id)?.end(out);
  }

  export function spawns(args: Record<string, unknown>): Spawn[] | string {
    if (args.model !== undefined || args.effort !== undefined) {
      return "Give model and effort per task, in each of tasks: { task, model?, effort? }. Nothing started.";
    }
    const out: Spawn[] = [];
    for (const [k, t] of items(args.tasks).entries()) {
      const x: Record<string, unknown> = typeof t === "string" ? { task: t } : rec(t) ? t : {};
      const task = typeof x.task === "string" ? x.task : "";
      const model = x.model === undefined ? null : text_of(x.model, "null");
      const effort = x.effort === undefined ? null : text_of(x.effort, "null");
      const bad = task === "" ? "no task text" : model !== null && !MODELS.includes(model) ? "no model " + model + "; one of " + MODELS.join(", ") : effort !== null && !EFFORTS.includes(effort) ? "no effort " + effort + "; one of " + EFFORTS.join(", ") : null;
      if (bad !== null) {
        return "Task " + (k + 1) + (task === "" ? "" : " (" + JSON.stringify(task.length > 60 ? task.slice(0, 60) + "…" : task) + ")") + ": " + bad + ". Nothing started.";
      }
      // its label, or the call's labels' k-th (as spawn took them before)
      const label = typeof x.label === "string" ? x.label : Array.isArray(args.labels) && typeof args.labels[k] === "string" ? args.labels[k] : "";
      out.push({ task, role: { model, effort }, label });
    }
    return out;
  }

  export async function spawn(tools: Tools, tasks: Spawn[]): Promise<string> {
    const view = tasks.length === 0 ? "No tasks." : await Tools.view(tools);
    if (typeof view === "string") {
      return view;
    }
    const names = tasks.map(({ task, role, label }) => {
      const knobs = [role.model, role.effort === null ? null : "effort " + role.effort].filter((k) => k !== null);
      return Tools.named(tools, Tools.start(tools, role, task, view, label)) + (knobs.length === 0 ? "" : " (" + knobs.join(", ") + ")");
    });
    return "Started " + names.join(", ") + ". Each one's report will reach you as a message when it finishes.";
  }

  export function restarted(work: string[]): string {
    return "The server restarted, cutting " + work.join(", ") + "; nothing was lost: go on.";
  }

  export async function tell(tools: Tools, name: string, message: string, before: string[] = []): Promise<string> {
    const agent = Tools.agent(tools, name);
    if (agent === null) {
      if (name in tools.mem.tells) {
        delete tools.mem.tells[name];
        Memory.save_queue(tools.mem);
      }
      return "No agent " + name + " to tell.";
    }
    const run = agent.run;
    if (run.busy && run.halt.signal.aborted) {
      await run.going.catch(() => {});
    }
    const idle = !run.busy;
    if (idle) {
      const view = await Tools.view(tools);
      if (typeof view === "string") {
        return view;
      }
      if (!run.busy) {
        Object.assign(agent, { view, replies: [], why: null });
      }
    }
    void Run.takes(run, [...before, message].map((text) => ({ text, imgs: [] })));
    return idle ? "Sent. " + name + "'s reply will reach you as a message." : "Sent. " + name + " gets it once its current reply is done, and its report answers it.";
  }

  export function start(tools: Tools, role: Agent["role"], task: string, view: Block[], label = ""): string {
    const name = Memory.agent_new(tools.mem);
    const shown = Tools.label_clean(label);
    const agent = Tools.made(tools, name, role, view, shown);
    tools.agents.set(name, agent);
    if (shown !== null) {
      tools.labels.set(name, shown);
    }
    tools.log.push(agent.run, "note", SUB_NOTE + (role.model === null ? "" : SUB_ON + role.model) + (role.effort === null ? "" : SUB_AT + role.effort) + (shown === null ? "" : SUB_AS + shown));
    void Run.take(agent.run, { text: task, imgs: [] });
    tools.log.agents?.();
    return name;
  }

  export function made(tools: Tools, name: string, role: Agent["role"], view: Block[], label: string | null = null): Agent {
    const agent: Agent = { name, label, role, why: null, view, replies: [], run: Run.make<Say, Say>(name, Tools.kind(tools, () => agent)) };
    return agent;
  }

  export function agent(tools: Tools, name: string): Agent | null {
    const found = tools.agents.get(name) ?? Tools.logged(tools, name);
    if (found !== null) {
      tools.agents.set(name, found);
    }
    return found;
  }

  export function logged(tools: Tools, name: string): Agent | null {
    const log = Memory.agent(tools.mem, name);
    const note = log !== null && log.length > 0 && log[0].kind === "note" ? log[0].text : "";
    const sub = SUB_ROLE.exec(note);
    return sub === null ? null : Tools.made(tools, name, { effort: sub[2] ?? null, model: sub[1] ?? null }, [], Tools.label_clean(sub[3] ?? ""));
  }

  // a label as given, on one line, at most LABEL graphemes (LABEL_POINTS
  // code points); null: none. The spawn's and a note's alike (a note may
  // be edited by hand)
  export function label_clean(label: string): string | null {
    const one = label.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
    let cut = "";
    let n = 0;
    let points = 0;
    for (const { segment } of GRAPHEMES.segment(one)) {
      const size = Array.from(segment).length;
      if (n === LABEL || points + size > LABEL_POINTS) {
        break;
      }
      cut += segment;
      n += 1;
      points += size;
    }
    cut = cut.trim();
    return cut === "" ? null : cut;
  }

  // every agent's label, by name, from its log's note (Memory.agent_heads)
  export function labels(mem: Memory): Map<string, string> {
    const out = new Map<string, string>();
    for (const [name, note] of Memory.agent_heads(mem)) {
      const label = Tools.label_clean(SUB_ROLE.exec(note)?.[3] ?? "");
      if (label !== null) {
        out.set(name, label);
      }
    }
    return out;
  }

  // an agent as Unii reads it: its name, its label after it if it has one
  export function named(tools: Tools, name: string): string {
    const label = tools.labels.get(name);
    return label === undefined ? name : name + " (" + label + ")";
  }

  export function kind(tools: Tools, agent: () => Agent): Run<Say, Say>["kind"] {
    return { ...Tools.agent_inbox(tools), ...Tools.agent_calls(tools, agent), ...Tools.agent_loop(tools, agent), change: () => tools.log.change() };
  }

  export function agent_inbox(tools: Tools): InboxHooks<Say, Say> {
    const log = tools.log;
    return {
      log    : (run, say) => {
        log.push(run, "user", say.text);
        return say;
      },
      queued : (run) => {
        Tools.queued(tools, run);
        log.change();
      },
      again  : () => false,
    };
  }

  export function agent_calls(tools: Tools, agent: () => Agent): CallHooks<Say, Say> {
    return {
      pick   : () => Tools.pick(tools, agent()),
      ask    : (_, take) => {
        take();
        return Tools.ask(tools, agent());
      },
      ended  : (_, end) => {
        const a = agent();
        a.replies.push(end.ok ? end.text : a.why ?? "failed: " + end.text);
        return end.ok;
      },
      on     : (run, ev) => tools.log.on(run, ev),
    };
  }

  export function agent_loop(tools: Tools, agent: () => Agent): LoopHooks<Say, Say> {
    return {
      begin  : () => {},
      failed : (_, why) => {
        agent().replies.push("failed: " + why);
      },
      ending : () => {},
      finish : (run) => {
        const a = agent();
        run.fell = null;
        tools.log.report(report_text(a.name, a.replies.join("\n\n")), !run.halt.signal.aborted, "agent:" + a.name);
      },
    };
  }

  export function queued(tools: Tools, run: Run<Say, Say>): void {
    const texts = run.queue.map((x) => x.q.text);
    if (texts.length === 0 && !(run.name in tools.mem.tells)) {
      return;
    }
    if (texts.length === 0) {
      delete tools.mem.tells[run.name];
    } else {
      tools.mem.tells[run.name] = texts;
    }
    Memory.save_queue(tools.mem);
  }

  export function ask(tools: Tools, agent: Agent): Ask {
    const log = { text: Memory.agent_show(tools.mem, agent.name), mark: true };
    const server = Tools.at(tools, agent.name);
    const run = Pick.ask(Tools.pick(tools, agent));
    const own = Memory.file_text(PROMPTS.prompt.file);
    const system = own === "" ? SUB : SUB + "\n\n" + AGENT_PROMPT + "\n\n" + own;
    const blocks = [Tools.instructions(tools), ...agent.view, Tools.skills(tools), Tools.instructions(tools, true), Tools.devices(tools), log];
    return { ...run, system, blocks, searches: SEARCHES, server, agent: true, who: agent.name };
  }

  export function pick(tools: Tools, agent: Agent): Pick {
    const base = config.AGENTS ?? tools.main.kind.pick();
    const { model, effort } = agent.role;
    const given = model === null ? base : Pick.to_model(base, model, config.OFFER.vendors, config.OFFER);
    if (given === null) {
      throw new Error(agent.name + "'s model " + model + " is no longer offered; spawn another subagent.");
    }
    return { ...given, effort: effort ?? given.effort };
  }

  export function shown(tools: Tools, agent: Agent): Pick | null {
    try {
      const { profile, ...pick } = Tools.pick(tools, agent);
      return agent.role.model === null && profile !== undefined ? { ...pick, profile } : pick;
    } catch {
      return null;
    }
  }

  export async function view(tools: Tools): Promise<Block[] | string> {
    const why = await Memory.settle(tools.mem, tools.mem.count, tools.main.halt.signal);
    return why ?? Memory.view(tools.mem);
  }

  export function working(tools: Tools): Agent[] {
    return [...tools.agents.values()].filter((a) => a.run.busy);
  }

  export function holding(tools: Tools): Agent[] {
    return Tools.working(tools).filter((a) => a.run.limit === null);
  }

  export async function halt(tools: Tools, name: string, why: string): Promise<Out> {
    const agent = Tools.agent(tools, name);
    if (agent === null) {
      return { text: "No agent " + name + ".", fail: true };
    }
    const run = agent.run;
    const working = run.busy;
    let ended = true;
    if (working) {
      const live = run.live.at(-1);
      const last = [...run.calls.values()].at(-1)?.text ?? (live && live.kind + ": " + live.text);
      const doing = last === undefined ? "" : " It was last at " + last.replace(/\s+/g, " ").slice(0, 300);
      agent.why = "Stopped by Unii" + (why.trim() === "" ? "." : ": " + why.trim().replace(/\.?$/, ".")) + doing;
      Tools.stop(tools, name);
      ended = await Promise.race([run.going.then(() => true, () => true), Bun.sleep(HALT).then(() => false)]);
    }
    const left = await Tools.sweep(tools, name);
    const runs = left.length === 0 ? "" : " Still running: " + left.join("; ") + ".";
    const text = !working ? name + " isn't working: nothing to stop." + (left.length === 0 ? "" : runs) : ended ? "Stopped " + name + "." + runs : "Stopping " + name + ": it hasn't ended yet." + runs;
    return { text, fail: !ended || left.length > 0 };
  }

  export async function sweep(tools: Tools, name: string): Promise<string[]> {
    const live = Tools.opened(tools).filter(([, d]) => [...d.terms.values()].some((t) => t.live()));
    const outs = await Promise.all(live.map(async ([device]) => {
      const run = Tools.start_job(tools, device, { name: "halt", input: { agent: name }, cwd: "main" }, crypto.randomUUID());
      if (typeof run === "string") {
        return null;
      }
      const timer = setTimeout(() => run.end({ text: "no answer", fail: true }), HALT);
      const out = await run.out;
      clearTimeout(timer);
      return out.fail ? device + ": " + out.text : null;
    }));
    return outs.filter((o) => o !== null);
  }

  export function stop(tools: Tools, name: string | null): void {
    for (const agent of Tools.working(tools).filter((a) => name === null || a.name === name)) {
      Run.stop(agent.run, null);
    }
  }

}
