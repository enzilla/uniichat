// TaskPush.server.test
// ====================
// `UNII_DIR=$(mktemp -d) bun test TaskPush.server.test.ts`: the pending
// list's pushes in the server (Server.ts Chat.task_push): a task the
// user's, added by Unii, goes to the owner's phones and browsers as one
// push after the window, its count for the badge, and a turn's reply
// pushes nothing; a push that fails goes again, only to the
// browsers it didn't. Push.deliver is a fake that keeps what it gets;
// Push.phones and Push.browsers fakes keep what reaches them (SENT), so
// a whole turn (Chat.turn) is seen to push nothing.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as config from "./Config.ts";
import { Memory } from "./Memory.ts";
import { Push } from "./Push.ts";
import { Chat } from "./Server.ts";
import * as TaskPush from "./TaskPush.ts";
import * as Tasks from "./Tasks.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

const GOT: { text: string; more: any }[] = [];
const SENT: { to: string; text: string; more?: any }[] = [];
const DELIVER = Push.deliver;
const PHONES = Push.phones;
const BROWSERS = Push.browsers;
// fails as many times as FAIL says, then goes
let FAIL = 0;
(Push as any).deliver = async (_db: unknown, text: string, more: any, done: Set<string>) => {
  GOT.push({ text, more });
  if (FAIL > 0) {
    FAIL--;
    return false;
  }
  done.add("https://a.example/1");
  return true;
};
(Push as any).phones = (_db: unknown, text: string) => SENT.push({ to: "phones", text });
(Push as any).browsers = (_db: unknown, text: string, more: any = {}) => SENT.push({ to: "browsers", text, more });

const chat = Chat.open() as any;
const dir = chat.mem.dir;

// the chat's list and what was told left as found: the other files of a
// whole run share this chat's dir
afterAll(() => {
  (Push as any).deliver = DELIVER;
  (Push as any).phones = PHONES;
  (Push as any).browsers = BROWSERS;
  Tasks.tasks_forget();
  fs.rmSync(dir + "/tasks.json", { force: true });
  fs.rmSync(dir + TaskPush.FILE, { force: true });
});

test("a task for the user goes once, after the window, with the count; Unii's doesn't", async () => {
  const t0 = Date.now();
  await Chat.task_push(chat, t0);
  expect(GOT).toEqual([]);
  expect(fs.existsSync(dir + TaskPush.FILE)).toBe(true);
  const s = Tasks.tasks_load(dir);
  Tasks.task_new(s, { title: "Mesclar o PR secreto" }, "main", t0);
  Tasks.task_new(s, { title: "Acompanhar o agente", assignee: "unii" }, "main", t0);
  await Chat.task_push(chat, t0 + 1000);
  expect(GOT).toEqual([]);
  await Chat.task_push(chat, t0 + 1000 + TaskPush.WINDOW);
  expect(GOT).toEqual([{ text: "Pendência P1 precisa de você", more: { kind: "tasks", tasks: 1, ids: ["P1"] } }]);
  await Chat.task_push(chat, t0 + 2000 + TaskPush.WINDOW);
  expect(GOT.length).toBe(1);
});

test("a push that fails goes again, with the same text; told once it went", async () => {
  GOT.length = 0;
  const t0 = Date.now() + 10 * TaskPush.WINDOW;
  const s = Tasks.tasks_load(dir);
  Tasks.task_new(s, { title: "Outra pendência secreta" }, "main", t0);
  await Chat.task_push(chat, t0);
  FAIL = 2;
  const waits: number[] = [];
  await Chat.task_push(chat, t0 + TaskPush.WINDOW, async (ms) => waits.push(ms));
  expect(GOT.map((g) => g.text)).toEqual(["Pendência P3 precisa de você", "Pendência P3 precisa de você", "Pendência P3 precisa de você"]);
  expect(waits).toEqual(TaskPush.WAITS);
  await Chat.task_push(chat, t0 + 2 * TaskPush.WINDOW);
  expect(GOT.length).toBe(3);
});

test("a whole turn's reply pushes nothing; a new task still does", async () => {
  GOT.length = 0;
  SENT.length = 0;
  const t0 = Date.now() + 100 * TaskPush.WINDOW;
  // the model's call faked: it answers "Pronto." and the turn ends, its
  // finally run as in the server
  const CALL = Chat.call;
  (Chat as any).call = async (c: any) => {
    c.wait = [];
    await Chat.writing(c, async () => Chat.push(c, null, "unii", "Pronto."));
    return false;
  };
  try {
    chat.wait = [{ id: -1 }];
    await Chat.turn(chat);
  } finally {
    (Chat as any).call = CALL;
  }
  expect(chat.busy).toBe(false);
  expect(Memory.message(chat.mem, chat.mem.count - 1)!.text).toBe("Pronto.");
  await Chat.task_push(chat, t0);
  await Chat.task_push(chat, t0 + TaskPush.WINDOW);
  expect(GOT).toEqual([]);
  expect(SENT).toEqual([]);
  const s = Tasks.tasks_load(dir);
  Tasks.task_new(s, { title: "Pendência depois da resposta" }, "main", t0 + TaskPush.WINDOW);
  await Chat.task_push(chat, t0 + TaskPush.WINDOW);
  await Chat.task_push(chat, t0 + 2 * TaskPush.WINDOW);
  expect(GOT.map((g) => g.more.kind)).toEqual(["tasks"]);
  expect(GOT[0].text).toMatch(/^Pendência P\d+ precisa de você$/);
  expect(SENT.map((g) => g.to)).toEqual(["phones"]);
});
