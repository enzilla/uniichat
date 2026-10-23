// Thread.test
// ===========
// `UNII_DIR=$(mktemp -d /tmp/unii-t.XXXX) bun test Thread.test.ts`: a
// task's thread. A message sent about a task carries its mark (View); a
// turn of such messages only, all about one task, gets that task whole
// in its blocks, after the memory's view, and Unii's answers in it join
// the task's thread (Server.ts, threads.json), which the views get in
// their state. The AI is a fake that answers each turn at once, logging
// its answer as a streamed one is.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Chat } from "./Server.ts";
import * as Tasks from "./Tasks.ts";
import * as View from "./View.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}
afterAll(() => fs.rmSync(config.DIR, { recursive: true, force: true }));

const ASKED: Ask[] = [];
let chat: any = null;
(AskAI as any).ask = (ask: Ask) => {
  const turn = ask.blocks.some((b) => b.text.startsWith("Turn: "));
  if (turn) {
    ASKED.push(ask);
    Chat.push(chat, null, "unii", "resposta " + ASKED.length);
  }
  return { send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "", left: [] }) };
};

chat = Chat.open();
const s = Tasks.tasks_load(chat.mem.dir);
const t1 = Tasks.task_new(s, { title: "Qual ambiente usar?", detail: "Para o teste de carga.", choices: ["hom", "prod"] }, "main", Date.now()) as Tasks.Task;
const t2 = Tasks.task_new(s, { title: "Revisar o PR" }, "main", Date.now()) as Tasks.Task;
Tasks.tasks_save(s);

async function idle(): Promise<void> {
  for (let k = 0; k < 200 && (chat.busy || chat.wait.length > 0); k++) {
    await Bun.sleep(5);
  }
  await Bun.sleep(5);
}

// messages logged together, their turn waited on
async function say(...texts: string[]): Promise<Ask> {
  const was = ASKED.length;
  await Chat.writing(chat, async () => texts.forEach((text) => Chat.take(chat, Chat.push(chat, null, "user", text))));
  await idle();
  expect(ASKED.length).toBe(was + 1);
  return ASKED.at(-1)!;
}

test("a mark: the task's id and title; read back; taken off; a turn's task only when all its messages share one", () => {
  const mark = View.task_mark(t1);
  expect(mark).toBe("[Sobre a pendência P1 · Qual ambiente usar?]");
  expect(View.task_marked(mark + "\nhom ou prod?")).toBe("P1");
  expect(View.task_marked("hom ou prod?")).toBe(null);
  expect(View.task_unmark(mark + "\nhom ou prod?")).toBe("hom ou prod?");
  expect(View.turn_task([mark + "\na", mark + "\nb"])).toBe("P1");
  expect(View.turn_task([mark + "\na", View.task_mark(t2) + "\nb"])).toBe(null);
  expect(View.turn_task([mark + "\na", "b"])).toBe(null);
});

test("a message sent about a task starts with its mark; one about a task the view doesn't know is not sent", async () => {
  const v = View.view_new();
  v.up = true;
  v.tasks = [t1];
  const out = View.view_act(v, { $: "Send", text: "prod, mas só à noite", task: "P1" });
  expect(out.length).toBe(1);
  const body = (out[0] as { body: () => Blob }).body();
  expect(await body.text()).toBe("[Sobre a pendência P1 · Qual ambiente usar?]\nprod, mas só à noite");
  expect(View.view_act(v, { $: "Send", text: "oi", task: "P9" })).toEqual([]);
  expect(v.notes.at(-1)).toContain("P9");
});

test("a turn about one task has it whole after the view, and Unii's answer joins its thread, kept and in the state", async () => {
  const ask = await say(View.task_mark(t1) + "\nqual a diferença?");
  const texts = ask.blocks.map((b) => b.text);
  const about = texts.findIndex((x) => x.startsWith("This turn's messages are about task P1"));
  expect(about).toBe(texts.length - 2); // right before the message, after the view
  expect(texts[about]).toContain("Para o teste de carga.");
  expect(texts[about]).toContain("options: hom | prod");
  const answer = chat.mem.count - 1;
  expect(chat.threads.P1).toEqual([answer]);
  expect(JSON.parse(fs.readFileSync(chat.mem.dir + "/threads.json", "utf8"))).toEqual({ P1: [answer] });
  expect(Chat.state(chat).threads).toEqual({ P1: [answer] });
  expect(Chat.threads_read(chat.mem.dir)).toEqual({ P1: [answer] });
});

test("a turn of another task's message, or of an unmarked one too, has no task and adds to no thread", async () => {
  const before = JSON.stringify(chat.threads);
  const mixed = await say(View.task_mark(t1) + "\na", "outra coisa");
  expect(mixed.blocks.some((b) => b.text.startsWith("This turn's messages are about task"))).toBe(false);
  const plain = await say("bom dia");
  expect(plain.blocks.some((b) => b.text.startsWith("This turn's messages are about task"))).toBe(false);
  expect(JSON.stringify(chat.threads)).toBe(before);
  await say(View.task_mark(t2) + "\nvai");
  expect(chat.threads.P2).toEqual([chat.mem.count - 1]);
});

test("a view's thread of a task: its marked messages and its answers, in order", () => {
  const v = View.view_new();
  v.whole = new Map<number, View.Entry>([
    [1, { kind: "user", text: View.task_mark(t1) + "\nqual a diferença?" }],
    [2, { kind: "unii", text: "hom é o ensaio." }],
    [3, { kind: "user", text: "bom dia" }],
    [4, { kind: "unii", text: "bom dia!" }],
  ]);
  v.threads = { P1: [2] };
  expect(View.task_thread(v, "P1").map((e) => e.id)).toEqual([1, 2]);
  expect(View.task_thread(v, "P2")).toEqual([]);
});
