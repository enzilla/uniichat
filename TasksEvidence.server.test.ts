// TasksEvidence.server.test
// =========================
// `UNII_DIR=$(mktemp -d) bun test TasksEvidence.server.test.ts`: the
// evidence round in the server (Server.ts): a promise for later with no
// task of Unii's gets a note (Chat.promised); a restart the user ordered
// closes its order with the serve back as evidence (Chat.back); a task
// of Unii's past its due is pushed once as stalled (Chat.task_push).
// Push.deliver and Push.phones are fakes that keep what they get.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Memory } from "./Memory.ts";
import { Push } from "./Push.ts";
import * as Restart from "./Restart.ts";
import { Chat } from "./Server.ts";
import * as TaskPush from "./TaskPush.ts";
import * as Tasks from "./Tasks.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

// the AI: a fake that answers each call at once (an order and a restart
// start turns), keeping the turns asked
const ASKED: Ask[] = [];
(AskAI as any).ask = (ask: Ask) => {
  if (ask.blocks.some((b) => b.text.startsWith("Turn: "))) {
    ASKED.push(ask);
  }
  return { send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "", left: [] }) };
};

const GOT: { text: string; more: any }[] = [];
const PHONES: string[] = [];
const DELIVER = Push.deliver;
const PHONE = Push.phones;
(Push as any).deliver = async (_db: unknown, text: string, more: any, done: Set<string>) => {
  GOT.push({ text, more });
  done.add("https://a.example/1");
  return true;
};
(Push as any).phones = (_db: unknown, text: string) => PHONES.push(text);

const chat = Chat.open() as any;
const dir = chat.mem.dir;

// the chat's list and what was told left as found: the other files of a
// whole run share this chat's dir
afterAll(() => {
  (Push as any).deliver = DELIVER;
  (Push as any).phones = PHONE;
  Tasks.tasks_forget();
  fs.rmSync(dir + "/tasks.json", { force: true });
  fs.rmSync(dir + TaskPush.FILE, { force: true });
  fs.rmSync(dir + "/restart.json", { force: true });
});

const last = () => Memory.message(chat.mem, chat.mem.count - 1)!;
const settle = () => Bun.sleep(20);

test("a turn ending in a promise with no task of Unii's made or moved gets a note; with one, none", async () => {
  const began = Date.now();
  Chat.push(chat, null, "unii", "Registrei a P79. Vou revisar o `spec/ritsu.lock` em seguida.");
  Chat.promised(chat, began);
  await settle();
  expect(last().kind).toBe("note");
  expect(last().text).toStartWith("Compromisso sem pendência: o Unii disse “Vou revisar o … em seguida”");
  // a reply with no promise: nothing
  const count = chat.mem.count;
  Chat.push(chat, null, "unii", "Feito: P77 fechada com a evidência do commit.");
  Chat.promised(chat, Date.now());
  await settle();
  expect(chat.mem.count).toBe(count + 1);
  // the promise registered as a task of Unii's in the turn: nothing
  const now = Date.now();
  const s = Tasks.tasks_load(dir);
  Tasks.task_new(s, { title: "Revisar o ritsu.lock", assignee: "unii", done_when: "assinatura entregue", next_step: "revisar o diff" }, "main", now);
  Chat.push(chat, null, "unii", "Vou revisar o diff agora.");
  const was = chat.mem.count;
  Chat.promised(chat, now);
  await settle();
  expect(chat.mem.count).toBe(was);
});

test("a promise with a task of Unii's moved in the turn but unrelated to it still gets a note", async () => {
  const now = Date.now();
  const s = Tasks.tasks_load(dir);
  Tasks.task_new(s, { title: "Conferir DLQ de hom", assignee: "unii", done_when: "DLQs lidas", next_step: "ler as filas" }, "main", now);
  Chat.push(chat, null, "unii", "Vou responder o Enzo em seguida.");
  Chat.promised(chat, now);
  await settle();
  expect(last().kind).toBe("note");
  expect(last().text).toContain("nenhuma pendência sua ligada a ele");
});

test("a restart the user ordered: once the serve is back, its order is closed, the restart its evidence", async () => {
  const s = Tasks.tasks_load(dir);
  const t = Tasks.task_new(s, { title: "Reiniciar com agentes rodando?", kind: "restart", done_when: "serve reiniciado" }, "main", Date.now()) as Tasks.Task;
  expect(await Chat.apply(chat, { id: "act-order", $: "task", task: t.id, state: "done", answer: Tasks.RESTART_YES }, "")).toEqual({});
  expect(Tasks.task_ordered(Tasks.task_find(s, t.id)!)).toBe(true);
  await settle();
  expect(ASKED.at(-1)!.blocks.at(-1)!.text).toContain("recebida como ordem do usuário");
  // asked by another process (pid), before this one started, for this task
  Restart.mark_write(dir, { why: "aplicar a rodada de evidência", resume: "Seguir.", at: new Date(Date.now() - process.uptime() * 1000 - 2000).toISOString(), agents: ["CalmCow"], task: t.id, done: false, used: [t.id], pid: process.pid + 1 });
  Chat.back(chat);
  await settle();
  const done = Tasks.task_find(Tasks.tasks_load(dir), t.id)!;
  expect(done).toMatchObject({ state: "done", closed_by: "unii", evidence: [{ type: "restart" }] });
  expect(done.evidence[0].summary).toContain("o serve voltou (pid " + process.pid + ")");
});

test("a task of Unii's past its due is pushed once as stalled, to the phones and the browsers; not again", async () => {
  const s = Tasks.tasks_load(dir);
  const t0 = Date.now();
  await Chat.task_push(chat, t0);
  const t = Tasks.task_new(s, { title: "Conferir o Job", assignee: "unii", done_when: "Job conferido", next_step: "ler o log", next_due: "10m" }, "main", t0) as Tasks.Task;
  GOT.length = 0;
  PHONES.length = 0;
  await Chat.task_push(chat, t0 + 11 * 60e3);
  expect(GOT.map((g) => g.text)).toEqual(["Pendência " + t.id + " do Unii está parada além do prazo"]);
  expect(PHONES).toEqual(["Pendência " + t.id + " do Unii está parada além do prazo"]);
  expect(GOT[0].more).toMatchObject({ kind: "tasks", ids: [t.id] });
  await Chat.task_push(chat, t0 + 20 * 60e3);
  expect(GOT.length).toBe(1);
});

test("a restart with no task given (no agents): the orders of a restart received before it are closed, a later one not", async () => {
  const s = Tasks.tasks_load(dir);
  const a = Tasks.task_new(s, { title: "Reiniciar o serve?", kind: "restart", done_when: "serve reiniciado" }, "main", Date.now()) as Tasks.Task;
  expect(await Chat.apply(chat, { id: "act-order-a", $: "task", task: a.id, state: "done", answer: Tasks.RESTART_YES }, "")).toEqual({});
  expect(Tasks.task_ordered(Tasks.task_find(s, a.id)!)).toBe(true);
  await settle();
  // the restart asked by the process before (before this one started),
  // a's order received before it (as kept on disk), b's after it
  const start = Date.now() - process.uptime() * 1000;
  const at = new Date(start - 2000).toISOString();
  Tasks.task_find(s, a.id)!.order!.at = new Date(start - 5000).toISOString();
  Tasks.tasks_save(s);
  const b = Tasks.task_new(s, { title: "Reiniciar de novo?", kind: "restart", done_when: "serve reiniciado" }, "main", Date.now()) as Tasks.Task;
  expect(await Chat.apply(chat, { id: "act-order-b", $: "task", task: b.id, state: "done", answer: Tasks.RESTART_YES }, "")).toEqual({});
  await settle();
  Restart.mark_write(dir, { why: "sem agentes", resume: "Seguir.", at, agents: [], task: null, done: false, used: [], pid: process.pid + 1 });
  Chat.back(chat);
  await settle();
  const after = Tasks.tasks_load(dir);
  expect(Tasks.task_find(after, a.id)).toMatchObject({ state: "done", closed_by: "unii", evidence: [{ type: "restart" }] });
  expect(Tasks.task_ordered(Tasks.task_find(after, b.id)!)).toBe(true);
});
