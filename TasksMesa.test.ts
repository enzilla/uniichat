// TasksMesa.test
// ==============
// `bun test TasksMesa.test.ts`: the pending list's hardening (phase 0 of
// the Mesa: the verifiers' ressalvas) and, below, its conversation and
// fields (phase 1), on chats in a temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-mesa-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");
let dir    = "";

beforeEach(() => {
  T.tasks_forget();
  dir = fs.mkdtempSync(ROOT + "/chat-");
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function add(s: T.Store, args: T.Edit, now = NOW): T.Task {
  const t = T.task_new(s, args, "main", now);
  if (typeof t === "string") {
    throw new Error(t);
  }
  return t;
}

function reload(): T.Store {
  T.tasks_forget();
  return T.tasks_load(dir);
}

// Phase 0
// =======

test("task_edit refuses done on a task that waits; dropped goes; done with its after cleared too", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  add(s, { title: "B", after: ["P1"] });
  add(s, { title: "C", after: ["P1"] });
  const no = T.task_edit(s, { id: "P2", state: "done" }, NOW);
  expect(no).toBe("P2 waits for P1, still open: it can't be done before them. Close those first, change its after, or drop it if it no longer applies.");
  expect(T.task_find(s, "P2")!.state).toBe("open");
  expect((T.task_edit(s, { id: "P2", state: "dropped" }, NOW) as T.Task).state).toBe("dropped");
  expect((T.task_edit(s, { id: "P3", state: "done", after: [] }, NOW) as T.Task).state).toBe("done");
});

test("a resolution untold survives Unii's change of state and a restart; told once shown", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Mesclar?", choices: ["sim", "não"] });
  T.task_resolve(s, "P1", "done", "sim", "pode", NOW);
  T.task_edit(s, { id: "P1", state: "open" }, NOW + 1);
  const again = reload();
  const t = T.task_find(again, "P1")!;
  expect([t.state, t.told, t.heard]).toEqual(["open", false, { state: "done", answer: "sim", note: "pode" }]);
  expect(T.tasks_block(again, NOW + 2)).toContain("- P1 done by user: \"Mesclar?\" — answer: sim — note: \"pode\" — since then you made it open");
  expect(T.tasks_told(again)).toBe(1);
  expect(T.task_find(again, "P1")!.heard).toBe(null);
  expect(T.tasks_block(again, NOW + 3)).not.toContain("by user");
});

test("a heard of a hand edit: wrong shapes read as none, told tasks keep none", () => {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ tasks: [
    { id: "P1", title: "A", state: "done", told: false, heard: { state: "x" } },
    { id: "P2", title: "B", state: "done", told: true, heard: { state: "done" } },
    { id: "P3", title: "C", state: "open", told: false, heard: { state: "dropped", note: "\u001b[31mnão\u0007" } },
  ] }));
  const s = T.tasks_load(dir);
  expect(s.tasks.map((t) => t.heard)).toEqual([null, null, { state: "dropped", answer: null, note: "[31mnão" }]);
  expect(T.tasks_block(s, NOW)).toContain("- P3 dropped by user: \"C\" — note: \"[31mnão\" — since then you made it open");
});

test("tasks.json freeing a task that still waits: unfreed, said in the log, the file kept aside", () => {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ tasks: [
    { id: "P1", title: "A" },
    { id: "P2", title: "B", after: ["P1"], freed: true, told: false },
    { id: "P3", title: "C", after: ["P4"], freed: true, told: false },
    { id: "P4", title: "D", state: "done" },
  ] }));
  const s = T.tasks_load(dir);
  const p2 = T.task_find(s, "P2")!;
  expect([p2.freed, p2.told]).toEqual([false, true]);
  const p3 = T.task_find(s, "P3")!;
  expect([p3.freed, p3.told]).toEqual([true, false]);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(true);
  const block = T.tasks_block(s, NOW);
  expect(block).not.toContain("P2 freed");
  expect(block).toContain("P3 freed");
});

test("ids past 9 digits: made and read back; past MAXID: refused, nothing made", () => {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 1000000000, tasks: [{ id: "P999999999", title: "A" }] }));
  const s = T.tasks_load(dir);
  expect(add(s, { title: "B" }).id).toBe("P1000000000");
  const again = reload();
  expect(again.tasks.map((t) => t.id)).toEqual(["P999999999", "P1000000000"]);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(false);
  expect(again.next).toBe(1000000001);
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: T.MAXID + 1, tasks: [] }));
  const full = reload();
  expect(T.task_new(full, { title: "C" }, "main", NOW)).toBe("The list has no ids left (the last is P999999999999999).");
  expect(full.tasks).toEqual([]);
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ tasks: [{ id: "P1000000000000000", title: "too long" }, { id: "P5", title: "ok", after: [3, 5, 1e300] }, { id: "P3", title: "x" }] }));
  const odd = reload();
  expect(odd.tasks.map((t) => t.id)).toEqual(["P5", "P3"]);
  expect(T.task_find(odd, "P5")!.after).toEqual(["P3"]);
});

test("the ✓ never says a bare 0 when some wait; the list says none to resolve now", () => {
  expect(View.tasks_count_said(2, 3)).toBe("2");
  expect(View.tasks_count_said(0, 3)).toBe("+3");
  expect(View.tasks_count_said(0, 0)).toBe("0");
  expect(View.tasks_none_said(0)).toBe("Nenhuma pendência aberta.");
  expect(View.tasks_none_said(2)).toBe("Nenhuma pendência para resolver agora.");
  const s = T.tasks_load(dir);
  add(s, { title: "A", who: "unii" });
  add(s, { title: "B", after: ["P1"] });
  T.task_edit(s, { id: "P1", detail: "x" }, NOW);
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW).filter((t) => t.id === "P2").concat(T.tasks_view(s, NOW).filter((t) => t.id === "P1"));
  expect(View.tasks_md(v)).toContain("**Pendências com o Unii (1)**");
  const only = View.view_new();
  only.tasks = [{ ...T.task_find(s, "P2")!, after: ["P9"] }, { ...T.task_find(s, "P1")!, id: "P9", after: ["P2"], state: "open" }];
  expect(View.tasks_md(only)).toContain("Nenhuma pendência para resolver agora.");
});

// Phase 1: fields
// ===============

const FIELDS = [
  { id: "amb", label: "Ambiente", kind: "choice", choices: ["hom", "prod"] },
  { id: "dias", label: "Dias", kind: "multi", choices: ["seg", "ter", "qua"], required: false },
  { id: "obs", label: "Observação", kind: "text", required: false },
  { id: "ok", label: "Pode reiniciar?", kind: "simnao" },
];

test("fields: read as given, aliases, defaults; each error said, nothing made", () => {
  const got = T.fields_read(FIELDS);
  expect(got.why).toBe(null);
  expect(got.fields.map((f) => [f.id, f.kind, f.required, f.choices.length])).toEqual([["amb", "choice", true, 2], ["dias", "multi", false, 3], ["obs", "text", false, 0], ["ok", "yesno", true, 2]]);
  expect(got.fields[3].choices).toEqual(["sim", "não"]);
  const why = (x: unknown) => T.fields_read(x).why;
  expect(why("x")).toBe("fields is a list of {id, label, kind, choices?, required?}.");
  expect(why([null])).toBe("fields[0] is not an object.");
  expect(why([{ id: "__proto__", label: "x", kind: "text" }])).toContain("id is 1 to 24 letters");
  expect(why([{ id: "a b", label: "x", kind: "text" }])).toContain("id is 1 to 24 letters");
  expect(why([{ id: "a", label: "x", kind: "text" }, { id: "A", label: "y", kind: "text" }])).toBe("Field id A given twice.");
  expect(why([{ id: "a", label: "x", kind: "slider" }])).toBe("Field a: kind is one of choice, multi, text, yesno.");
  expect(why([{ id: "a", label: "x", kind: "constructor" }])).toBe("Field a: kind is one of choice, multi, text, yesno.");
  expect(why([{ id: "a", label: " ", kind: "text" }])).toBe("Field a needs a label.");
  expect(why([{ id: "a", label: "x", kind: "choice", choices: ["só"] }])).toBe("Field a (choice) needs at least 2 choices.");
  expect(why([{ id: "a", label: "x", kind: "multi", choices: "a,b" }])).toBe("Field a: choices is a list of strings.");
  expect(why([{ id: "a", label: "x", kind: "text", required: "sim" }])).toBe("Field a: required is true or false.");
  expect(why(Array.from({ length: 13 }, (_, k) => ({ id: "f" + k, label: "x", kind: "text" })))).toBe("At most 12 fields.");
  const s = T.tasks_load(dir);
  expect(T.task_new(s, { title: "A", fields: [{ id: "a", kind: "text" }] }, "main", NOW)).toBe("Field a needs a label.");
  expect(s.tasks).toEqual([]);
});

test("a draft: answered apart, checked, kept on disk; no change told, no version", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Reiniciar o serve", fields: FIELDS });
  const rev = s.rev;
  expect(T.task_draft(s, "P1", { amb: "prod" })).toMatchObject({ draft: { amb: "prod" } });
  expect(T.task_draft(s, "P1", { dias: ["qua", "seg"], OBS: "  depois das 18h \u001b[1m " })).toMatchObject({ draft: { amb: "prod", dias: ["seg", "qua"], obs: "depois das 18h [1m" } });
  expect(T.task_draft(s, "P1", { amb: "dev" })).toBe("O campo “Ambiente” não tem a opção “dev”. Opções: hom, prod.");
  expect(T.task_draft(s, "P1", { ok: ["sim", "não"] })).toBe("O campo “Pode reiniciar?” espera uma opção.");
  expect(T.task_draft(s, "P1", { obs: 3 })).toBe("O campo “Observação” espera um texto.");
  expect(T.task_draft(s, "P1", { nada: "x" })).toBe("A pendência P1 não tem o campo “nada”.");
  expect(T.task_draft(s, "P1", ["x"])).toBe("Respostas inválidas: informe um objeto com as respostas de cada campo.");
  expect(T.task_draft(s, "P9", {})).toBe("Pendência P9 não encontrada.");
  expect(T.task_draft(s, "P1", { dias: [] })).toMatchObject({ draft: { amb: "prod", obs: "depois das 18h [1m" } });
  const t = T.task_find(s, "P1")!;
  expect([t.told, t.rev, s.rev]).toEqual([true, 0, rev]);
  expect(T.tasks_untold(s)).toEqual([]);
  expect(reload().tasks[0].draft).toEqual({ amb: "prod", obs: "depois das 18h [1m" });
});

test("conclude: the required first (nothing changed), answers given at once, said to Unii and in the chat", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Reiniciar o serve", fields: FIELDS, choices: ["agora", "depois"] });
  T.task_draft(s, "P1", { amb: "hom" });
  expect(T.task_resolve(s, "P1", "done", "agora", null, NOW)).toBe("Responda o campo obrigatório da pendência P1 antes de concluir: “Pode reiniciar?”. Nada foi alterado.");
  expect(T.task_resolve(s, "P1", "done", null, null, NOW, { amb: "" })).toBe("Responda os campos obrigatórios da pendência P1 antes de concluir: “Ambiente”, “Pode reiniciar?”. Nada foi alterado.");
  expect(T.task_resolve(s, "P1", "done", null, null, NOW, { amb: "x" })).toBe("O campo “Ambiente” não tem a opção “x”. Opções: hom, prod. Nada foi alterado.");
  expect(T.task_find(s, "P1")!.state).toBe("open");
  expect(T.task_find(s, "P1")!.draft).toEqual({ amb: "hom" });
  const t = T.task_resolve(s, "P1", "done", "agora", "ok", NOW, { ok: "sim", obs: "à noite" }) as T.Task;
  expect([t.state, t.answers]).toEqual(["done", { amb: "hom", obs: "à noite", ok: "sim" }]);
  expect(T.task_said(t)).toBe("Pendência P1 concluída pelo usuário: “Reiniciar o serve”. Resposta: agora. Respostas: Ambiente: hom; Observação: “à noite”; Pode reiniciar?: sim. Comentário: “ok”.");
  expect(T.tasks_block(s, NOW)).toContain("- P1 done by user: \"Reiniciar o serve\" — answer: agora — fields: Ambiente: hom; Observação: “à noite”; Pode reiniciar?: sim — note: \"ok\"");
  // the same again: nothing
  expect(T.task_resolve(s, "P1", "done", "agora", "ok", NOW, { ok: "sim" })).toBe(null);
  // a draft of a closed one: refused; reopened: answers gone, draft kept
  expect(T.task_draft(s, "P1", { amb: "prod" })).toBe("A pendência P1 já foi resolvida: reabra-a para mudar as respostas.");
  const o = T.task_resolve(s, "P1", "open", null, null, NOW) as T.Task;
  expect([o.answers, o.draft.amb]).toEqual([null, "hom"]);
  // dropped needs nothing answered
  add(s, { title: "Outra", fields: FIELDS });
  expect((T.task_resolve(s, "P2", "dropped", null, null, NOW) as T.Task).answers).toBe(null);
});

test("Unii's edit replaces fields; drafts of fields kept stay, others go; a bad list refused", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A", fields: FIELDS });
  T.task_draft(s, "P1", { amb: "prod", obs: "x", ok: "não" });
  const e = T.task_edit(s, { id: "P1", fields: [FIELDS[0], { id: "ok", label: "Pode?", kind: "choice", choices: ["talvez", "sim"] }, { id: "novo", label: "Novo", kind: "text" }] }, NOW) as T.Task;
  expect(e.fields.map((f) => f.id)).toEqual(["amb", "ok", "novo"]);
  expect(e.draft).toEqual({ amb: "prod" });
  expect(T.task_edit(s, { id: "P1", fields: [{ id: "a" }] }, NOW)).toContain("kind is one of");
  expect((T.task_edit(s, { id: "P1", fields: [] }, NOW) as T.Task).fields).toEqual([]);
  expect(T.task_find(s, "P1")!.draft).toEqual({});
});

test("tasks.json with fields wrong: the sound kept, drafts and threads cleaned, logged, kept aside; nothing breaks", () => {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ tasks: [
    { id: "P1", title: "A", fields: [FIELDS[0], { id: "x", kind: "nope", label: "y" }, "lixo", { id: "amb", label: "dup", kind: "text" }], draft: { amb: "dev", x: "1", __proto__: { polluted: 1 } } },
    { id: "P2", title: "B", fields: "não", draft: "x", answers: 7, thread: [{ who: "user", text: "oi" }, { who: "boss", text: "x" }, { who: "unii", text: "" }, null, { who: "unii", text: "\u001b]8;;http://x\u0007ola" }], talk: "unii" },
    { id: "P3", title: "C", state: "done", fields: [FIELDS[3]], answers: { ok: "sim" }, talk: "user" },
  ] }));
  const s = T.tasks_load(dir);
  expect(s.tasks[0].fields.map((f) => f.id)).toEqual(["amb"]);
  expect(s.tasks[0].draft).toEqual({});
  expect(({} as any).polluted).toBe(undefined);
  expect(s.tasks[1].fields).toEqual([]);
  expect(s.tasks[1].thread.map((m) => [m.who, m.text])).toEqual([["user", "oi"], ["unii", "]8;;http://xola"]]);
  expect(s.tasks[1].talk).toBe("unii");
  expect([s.tasks[2].answers, s.tasks[2].talk]).toEqual([{ ok: "sim" }, null]);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(true);
  expect(T.tasks_block(s, NOW)).toContain("- P1 [user] A fields: amb* \"Ambiente\" (choice: hom | prod)");
  expect(T.tasks_list(s, { id: "P2" }, NOW)).toContain("thread (waiting for your reply):");
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  expect(View.tasks_md(v)).toContain("**aguardando o Unii**");
});

// Phase 1: the thread
// ===================

test("talk: the user writes (Unii's turn), Unii replies (the user's), the turn's end replies for it", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Mesclar o PR?" });
  const a = T.task_say(s, "P1", "  Por que não agora?  ", NOW) as T.Task;
  expect([a.talk, a.thread]).toEqual(["unii", [{ who: "user", text: "Por que não agora?", at: new Date(NOW).toISOString() }]]);
  expect(T.task_mark(a, "Por que não agora?")).toBe("[Pendência P1: “Mesclar o PR?”]\n\nPor que não agora?");
  expect(T.tasks_block(s, NOW)).toContain("- P1 [user] Mesclar o PR? [the user wrote in its thread: reply with task_reply]");
  const b = T.task_reply(s, "P1", "Falta o verificador.", NOW) as T.Task;
  expect([b.talk, b.thread.length]).toEqual(["user", 2]);
  expect(T.tasks_talked(s, "x", NOW)).toEqual([]);
  T.task_say(s, "P1", "E agora?", NOW);
  expect(T.tasks_talked(s, "Agora pode.", NOW).map((t) => t.id)).toEqual(["P1"]);
  expect(T.task_find(s, "P1")!.thread.at(-1)).toMatchObject({ who: "unii", text: "Agora pode." });
  T.task_say(s, "P1", "Ok", NOW);
  T.tasks_talked(s, null, NOW);
  expect(T.task_find(s, "P1")!.thread.at(-1)!.text).toBe("O Unii não respondeu aqui; veja a conversa principal.");
  // no told, no version: a talk isn't a resolution
  expect(T.tasks_untold(s)).toEqual([]);
  expect(reload().tasks[0].thread.length).toBe(6);
});

test("talk refused: closed, empty, too long, no task; Unii's reply to a closed one: no turn to give", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  expect(T.task_say(s, "P1", " \n ", NOW)).toBe("Escreva uma mensagem.");
  expect(T.task_say(s, "P1", "x".repeat(T.TALK + 1), NOW)).toBe("Mensagem longa demais: no máximo 4000 caracteres.");
  expect(T.task_say(s, "P9", "oi", NOW)).toBe("Pendência P9 não encontrada.");
  expect(T.task_reply(s, "P9", "oi", NOW)).toBe("No task P9.");
  expect(T.task_reply(s, "P1", "", NOW)).toBe("A reply needs a text.");
  T.task_say(s, "P1", "oi", NOW);
  T.task_resolve(s, "P1", "done", null, null, NOW);
  expect(T.task_find(s, "P1")!.talk).toBe(null);
  expect(T.task_say(s, "P1", "oi", NOW)).toBe("A pendência P1 já foi resolvida: reabra-a para conversar sobre ela.");
  expect((T.task_reply(s, "P1", "Visto.", NOW) as T.Task).talk).toBe(null);
});

test("a thread keeps THREAD messages; views get the newest VIEW_TALK", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  for (let k = 0; k < T.THREAD + 5; k++) {
    T.task_say(s, "P1", "m" + k, NOW);
  }
  expect(T.task_find(s, "P1")!.thread.length).toBe(T.THREAD);
  expect(T.task_find(s, "P1")!.thread[0].text).toBe("m5");
  const seen = T.tasks_view(s, NOW)[0].thread;
  expect(seen.length).toBe(T.VIEW_TALK);
  expect(seen.at(-1)!.text).toBe("m44");
  expect(T.task_find(s, "P1")!.thread.length).toBe(T.THREAD);
});

// Phase 1: views
// ==============

test("terminal words: fields by id or number, choices by text or number, sim/não, many, quoted texts", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Reiniciar", fields: FIELDS, choices: ["agora", "depois"] });
  add(s, { title: "Sem campos" });
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  const args = (a: string) => {
    const r = View.task_args(v, a, true);
    return typeof r === "string" ? r : [r.answer, r.fields, r.note];
  };
  expect(args("P1 agora 1=prod dias=1,ter 3=\"depois das 18h\" ok=s pode ir")).toEqual(["agora", { amb: "prod", dias: ["seg", "ter"], obs: "depois das 18h", ok: "sim" }, "pode ir"]);
  expect(args("P1 AMB=2 4=não")).toEqual([undefined, { amb: "prod", ok: "não" }, ""]);
  expect(args("P1 obs=“com aspas curvas”")).toEqual([undefined, { obs: "com aspas curvas" }, ""]);
  expect(args("P1 1=dev")).toBe("O campo “Ambiente” não tem a opção “dev”. Opções: 1) hom, 2) prod. Nada foi alterado.");
  expect(args("P1 9=x")).toBe("A pendência P1 não tem o campo “9”. Campos: 1) amb, 2) dias, 3) obs, 4) ok. Nada foi alterado.");
  expect(args("P1 4=talvez")).toContain("não tem a opção “talvez”");
  expect(args("P2 a=b c")).toEqual([undefined, undefined, "a=b c"]);
  const given = View.fields_args(v.tasks[0], "2= obs=");
  expect(given).toEqual({ fields: { dias: [], obs: "" }, rest: " " });
});

test("terminal words: a quote left open or text stuck after the closing one is refused, nothing done", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Reiniciar", fields: FIELDS, choices: ["agora", "depois"] });
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  const open = "O valor de “obs” tem uma aspa sem par: feche as aspas e separe o resto com um espaço. Nada foi alterado.";
  const stuck = "O valor de “obs” tem texto colado depois da aspa de fechamento: feche as aspas e separe o resto com um espaço. Nada foi alterado.";
  expect(View.task_args(v, "P1 obs=\"sem fechar", true)).toBe(open);
  expect(View.task_args(v, "P1 agora obs=\"sem fechar aspas e mais", true)).toBe(open);
  expect(View.task_args(v, "P1 obs=“curva sem fechar", true)).toBe(open);
  expect(View.task_args(v, "P1 obs=\"", true)).toBe(open);
  expect(View.task_args(v, "P1 obs=\"a\"b", true)).toBe(stuck);
  expect(View.task_args(v, "P1 obs=\"a b\"c d", true)).toBe(open);
  expect(View.task_args(v, "P1 3=“a”b", true)).toContain("O valor de “3” tem texto colado");
  // closed ones still pass, also empty and at the end
  const ok = View.task_args(v, "P1 obs=\"\" amb=hom fim", true);
  expect(typeof ok === "string" ? ok : [ok.fields, ok.note]).toEqual([{ obs: "", amb: "hom" }, "fim"]);
  const end = View.task_args(v, "P1 obs=\"a b\"", true);
  expect(typeof end === "string" ? end : end.fields).toEqual({ obs: "a b" });
});

test("views: acts for a draft and a talk; /p shows fields and the thread", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Reiniciar", fields: FIELDS });
  T.task_draft(s, "P1", { amb: "hom" });
  T.task_say(s, "P1", "Precisa mesmo?", NOW);
  T.task_reply(s, "P1", "Sim: **a versão nova**.", NOW);
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  expect(View.view_act(v, { $: "TaskDraft", task: "P1", fields: { amb: "prod" } })).toEqual([{ $: "task_draft", task: "P1", fields: { amb: "prod" } }]);
  expect(View.view_act(v, { $: "TaskSay", task: "P1", text: "  ok  " })).toEqual([{ $: "task_say", task: "P1", text: "ok" }]);
  expect(View.view_act(v, { $: "TaskSay", task: "P1", text: "  " })).toEqual([]);
  expect(View.view_act(v, { $: "TaskSay", task: "P8", text: "x" })).toEqual([]);
  expect(v.notes).toEqual(["Escreva uma mensagem sobre a pendência P1.", "Pendência P8 não encontrada."]);
  expect(View.view_act(v, { $: "Task", task: "P1", state: "done", fields: { ok: "sim" } })).toEqual([{ $: "task", task: "P1", state: "done", fields: { ok: "sim" } }]);
  expect(View.view_act(v, { $: "Task", task: "P1", state: "dropped", fields: { ok: "sim" } })).toEqual([{ $: "task", task: "P1", state: "dropped" }]);
  const md = View.tasks_md(v, v.tasks[0]);
  expect(md).toContain("aberta · com você · sua vez");
  expect(md).toContain("1. Ambiente `amb` (escolha uma: 1) hom  2) prod, obrigatório) — hom");
  expect(md).toContain("2. Dias `dias` (escolha várias: 1) seg  2) ter  3) qua) — _sem resposta_");
  expect(md).toContain("**Conversa** · sua vez");
  expect(md).toContain("- **Unii:** Sim: **a versão nova**.");
  expect(View.tasks_md(v)).toContain("- **P1** Reiniciar · 4 campos · **sua vez**");
});

test("web: fields and thread drawn escaped, drafts checked, whose turn shown; Unii's Markdown without raw HTML", async () => {
  const Html = await import("./web/src/Html.ts");
  const s = T.tasks_load(dir);
  const bad = "<img src=x onerror=alert(1)>\"'";
  add(s, { title: "A", fields: [
    { id: "amb", label: bad, kind: "choice", choices: [bad, "prod"] },
    { id: "dias", label: "Dias", kind: "multi", choices: ["seg", "ter"] },
    { id: "obs", label: "Obs", kind: "text" },
  ] });
  T.task_draft(s, "P1", { amb: bad.slice(0, 80), dias: ["ter"], obs: "</textarea><script>alert(1)</script>" });
  T.task_say(s, "P1", "<b>oi</b>\u001b[31m", NOW);
  T.task_reply(s, "P1", "<script>alert(2)</script> **ok** [x](javascript:alert(3))", NOW);
  const html = Html.tasks_html(T.tasks_view(s, NOW)).open[0];
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<b>oi");
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain("\u001b");
  expect(html).toContain("&lt;/textarea&gt;&lt;script&gt;");
  expect(html).toContain('<input type="checkbox" name="f-P1-dias" value="ter" checked>');
  expect(html).toContain('<input type="checkbox" name="f-P1-dias" value="seg">');
  expect(html).toContain('<span class="talk user">sua vez</span>');
  expect(html).toContain("<strong>ok</strong>");
  expect(html).toContain('<details class="thread" data-keep="thread" open>');
  expect(html).toContain('class="task user talk-user"');
  T.task_say(s, "P1", "e?", NOW);
  expect(Html.tasks_html(T.tasks_view(s, NOW)).open[0]).toContain('<span class="talk unii">aguardando o Unii</span>');
});
