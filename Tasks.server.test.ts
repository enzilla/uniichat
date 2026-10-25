// Tasks.server.test
// =================
// `UNII_DIR=$(mktemp -d) bun test Tasks.server.test.ts`: the pending list
// in the server (Server.ts): each turn's block, after "Agents at work
// now" and out of the cached prefix, told once a call ends well; the
// views' state; the user's acts (a note, or with go a turn), done once.
// The AI is a fake that keeps what each call asks and answers at once.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask, type End } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Memory } from "./Memory.ts";
import { Chat } from "./Server.ts";
import * as Tasks from "./Tasks.ts";
import { Tools } from "./Tools.ts";
import * as View from "./View.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}
afterAll(() => fs.rmSync(config.DIR, { recursive: true, force: true }));

// what each turn's call was asked; the next call's end
const ASKED: Ask[] = [];
let END: End = { ok: true, text: "", left: [] };
// what a turn does as it's asked (Unii's reply logged, a tool called)
let DOING: (() => void) | null = null;
(AskAI as any).ask = (ask: Ask) => {
  const turn = ask.blocks.some((b) => b.text.startsWith("Turn: "));
  if (turn) {
    ASKED.push(ask);
    DOING?.();
  }
  const done = Promise.resolve(turn ? END : { ok: true, text: "a summary", left: [] });
  return { send: () => {}, stop: () => {}, wake: () => {}, done };
};

const chat = Chat.open() as any;
const dir = chat.mem.dir;
const s = Tasks.tasks_load(dir);
let n = 0;

// an act as a view sends it, by the apply point (each with an id)
const act = (msg: object, id = "act-" + ++n) => Chat.apply(chat, { id, ...msg }, "");

// till the turn running ends
async function idle(): Promise<void> {
  for (let k = 0; k < 200 && (chat.busy || chat.wait.length > 0); k++) {
    await Bun.sleep(5);
  }
  await Bun.sleep(5);
}

// a user's message, logged and taken, its turn waited on
async function say(text: string): Promise<Ask> {
  const was = ASKED.length;
  await Chat.writing(chat, async () => Chat.take(chat, Chat.push(chat, null, "user", text)));
  await idle();
  expect(ASKED.length).toBe(was + 1);
  return ASKED.at(-1)!;
}

const last = () => Memory.message(chat.mem, chat.mem.count - 1)!;

test("no tasks: an empty block, the turn as before", async () => {
  const ask = await say("olá");
  const k = ask.blocks.findIndex((b) => b.text.startsWith("Agents at work now"));
  expect(ask.blocks[k + 1]).toEqual({ text: "", mark: false });
  expect(ask.blocks[k + 2].text).toStartWith("Turn: the user's new message:");
});

test("the block comes after Agents at work now, unmarked; the cached prefix is the same", async () => {
  const a = await say("primeira");
  Tasks.task_new(s, { title: "Reiniciar o serve", ref: "uniichat" }, "main", Date.now());
  const b = await say("segunda");
  const k = b.blocks.findIndex((x) => x.text.startsWith("Agents at work now"));
  expect(b.blocks[k + 1].mark).toBe(false);
  expect(b.blocks[k + 1].text).toContain("- P1 [user] Reiniciar o serve (ref uniichat, 0m)");
  const marked = (x: Ask) => x.blocks.filter((y) => y.mark).slice(0, -1).map((y) => y.text);
  expect(marked(b).slice(0, marked(a).length - 1)).toEqual(marked(a).slice(0, -1));
});

test("state carries the list", () => {
  const st = Chat.state(chat) as any;
  expect(st.tasks.map((t: Tasks.Task) => t.id)).toEqual(["P1"]);
});

test("done without go: a note, no turn; told by the next turn that ends well", async () => {
  const before = ASKED.length;
  expect(await act({ $: "task", task: "P1", state: "done", note: "reiniciei" })).toEqual({});
  await idle();
  expect(ASKED.length).toBe(before);
  expect(last().kind).toBe("note");
  expect(last().text).toBe('Pendência P1 concluída pelo usuário: “Reiniciar o serve”. Comentário: “reiniciei”.');
  // the same act again (a lost answer): nothing new
  const count = chat.mem.count;
  expect(await act({ $: "task", task: "P1", state: "done", note: "reiniciei" })).toEqual({});
  expect(chat.mem.count).toBe(count);
  // a failed call shows it again
  END = { ok: false, text: "down", left: [] };
  const failed = await say("terceira");
  expect(failed.blocks.map((b) => b.text).join("")).toContain('P1 done by user: "Reiniciar o serve" — note: "reiniciei"');
  expect(Tasks.tasks_untold(s).map((t) => t.id)).toEqual(["P1"]);
  END = { ok: true, text: "", left: [] };
  const ok = await say("quarta");
  expect(ok.blocks.map((b) => b.text).join("")).toContain("P1 done by user");
  expect(Tasks.tasks_untold(s)).toEqual([]);
  const after = await say("quinta");
  expect(after.blocks.map((b) => b.text).join("")).not.toContain("P1 done by user");
});

test("done with go: a [Pendências] message starts a turn; told at once", async () => {
  Tasks.task_new(s, { title: "Abrir o PR?", choices: ["sim", "não"] }, "main", Date.now());
  const before = ASKED.length;
  expect(await act({ $: "task", task: "P2", state: "done", answer: "sim", go: true })).toEqual({});
  await idle();
  expect(ASKED.length).toBe(before + 1);
  const turn = ASKED.at(-1)!.blocks.at(-1)!.text;
  expect(turn).toContain('[Pendências] Pendência P2 concluída pelo usuário: “Abrir o PR?”. Resposta: sim.');
  expect(Tasks.tasks_untold(s)).toEqual([]);
  // done again with go: nothing (told already)
  expect(await act({ $: "task", task: "P2", state: "done", answer: "sim", go: true })).toEqual({});
  await idle();
  expect(ASKED.length).toBe(before + 1);
});

test("a choice it lacks, or no such task: refused", async () => {
  expect(await act({ $: "task", task: "P2", state: "done", answer: "talvez" })).toEqual({ error: 'A pendência P2 não tem a opção "talvez".' });
  expect(await act({ $: "task", task: "P9", state: "done" })).toEqual({ error: "Pendência P9 não encontrada." });
});

test("done, then go on its own: told now; tell with none: refused", async () => {
  Tasks.task_new(s, { title: "Testar o clique" }, "main", Date.now());
  Tasks.task_new(s, { title: "Ler o relatório" }, "main", Date.now());
  await act({ $: "task", task: "P3", state: "dropped" });
  await act({ $: "task", task: "P4", state: "done" });
  const before = ASKED.length;
  expect(await act({ $: "tasks_tell" })).toEqual({});
  await idle();
  expect(ASKED.length).toBe(before + 1);
  const turn = ASKED.at(-1)!.blocks.at(-1)!.text;
  expect(turn).toContain("[Pendências] Pendência P3 descartada pelo usuário");
  expect(turn).toContain("Pendência P4 concluída pelo usuário");
  expect(await act({ $: "tasks_tell" })).toEqual({ error: "Não há pendências resolvidas para avisar." });
  // reopened: a note, as any resolution
  await act({ $: "task", task: "P4", state: "open" });
  expect(last().text).toBe('Pendência P4 reaberta pelo usuário: “Ler o relatório”.');
});

test("views: an act of the person makes the act to send", () => {
  const v = View.view_new();
  v.tasks = Tasks.tasks_view(s, Date.now());
  expect(View.view_act(v, { $: "Task", task: "P4", state: "done", answer: undefined, note: "  ok  ", go: true })).toEqual([{ $: "task", task: "P4", state: "done", note: "ok", go: true }]);
  expect(View.view_act(v, { $: "Task", task: "P2", state: "open" })).toEqual([{ $: "task", task: "P2", state: "open" }]);
  expect(View.view_act(v, { $: "Task", task: "P2", state: "done", answer: "talvez" })).toEqual([]);
  expect(View.view_act(v, { $: "Task", task: "P9", state: "done" })).toEqual([]);
  expect(v.notes).toEqual(["A pendência P2 não tem a opção “talvez”.", "Pendência P9 não encontrada."]);
  expect(View.view_act(v, { $: "TasksTell" })).toEqual([{ $: "tasks_tell" }]);
});

test("terminal words: id, choice by text or number, comment", () => {
  const v = View.view_new();
  v.tasks = Tasks.tasks_view(s, Date.now());
  const args = (a: string, choose = true) => {
    const r = View.task_args(v, a, choose);
    return typeof r === "string" ? r : [r.task.id, r.answer, r.note];
  };
  expect(args("P2 sim pode mesclar")).toEqual(["P2", "sim", "pode mesclar"]);
  expect(args("p2 NÃO")).toEqual(["P2", "não", ""]);
  expect(args("2 2 depois")).toEqual(["P2", "não", "depois"]);
  expect(args("P2 simples assim")).toEqual(["P2", undefined, "simples assim"]);
  expect(args("P4 feito, obrigado")).toEqual(["P4", undefined, "feito, obrigado"]);
  expect(args("P2 sim", false)).toEqual(["P2", undefined, "sim"]);
  expect(args("")).toBe("Qual pendência? Informe o id, como P7.");
  expect(args("P77")).toBe("Pendência P77 não encontrada.");
  expect(args("Px")).toBe("Qual pendência? Informe o id, como P7.");
  // a number none of the choices is: refused, nothing taken as a comment
  expect(args("P2 4")).toBe("Opção 4 inválida: a pendência P2 tem 2 opções (1 a 2). Nada foi alterado.");
  expect(args("P2 0 talvez")).toBe("Opção 0 inválida: a pendência P2 tem 2 opções (1 a 2). Nada foi alterado.");
  expect(args("P2 12")).toBe("Opção 12 inválida: a pendência P2 tem 2 opções (1 a 2). Nada foi alterado.");
  expect(args("P2 1")).toEqual(["P2", "sim", ""]);
  // without choices, a number is a comment; /descartar takes no choice
  expect(args("P4 3 PRs abertos")).toEqual(["P4", undefined, "3 PRs abertos"]);
  expect(args("P2 4", false)).toEqual(["P2", undefined, "4"]);
});

test("terminal footer: ids if they fit, else the count", () => {
  const v = View.view_new();
  v.tasks = Tasks.tasks_view(s, Date.now());
  const open = v.tasks.filter((t) => t.state === "open").length;
  expect(View.tasks_footer(v, 200)).toBe("Pendências: " + open + (open === 1 ? " aberta" : " abertas") + " (" + v.tasks.filter((t) => t.state === "open").map((t) => t.id).join(", ") + ") · /p");
  expect(View.tasks_footer(v, 20)).toBe("Pendências: " + open + " · /p");
  expect(View.tasks_footer(v, 5)).toBe("");
  expect(View.tasks_footer(View.view_new(), 200)).toBe("");
});

test("a resolution that frees another: the freeing is in the next turn's block, told once it ends well", async () => {
  const a = Tasks.task_new(s, { title: "Habilitar o app" }, "main", Date.now()) as Tasks.Task;
  const b = Tasks.task_new(s, { title: "Testar a conexão", who: "unii", after: [a.id] }, "main", Date.now()) as Tasks.Task;
  const v = View.view_new();
  v.tasks = Tasks.tasks_view(s, Date.now());
  expect(View.view_act(v, { $: "Task", task: b.id, state: "done" })).toEqual([]);
  expect(await act({ $: "task", task: b.id, state: "done" })).toEqual({ error: "A pendência " + b.id + " aguarda " + a.id + ": resolva essa pendência antes. Nada foi alterado." });
  await act({ $: "task", task: a.id, state: "done" });
  const block = Tasks.tasks_block(s, Date.now());
  expect(block).toContain("- " + b.id + " freed: every task it waited for (" + a.id + ") is closed");
});

// the Mesa's phase 1: a task's thread and fields
// ==============================================

test("a talk in a task's thread: a marked message of the chat, a turn; Unii's reply back in the thread", async () => {
  const t = Tasks.task_new(s, { title: "Mesclar o #40?" }, "main", Date.now()) as Tasks.Task;
  const before = ASKED.length;
  let during: Tasks.Task | null = null;
  DOING = () => {
    during = { ...Tasks.task_find(s, t.id)! };
    Chat.push(chat, null, "unii", "Ainda não: falta a tag.");
  };
  expect(await act({ $: "task_say", task: t.id, text: "  Posso mesclar?  " }, "say-1")).toEqual({});
  await idle();
  DOING = null;
  expect(ASKED.length).toBe(before + 1);
  const ask = ASKED.at(-1)!;
  expect(ask.blocks.at(-1)!.text).toContain("[Pendência " + t.id + ": “Mesclar o #40?”]\n\nPosso mesclar?");
  expect(ask.blocks.map((b) => b.text).join("")).toContain("Mesclar o #40? [the user wrote in its thread: reply with task_reply]");
  expect(during!.talk).toBe("unii");
  const after = Tasks.task_find(s, t.id)!;
  expect(after.talk).toBe("user");
  expect(after.thread.map((m) => [m.who, m.text])).toEqual([["user", "Posso mesclar?"], ["unii", "Ainda não: falta a tag."]]);
  expect((Chat.state(chat) as any).tasks.find((x: Tasks.Task) => x.id === t.id).talk).toBe("user");
  // the same act again (a lost answer): logged once
  const count = chat.mem.count;
  expect(await act({ $: "task_say", task: t.id, text: "Posso mesclar?" }, "say-1")).toEqual({});
  expect(chat.mem.count).toBe(count);
  // no reply of Unii's (a failed call): said so in the thread, the user's turn
  END = { ok: false, text: "down", left: [] };
  await act({ $: "task_say", task: t.id, text: "E agora?" });
  await idle();
  END = { ok: true, text: "", left: [] };
  // its why said there, not "see the main chat" for a reply that isn't there
  expect(Tasks.task_find(s, t.id)!.thread.at(-1)!.text).toBe("O Unii não conseguiu responder (down). Escreva de novo aqui para tentar outra vez.");
  expect(Tasks.task_find(s, t.id)!.talk).toBe("user");
});

test("Unii's task_reply in the turn: the thread has it once, the turn's last reply not copied", async () => {
  const t = Tasks.task_new(s, { title: "Qual porta?" }, "main", Date.now()) as Tasks.Task;
  DOING = () => {
    Tools.task(chat.tools, "task_reply", { id: t.id, text: "A 8811." }, "main");
    Chat.push(chat, null, "unii", "Respondi na pendência.");
  };
  await act({ $: "task_say", task: t.id, text: "Qual?" });
  await idle();
  DOING = null;
  expect(Tasks.task_find(s, t.id)!.thread.map((m) => m.text)).toEqual(["Qual?", "A 8811."]);
  expect(await act({ $: "task_say", task: t.id, text: "  " })).toEqual({ error: "Escreva uma mensagem." });
  await act({ $: "task", task: t.id, state: "dropped" });
  expect(await act({ $: "task_say", task: t.id, text: "x" })).toEqual({ error: "A pendência " + t.id + " já foi resolvida: reabra-a para conversar sobre ela." });
});

test("fields: a draft is no turn and no note; done refused till the required are answered; then said with the answers", async () => {
  const t = Tasks.task_new(s, { title: "Reiniciar o serve?", fields: [{ id: "quando", label: "Quando", kind: "choice", choices: ["agora", "à noite"] }, { id: "obs", label: "Obs", kind: "text", required: false }] }, "main", Date.now()) as Tasks.Task;
  const before = ASKED.length;
  const count = chat.mem.count;
  expect(await act({ $: "task_draft", task: t.id, fields: { obs: "sem pressa" } })).toEqual({});
  await idle();
  expect([ASKED.length, chat.mem.count]).toEqual([before, count]);
  expect((Chat.state(chat) as any).tasks.find((x: Tasks.Task) => x.id === t.id).draft).toEqual({ obs: "sem pressa" });
  expect(await act({ $: "task_draft", task: t.id, fields: { quando: "amanhã" } })).toEqual({ error: "O campo “Quando” não tem a opção “amanhã”. Opções: agora, à noite." });
  expect(await act({ $: "task", task: t.id, state: "done" })).toEqual({ error: "Responda o campo obrigatório da pendência " + t.id + " antes de concluir: “Quando”. Nada foi alterado." });
  expect(await act({ $: "task", task: t.id, state: "done", fields: { quando: "à noite" }, go: true })).toEqual({});
  await idle();
  expect(ASKED.at(-1)!.blocks.at(-1)!.text).toContain("[Pendências] Pendência " + t.id + " concluída pelo usuário: “Reiniciar o serve?”. Respostas: Quando: à noite; Obs: “sem pressa”.");
});

test("the views' state carries the site's build (a page of another one reloads: main.ts desk_build)", () => {
  const web = (Chat.state(chat) as any).web;
  expect(typeof web).toBe("string");
  expect(web).toMatch(/^[0-9a-z]+\.[0-9a-z]+$/);
  expect((Chat.state(chat) as any).web).toBe(web);
});
