// TasksAsk.test
// =============
// `bun test TasksAsk.test.ts`: the questions to the user a reply holds
// (Tasks.questions_in, P87), what isn't one, and the task a question
// without one gets (Tasks.task_asked, tasks_asked_since).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as T from "./Tasks.ts";

const asks = (text: string, ids: string[] = []) => T.questions_in(text, new Set(ids));

test("a question put to the user counts", () => {
  expect(asks("Os três estão aprovados. Quer que eu mescle como admin e crie as tags?")).toEqual(["Quer que eu mescle como admin e crie as tags?"]);
  expect(asks("Posso mesclar o hospitalar#649?")).toEqual(["Posso mesclar o hospitalar#649?"]);
  expect(asks("Mesclo agora?")).toEqual(["Mesclo agora?"]);
  expect(asks("Sigo com o deploy em hom ou prefere esperar?")).toEqual(["Sigo com o deploy em hom ou prefere esperar?"]);
  expect(asks("Qual opção você prefere, A ou B?")).toEqual(["Qual opção você prefere, A ou B?"]);
  expect(asks("Que tal mesclar só o auth?")).toEqual(["Que tal mesclar só o auth?"]);
  expect(asks("Mesclo o auth#306 (tag server/v0.2.0-beta.85)?")).toEqual(["Mesclo o auth#306 (tag server/v0.2.0-beta.85)?"]);
  expect(asks("Should I merge it?")).toEqual(["Should I merge it?"]);
});

test("a request in words, without a question mark, counts", () => {
  expect(asks("Tudo pronto. Aguardo sua ordem para mesclar.")).toEqual(["Aguardo sua ordem para mesclar."]);
  expect(asks("Me diga se posso seguir.")).toEqual(["Me diga se posso seguir."]);
  expect(asks("O merge admin e as tags dependem de ordem sua.")).toEqual(["O merge admin e as tags dependem de ordem sua."]);
  expect(asks("Se quiser, posso montar o agente.")).toEqual(["Se quiser, posso montar o agente."]);
  expect(asks("Preciso da sua decisão sobre o prazo.")).toEqual(["Preciso da sua decisão sobre o prazo."]);
  expect(asks("Let me know when to restart.")).toEqual(["Let me know when to restart."]);
});

test("what isn't a question to the user: none", () => {
  // a question Unii asks itself and answers
  expect(asks("Por que travou? Porque o lint falhou no head novo.")).toEqual([]);
  expect(asks("O que mudou? O filtro de Kind.")).toEqual([]);
  // quoted: in a block quote, in quotes, in code
  expect(asks("> Quer que eu mescle?\n\nFeito.")).toEqual([]);
  expect(asks("O Enzo escreveu “vc tem um agente escutando os prs?” e respondi.")).toEqual([]);
  expect(asks("Rodei:\n```\nread -p 'Continuar?' x\n```\nPassou.")).toEqual([]);
  expect(asks("O teste `deve mesclar?` passou.")).toEqual([]);
  // a heading
  expect(asks("## Posso mesclar?\nNão: falta o CI.")).toEqual([]);
  // another's question reported
  expect(asks("O Enzo perguntou: você tem um agente escutando os PRs? Respondi que não.")).toEqual([]);
  // plain statements, promises, past
  expect(asks("Mesclei os três e criei as tags. P48 fechada com evidência.")).toEqual([]);
  expect(asks("Vou revisar o diff em seguida.")).toEqual([]);
  expect(asks("Você pediu reinício e não há agentes ativos.")).toEqual([]);
});

test("a question tied by id to an open task of the user's is that task's", () => {
  expect(asks("A P86 segue aberta: mesclo os três como admin?", ["P86"])).toEqual([]);
  // the id of a task not open (or not the user's): still a question
  expect(asks("A P86 segue aberta: mesclo os três como admin?", ["P85"])).toEqual(["A P86 segue aberta: mesclo os três como admin?"]);
  // another paragraph: still a question
  expect(asks("Abri a P86.\n\nE o deploy, faço hoje?", ["P86"])).toEqual(["E o deploy, faço hoje?"]);
});

test("at most 3, each once", () => {
  expect(asks("Mesclo? Mesclo? Aplico? Reinicio? Publico?")).toEqual(["Mesclo?", "Aplico?", "Reinicio?"]);
});

test("a question without a task gets one of the user's: a decision from the chat, a text field; one open gets the next added", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const now = Date.now();
  expect(T.tasks_asked_since(s, now)).toBe(false);
  const t = T.task_asked(s, ["Quer que eu mescle?"], now) as T.Task;
  expect(t.title).toBe(T.ASKED_TITLE);
  expect(t.assignee).toBe("user");
  expect(t.origin).toBe("chat");
  expect(t.kind).toBe("decision");
  expect(t.fields.map((f) => [f.id, f.kind, f.required])).toEqual([["resposta", "text", true]]);
  expect(t.detail).toContain("“Quer que eu mescle?”");
  expect(T.tasks_asked_since(s, now)).toBe(true);
  const u = T.task_asked(s, ["Aplico em hom?"], now + 1000) as T.Task;
  expect(u.id).toBe(t.id);
  expect(u.detail).toContain("“Aplico em hom?”");
  expect(s.tasks.filter((x) => x.state === "open")).toHaveLength(1);
  // a task of Unii's moved: not the user's question's
  const later = now + 60e3;
  T.task_new(s, { title: "Conferir CI", assignee: "unii", done_when: "CI lido", next_step: "ler" }, "main", later);
  expect(T.tasks_asked_since(s, later)).toBe(false);
  // Unii talked in a thread of the user's: it is
  T.task_reply(s, t.id, "Mesclo?", later + 10);
  expect(T.tasks_asked_since(s, later)).toBe(true);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the note says the task made, or why none", () => {
  const t = { id: "P9" } as T.Task;
  expect(T.questions_said(["Mesclo?"], t)).toStartWith("Pergunta sem pendência: o Unii perguntou “Mesclo?” sem abrir nem atualizar, neste turno, uma pendência sua. Registrei na P9");
  expect(T.questions_said(["Mesclo?"], "The list has 100 open tasks")).toContain("não foi possível abri-la");
});
