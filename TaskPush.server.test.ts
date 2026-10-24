// TaskPush.server.test
// ====================
// `UNII_DIR=$(mktemp -d) bun test TaskPush.server.test.ts`: the pending
// list's pushes in the server (Server.ts Chat.task_push): a task the
// user's, added by Unii, goes to the owner's phones and browsers as one
// push after the window, its count for the badge, and a turn's reply
// carries the count too. Push.notify is a fake that keeps what it gets.

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
const NOTIFY = Push.notify;
(Push as any).notify = (_db: unknown, text: string, more: any = {}) => GOT.push({ text, more });

const chat = Chat.open() as any;
const dir = chat.mem.dir;

// the chat's list and what was told left as found: the other files of a
// whole run share this chat's dir
afterAll(() => {
  (Push as any).notify = NOTIFY;
  Tasks.tasks_forget();
  fs.rmSync(dir + "/tasks.json", { force: true });
  fs.rmSync(dir + TaskPush.FILE, { force: true });
});

test("a task for the user goes once, after the window, with the count; Unii's doesn't", () => {
  const t0 = Date.now();
  Chat.task_push(chat, t0);
  expect(GOT).toEqual([]);
  expect(fs.existsSync(dir + TaskPush.FILE)).toBe(true);
  const s = Tasks.tasks_load(dir);
  Tasks.task_new(s, { title: "Mesclar o PR secreto" }, "main", t0);
  Tasks.task_new(s, { title: "Acompanhar o agente", assignee: "unii" }, "main", t0);
  Chat.task_push(chat, t0 + 1000);
  expect(GOT).toEqual([]);
  Chat.task_push(chat, t0 + 1000 + TaskPush.WINDOW);
  expect(GOT).toEqual([{ text: "Pendência P1 precisa de você", more: { kind: "tasks", tasks: 1, ids: ["P1"] } }]);
  Chat.task_push(chat, t0 + 2000 + TaskPush.WINDOW);
  expect(GOT.length).toBe(1);
});

test("a turn's reply carries the user's count", async () => {
  GOT.length = 0;
  await Chat.writing(chat, async () => Chat.push(chat, null, "unii", "Pronto."));
  Chat.phone(chat);
  expect(Memory.message(chat.mem, chat.mem.count - 1)!.text).toBe("Pronto.");
  expect(GOT).toEqual([{ text: "Pronto.", more: { kind: "reply", tasks: 1 } }]);
});
