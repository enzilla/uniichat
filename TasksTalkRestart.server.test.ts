// TasksTalkRestart.server.test
// ============================
// `bun test TasksTalkRestart.server.test.ts`: a task's thread that waits
// for Unii ("aguardando o Unii": the user wrote there) as the server
// starts (Server.ts, Chat.orphans). With no turn to come (none cut to
// resume, no restart's message), it's given back at once as a turn with
// no reply is: "Unii não respondeu", why said in the thread, the move
// whose it was, Unii told next turn; not left waiting for whatever turn
// came next (baixa 2 of the Mesa's second verification). With a turn to
// come, nothing is done: that turn's end answers it (Chat.talked). The
// AI is a fake that answers at once; the chat's dir is the run's.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Memory } from "./Memory.ts";
import { Push } from "./Push.ts";
import { Chat, RESTARTED } from "./Server.ts";
import * as Deps from "./TaskDeps.ts";
import * as Tasks from "./Tasks.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

const ASKED: Ask[] = [];
(AskAI as any).ask = (ask: Ask) => {
  if (ask.blocks.some((b) => b.text.startsWith("Turn: "))) {
    ASKED.push(ask);
  }
  return { send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "", left: [] }) };
};
const DELIVER = Push.deliver;
const PHONE = Push.phones;
(Push as any).deliver = async () => true;
(Push as any).phones = () => {};

// the list as the server before left it: a task of the user's and one
// of Unii's, the user wrote in both threads, no turn ended since; the
// view's state with no work cut, no restart asked
const DIR = config.DIR + "/chat";
const T0 = Date.now() - 20 * 60e3;
fs.mkdirSync(DIR, { recursive: true });
fs.rmSync(DIR + "/restart.json", { force: true });
const saved = Memory.saved(DIR);
if (saved !== null) {
  fs.writeFileSync(DIR + "/view.json", JSON.stringify({ ...saved, work: [] }));
}
Tasks.tasks_forget();
fs.rmSync(DIR + "/tasks.json", { force: true });
const before = Tasks.tasks_load(DIR);
const mine = Tasks.task_new(before, { origin: "chat", title: "Aprovar o PR", choices: ["Mesclar", "Corrigir antes"] }, "main", T0) as Tasks.Task;
const unii = Tasks.task_new(before, { origin: "chat", title: "Corrigir as portas", assignee: "unii", next_step: "relato" }, "main", T0) as Tasks.Task;
const quiet = Tasks.task_new(before, { origin: "chat", title: "Sem conversa" }, "main", T0) as Tasks.Task;
Tasks.task_say(before, mine.id, "Pode resumir?", T0 + 60e3);
Tasks.task_say(before, unii.id, "Andamento?", T0 + 60e3);
expect(before.tasks.filter((t) => t.talk === "unii").length).toBe(2);
Tasks.tasks_forget();

const chat = Chat.open() as any;

afterAll(() => {
  (Push as any).deliver = DELIVER;
  (Push as any).phones = PHONE;
  Tasks.tasks_forget();
  fs.rmSync(DIR + "/tasks.json", { force: true });
});

test("the server starts with no turn to come: each thread waiting for Unii is given back 'Unii não respondeu', why said, the move whose it was, Unii told", () => {
  expect(chat.busy).toBe(false);
  expect(ASKED.length).toBe(0);
  const s = Tasks.tasks_load(DIR);
  expect(s.tasks.some((t) => t.talk === "unii")).toBe(false);
  const m = Tasks.task_find(s, mine.id)!;
  const u = Tasks.task_find(s, unii.id)!;
  for (const t of [m, u]) {
    expect(Deps.task_missed(t)).toBe(true);
    expect(t.thread[t.thread.length - 1]).toMatchObject({ who: "unii", none: true, text: "O Unii não conseguiu responder (" + RESTARTED + "). Escreva de novo aqui para tentar outra vez." });
    expect(View.task_talk_said(t)).toBe(View.MISSED);
  }
  // the user's own stays theirs to decide; Unii's isn't the user's move
  const blocked = Deps.blocked_ids(s.tasks);
  expect(View.desk_group(m, blocked)).toBe("now");
  expect(View.desk_group(u, blocked)).toBe("others");
  // a task never talked about is left as it was
  expect(Tasks.task_find(s, quiet.id)!.thread).toEqual([]);
  // Unii's next turn sees the message still unanswered
  expect(Tasks.task_line(u, Date.now(), true, s.tasks)).toContain("your turn ended with no reply to the user's message in its thread: reply with task_reply");
  // the ficha says it, not "aguardando o Unii"
  const d = Html.desk_html(s.tasks, "", "", m.id, Date.now()).detail.join("");
  expect(d).toContain('<span class="talk missed">Unii não respondeu</span>');
  expect(d).not.toContain("Aguardando o Unii");
  // kept: the list on disk says it too
  Tasks.tasks_forget();
  expect(Deps.task_missed(Tasks.task_find(Tasks.tasks_load(DIR), mine.id)!)).toBe(true);
});

test("with a turn to come (cut and resumed, a restart's message, or one running), the threads are left to its end; a second call gives back nothing", () => {
  const s = Tasks.tasks_load(DIR);
  Tasks.task_say(s, mine.id, "E agora?", Date.now());
  expect(Tasks.task_find(s, mine.id)!.talk).toBe("unii");
  expect(Chat.orphans(chat, true)).toEqual([]);
  chat.busy = true;
  expect(Chat.orphans(chat, false)).toEqual([]);
  chat.busy = false;
  chat.wait.push({ id: 1 });
  expect(Chat.orphans(chat, false)).toEqual([]);
  chat.wait.length = 0;
  expect(Tasks.task_find(s, mine.id)!.talk).toBe("unii");
  // none to come: given back, once
  expect(Chat.orphans(chat, false).map((t) => t.id)).toEqual([mine.id]);
  expect(Chat.orphans(chat, false)).toEqual([]);
});

test("the ficha of a task waiting for Unii says how long, why, and that it hangs on Unii's reply or its turn's end", () => {
  const s = Tasks.tasks_load(DIR);
  Tasks.task_say(s, unii.id, "Tem novidade?", Date.now() - 7 * 60e3);
  const t = Tasks.task_find(s, unii.id)!;
  const said = View.task_turn_said(t, s.tasks, Date.now(), { busy: false, wait: "", limited: false, up: true });
  expect(said.lead).toBe("Aguardando o Unii");
  expect(said.text).toContain("há 7 min");
  expect(said.text).toContain("nenhum turno em andamento");
  expect(said.text).toContain("quando ele responder nesta conversa ou quando o turno dele terminar");
  expect(said.text).toContain("se o servidor reiniciar sem turno a retomar, ela volta marcada “Unii não respondeu”");
});
