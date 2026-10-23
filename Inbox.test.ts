// Inbox.test
// ==========
// `UNII_DIR=$(mktemp -d) bun test Inbox.test.ts`: tasks from outside
// (Tasks.task_inbox, Server.ts Main.inbox): only with the inbox token,
// the user's, from slack or github, one per conversation (ref), done once
// per post id, no turn started, what's wrong refused.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Owner } from "./Owner.ts";
import { Chat, Main } from "./Server.ts";
import * as Tasks from "./Tasks.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}
afterAll(() => fs.rmSync(config.DIR, { recursive: true, force: true }));

// any call to the AI is a turn started: there must be none
let CALLS = 0;
(AskAI as any).ask = () => {
  CALLS += 1;
  return { send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "", left: [] }) };
};

const chat = Chat.open() as any;
const s = Tasks.tasks_load(chat.mem.dir);
const TOKEN = Owner.inbox_new();

const slack = (over: object = {}) => ({
  title: "Slack: DM de Enzo",
  detail: "13:45 Enzo: salve",
  origin: "slack",
  origin_url: "https://numih.slack.com/archives/D0C361HU1R9/p1792773933327869",
  ref: "slack:D0C361HU1R9",
  choices: ["Enviar rascunho", "Eu respondo", "Ignorar"],
  ...over,
});

function post(body: unknown, headers: Record<string, string> = {}, method = "POST"): Promise<Response> {
  const h = { authorization: "Bearer " + TOKEN, "content-type": "application/json", ...headers };
  const req = new Request("http://127.0.0.1/api/inbox", { method, headers: h, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return Main.inbox(chat, req);
}

test("a new conversation: a task of the user's, from slack, with its link and choices; no turn", async () => {
  const res = await post({ id: "slack:D0C361HU1R9:1792773933.327869", task: slack() });
  expect(res.status).toBe(201);
  const ans = await res.json();
  expect(ans).toEqual({ task: "P1", made: true });
  const t = Tasks.task_find(s, "P1")!;
  expect(t.assignee).toBe("user");
  expect(t.origin).toBe("slack");
  expect(t.origin_url).toBe(slack().origin_url);
  expect(t.ref).toBe("slack:D0C361HU1R9");
  expect(t.by).toBe("inbox");
  expect(t.choices).toEqual(["Enviar rascunho", "Eu respondo", "Ignorar"]);
  expect(t.told).toBe(true);
  await Bun.sleep(20);
  expect(CALLS).toBe(0);
  expect(JSON.parse(fs.readFileSync(chat.mem.dir + "/tasks.json", "utf8")).tasks[0].origin).toBe("slack");
});

test("the same post again: done once, answered the same", async () => {
  const res = await post({ id: "slack:D0C361HU1R9:1792773933.327869", task: slack({ detail: "outra coisa" }) });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ task: "P1", made: true, again: true });
  expect(Tasks.task_find(s, "P1")!.detail).toBe("13:45 Enzo: salve");
});

test("more of the same conversation: appended to its open task, the newest link", async () => {
  const url = "https://numih.slack.com/archives/D0C361HU1R9/p1792774000000001";
  const res = await post({ id: "slack:D0C361HU1R9:1792774000.000001", task: slack({ detail: "13:46 Enzo: pode revisar o PR?", origin_url: url, title: "Slack: DM de Enzo (2)" }) });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ task: "P1", made: false });
  const t = Tasks.task_find(s, "P1")!;
  expect(t.detail).toBe("13:45 Enzo: salve\n13:46 Enzo: pode revisar o PR?");
  expect(t.origin_url).toBe(url);
  expect(t.title).toBe("Slack: DM de Enzo (2)");
  expect(s.tasks.filter((x) => x.state === "open").length).toBe(1);
});

test("once the user closes it, the next message makes a new task", async () => {
  Tasks.task_resolve(s, "P1", "done", "Eu respondo", null, Date.now());
  const res = await post({ id: "slack:D0C361HU1R9:1792775000.000001", task: slack({ detail: "14:00 Enzo: e aí?" }) });
  expect(await res.json()).toEqual({ task: "P2", made: true });
  expect(Tasks.task_find(s, "P2")!.detail).toBe("14:00 Enzo: e aí?");
});

test("another conversation: its own task", async () => {
  const res = await post({ id: "slack:C0C8NFDEY91:1", task: slack({ ref: "slack:C0C8NFDEY91", title: "Slack: grupo com Morum" }) });
  expect(await res.json()).toEqual({ task: "P3", made: true });
});

test("no token, a wrong one, the owner's cookie alone: refused, nothing added", async () => {
  const before = s.tasks.length;
  const bodies = { id: "x1", task: slack({ ref: "slack:X" }) };
  expect((await post(bodies, { authorization: "" })).status).toBe(401);
  expect((await post(bodies, { authorization: "Bearer " + "a".repeat(43) })).status).toBe(401);
  expect((await post(bodies, { authorization: TOKEN })).status).toBe(401);
  expect((await post(bodies, { authorization: "", cookie: "unii=" + TOKEN })).status).toBe(401);
  expect(s.tasks.length).toBe(before);
});

test("a token made anew: the old one no longer works; off: none", async () => {
  const fresh = Owner.inbox_new();
  expect((await post({ id: "y1", task: slack({ ref: "slack:Y" }) })).status).toBe(401);
  const h = { authorization: "Bearer " + fresh };
  expect((await post({ id: "y1", task: slack({ ref: "slack:Y", title: "Slack: Y" }) }, h)).status).toBe(201);
  expect(Owner.inbox_off()).toBe(1);
  expect((await post({ id: "y2", task: slack({ ref: "slack:Y2", title: "Slack: Y2" }) }, h)).status).toBe(401);
  // the token of the rest of the tests, again
  const db = Owner.open();
  db.query("insert into inbox values (?, ?)").run(Owner.hash(TOKEN), Date.now());
});

test("the inbox token is no session: the owner's pages refuse it", () => {
  const req = new Request("http://127.0.0.1/api/tree", { headers: { authorization: "Bearer " + TOKEN } });
  expect(Owner.is(req)).toBe(false);
});

test("malformed posts: refused, said why, nothing added", async () => {
  const before = JSON.stringify(s.tasks);
  const cases: [unknown, number, string][] = [
    ["not json", 400, "Send { id, task }"],
    [{ task: slack() }, 400, "Send { id, task }"],
    [{ id: "../x", task: slack() }, 400, "Send { id, task }"],
    [{ id: "z" + "x".repeat(200), task: slack() }, 400, "Send { id, task }"],
    [{ id: "z1", task: null }, 400, "task is an object"],
    [{ id: "z2", task: [1] }, 400, "task is an object"],
    [{ id: "z3", task: slack({ origin: "chat" }) }, 400, "origin is one of"],
    [{ id: "z4", task: slack({ origin: "agent:X" }) }, 400, "origin is one of"],
    [{ id: "z5", task: slack({ ref: "  " }) }, 400, "needs a ref"],
    [{ id: "z6", task: slack({ title: "\x1b\x07  " }) }, 400, "needs a title"],
    [{ id: "z7", task: slack({ origin_url: "javascript:alert(1)" }) }, 400, "origin_url"],
    [{ id: "z8", task: slack({ origin_url: "https://x.com/\"><script>" }) }, 400, "origin_url"],
    [{ id: "z9", task: slack({ assignee: "unii" }) }, 400, "Unknown key(s): assignee"],
    [{ id: "z10", task: slack({ fields: [] }) }, 400, "Unknown key(s): fields"],
    [{ id: "z11", task: slack({ detail: 5 }) }, 400, "detail must be text"],
    [{ id: "z12", task: slack({ choices: "a" }) }, 400, "choices is a list"],
    [{ id: "z13", task: slack({ choices: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] }) }, 400, "At most"],
  ];
  for (const [body, status, why] of cases) {
    const res = await post(body);
    expect(res.status).toBe(status);
    expect((await res.json()).error).toContain(why);
  }
  expect((await post({ id: "w1", task: slack() }, { "content-type": "text/plain" })).status).toBe(415);
  expect((await post({ id: "w2", task: slack({ detail: "x".repeat(20000) }) })).status).toBe(413);
  expect((await post(null, {}, "GET")).status).toBe(405);
  expect(JSON.stringify(s.tasks)).toBe(before);
});

test("texts cleaned: control characters and ANSI gone, cut at their lengths", async () => {
  const res = await post({ id: "c1", task: slack({ ref: "slack:C1", title: "Slack:\x1b[31m vermelho " + "t".repeat(300), detail: "a\x1b[2Jb\nc\u0007d" }) });
  const t = Tasks.task_find(s, (await res.json()).task)!;
  expect(t.title).not.toContain("\x1b");
  expect(t.title.length).toBe(Tasks.TITLE);
  expect(t.detail).toBe("a[2Jb\ncd");
});

test("a long conversation: the oldest lines go, the newest kept", () => {
  const a = Array.from({ length: 50 }, (_, k) => "linha " + k + " " + "x".repeat(40)).join("\n");
  const out = Tasks.detail_join(a, "a mais nova", 300);
  expect(out.length).toBeLessThanOrEqual(300);
  expect(out.startsWith("…\nlinha ")).toBe(true);
  expect(out.endsWith("\na mais nova")).toBe(true);
  expect(Tasks.detail_join("", "b", 10)).toBe("b");
  expect(Tasks.detail_join("a", "", 10)).toBe("a");
});

test("a title an open task of another conversation has: refused", async () => {
  const res = await post({ id: "t1", task: slack({ ref: "slack:OUTRO", title: "Slack: grupo com Morum" }) });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("open with this title");
});

test("by the server's router: reached without a session; another site's post refused", async () => {
  Main.chat = chat;
  const req = (h: Record<string, string>, id: string) => new Request("http://127.0.0.1/api/inbox", { method: "POST", headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json", ...h }, body: JSON.stringify({ id, task: slack({ ref: "slack:R" + id, title: "Slack: R" + id }) }) });
  expect((await Main.http(req({}, "r1"), null as any))!.status).toBe(201);
  expect((await Main.http(req({ "sec-fetch-site": "cross-site" }, "r2"), null as any))!.status).toBe(403);
  expect((await Main.http(req({ authorization: "" }, "r3"), null as any))!.status).toBe(401);
});

test("still no turn after all of it", async () => {
  await Bun.sleep(20);
  expect(CALLS).toBe(0);
});
