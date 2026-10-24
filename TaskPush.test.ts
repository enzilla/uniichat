// TaskPush.test
// =============
// `UNII_DIR=$(mktemp -d) bun test TaskPush.test.ts`: the pending list's
// pushes (TaskPush.ts): the tasks made or freed for the user, together
// within WINDOW, only their ids; the daily reminder of the late ones,
// each once; what was told kept (push.json, mode 600); the browsers'
// pushes with the count for the badge, a subscription gone (404, 410)
// forgotten (Push.ts).

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as config from "./Config.ts";
import { Push } from "./Push.ts";
import * as TaskPush from "./TaskPush.ts";
import type { Task } from "./Tasks.ts";
import * as View from "./View.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}
afterAll(() => fs.rmSync(config.DIR, { recursive: true, force: true }));

// a task: open, the user's, unless said
function task(id: string, more: Partial<Task> = {}): Task {
  const at = "2026-10-24T10:00:00.000Z";
  return {
    id, title: "Título secreto de " + id, detail: "", state: "open", assignee: "user", origin: "chat", origin_url: null, by: "main",
    choices: [], answer: null, note: null, ref: null, made: at, changed: at, closed: null, told: true, rev: 0, after: [], freed: false,
    heard: null, fields: [], draft: {}, answers: null, thread: [], talk: null, ...more,
  };
}

// a local time (the reminder goes by the server's clock)
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

test("the first look takes the tasks open as told: nothing pushed", () => {
  const { state, send } = TaskPush.step(null, [task("P1"), task("P2")], at(24, 10));
  expect(send).toEqual([]);
  expect(Object.keys(state.seen)).toEqual(["P1", "P2"]);
});

test("a task made goes after WINDOW, only its id", () => {
  let { state } = TaskPush.step(null, [task("P1")], at(24, 10));
  const tasks = [task("P1"), task("P2")];
  let out = TaskPush.step(state, tasks, at(24, 10, 1));
  expect(out.send).toEqual([]);
  expect(out.state.queue).toEqual(["P2"]);
  out = TaskPush.step(out.state, tasks, at(24, 10, 1) + TaskPush.WINDOW - 1);
  expect(out.send).toEqual([]);
  out = TaskPush.step(out.state, tasks, at(24, 10, 1) + TaskPush.WINDOW);
  expect(out.send).toEqual([{ kind: "new", ids: ["P2"], text: "Pendência P2 precisa de você", count: 2 }]);
  expect(out.send[0].text).not.toContain("Título");
  // told: not again
  out = TaskPush.step(out.state, tasks, at(24, 10, 5));
  expect(out.send).toEqual([]);
});

test("tasks made within WINDOW go as one", () => {
  let { state } = TaskPush.step(null, [], at(24, 10));
  state = TaskPush.step(state, [task("P3")], at(24, 10, 0)).state;
  state = TaskPush.step(state, [task("P3"), task("P10")], at(24, 10, 0) + 20000).state;
  const out = TaskPush.step(state, [task("P3"), task("P10"), task("P4")], at(24, 10, 0) + TaskPush.WINDOW);
  expect(out.send.map((n) => n.text)).toEqual(["Pendências P3, P4 e P10 precisam de você"]);
});

test("ids past four are counted", () => {
  expect(TaskPush.ids_said(["P1", "P2", "P3", "P4", "P5", "P6"])).toBe("P1, P2, P3, P4 e mais 2");
  expect(TaskPush.text("new", ["P1", "P2"])).toBe("Pendências P1 e P2 precisam de você");
  expect(TaskPush.text("late", ["P1"])).toBe("Pendência P1 está em atraso");
  expect(TaskPush.text("late", ["P1", "P2"])).toBe("Pendências P1 e P2 estão em atraso");
});

test("Unii's tasks, those waiting for others or for Unii's reply aren't pushed; one freed is", () => {
  let { state } = TaskPush.step(null, [], at(24, 10));
  const tasks = [task("P1", { assignee: "unii" }), task("P2"), task("P3", { after: ["P2"] }), task("P4", { talk: "unii" })];
  let out = TaskPush.step(state, tasks, at(24, 10, 1));
  out = TaskPush.step(out.state, tasks, at(24, 11));
  expect(out.send.map((n) => n.ids)).toEqual([["P2"]]);
  // P2 done: P3 freed
  tasks[1] = task("P2", { state: "done" });
  out = TaskPush.step(out.state, tasks, at(24, 12));
  out = TaskPush.step(out.state, tasks, at(24, 13));
  expect(out.send.map((n) => n.text)).toEqual(["Pendência P3 precisa de você"]);
});

test("a task resolved before its push goes isn't pushed", () => {
  let { state } = TaskPush.step(null, [], at(24, 10));
  state = TaskPush.step(state, [task("P1")], at(24, 10, 1)).state;
  const out = TaskPush.step(state, [task("P1", { state: "dropped" })], at(24, 11));
  expect(out.send).toEqual([]);
  expect(out.state.queue).toEqual([]);
  expect(out.state.since).toBe(null);
});

test("the late ones once a day, at REMIND or after, each once ever", () => {
  const tasks = [task("P1"), task("P2")];
  let { state } = TaskPush.step(null, tasks, at(23, 10));
  // the next day before REMIND: nothing
  let out = TaskPush.step(state, tasks, at(24, TaskPush.REMIND - 1, 59));
  expect(out.send).toEqual([]);
  out = TaskPush.step(out.state, tasks, at(24, TaskPush.REMIND, 0));
  expect(out.send).toEqual([]); // not 24 h yet
  // the day after, both late
  out = TaskPush.step(out.state, tasks, at(25, TaskPush.REMIND, 30));
  expect(out.send).toEqual([{ kind: "late", ids: ["P1", "P2"], text: "Pendências P1 e P2 estão em atraso", count: 2 }]);
  // same day, and the days after: not again
  out = TaskPush.step(out.state, tasks, at(25, 18));
  expect(out.send).toEqual([]);
  out = TaskPush.step(out.state, [...tasks, task("P3")], at(26, 10));
  expect(out.send.filter((n) => n.kind === "late")).toEqual([]);
  // reopened later: still reminded already
  out = TaskPush.step(out.state, [task("P1", { state: "done" }), task("P2"), task("P3")], at(26, 11));
  out = TaskPush.step(out.state, [task("P1"), task("P2"), task("P3")], at(27, 8));
  out = TaskPush.step(out.state, [task("P1"), task("P2"), task("P3")], at(28, 10));
  expect(out.send.filter((n) => n.kind === "late").map((n) => n.ids)).toEqual([["P3"]]);
});

test("kept in the chat's dir, mode 600; a broken file starts again as the first look", () => {
  const dir = config.DIR + "/chat-a";
  const sent: TaskPush.Notice[] = [];
  TaskPush.look(dir, [task("P1")], at(24, 10), (n) => sent.push(n));
  expect(fs.statSync(dir + TaskPush.FILE).mode & 0o777).toBe(0o600);
  TaskPush.look(dir, [task("P1"), task("P2")], at(24, 10, 1), (n) => sent.push(n));
  TaskPush.look(dir, [task("P1"), task("P2")], at(24, 10, 2), (n) => sent.push(n));
  expect(sent.map((n) => n.text)).toEqual(["Pendência P2 precisa de você"]);
  fs.writeFileSync(dir + TaskPush.FILE, "{not json");
  expect(TaskPush.load(dir)).toBe(null);
  const again = TaskPush.look(dir, [task("P1"), task("P2"), task("P5")], at(24, 12), () => {});
  expect(again).toEqual([]);
  expect(Object.keys(TaskPush.load(dir)!.seen)).toEqual(["P1", "P2", "P5"]);
});

test("the user's count is the Mesa's Agora", () => {
  const tasks = [task("P1"), task("P2", { assignee: "unii" }), task("P3", { assignee: "unii", talk: "user" }), task("P4", { talk: "unii" }), task("P5", { after: ["P1"] }), task("P6", { state: "done" })];
  expect(TaskPush.turn_count(tasks)).toBe(View.desk_list(tasks).find((g) => g.group === "now")!.tasks.length);
  expect(TaskPush.turn_count(tasks)).toBe(2);
  expect(View.turn_title("UniiChat", 2)).toBe("(2) UniiChat");
  expect(View.turn_title("UniiChat", 0)).toBe("UniiChat");
});

test("browsers get the text and the count; a subscription gone (404, 410) is forgotten", async () => {
  const subs = [{ endpoint: "https://a.example/1", p256dh: "x", auth: "y" }, { endpoint: "https://b.example/2", p256dh: "x", auth: "y" }, { endpoint: "https://c.example/3", p256dh: "x", auth: "y" }];
  const gone: string[] = [];
  const db = { query: (sql: string) => ({ all: () => subs, run: (endpoint: string) => sql.startsWith("delete") && gone.push(endpoint) }) } as any;
  const bodies: any[] = [];
  const status: Record<string, number> = { "https://a.example/1": 201, "https://b.example/2": 410, "https://c.example/3": 404 };
  const send = Push.send;
  (Push as any).send = async (sub: { endpoint: string }, body: string) => (bodies.push(JSON.parse(body)), status[sub.endpoint]);
  try {
    Push.browsers(db, "Pendência P7 precisa de você", { kind: "tasks", tasks: 3, ids: ["P7"] });
    await Bun.sleep(10);
  } finally {
    (Push as any).send = send;
  }
  expect(bodies[0]).toEqual({ kind: "tasks", tasks: 3, ids: ["P7"], text: "Pendência P7 precisa de você" });
  expect(gone.sort()).toEqual(["https://b.example/2", "https://c.example/3"]);
});

test("the VAPID key pair is made in UNII_DIR, mode 600", () => {
  expect(Push.keys()).not.toBe(null);
  expect(fs.statSync(config.DIR + "/vapid.json").mode & 0o777).toBe(0o600);
});
