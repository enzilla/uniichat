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
import { Chat, TELL } from "./Server.ts";
import * as Tasks from "./Tasks.ts";
import { Tools } from "./Tools.ts";
import * as View from "./View.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}
// emptied, not removed: a flush (Disk.ts) syncs the dir itself, and
// may come later; TestSetup.ts removes it as the run ends
afterAll(() => {
  fs.rmSync(config.DIR, { recursive: true, force: true });
  fs.mkdirSync(config.DIR, { recursive: true });
});

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

// P1 (25/10/2026): the user's resolutions reach Unii on their own, in
// one "[Pendências]" message once TELL.ms pass from the first
test("resolutions without go: told on their own, together, once the wait ends; none left told meanwhile: nothing", async () => {
  await idle();
  clearTimeout(chat.tell);
  chat.tell = undefined;
  Tasks.tasks_tell(s);
  const was = TELL.ms;
  TELL.ms = 60;
  try {
    const a = Tasks.task_new(s, { title: "Lote A", choices: ["Sim, reinicie", "Depois"] }, "main", Date.now()) as Tasks.Task;
    const b = Tasks.task_new(s, { title: "Lote B" }, "main", Date.now()) as Tasks.Task;
    const before = ASKED.length;
    expect(await act({ $: "task", task: a.id, state: "done", answer: "Sim, reinicie" })).toEqual({});
    expect(await act({ $: "task", task: b.id, state: "dropped" })).toEqual({});
    expect(chat.tell).toBeDefined();
    // no turn yet: only the notes
    expect(ASKED.length).toBe(before);
    await Bun.sleep(120);
    await idle();
    expect(ASKED.length).toBe(before + 1);
    const turn = ASKED.at(-1)!.blocks.at(-1)!.text;
    // the batch names them only (R4): their whole text is in the notes before it
    expect(turn).toContain("[Pendências] O usuário resolveu, como dizem as notas acima: " + a.id + " concluída (Sim, reinicie); " + b.id + " descartada.");
    expect(turn).not.toContain("“Lote A”");
    const notes = [Memory.message(chat.mem, chat.mem.count - 3)!, Memory.message(chat.mem, chat.mem.count - 2)!].map((m) => m.kind + ": " + m.text);
    expect(notes).toEqual(["note: Pendência " + a.id + " concluída pelo usuário: “Lote A”. Resposta: Sim, reinicie.", "note: Pendência " + b.id + " descartada pelo usuário: “Lote B”."]);
    expect(Tasks.tasks_untold(s)).toEqual([]);
    expect(chat.tell).toBeUndefined();
    // told meanwhile ("Avisar o Unii agora"): the wait ends with nothing
    const c = Tasks.task_new(s, { title: "Lote C" }, "main", Date.now()) as Tasks.Task;
    await act({ $: "task", task: c.id, state: "done" });
    expect(await act({ $: "tasks_tell" })).toEqual({});
    await idle();
    const told = ASKED.length;
    await Bun.sleep(120);
    await idle();
    expect(ASKED.length).toBe(told);
  } finally {
    TELL.ms = was;
  }
});

// R2 (GreenWasp): the wait is each chat's own, not the module's: one
// chat's wait running holds no other's back
test("tell_soon: each chat its own wait (one running doesn't stop another's)", () => {
  clearTimeout(chat.tell);
  chat.tell = undefined;
  const other = { ...chat, tell: undefined } as any;
  try {
    Chat.tell_soon(other);
    expect(other.tell).toBeDefined();
    expect(chat.tell).toBeUndefined();
    Chat.tell_soon(chat);
    expect(chat.tell).toBeDefined();
    expect(chat.tell).not.toBe(other.tell);
    // a second call while one waits: the same wait
    const was = chat.tell;
    Chat.tell_soon(chat);
    expect(chat.tell).toBe(was);
  } finally {
    clearTimeout(other.tell);
    clearTimeout(chat.tell);
    chat.tell = undefined;
  }
});

// R4: those left untold by a server before may have no note: told whole
test("tell_soon for those left untold at start (noted false): the batch says them whole", async () => {
  await idle();
  clearTimeout(chat.tell);
  chat.tell = undefined;
  Tasks.tasks_tell(s);
  const was = TELL.ms;
  TELL.ms = 30;
  try {
    const a = Tasks.task_new(s, { title: "Antes do reinício", choices: ["Sim", "Não"] }, "main", Date.now()) as Tasks.Task;
    // resolved, as a server that stopped before its note and its batch
    Tasks.task_resolve(s, a.id, "done", "Sim", null, Date.now());
    const before = ASKED.length;
    Chat.tell_soon(chat, false);
    await Bun.sleep(80);
    await idle();
    expect(ASKED.length).toBe(before + 1);
    expect(ASKED.at(-1)!.blocks.at(-1)!.text).toContain("[Pendências] Pendência " + a.id + " concluída pelo usuário: “Antes do reinício”. Resposta: Sim.");
  } finally {
    TELL.ms = was;
    clearTimeout(chat.tell);
    chat.tell = undefined;
  }
});

// P6 (25/10/2026): on a task of Unii's, the user only asks after it or
// tells Unii to close it
test("a task of Unii's: dropping refused; Pode fechar closes it, said so; Cobrar agora is a message in its thread", async () => {
  clearTimeout(chat.tell);
  chat.tell = undefined;
  const u = Tasks.task_new(s, { title: "Acompanhar a leva", assignee: "unii", agent: "WiseDolphin", fields: [{ id: "x", label: "X", kind: "text" }] }, "main", Date.now()) as Tasks.Task;
  expect(await act({ $: "task", task: u.id, state: "dropped" })).toEqual({ error: "A pendência " + u.id + " está com o Unii: use “Cobrar agora” ou “Pode fechar”. Nada foi alterado." });
  const v = View.view_new();
  v.tasks = Tasks.tasks_view(s, Date.now());
  expect(View.view_act(v, { $: "Task", task: u.id, state: "dropped" })).toEqual([]);
  expect(View.view_act(v, { $: "TaskSay", task: u.id, text: View.CHASE })).toEqual([{ $: "task_say", task: u.id, text: View.CHASE }]);
  const before = ASKED.length;
  expect(await act({ $: "task_say", task: u.id, text: View.CHASE })).toEqual({});
  await idle();
  expect(ASKED.length).toBe(before + 1);
  expect(ASKED.at(-1)!.blocks.at(-1)!.text).toContain(View.CHASE);
  // the required field doesn't hold Pode fechar back; no comment: "Pode fechar"
  expect(await act({ $: "task", task: u.id, state: "done" })).toEqual({});
  const t = Tasks.task_find(s, u.id)!;
  expect(t.state).toBe("done");
  expect(t.note).toBe(Tasks.CLOSE);
  expect(last().text).toBe("Pendência " + u.id + " concluída pelo usuário: “Acompanhar a leva”. Comentário: “Pode fechar”.");
  clearTimeout(chat.tell);
  chat.tell = undefined;
});

// R5: an option that's an order to Unii (acts) tells it at once, with no
// "Avisar" and no wait for the minute's batch
test("acts: picking an option of Unii's starts its turn at once, said as an order; a report option waits for the batch", async () => {
  clearTimeout(chat.tell);
  chat.tell = undefined;
  const r = Tasks.task_new(s, { title: "Reiniciar com agentes rodando?", kind: "restart" }, "main", Date.now()) as Tasks.Task;
  expect(r.choices).toEqual([Tasks.RESTART_YES, Tasks.RESTART_LATER]);
  const before = ASKED.length;
  expect(await act({ $: "task", task: r.id, state: "done", answer: Tasks.RESTART_YES })).toEqual({});
  await idle();
  expect(ASKED.length).toBe(before + 1);
  expect(ASKED.at(-1)!.blocks.at(-1)!.text).toContain("[Pendências] Pendência " + r.id + " concluída pelo usuário: “Reiniciar com agentes rodando?”. Resposta: Sim, reinicie. Essa opção é uma ordem: cabe ao Unii executá-la.");
  expect(chat.tell).toBeUndefined();
  const l = Tasks.task_new(s, { title: "Reiniciar depois?", kind: "restart" }, "main", Date.now()) as Tasks.Task;
  const mid = ASKED.length;
  expect(await act({ $: "task", task: l.id, state: "done", answer: Tasks.RESTART_LATER })).toEqual({});
  await idle();
  expect(ASKED.length).toBe(mid);
  expect(chat.tell).not.toBeUndefined();
  clearTimeout(chat.tell);
  chat.tell = undefined;
});

// R5 (P8): a restart Unii asked, taken as the server starts: said in the
// chat and its resume a message that starts Unii's turn, once
test("restart: the mark taken at start says it's back and starts a turn with what to resume, once", async () => {
  const Restart = await import("./Restart.ts");
  // asked by another process (pid), before this one started: its restart
  Restart.mark_write(dir, { why: "aplicar a R5", resume: "Conferir o serve e seguir com a R6.", at: new Date(Date.now() - process.uptime() * 1000 - 2000).toISOString(), agents: [], task: null, done: false, used: [], pid: process.pid + 1 });
  const before = ASKED.length;
  Chat.back(chat);
  await idle();
  expect(ASKED.length).toBe(before + 1);
  expect(ASKED.at(-1)!.blocks.at(-1)!.text).toContain("[Restart] The serve restarted as you asked");
  expect(ASKED.at(-1)!.blocks.at(-1)!.text).toContain("Resume now: Conferir o serve e seguir com a R6.");
  Chat.back(chat);
  await idle();
  expect(ASKED.length).toBe(before + 1);
  expect(Restart.mark_read(dir)!.done).toBe(true);
});
