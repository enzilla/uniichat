// TasksAsk.server.test
// ====================
// `UNII_DIR=$(mktemp -d) bun test TasksAsk.server.test.ts`: the trava
// of P87 in the server (Server.ts, Chat.asked). A whole turn (Chat.turn,
// the model's call faked) whose last reply asks the user something with
// no task of the user's about it: the serve makes one, "Pergunta sem
// pendência", and a note says so; with one, or with no question,
// nothing; with one about something else, still one. Push.deliver and
// Push.phones are fakes.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Memory } from "./Memory.ts";
import { Push } from "./Push.ts";
import { Chat } from "./Server.ts";
import * as Tasks from "./Tasks.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

(AskAI as any).ask = () => ({ send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "", left: [] }) });
const DELIVER = Push.deliver;
const PHONE = Push.phones;
(Push as any).deliver = async () => true;
(Push as any).phones = () => {};

const chat = Chat.open() as any;
const dir = chat.mem.dir;
Tasks.tasks_forget();
fs.rmSync(dir + "/tasks.json", { force: true });

afterAll(() => {
  (Push as any).deliver = DELIVER;
  (Push as any).phones = PHONE;
  Tasks.tasks_forget();
  fs.rmSync(dir + "/tasks.json", { force: true });
});

const last = () => Memory.message(chat.mem, chat.mem.count - 1)!;
const asked = () => Tasks.tasks_load(dir).tasks.filter((t) => t.state === "open" && t.title === Tasks.ASKED_TITLE);

// a whole turn, as the server runs it, whose call does `act` (tools,
// say) and then replies `reply`
async function turn(reply: string, act: () => void = () => {}): Promise<void> {
  const CALL = Chat.call;
  (Chat as any).call = async (c: any) => {
    c.wait = [];
    act();
    await Chat.writing(c, async () => Chat.push(c, null, "unii", reply));
    return false;
  };
  try {
    chat.wait = [{ id: -1 }];
    await Chat.turn(chat);
  } finally {
    (Chat as any).call = CALL;
  }
  await Bun.sleep(20);
}

test("a turn ending in a question to the user with no task of theirs: the serve makes one and says so", async () => {
  await turn("Os três estão aprovados, sem ressalvas. Quer que eu mescle como admin e crie as tags?");
  const made = asked();
  expect(made).toHaveLength(1);
  const t = made[0];
  expect([t.assignee, t.origin, t.kind, t.by]).toEqual(["user", "chat", "decision", "trava"]);
  expect(t.detail).toContain("“Quer que eu mescle como admin e crie as tags?”");
  expect(last().kind).toBe("note");
  expect(last().text).toStartWith("Pergunta sem pendência: o Unii perguntou “Quer que eu mescle como admin e crie as tags?”");
  expect(last().text).toContain("Registrei na " + t.id);
  // the next question, while that one is open: added to it, no other
  await turn("Aguardo sua ordem para aplicar o #1127.");
  expect(asked()).toHaveLength(1);
  expect(asked()[0].detail).toContain("“Aguardo sua ordem para aplicar o #1127.”");
  Tasks.task_resolve(Tasks.tasks_load(dir), t.id, "dropped", null, null, Date.now());
});

test("with a task of the user's made in the turn, or no question, nothing", async () => {
  let count = chat.mem.count;
  await turn("Abri a decisão. Quer que eu mescle?", () => {
    Tasks.task_new(Tasks.tasks_load(dir), { title: "Mesclar os três?", origin: "chat", kind: "decision", choices: ["Sim", "Não"] }, "main", Date.now());
  });
  expect(chat.mem.count).toBe(count + 1);
  expect(last().kind).toBe("unii");
  expect(asked()).toHaveLength(0);
  // a question tied by id to an open task of the user's, not moved now
  const open = Tasks.tasks_load(dir).tasks.find((t) => t.title === "Mesclar os três?")!;
  count = chat.mem.count;
  await turn("A " + open.id + " segue aberta: mesclo os três?");
  expect(chat.mem.count).toBe(count + 1);
  // a task of Unii's only: still a note and a task
  await turn("Mesclei. E o deploy, faço hoje?", () => {
    Tasks.task_new(Tasks.tasks_load(dir), { title: "Conferir o CI", assignee: "unii", done_when: "CI lido", next_step: "ler" }, "main", Date.now());
  });
  expect(asked()).toHaveLength(1);
  expect(last().text).toStartWith("Pergunta sem pendência: o Unii perguntou “E o deploy, faço hoje?”");
  Tasks.task_resolve(Tasks.tasks_load(dir), asked()[0].id, "dropped", null, null, Date.now());
  // no question; a question in code or quoted; one Unii answers itself
  count = chat.mem.count;
  await turn("Mesclei os três e criei as tags.");
  await turn("O Enzo perguntou: “vc tem um agente escutando os prs?”. Respondi que não.");
  await turn("Por que travou? Porque o lint falhou.\n```\nread -p 'Continuar?'\n```");
  expect(chat.mem.count).toBe(count + 3);
  expect(asked()).toHaveLength(0);
});

test("a task of the user's about something else, made in the turn, doesn't spare the question (B2)", async () => {
  await turn("Abri a assinatura do lock. Quer que eu mescle o hospitalar?", () => {
    Tasks.task_new(Tasks.tasks_load(dir), { title: "Assinar o ritsu.lock", origin: "chat", choices: ["Assinei", "Depois"] }, "main", Date.now());
  });
  expect(asked()).toHaveLength(1);
  expect(last().kind).toBe("note");
  expect(last().text).toStartWith("Pergunta sem pendência: o Unii perguntou “Quer que eu mescle o hospitalar?”");
  Tasks.task_resolve(Tasks.tasks_load(dir), asked()[0].id, "dropped", null, null, Date.now());
  for (const t of Tasks.tasks_load(dir).tasks.filter((x) => x.state === "open" && x.title === "Assinar o ritsu.lock")) {
    Tasks.task_resolve(Tasks.tasks_load(dir), t.id, "dropped", null, null, Date.now());
  }
});

test("a reply in a task's thread (the user wrote there) is that task's: nothing", async () => {
  const s = Tasks.tasks_load(dir);
  const t = Tasks.task_new(s, { title: "Aprovar o PR", origin: "chat", choices: ["Mesclar", "Corrigir antes"] }, "main", Date.now() - 60e3) as Tasks.Task;
  Tasks.task_say(s, t.id, "Pode resumir?", Date.now() - 30e3);
  const count = chat.mem.count;
  await turn("Resumo: CI verde, verificação limpa. Mesclo?");
  expect(chat.mem.count).toBe(count + 1);
  expect(asked()).toHaveLength(0);
  expect(Tasks.tasks_load(dir).tasks.find((x) => x.id === t.id)!.thread.at(-1)!.text).toBe("Resumo: CI verde, verificação limpa. Mesclo?");
});

test("a turn halted (a note last): nothing", async () => {
  const count = chat.mem.count;
  Chat.push(chat, null, "unii", "Quer que eu mescle?");
  Chat.push(chat, null, "note", "Stopped by the user: Unii's turn.");
  Chat.asked(chat, Date.now(), Chat.reply(chat));
  await Bun.sleep(20);
  expect(chat.mem.count).toBe(count + 2);
  expect(asked()).toHaveLength(0);
});
