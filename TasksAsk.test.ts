// TasksAsk.test
// =============
// `bun test TasksAsk.test.ts`: the questions to the user a reply holds
// (Tasks.questions_in, P87), what isn't one, and the task a question
// without one gets (Tasks.task_asked), and when a task of the user's is
// the question's (Tasks.question_tasked).

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

test("common requests to the user count (M1)", () => {
  const one = (x: string) => expect(asks(x)).toEqual([x]);
  one("Unii perguntou se mescla os três (depende de ordem).");
  one("O merge e as tags dependem de ordem.");
  one("Aguardando decisão.");
  one("Aguardando sua resposta.");
  one("Fico no aguardo.");
  one("Qual opção?");
  one("Qual?");
  one("Você decide.");
  one("Diga qual prefere.");
  one("Preciso que você decida.");
  one("Preciso de decisão sua: mesclar ou esperar.");
  one("Falta só a sua aprovação.");
  one("Pode confirmar o merge");
  one("Quando quiser, aplico.");
  expect(asks("Opções: (a) mesclar agora; (b) esperar o CI. Qual?")).toEqual(["Qual?"]);
  // another's order, decision, answer: not the user's
  expect(asks("O deploy depende de ordem do Enzo.")).toEqual([]);
  expect(asks("Aguardando resposta do Enzo no Slack.")).toEqual([]);
  expect(asks("Preciso da aprovação do comitê antes.")).toEqual([]);
});

test("what isn't asked of the user: none (B1)", () => {
  expect(asks("Perguntei ao Enzo se quer que eu mescle.")).toEqual([]);
  expect(asks("O Enzo quer que eu mescle?")).toEqual([]);
  expect(asks("Alguém sabe por que falhou?")).toEqual([]);
  expect(asks("Você já viu o que houve? Foi o lint.")).toEqual([]);
  expect(asks("Você viu o que houve? Foi o lint.")).toEqual([]);
  expect(asks("Não testado: hom?")).toEqual([]);
  // but to the user still, with a word to them, or said last
  expect(asks("O Enzo quer que eu mescle; você concorda?")).toEqual(["O Enzo quer que eu mescle; você concorda?"]);
  expect(asks("O lint passou. Você viu o PR #22?")).toEqual(["Você viu o PR #22?"]);
  expect(asks("A P86 segue aberta; mesclo?")).toEqual(["A P86 segue aberta; mesclo?"]);
  expect(asks("Pergunto se você quer que eu mescle.")).toEqual(["Pergunto se você quer que eu mescle."]);
});

test("a request negated just before it asks nothing (P87 #2, B1)", () => {
  expect(asks("Não depende de ordem sua.")).toEqual([]);
  expect(asks("Isso não depende de você.")).toEqual([]);
  expect(asks("Nenhum agente depende de ordem.")).toEqual([]);
  expect(asks("Ele nem depende de você.")).toEqual([]);
  expect(asks("Não cabe a você decidir.")).toEqual([]);
  // the negation of another clause, or further before, doesn't cancel it
  expect(asks("Não mesclei porque aguardo sua ordem.")).toEqual(["Não mesclei porque aguardo sua ordem."]);
  expect(asks("Não, você decide.")).toEqual(["Não, você decide."]);
  expect(asks("Isso não depende de ordem sua, mas preciso da sua decisão sobre o prazo.")).toEqual(["Isso não depende de ordem sua, mas preciso da sua decisão sobre o prazo."]);
  // what asks still does
  expect(asks("O merge e as tags dependem de ordem.")).toEqual(["O merge e as tags dependem de ordem."]);
  expect(asks("Depende de você.")).toEqual(["Depende de você."]);
});

test("short confirmations, \"Me avise\", whose call it is, and the user's name ask (P87 #2, B2)", () => {
  const one = (x: string, names: string[] = []) => expect(T.questions_in(x, new Set(), names)).toEqual([x]);
  one("Ok?");
  one("Vale?");
  one("Pode ser?");
  one("Me avise.");
  one("Me avise quando puder.");
  one("Quem decide é você.");
  one("Cabe a você decidir.");
  one("Depende da ordem do Guilherme.", ["Guilherme"]);
  one("Aguardando resposta do Guilherme.", ["Guilherme"]);
  expect(asks("Mesclo agora. Ok?")).toEqual(["Ok?"]);
  // the user's name unknown (no owner_name): another's, as before
  expect(asks("Depende da ordem do Guilherme.")).toEqual([]);
  // another's still not, with the user's name known
  const none = (x: string) => expect(T.questions_in(x, new Set(), ["Guilherme"])).toEqual([]);
  none("O deploy depende de ordem do Enzo.");
  none("Depende da ordem do Enzo, não do Guilherme.");
  none("Aguardando resposta do Enzo");
  none("O Enzo me avisou.");
  // the false positives fixed before stay fixed
  none("O Enzo quer que eu mescle?");
  none("Alguém sabe por que falhou?");
  none("Não testado: hom?");
  none("depende de ordem do Enzo");
});

test("known limits, kept as documented (P87 #2, B3 and B4)", () => {
  // B3: "Rodei x? ok.": two words and "?", read as a question
  expect(asks("Rodei x? ok.")).toEqual(["Rodei x?"]);
  // B4: question_tasked: a word in common with an unrelated task of the
  // user's made in the turn spares a question
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const now = Date.now();
  T.task_new(s, { title: "Revisar o hospitalar#700", origin: "chat" }, "main", now + 10);
  expect(T.question_tasked(s, "Quer que eu mescle o hospitalar?", now)).toBe(true);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
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
  expect(T.question_tasked(s, "Quer que eu mescle?", now)).toBe(false);
  const t = T.task_asked(s, ["Quer que eu mescle?"], now) as T.Task;
  expect(t.title).toBe(T.ASKED_TITLE);
  expect(t.assignee).toBe("user");
  expect(t.origin).toBe("chat");
  expect(t.kind).toBe("decision");
  expect(t.fields.map((f) => [f.id, f.kind, f.required])).toEqual([["resposta", "text", true]]);
  expect(t.detail).toContain("“Quer que eu mescle?”");
  expect(T.question_tasked(s, "Quer que eu mescle?", now)).toBe(true);
  const u = T.task_asked(s, ["Aplico em hom?"], now + 1000) as T.Task;
  expect(u.id).toBe(t.id);
  expect(u.detail).toContain("“Aplico em hom?”");
  expect(s.tasks.filter((x) => x.state === "open")).toHaveLength(1);
  // a task of Unii's made: not the user's question's
  const later = now + 60e3;
  T.task_new(s, { title: "Conferir o deploy", assignee: "unii", done_when: "CI lido", next_step: "ler" }, "main", later);
  expect(T.question_tasked(s, "Faço o deploy hoje?", later)).toBe(false);
  // Unii said it in a thread of the user's: it is
  T.task_reply(s, t.id, "CI verde. Faço o deploy hoje?", later + 10);
  expect(T.question_tasked(s, "Faço o deploy hoje?", later)).toBe(true);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("only a task of the user's about the question spares it (B2)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const before = Date.now() - 3600e3;
  const old = T.task_new(s, { title: "Mesclar o hospitalar#649?", origin: "chat", kind: "decision", choices: ["Sim", "Não"] }, "main", before) as T.Task;
  const now = Date.now();
  // made before the turn, even about it, and moved in it: the id in the
  // paragraph ties it (questions_in), the words don't
  T.task_edit(s, { id: old.id, detail: "Mesclar o hospitalar agora?" }, now + 5);
  expect(T.question_tasked(s, "Quer que eu mescle o hospitalar?", now)).toBe(false);
  // made in the turn, about something else
  T.task_new(s, { title: "Assinar o ritsu.lock", detail: "Rode o comando de assinatura.", origin: "chat" }, "main", now + 10);
  expect(T.question_tasked(s, "Quer que eu mescle o hospitalar?", now)).toBe(false);
  // made in the turn, about it (words in common: "mescl", "hospi")
  T.task_new(s, { title: "Mesclar o hospitalar#649 como admin?", origin: "chat", kind: "decision", choices: ["Sim", "Não"] }, "main", now + 20);
  expect(T.question_tasked(s, "Quer que eu mescle o hospitalar?", now)).toBe(true);
  // made in the turn but Unii's: not
  T.task_new(s, { title: "Aplicar o infra#1127", assignee: "unii", done_when: "aplicado", next_step: "aplicar" }, "main", now + 30);
  expect(T.question_tasked(s, "Aplico o infra#1127?", now)).toBe(false);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the note says the task made, or why none", () => {
  const t = { id: "P9" } as T.Task;
  expect(T.questions_said(["Mesclo?"], t)).toStartWith("Pergunta sem pendência: o Unii perguntou “Mesclo?” sem abrir nem atualizar, neste turno, uma pendência sua. Registrei na P9");
  expect(T.questions_said(["Mesclo?"], "The list has 100 open tasks")).toContain("não foi possível abri-la");
});
