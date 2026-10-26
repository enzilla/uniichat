// TasksAssignee.test
// ==================
// `bun test TasksAssignee.test.ts`: a task's assignee (who is
// responsible; `who`, its older name, still read) and origin (where it
// came from, with a link to its source), through the store, the tools
// and the views, on chats in a temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";
import { Tools, type Tools as Kit } from "./Tools.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-assignee-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");
let dir    = "";

beforeEach(() => {
  T.tasks_forget();
  dir = fs.mkdtempSync(ROOT + "/chat-");
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function add(s: T.Store, args: T.Edit, origin: string | null = null): T.Task {
  const t = T.task_new(s, args, "main", NOW, origin);
  if (typeof t === "string") {
    throw new Error(t);
  }
  return t;
}

function reload(): T.Store {
  T.tasks_forget();
  return T.tasks_load(dir);
}

// the evidence round: task_add needs done_when, and a task of Unii's its
// next_step; given here unless a test gives its own (TasksEvidence.test.ts
// tests them)
const ROUND = (name: string, args: any) => (name !== "task_add" ? args : { done_when: "feito", ...(String(args.assignee ?? args.who ?? "") === "unii" ? { next_step: "seguir" } : {}), ...args });

test("assignee: by default the user; who (its older name) still read, in the tools and in an old tasks.json", () => {
  const s = T.tasks_load(dir);
  expect(add(s, { title: "A" }).assignee).toBe("user");
  expect(add(s, { title: "B", who: "unii" }).assignee).toBe("unii");
  expect(add(s, { title: "C", assignee: "unii" }).assignee).toBe("unii");
  expect(add(s, { title: "D", assignee: " UNII ", who: "unii" }).assignee).toBe("unii");
  expect(T.task_new(s, { title: "E", assignee: "boss" }, "main", NOW)).toBe("assignee is one of: user, unii.");
  expect(T.task_new(s, { title: "E", assignee: "\x1b[31munii" }, "main", NOW)).toBe("assignee is one of: user, unii.");
  expect(T.task_new(s, { title: "E", assignee: "user", who: "unii" }, "main", NOW)).toContain("assignee and who differ");
  expect(T.task_edit(s, { id: "P1", who: "unii" }, NOW)).toMatchObject({ assignee: "unii" });
  expect(T.task_edit(s, { id: "P1", assignee: "user" }, NOW)).toMatchObject({ assignee: "user" });
  expect(T.task_edit(s, { id: "P1", assignee: 3 }, NOW)).toBe("assignee is one of: user, unii.");
  // an old file: who only
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 3, rev: 0, tasks: [{ id: "P1", title: "Velha", who: "unii" }, { id: "P2", title: "Outra" }] }));
  const old = reload();
  expect(old.tasks.map((t) => [t.assignee, t.origin, t.origin_url])).toEqual([["unii", null, null], ["user", null, null]]);
  // saved with who too, so an older version reads whose each is
  T.tasks_save(old);
  const raw = JSON.parse(fs.readFileSync(dir + "/tasks.json", "utf8"));
  expect(raw.tasks.map((t: any) => [t.assignee, t.who])).toEqual([["unii", "unii"], ["user", "user"]]);
});

test("origin: the turn's by default, one given wins; checked; a link only http(s), clean, with an origin", () => {
  const s = T.tasks_load(dir);
  expect(add(s, { title: "A" }).origin).toBeNull();
  expect(add(s, { title: "B" }, "timer").origin).toBe("timer");
  expect(add(s, { title: "C" }, "agent:ShortRabbit").origin).toBe("agent:ShortRabbit");
  expect(add(s, { title: "D", origin: "slack", origin_url: "https://numih.slack.com/archives/C1/p2" }, "chat")).toMatchObject({ origin: "slack", origin_url: "https://numih.slack.com/archives/C1/p2" });
  expect(add(s, { title: "E", origin: "Agent:X.y-1" }).origin).toBe("agent:X.y-1");
  const bad = "origin is chat, timer, slack, github or agent:<name> (letters, digits, . _ -).";
  for (const o of ["email", "agent:", "agent:<b>", "agent:a b", "\x1b[31mchat", "agent:" + "x".repeat(65), 7]) {
    expect(T.task_new(s, { title: "F", origin: o }, "main", NOW)).toBe(bad);
  }
  // an origin of the turn not one: none
  expect(add(s, { title: "G" }, "<script>").origin).toBeNull();
  const link = "origin_url is an http(s) link of at most 500 characters, without spaces, quotes or angle brackets.";
  for (const u of ["javascript:alert(1)", "https://a.b/\"onmouseover=x", "https://a.b/<x>", "https://a b", "https://a.b/\x1b[2J", "ftp://a.b", "https://a.b/" + "x".repeat(500), "data:text/html,x"]) {
    expect(T.task_new(s, { title: "H", origin: "github", origin_url: u }, "main", NOW)).toBe(link);
  }
  expect(T.task_new(s, { title: "H", origin_url: "https://github.com/x" }, "main", NOW)).toBe("origin_url needs an origin.");
  // edit: a new origin drops the old link; "" clears it
  expect(T.task_edit(s, { id: "P4", origin: "github" }, NOW)).toMatchObject({ origin: "github", origin_url: null });
  expect(T.task_edit(s, { id: "P4", origin_url: "https://github.com/morum/uniichat/issues/1" }, NOW)).toMatchObject({ origin_url: "https://github.com/morum/uniichat/issues/1" });
  expect(T.task_edit(s, { id: "P4", origin_url: "" }, NOW)).toMatchObject({ origin: "github", origin_url: null });
  expect(T.task_edit(s, { id: "P1", origin_url: "https://x.y" }, NOW)).toBe("origin_url needs an origin.");
  // read back as given; a hand edit's wrong ones dropped
  const kept = reload();
  expect(kept.tasks.find((t) => t.id === "P3")!.origin).toBe("agent:ShortRabbit");
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 4, rev: 0, tasks: [{ id: "P1", title: "a", origin: "<img>", origin_url: "https://x.y" }, { id: "P2", title: "b", origin: "slack", origin_url: "javascript:x" }, { id: "P3", title: "c", origin: "github", origin_url: "https://github.com/a" }] }));
  expect(reload().tasks.map((t) => [t.origin, t.origin_url])).toEqual([[null, null], ["slack", null], ["github", "https://github.com/a"]]);
});

test("a turn's origin: a message of the user's among them, chat; else the first's", () => {
  expect(T.turn_origin([])).toBe("chat");
  expect(T.turn_origin([undefined])).toBe("chat");
  expect(T.turn_origin(["timer"])).toBe("timer");
  expect(T.turn_origin(["agent:A", "timer"])).toBe("agent:A");
  expect(T.turn_origin(["timer", undefined])).toBe("chat");
  expect(T.turn_origin(["agent:<x>"])).toBe("chat");
});

test("tools: task_add needs its origin given, never the turn's (R5); says it; who and assignee both accepted", async () => {
  const tools = { mem: { dir }, agents: new Map(), hooks: { change: () => {} } } as unknown as Kit;
  const call = (name: string, args: object) => Tools.call(tools, "main", name, ROUND(name, args), new AbortController().signal, "x");
  expect((await call("task_add", { title: "A", origin: "chat" })).text).toBe("Added P1 [user] A (from chat, 0m)");
  tools.origin = "timer";
  expect((await call("task_add", { title: "B", who: "unii", origin: "timer" })).text).toBe("Added P2 [unii] B (from timer, 0m)");
  // the turn came from an agent's report, but the task is Unii's own:
  // the origin given is kept, the turn's never taken (P63, P67)
  tools.origin = "agent:SleepyToucan";
  const none = await call("task_add", { title: "Sem origem", assignee: "unii" });
  expect(none.fail).toBe(true);
  expect(none.text).toStartWith("Give origin: where this task came from");
  expect(none.text).toContain("(this one came from agent:SleepyToucan)");
  expect((await call("task_add", { title: "C", assignee: "unii", origin: "chat", ref: "num-3182", ref_new: true })).text).toBe("Added P3 [unii] C (ref num-3182, from chat, 0m)");
  expect((await call("task_add", { title: "D", origin: "github", origin_url: "https://github.com/a/b/pull/1" })).text).toBe("Added P4 [user] D (from github https://github.com/a/b/pull/1, 0m)");
  expect(await call("task_add", { title: "E", origin: "chat", assignee: "x" })).toEqual({ text: "assignee is one of: user, unii.", fail: true });
  const spec = Tools.list(tools, "main").find((s) => s.name === "task_add")! as any;
  const props = (spec.schema ?? spec.input_schema ?? spec.parameters ?? spec).properties ?? JSON.stringify(spec);
  expect(JSON.stringify(props)).toContain("assignee");
  expect(JSON.stringify(props)).toContain("origin_url");
});

test("views: the open by assignee, the user's first; a task not the user's has only Cobrar agora and Pode fechar (P6); origin a badge, escaped; a link only http(s)", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Do Unii", assignee: "unii" }, "agent:Short<Rabbit");
  add(s, { title: "Minha", origin: "slack", origin_url: "https://numih.slack.com/archives/C1/p2?a=1&b=2" }, "chat");
  add(s, { title: "Outra minha" }, "timer");
  const tasks = T.tasks_view(s, NOW);
  // the agent's name isn't one (<): no origin
  expect(tasks.find((t) => t.id === "P1")!.origin).toBeNull();
  const html = Html.tasks_html(tasks);
  expect(html.open.length).toBe(3);
  expect(html.now.length).toBe(5);
  expect(html.now[0]).toBe('<li class="group" data-assignee="user">Com você <span class="n">(2)</span></li>');
  expect(html.now[3]).toBe('<li class="group" data-assignee="unii">Com o Unii <span class="n">(1)</span></li>');
  expect(html.now[1]).toContain('data-task="P2"');
  expect(html.now[1]).toContain('<a class="origin" title="Origem" href="https://numih.slack.com/archives/C1/p2?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Slack</a>');
  expect(html.now[1]).toContain('class="done"');
  expect(html.now[2]).toContain('<span class="origin" title="Origem">agendamento</span>');
  expect(html.now[4]).toContain('class="chase"');
  expect(html.now[4]).toContain('>Pode fechar</button>');
  expect(html.now[4]).not.toContain(">Concluir<");
  expect(html.now[4]).not.toContain(">Descartar<");
  expect(html.now[4]).toContain("com o Unii");
  expect(html.now[4]).toContain('class="task other unii"');
  // the user's alone: no heading
  const mine = Html.tasks_html(tasks.filter((t) => t.assignee === "user"));
  expect(mine.now).toEqual(mine.open);
  // terminal
  const v = View.view_new();
  v.tasks = tasks;
  const md = View.tasks_md(v);
  expect(md.indexOf("**Suas pendências (2)**")).toBeLessThan(md.indexOf("**Pendências com o Unii (1)**"));
  expect(md).toContain("- **P2** Minha · origem: Slack");
  // (the evidence round: Unii's, made days before the clock, is past its due)
  expect(View.tasks_md(v, tasks.find((t) => t.id === "P1")!)).toMatch(/aberta · \*\*prazo vencido há \d+ [hd]\*\* · com o Unii/);
  expect(View.origin_said({ origin: "agent:SleepyToucan" } as T.Task)).toBe("agente SleepyToucan");
});
