// TasksEvidence.test
// ==================
// `bun test TasksEvidence.test.ts`: the evidence round. No task is closed
// without a concrete, documented solution: Unii's close refused without
// evidence, each type of evidence checked (slack, pr_merged and
// commit_tests read live, tfc, file, reason only to drop; the system's
// own never given); done_when, next_step and acts asked as a task is
// added; an order received (a choice of Unii's) open till executed with
// evidence; the statuses waiting_user and blocked; overdue (the views,
// the block, a push once per due); the closed ones of before marked "sem
// evidência", proven or opened again; a promise without a task. On
// chats in a temporary dir; gh replaced by fakes (Evidence.CHECK).

import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Ev from "./Evidence.ts";
import * as Deps from "./TaskDeps.ts";
import * as TaskPush from "./TaskPush.ts";
import * as T from "./Tasks.ts";
import { Tools, type Tools as Kit } from "./Tools.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-evidence-");
const NOW  = Date.parse("2026-10-26T12:00:00Z");
const H    = 3600e3;
const PR   = "https://github.com/morum/uniichat/pull/20";
const FILE = ROOT + "/relato.md";
let dir    = "";
let tools: Kit;

// what gh answers (Evidence.CHECK): a PR's state, a commit; and what was asked
const CHECK = { ...Ev.CHECK };
let PR_STATE: Ev.PrState | null = { state: "MERGED", merge: "d9105dde1234567890abcdef1234567890abcdef" };
let COMMIT: string | null = "a42d3b3c1234567890abcdef1234567890abcdef";
let ASKED: string[] = [];

beforeEach(() => {
  T.tasks_forget();
  dir = fs.mkdtempSync(ROOT + "/chat-");
  tools = { mem: { dir }, agents: new Map(), hooks: { change: () => {}, note: () => {} } } as unknown as Kit;
  fs.writeFileSync(FILE, "# relato\nfeito\n");
  PR_STATE = { state: "MERGED", merge: "d9105dde1234567890abcdef1234567890abcdef" };
  COMMIT = "a42d3b3c1234567890abcdef1234567890abcdef";
  ASKED = [];
  Ev.CHECK.pr = async (url) => (ASKED.push("pr " + url), PR_STATE);
  Ev.CHECK.commit = async (repo, sha) => (ASKED.push("commit " + repo + "@" + sha), COMMIT);
  Deps.stall_set(Deps.STALL_DEFAULT);
});

afterEach(() => {
  Ev.CHECK.pr = CHECK.pr;
  Ev.CHECK.commit = CHECK.commit;
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const call = (name: string, args: object) => Tools.call(tools, "main", name, args, new AbortController().signal, "x");
const mine = (s: T.Store, title: string, more: object = {}, at = NOW) => T.task_new(s, { title, assignee: "unii", done_when: "feito", next_step: "fazer", ...more }, "main", at) as T.Task;
const theirs = (s: T.Store, title: string, more: object = {}, at = NOW) => T.task_new(s, { title, done_when: "decidido", ...more }, "main", at) as T.Task;
const REASON = { type: "reason", text: "não se aplica mais: o usuário escolheu deixar como está (P79)" };

// Closing needs evidence
// ======================

test("Unii's close without evidence is refused, nothing changed; with it, kept and said", async () => {
  const s = T.tasks_load(dir);
  const t = mine(s, "Responder o Enzo");
  for (const evidence of [undefined, null, "", []]) {
    const no = T.task_edit(s, { id: t.id, state: "done", evidence }, NOW + 1);
    expect(no).toStartWith(t.id + ": Refused: a task is done only with evidence of a concrete, documented solution.");
    expect(no).toContain("Nothing was changed.");
  }
  expect(T.task_edit(s, { id: t.id, state: "dropped" }, NOW + 1)).toContain("reason {text: at least 40 characters} (only to drop)");
  expect(T.task_find(s, t.id)!.state).toBe("open");
  // through the tool too
  const tool = await call("task_edit", { id: t.id, state: "done" });
  expect(tool.fail).toBe(true);
  expect(tool.text).toContain("Refused: a task is done only with evidence");
  // with it: closed, its evidence kept on disk, said in its line
  const ok = await call("task_edit", { id: t.id, state: "done", evidence: { type: "slack", channel: "D0C361HU1R9", ts: "1793020666.223629", summary: "resposta ao Enzo" } });
  expect(ok.fail).toBe(false);
  expect(ok.text).toContain("evidence: slack D0C361HU1R9 1793020666.223629");
  T.tasks_forget();
  const back = T.task_find(T.tasks_load(dir), t.id)!;
  expect(back.evidence).toEqual([{ type: "slack", at: expect.any(String), summary: "resposta ao Enzo", channel: "D0C361HU1R9", ts: "1793020666.223629" }]);
  expect(T.task_unproven(back)).toBe(false);
});

test("slack: the channel's id and the message's ts, a link of that channel if given", () => {
  const r = (e: object) => Ev.evidence_read(e, "done", NOW);
  expect(r({ type: "slack", channel: "#geral", ts: "1793020666.223629" })).toContain("channel is the channel's id");
  expect(r({ type: "slack", channel: "D0C361HU1R9", ts: "ontem" })).toContain("ts is the message's timestamp");
  expect(r({ type: "slack", channel: "D0C361HU1R9", ts: "1793020666.223629", url: "https://evil.com/archives/D0C361HU1R9" })).toContain("url, if given");
  expect(r({ type: "slack", channel: "d0c361hu1r9", ts: "1793020666.223629", url: "https://numih.slack.com/archives/D0C361HU1R9/p1793020666223629" })).toMatchObject([{ channel: "D0C361HU1R9", url: "https://numih.slack.com/archives/D0C361HU1R9/p1793020666223629" }]);
});

test("pr_merged: read live; open, closed or not read is refused; a confirmation given is never taken", async () => {
  const s = T.tasks_load(dir);
  const t = mine(s, "Mesclar a R6");
  PR_STATE = { state: "OPEN", merge: null };
  const open = await call("task_edit", { id: t.id, state: "done", evidence: { type: "pr_merged", url: PR, confirmed: "MERGED abc" } });
  expect(open).toEqual({ text: t.id + ": evidence: pr_merged: " + PR + " is OPEN on GitHub, not merged. Nothing was changed.", fail: true });
  PR_STATE = null;
  expect((await call("task_edit", { id: t.id, state: "done", evidence: { type: "pr_merged", url: PR } })).text).toContain("couldn't be read on GitHub (gh): not confirmed, so refused");
  // the data layer alone (no live check) refuses one not confirmed
  expect(T.task_edit(s, { id: t.id, state: "done", evidence: { type: "pr_merged", url: PR } }, NOW)).toContain("not confirmed merged");
  expect(T.task_find(s, t.id)!.state).toBe("open");
  PR_STATE = { state: "MERGED", merge: "d9105dde1234567890abcdef1234567890abcdef" };
  const ok = await call("task_edit", { id: t.id, state: "done", evidence: { type: "pr_merged", url: PR + "/" } });
  expect(ok.fail).toBe(false);
  expect(ASKED).toEqual(["pr " + PR, "pr " + PR, "pr " + PR]);
  const e = T.task_find(s, t.id)!.evidence[0];
  expect(e).toMatchObject({ type: "pr_merged", url: PR, confirmed: "MERGED d9105dde1234567890abcdef1234567890abcdef" });
  expect(View.evidence_said(e)).toBe("PR mesclado: uniichat#20 (merge d9105dde1234)");
  // not a pull link
  expect(Ev.evidence_read({ type: "pr_merged", url: "https://github.com/morum/uniichat/issues/20", confirmed: "MERGED" }, "done", NOW)).toContain("url is the PR's GitHub link");
});

test("commit_tests: the commit read live, failed 0, at least one passed, the command said", async () => {
  const s = T.tasks_load(dir);
  const t = mine(s, "Corrigir a ressalva");
  const base = { type: "commit_tests", repo: "morum/uniichat", sha: "a42d3b3", command: "bun test", passed: 287, failed: 0 };
  expect(Ev.evidence_read({ ...base, failed: 2, confirmed: "a42d3b3" }, "done", NOW)).toContain("2 test(s) failed: a failing run is no evidence");
  expect(Ev.evidence_read({ ...base, passed: 0, confirmed: "a42d3b3" }, "done", NOW)).toContain("no test passed");
  expect(Ev.evidence_read({ ...base, command: "", confirmed: "a42d3b3" }, "done", NOW)).toContain("command is the test command");
  expect(Ev.evidence_read({ ...base, repo: "uniichat", confirmed: "a42d3b3" }, "done", NOW)).toContain("repo is <owner>/<repo>");
  expect(Ev.evidence_read({ ...base, sha: "zzz", confirmed: "a42d3b3" }, "done", NOW)).toContain("sha is the commit");
  expect(Ev.evidence_read({ ...base, passed: "muitos", confirmed: "a42d3b3" }, "done", NOW)).toContain("passed and failed are the counts");
  COMMIT = null;
  expect((await call("task_edit", { id: t.id, state: "done", evidence: { ...base, confirmed: "a42d3b3" } })).text).toContain("not found on GitHub (gh): not confirmed, so refused");
  COMMIT = "a42d3b3c1234567890abcdef1234567890abcdef";
  const ok = await call("task_edit", { id: t.id, state: "done", evidence: base });
  expect(ok.fail).toBe(false);
  const e = T.task_find(s, t.id)!.evidence[0];
  expect(e).toMatchObject({ type: "commit_tests", repo: "morum/uniichat", sha: "a42d3b3", passed: 287, failed: 0, confirmed: COMMIT });
  expect(View.evidence_said(e)).toBe("Commit a42d3b3 em morum/uniichat: 287 testes passaram, 0 falhas (bun test)");
});

test("tfc: the run's id, applied or planned_and_finished to be done; a drop takes any status", () => {
  expect(Ev.evidence_read({ type: "tfc", run: "run-123", status: "applied" }, "done", NOW)).toContain("run is the run's id");
  expect(Ev.evidence_read({ type: "tfc", run: "run-buHH5YDfjFpk7Uhj", status: "errored" }, "done", NOW)).toContain("status is applied or planned_and_finished");
  expect(Ev.evidence_read({ type: "tfc", run: "run-buHH5YDfjFpk7Uhj", status: "Applied" }, "done", NOW)).toMatchObject([{ type: "tfc", run: "run-buHH5YDfjFpk7Uhj", status: "applied" }]);
  expect(Ev.evidence_read({ type: "tfc", run: "run-buHH5YDfjFpk7Uhj", status: "discarded" }, "dropped", NOW)).toMatchObject([{ status: "discarded" }]);
});

test("file: absolute, existing, a regular file, not empty; its size kept", () => {
  expect(Ev.evidence_read({ type: "file", path: "relato.md" }, "done", NOW)).toContain("path is absolute");
  expect(Ev.evidence_read({ type: "file", path: ROOT + "/nenhum.md" }, "done", NOW)).toContain("doesn't exist on the server's computer");
  expect(Ev.evidence_read({ type: "file", path: ROOT }, "done", NOW)).toContain("is not a regular file");
  fs.writeFileSync(ROOT + "/vazio.md", "");
  expect(Ev.evidence_read({ type: "file", path: ROOT + "/vazio.md" }, "done", NOW)).toContain("is empty");
  const ok = Ev.evidence_read({ type: "file", path: FILE }, "done", NOW) as Ev.Evidence[];
  expect(ok[0]).toMatchObject({ type: "file", path: FILE, size: 15 });
  expect(View.evidence_said(ok[0])).toBe("Arquivo " + FILE + " (15 bytes)");
});

test("reason: only to drop, at least 40 characters; never to be done", () => {
  expect(Ev.evidence_read(REASON, "done", NOW)).toContain("reason only drops a task");
  expect(Ev.evidence_read({ type: "reason", text: "não precisa" }, "dropped", NOW)).toContain("at least 40 characters");
  expect(Ev.evidence_read(REASON, "dropped", NOW)).toMatchObject([{ type: "reason", text: REASON.text }]);
});

test("the system's own (user, restart) and unknown types are never given; at most 5; a list checked whole", () => {
  expect(Ev.evidence_read({ type: "user", answer: "sim" }, "done", NOW)).toContain("recorded by the system only");
  expect(Ev.evidence_read({ type: "restart" }, "done", NOW)).toContain("recorded by the system only");
  expect(Ev.evidence_read({ type: "palavra" }, "done", NOW)).toContain("type is one of slack, pr_merged, commit_tests, tfc, file, reason");
  expect(Ev.evidence_read("feito", "done", NOW)).toContain("each evidence is an object");
  expect(Ev.evidence_read(Array(6).fill({ type: "file", path: FILE }), "done", NOW)).toBe("At most 5 evidences.");
  expect(Ev.evidence_read([{ type: "file", path: FILE }, { type: "file", path: "x" }], "done", NOW)).toStartWith("evidence 2: file: path is absolute");
});

test("evidence on an open task without closing it is refused (on one closed without it, added: see the migration)", () => {
  const s = T.tasks_load(dir);
  const t = mine(s, "Algo");
  expect(T.task_edit(s, { id: t.id, evidence: { type: "file", path: FILE } }, NOW)).toContain("evidence goes with closing a task");
});

// What a task is added with
// =========================

test("task_add needs done_when; one of Unii's its next_step; with choices, acts for every one", async () => {
  expect((await call("task_add", { title: "X", origin: "chat" })).text).toStartWith("Give done_when: what concretely makes this task done");
  expect((await call("task_add", { title: "X", origin: "chat", done_when: "  " })).fail).toBe(true);
  expect((await call("task_add", { title: "X", origin: "chat", done_when: "feito", assignee: "unii" })).text).toStartWith("Give next_step: your next concrete step");
  const half = await call("task_add", { title: "Enviar?", origin: "slack", done_when: "respondido", choices: ["Enviar rascunho", "Eu respondo", "Ignorar"], acts: { "Enviar rascunho": "unii" } });
  expect(half.text).toBe("Give acts for every choice: who acts once it's picked, user (it reports what they did or decided) or unii (an order to you, which stays open as an order received until you close it with evidence). Not said: \"Eu respondo\", \"Ignorar\".");
  const ok = await call("task_add", { title: "Enviar?", origin: "slack", done_when: "respondido no Slack", choices: ["Enviar rascunho", "Eu respondo", "Ignorar"], acts: { "Enviar rascunho": "unii", "Eu respondo": "user", Ignorar: "user" } });
  expect(ok.fail).toBe(false);
  const s = T.tasks_load(dir);
  expect(s.tasks[0].done_when).toBe("respondido no Slack");
  // a restart's template says its acts itself
  expect((await call("task_add", { title: "Reiniciar?", origin: "chat", done_when: "serve reiniciado", kind: "restart" })).fail).toBe(false);
  // whole line: what makes it done
  expect(T.tasks_list(s, { id: s.tasks[0].id }, NOW)).toContain('done when "respondido no Slack"');
});

test("next_due: a time or from now; past or too far refused; a new next step resets it", () => {
  expect(T.due_read("4h", NOW)).toEqual({ v: new Date(NOW + 4 * H).toISOString() });
  expect(T.due_read("30 min", NOW)).toEqual({ v: new Date(NOW + 30 * 60e3).toISOString() });
  expect(T.due_read("2d", NOW)).toEqual({ v: new Date(NOW + 48 * H).toISOString() });
  expect(T.due_read("2026-10-27T14:00:00-03:00", NOW)).toEqual({ v: "2026-10-27T17:00:00.000Z" });
  expect(T.due_read("", NOW)).toEqual({ v: null });
  expect(T.due_read("amanhã", NOW)).toContain("next_due is a time");
  expect(T.due_read("2026-10-20T00:00:00Z", NOW)).toContain("next_due is past");
  expect(T.due_read("60d", NOW)).toContain("at most 30 days ahead");
  const s = T.tasks_load(dir);
  const t = mine(s, "Revisar", { next_due: "1h" });
  expect(t.next_due).toBe(new Date(NOW + H).toISOString());
  const e = T.task_edit(s, { id: t.id, next_step: "outro passo" }, NOW + 10) as T.Task;
  expect([e.next_step, e.next_due]).toEqual(["outro passo", null]);
  expect(Deps.due_at(e)).toBe(new Date(NOW + 10 + Deps.STALL_DEFAULT).toISOString());
});

// An order received
// =================

test("an order: the user's pick of a choice of Unii's leaves it open, Unii's, said as an order; closes only with evidence", () => {
  const s = T.tasks_load(dir);
  const t = theirs(s, "Responder o Enzo?", { choices: ["Enviar rascunho", "Eu respondo"], acts: { "Enviar rascunho": "unii", "Eu respondo": "user" } });
  const r = T.task_resolve(s, t.id, "done", "Enviar rascunho", "manda", NOW) as T.Task;
  expect(r).toMatchObject({ state: "open", assignee: "unii", answer: "Enviar rascunho", order: { answer: "Enviar rascunho", note: "manda" }, evidence: [], closed: null, told: false });
  expect(r.next_step).toBe(T.ORDER_STEP + "Enviar rascunho");
  expect(T.task_ordered(r)).toBe(true);
  expect(T.task_said(r)).toBe("Pendência " + t.id + " recebida como ordem do usuário: “Responder o Enzo?”. Resposta: Enviar rascunho. Essa opção é uma ordem: cabe ao Unii executá-la; a pendência fica com o Unii e só fecha com a evidência da execução. Comentário: “manda”.");
  expect(T.tasks_noted_said([r])).toBe("O usuário resolveu, como dizem as notas acima: " + t.id + " recebida como ordem (Enviar rascunho, ordem ao Unii: só fecha com evidência da execução).");
  expect(T.tasks_block(s, NOW)).toContain("- " + t.id + ' ORDERED by user: "Responder o Enzo?" — answer: Enviar rascunho — note: "manda" (an order: execute it now');
  // the user picking it again: nothing; another choice: refused; Pode fechar: refused
  expect(T.task_resolve(s, t.id, "done", "Enviar rascunho", null, NOW + 1)).toBeNull();
  expect(T.task_resolve(s, t.id, "done", "Eu respondo", null, NOW + 1)).toContain("já é uma ordem sua recebida pelo Unii");
  // Unii can't drop it nor change its answer; done needs evidence
  expect(T.task_edit(s, { id: t.id, state: "dropped", evidence: REASON }, NOW + 2)).toContain("is the user's order (Enviar rascunho): you can't drop it");
  expect(T.task_edit(s, { id: t.id, answer: "Eu respondo" }, NOW + 2)).toContain("its answer can't change");
  expect(T.task_edit(s, { id: t.id, state: "done" }, NOW + 2)).toContain("Refused: a task is done only with evidence");
  const done = T.task_edit(s, { id: t.id, state: "done", evidence: { type: "slack", channel: "D0C361HU1R9", ts: "1793020666.223629" } }, NOW + 3) as T.Task;
  expect(done).toMatchObject({ state: "done", closed_by: "unii", answer: "Enviar rascunho", order: { answer: "Enviar rascunho" } });
  expect(T.task_ordered(done)).toBe(false);
  // read back: the order kept as a record, not ordered once closed
  T.tasks_forget();
  const back = T.task_find(T.tasks_load(dir), t.id)!;
  expect([back.state, back.order?.answer, T.task_ordered(back)]).toEqual(["done", "Enviar rascunho", false]);
});

test("an order: Unii can't hand it to the user (assignee) while it's an order received; nothing changed", async () => {
  const s = T.tasks_load(dir);
  const t = theirs(s, "Responder o Enzo?", { choices: ["Enviar rascunho", "Eu respondo"], acts: { "Enviar rascunho": "unii", "Eu respondo": "user" } });
  T.task_resolve(s, t.id, "done", "Enviar rascunho", null, NOW);
  for (const assignee of ["user", "User "]) {
    const no = T.task_edit(s, { id: t.id, assignee }, NOW + 1);
    expect(no).toBe(t.id + " is the user's order received (Enviar rascunho): it stays yours (assignee unii) till you close it with evidence of the execution. If something of the user's is needed, set status waiting_user (why) or add a task of theirs for it. Nothing was changed.");
  }
  // with other changes in the same edit: refused whole
  expect(T.task_edit(s, { id: t.id, assignee: "user", detail: "outro" }, NOW + 1)).toContain("it stays yours (assignee unii)");
  expect(T.task_find(s, t.id)).toMatchObject({ assignee: "unii", detail: "" });
  // through the tool too
  const tool = await call("task_edit", { id: t.id, assignee: "user" });
  expect(tool.fail).toBe(true);
  // the same assignee, and waiting_user: no hand-over, taken
  expect(typeof T.task_edit(s, { id: t.id, assignee: "unii", detail: "andou" }, NOW + 2)).toBe("object");
  expect(T.task_edit(s, { id: t.id, status: "waiting_user", status_why: "o texto final" }, NOW + 3)).toMatchObject({ assignee: "unii", status: "waiting_user" });
  // closed with evidence, it's no order: the assignee may change again
  T.task_edit(s, { id: t.id, state: "done", evidence: { type: "slack", channel: "D0C361HU1R9", ts: "1793020666.223629" } }, NOW + 4);
  expect(T.task_edit(s, { id: t.id, assignee: "user" }, NOW + 5)).toMatchObject({ assignee: "user", state: "done" });
});

test("an order: the user may cancel it (dropped), their resolution its evidence; reopened, it's no order", () => {
  const s = T.tasks_load(dir);
  const t = theirs(s, "Reenviar?", { choices: ["Reenvie", "Deixe"], acts: { Reenvie: "unii", Deixe: "user" } });
  T.task_resolve(s, t.id, "done", "Reenvie", null, NOW);
  const c = T.task_resolve(s, t.id, "dropped", null, null, NOW + 1) as T.Task;
  expect(c).toMatchObject({ state: "dropped", note: T.CANCEL, closed_by: "user", evidence: [{ type: "user", answer: null, note: T.CANCEL }] });
  const o = T.task_resolve(s, t.id, "open", null, null, NOW + 2) as T.Task;
  expect([o.state, o.order, o.evidence]).toEqual(["open", null, []]);
});

test("the user's resolution of their own task is its evidence; Pode fechar on Unii's too (not on an order)", () => {
  const s = T.tasks_load(dir);
  const a = theirs(s, "Decidir", { choices: ["A", "B"], acts: { A: "user", B: "user" } });
  const r = T.task_resolve(s, a.id, "done", "A", "fica A", NOW) as T.Task;
  expect(r.evidence).toEqual([{ type: "user", at: new Date(NOW).toISOString(), answer: "A", note: "fica A" }]);
  expect(View.evidence_said(r.evidence[0])).toBe("Resolução do usuário: A — “fica A”");
  const u = mine(s, "Acompanhar");
  const c = T.task_resolve(s, u.id, "done", null, null, NOW) as T.Task;
  expect(c).toMatchObject({ state: "done", note: T.CLOSE, evidence: [{ type: "user", note: T.CLOSE }] });
});

test("the web: an order says so, offers Cancelar ordem, not Pode fechar; the terminal says it", () => {
  const s = T.tasks_load(dir);
  const t = theirs(s, "Reiniciar?", { kind: "restart" });
  T.task_resolve(s, t.id, "done", T.RESTART_YES, null, NOW);
  const view = T.tasks_view(s, NOW);
  const html = Html.desk_html(view, "", "", t.id, NOW);
  const all = html.detail.join("");
  expect(all).toContain('<span class="mark order">ordem recebida: Sim, reinicie</span>');
  expect(all).toContain(">Cancelar ordem</button>");
  expect(all).not.toContain(">Pode fechar</button>");
  expect(all).toContain("Ordem recebida: o Unii a executa e só a fecha com a evidência da execução.");
  const v = View.view_new();
  v.tasks = view;
  expect(View.tasks_md(v, view[0])).toContain("aberta · **ordem recebida: Sim, reinicie**");
  expect(View.task_status_said(view[0])).toBe("ordem recebida");
});

// Statuses
// ========

test("blocked: its why and what unblocks it, both needed; waiting_user: Unii's only, its why; the views say each", () => {
  const s = T.tasks_load(dir);
  const t = mine(s, "Aplicar em hom");
  expect(T.task_edit(s, { id: t.id, status: "blocked", status_why: "sem acesso" }, NOW)).toBe("status blocked needs status_why (why it's blocked) and unblock (what unblocks it).");
  expect(T.task_edit(s, { id: t.id, status: "waiting_user" }, NOW)).toContain("status waiting_user needs status_why");
  expect(T.task_edit(s, { id: t.id, status: "order" }, NOW)).toContain("status is one of open, waiting_user, blocked");
  expect(T.task_edit(s, { id: t.id, status_why: "x" }, NOW)).toContain("status_why and unblock go with status");
  const b = T.task_edit(s, { id: t.id, status: "blocked", status_why: "sem acesso ao TFC", unblock: "token do TFC" }, NOW) as T.Task;
  expect([b.status, b.status_why, b.unblock]).toEqual(["blocked", "sem acesso ao TFC", "token do TFC"]);
  expect(View.task_status_said(b)).toBe("bloqueada");
  expect(View.task_marks(b, [b], NOW)).toEqual([["blocked", "bloqueada: sem acesso ao TFC; desbloqueia: token do TFC"]]);
  expect(T.task_line(b, NOW)).toContain('status blocked: "sem acesso ao TFC" unblock: "token do TFC"');
  // a user's task can't wait for the user
  const u = theirs(s, "Minha");
  expect(T.task_edit(s, { id: u.id, status: "waiting_user", status_why: "x" }, NOW)).toContain("is for a task of yours");
  // waiting for the user: in their Agora, counted, pushed as theirs; not overdue
  const w = T.task_edit(s, { id: t.id, status: "waiting_user", status_why: "o gcloud auth login" }, NOW) as T.Task;
  expect([w.status, w.unblock]).toEqual(["waiting_user", null]);
  expect(View.desk_group(w, new Set())).toBe("now");
  expect(TaskPush.actionable(s.tasks)).toContain(w.id);
  expect(TaskPush.turn_count(s.tasks)).toBe(2);
  expect(Deps.due_at(w)).toBeNull();
  expect(Deps.overdue_ids(s.tasks, NOW + 100 * H)).toEqual([]);
  const html = Html.desk_html(T.tasks_view(s, NOW), "", "", w.id, NOW).detail.join("");
  expect(html).toContain("O Unii aguarda você: o gcloud auth login.");
  // handed to the user: no longer waiting for them
  expect((T.task_edit(s, { id: t.id, assignee: "user" }, NOW) as T.Task).status).toBe("open");
  // closed: status open again
  const d = T.task_edit(s, { id: u.id, state: "dropped", evidence: REASON }, NOW) as T.Task;
  expect([d.status, d.status_why]).toEqual(["open", null]);
});

// Overdue
// =======

test("overdue: Unii's open task past its next_due, or STALL after it moved; not the user's, waiting, or blocked by others", () => {
  const s = T.tasks_load(dir);
  const a = mine(s, "Sem prazo");
  const b = mine(s, "Com prazo", { next_due: "1h" });
  const c = theirs(s, "Do usuário");
  const d = mine(s, "Espera", { after: [c.id] });
  expect(Deps.due_at(a)).toBe(new Date(NOW + 4 * H).toISOString());
  expect(Deps.due_at(c)).toBeNull();
  expect(Deps.overdue_ids(s.tasks, NOW + 2 * H)).toEqual([b.id]);
  expect(Deps.overdue_ids(s.tasks, NOW + 5 * H)).toEqual([a.id, b.id]);
  expect(Deps.overdue_ms(s.tasks, d, NOW + 5 * H)).toBe(0);
  // the setting (config task_stall): 1 h
  Deps.stall_set(H);
  expect(Deps.overdue_ids(s.tasks, NOW + 2 * H)).toEqual([a.id, b.id]);
  Deps.stall_set(-1);
  expect(Deps.stall_ms()).toBe(Deps.STALL_DEFAULT);
  // the block says it to Unii; its line too
  const block = T.tasks_block(s, NOW + 5 * H);
  expect(block).toContain("OVERDUE (yours, past their next step's due; the user was alerted): " + a.id + ", " + b.id + ".");
  expect(block).toContain("[unii] Sem prazo (OVERDUE since " + new Date(NOW + 4 * H).toISOString());
  // the views: the due the server sent (tasks_view), the mark
  const view = T.tasks_view(s, NOW + 5 * H);
  expect(view.find((t) => t.id === a.id)!.due).toBe(new Date(NOW + 4 * H).toISOString());
  const marks = View.task_marks(view.find((t) => t.id === a.id)!, view, NOW + 5 * H);
  expect(marks).toEqual([["late overdue", "prazo vencido há 1 h"]]);
  expect(View.task_marks(view.find((t) => t.id === b.id)!, view, NOW + H + 30 * 60e3)).toEqual([["late overdue", "prazo vencido há 30 min"]]);
  const row = Html.desk_html(view, "", "", null, NOW + 5 * H).list.join("");
  expect(row).toContain('<span class="mark late overdue">prazo vencido há 1 h</span>');
  // moved (a real change): due again from then
  T.task_edit(s, { id: a.id, detail: "andou" }, NOW + 5 * H);
  expect(Deps.overdue_ids(s.tasks, NOW + 6 * H)).toEqual([b.id]);
});

test("push: Unii's overdue told once per due, as a stalled push; a new due told again; the first look none", () => {
  const s = T.tasks_load(dir);
  const a = mine(s, "Parada", { next_due: "1h" });
  // the first look: those overdue then taken as told
  let st = TaskPush.step(null, s.tasks, NOW + 2 * H);
  expect(st.send).toEqual([]);
  expect(st.state.alerted).toEqual({ [a.id]: new Date(NOW + H).toISOString() });
  expect(TaskPush.step(st.state, s.tasks, NOW + 3 * H).send).toEqual([]);
  // a new due, past: told once
  T.task_edit(s, { id: a.id, next_due: "30m" }, NOW + 3 * H);
  const b = mine(s, "Outra", { next_due: "10m" }, NOW + 3 * H);
  const got = TaskPush.step(st.state, s.tasks, NOW + 4 * H);
  expect(got.send).toEqual([{ kind: "stalled", ids: [a.id, b.id], text: "Pendências " + a.id + " e " + b.id + " do Unii estão paradas além do prazo", count: 0 }]);
  expect(TaskPush.step(got.state, s.tasks, NOW + 5 * H).send).toEqual([]);
  expect(TaskPush.text("stalled", [a.id])).toBe("Pendência " + a.id + " do Unii está parada além do prazo");
  // kept on disk and read back
  TaskPush.save(dir, got.state);
  expect(TaskPush.load(dir)!.alerted).toEqual(got.state.alerted);
  // closed: forgotten
  T.task_edit(s, { id: a.id, state: "dropped", evidence: REASON }, NOW + 5 * H);
  expect(TaskPush.step(got.state, s.tasks, NOW + 5 * H).state.alerted).toEqual({ [b.id]: new Date(NOW + 3 * H + 10 * 60e3).toISOString() });
});

test("push: a state of before the round (no alerted) takes Unii's overdue as told, no batch; kept as {}; a later one told", () => {
  const s = T.tasks_load(dir);
  const a = mine(s, "Velha", {}, NOW - 30 * H);
  const b = mine(s, "Antiga", {}, NOW - 10 * H);
  expect(Deps.overdue_ids(s.tasks, NOW)).toEqual([a.id, b.id]);
  // as kept before the evidence round: no alerted
  const old: TaskPush.State = { seen: {}, queue: [], since: null, reminded: [], day: "2026-10-26" };
  TaskPush.save(dir, old);
  const read = TaskPush.load(dir)!;
  expect("alerted" in read).toBe(false);
  const first = TaskPush.step(read, s.tasks, NOW);
  expect(first.send).toEqual([]);
  expect(first.state.alerted).toEqual({ [a.id]: Deps.due_at(T.task_find(s, a.id)!)!, [b.id]: Deps.due_at(T.task_find(s, b.id)!)! });
  expect(TaskPush.step(first.state, s.tasks, NOW + H).send).toEqual([]);
  // none overdue: kept as {} (not taken for a state of before again)
  const none = TaskPush.step(old, [], NOW);
  expect(none.state.alerted).toEqual({});
  TaskPush.save(dir, none.state);
  expect(TaskPush.load(dir)!.alerted).toEqual({});
  // one overdue later: told
  const c = mine(s, "Nova", { next_due: "10m" }, NOW);
  const later = TaskPush.step(first.state, s.tasks, NOW + H);
  expect(later.send.map((n) => [n.kind, n.ids])).toEqual([["stalled", [c.id]]]);
});

test("a promise and the tasks moved in its turn: only one related (its id, a word) counts; none given, any", () => {
  const s = T.tasks_load(dir);
  const t = mine(s, "Revisar o ritsu.lock", { ref: "fractal-ritsu", next_step: "ler o diff" }, NOW);
  expect(T.tasks_moved_since(s, NOW)).toBe(true);
  // the verb alone ("revisar") is generic: the subject relates
  expect(T.tasks_moved_since(s, NOW, ["Vou revisar o … em seguida"])).toBe(false);
  expect(T.tasks_moved_since(s, NOW, ["Vou revisar o ritsu.lock em seguida"])).toBe(true);
  expect(T.tasks_moved_since(s, NOW, ["vou conferir o diff"])).toBe(true);
  expect(T.tasks_moved_since(s, NOW, ["Vou responder o Enzo depois"])).toBe(false);
  expect(T.tasks_moved_since(s, NOW, ["vou fechar a " + t.id + " agora"])).toBe(true);
  // fillers and short words relate nothing
  expect(T.tasks_moved_since(s, NOW, ["vou fazer isso agora"])).toBe(false);
  // not moved in the turn: nothing
  expect(T.tasks_moved_since(s, NOW + 1, ["Vou revisar o ritsu.lock"])).toBe(false);
  // generic words relate nothing: a promise about "a pendência" isn't
  // any task saying "pendência"; whole words: "infraestrutura" isn't "infra"
  const g = mine(s, "Pendência do Slack de Morum", { detail: "Uma pendência de infra a conferir", ref: "infra" }, NOW);
  expect(T.tasks_moved_since({ ...s, tasks: [g] }, NOW, ["Vou responder a pendência do Enzo"])).toBe(false);
  expect(T.tasks_moved_since({ ...s, tasks: [g] }, NOW, ["vou revisar a infraestrutura"])).toBe(false);
  expect(T.tasks_moved_since({ ...s, tasks: [g] }, NOW, ["vou ver a pendência de infra"])).toBe(false);
  // a distinct word, whole, or the id: related
  expect(T.tasks_moved_since({ ...s, tasks: [g] }, NOW, ["Vou responder a pendência do Morum"])).toBe(true);
  expect(T.tasks_moved_since({ ...s, tasks: [g] }, NOW, ["vou fechar a " + g.id])).toBe(true);
  // a word's start alone isn't the word: "revisão" isn't "revisar"
  expect(T.tasks_moved_since({ ...s, tasks: [t] }, NOW, ["vou fazer a revisão"])).toBe(false);
});

test("a promise's verbs of action, in any form, relate nothing (BrownOctopus): its subject, a name or the exact id do", () => {
  const s = T.tasks_load(dir);
  const up = mine(s, "Atualizar documentação", { detail: "Verificar relatos dos agentes" }, NOW);
  const only = { ...s, tasks: [up] };
  expect(T.tasks_moved_since(only, NOW, ["Vou atualizar o serviço"])).toBe(false);
  expect(T.tasks_moved_since(only, NOW, ["Vou verificar o relato"])).toBe(false);
  expect(T.tasks_moved_since(only, NOW, ["vou revisar, corrigir e testar o deploy"])).toBe(false);
  expect(T.tasks_moved_since(only, NOW, ["Corrijo e verifico em seguida"])).toBe(false);
  expect(T.tasks_moved_since(only, NOW, ["vou responder e conferir a correção"])).toBe(false);
  expect(T.tasks_moved_since(only, NOW, ["I'll update and check it"])).toBe(false);
  // their subject still relates: "documentação", "relatos", "agentes"
  expect(T.tasks_moved_since(only, NOW, ["Vou atualizar a documentação"])).toBe(true);
  expect(T.tasks_moved_since(only, NOW, ["Vou verificar os relatos"])).toBe(true);
  // a name relates through a generic verb and "pendência"
  const enzo = mine(s, "Slack Enzo: responder sobre os PRs", {}, NOW);
  expect(T.tasks_moved_since({ ...s, tasks: [enzo] }, NOW, ["Vou responder a pendência do Enzo"])).toBe(true);
  // the id, exact: P55 isn't P5, nor P5 P55
  const p5 = { ...up, id: "P5" };
  expect(T.tasks_moved_since({ ...s, tasks: [p5] }, NOW, ["vou fechar a P55"])).toBe(false);
  expect(T.tasks_moved_since({ ...s, tasks: [p5] }, NOW, ["vou fechar a P5"])).toBe(true);
  expect(T.tasks_moved_since({ ...s, tasks: [{ ...up, id: "P55" }] }, NOW, ["vou atualizar a P5 agora"])).toBe(false);
  // the ref isn't compared (NeatFinch): "slack" there relates nothing;
  // in the title, it does (a common noun shared: a known limit)
  const ref = mine(s, "Responder o Enzo sobre os PRs", { ref: "slack" }, NOW);
  expect(T.tasks_moved_since({ ...s, tasks: [ref] }, NOW, ["Vou ajustar o slack"])).toBe(false);
  expect(T.tasks_moved_since({ ...s, tasks: [{ ...ref, ref: "fractal-ritsu" }] }, NOW, ["Vou olhar o fractal-ritsu"])).toBe(false);
  expect(T.tasks_moved_since({ ...s, tasks: [ref] }, NOW, ["Vou responder o Enzo"])).toBe(true);
  expect(T.tasks_moved_since({ ...s, tasks: [{ ...ref, title: "Slack Enzo: responder" }] }, NOW, ["Vou ajustar o slack"])).toBe(true);
  // known limits: a verb out of PROMISE_GENERIC, or a common noun shared, relates
  const doc = mine(s, "Documentar o fluxo de deploy", {}, NOW);
  expect(T.tasks_moved_since({ ...s, tasks: [doc] }, NOW, ["Vou documentar o serviço"])).toBe(true);
  expect(T.promises_said(["vou A", "vou B"])).toBe("Compromisso sem pendência: o Unii disse “vou A”, “vou B” e não registrou nem atualizou, neste turno, nenhuma pendência sua ligada a eles. Unii: registre-os com task_add (assignee unii, next_step e next_due) ou diga que não vai fazê-los.");
});

// The closed ones of before
// =========================

test("migration: closed before the round, the user's own pick (acts user) proven by it; the rest 'sem evidência'; nothing erased", () => {
  const old = (id: string, more: object) => ({ id, title: "t" + id, state: "done", made: "2026-10-20T10:00:00Z", changed: "2026-10-21T10:00:00Z", closed: "2026-10-21T10:00:00Z", ...more });
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 7, rev: 3, tasks: [
    old("P1", { closed_by: "user", answer: "Mesclado", choices: ["Mesclado", "Não"], acts: { Mesclado: "user" }, note: "feito" }),
    old("P2", { closed_by: "user", answer: "Enviar rascunho", choices: ["Enviar rascunho", "Eu respondo"], acts: { "Enviar rascunho": "unii" } }),
    old("P3", { closed_by: "unii", note: "resolvido" }),
    old("P4", { state: "dropped" }),
    old("P5", { closed_by: "user", answer: "Enviar rascunho", choices: ["Enviar rascunho", "Ignorar"] }),
    { id: "P6", title: "aberta", state: "open", made: "2026-10-25T10:00:00Z" },
  ] }));
  const s = T.tasks_load(dir);
  const by = (id: string) => T.task_find(s, id)!;
  expect(by("P1").evidence).toEqual([{ type: "user", at: "2026-10-21T10:00:00.000Z", answer: "Mesclado", note: "feito", migrated: true }]);
  expect(["P2", "P3", "P4", "P5"].map((id) => T.task_unproven(by(id)))).toEqual([true, true, true, true]);
  expect(T.task_unproven(by("P1"))).toBe(false);
  expect(by("P6")).toMatchObject({ state: "open", evidence: [], status: "open", order: null, done_when: null, next_step: null });
  // each kept as it was: titles, notes, answers
  expect([by("P2").answer, by("P3").note]).toEqual(["Enviar rascunho", "resolvido"]);
  // listed for Unii, said in the views
  expect(T.tasks_list(s, { unproven: true }, NOW)).toBe("Closed without evidence (sem evidência; give it with task_edit evidence, or open it again):\n" + ["P2", "P3", "P4", "P5"].map((id) => T.task_line(by(id), NOW)).join("\n"));
  expect(T.task_line(by("P3"), NOW)).toContain("NO EVIDENCE (sem evidência)");
  expect(View.task_marks(by("P3"), s.tasks, NOW)).toEqual([["unproven", "sem evidência"]]);
  const closed = Html.desk_html(s.tasks, "", "", "P3", NOW).detail.join("");
  expect(closed).toContain('<span class="mark unproven">sem evidência</span> Fechada sem evidência registrada. Reabra-a se o problema não foi resolvido.');
  expect(closed).toContain(">Reabrir</button>");
  expect(Html.desk_html(s.tasks, "", "", "P1", NOW).detail.join("")).toContain("<li>Resolução do usuário (registro anterior): Mesclado — “feito”</li>");
  const v = View.view_new();
  v.tasks = s.tasks;
  expect(View.tasks_md(v, by("P3"))).toContain("**Evidência:** nenhuma registrada (sem evidência). `/reabrir P3` reabre.");
  // proven afterwards (evidence added, the close kept), or opened again
  const p = T.task_edit(s, { id: "P3", evidence: { type: "file", path: FILE } }, NOW) as T.Task;
  expect([p.state, p.closed, T.task_unproven(p)]).toEqual(["done", "2026-10-21T10:00:00.000Z", false]);
  const o = T.task_resolve(s, "P2", "open", null, null, NOW) as T.Task;
  expect([o.state, o.evidence, o.order]).toEqual(["open", [], null]);
  // nothing else on disk lost: read again the same
  T.tasks_forget();
  const again = T.tasks_load(dir);
  expect(again.tasks.map((t) => t.id)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
  expect(T.task_find(again, "P3")!.evidence[0]).toMatchObject({ type: "file", path: FILE });
});

test("a view of an older server (no evidence round): made whole, nothing breaks", () => {
  const t = View.task_whole({ id: "P1", title: "x", state: "done", assignee: "user", after: [], fields: [], thread: [], choices: [], draft: {}, origin: null, agent: null, prs: [], acts: {}, made: "2026-10-20T10:00:00Z" });
  expect([t.evidence, t.status, t.order, t.done_when]).toEqual([[], "open", null, null]);
  expect(View.task_unproven(t)).toBe(true);
});

// The inbox
// =========

test("inbox: acts taken (an order to Unii marked by the sorter); a wrong one refused", () => {
  const s = T.tasks_load(dir);
  const got = T.task_inbox(s, { title: "Slack: Enzo", origin: "slack", ref: "slack:D0C361HU1R9", choices: ["Enviar rascunho", "Eu respondo"], acts: { "Enviar rascunho": "unii" } }, NOW) as { task: T.Task };
  expect(got.task.acts).toEqual({ "Enviar rascunho": "unii" });
  expect(T.task_inbox(s, { title: "Slack: B", origin: "slack", ref: "slack:D2", choices: ["A"], acts: { Z: "unii" } }, NOW)).toContain("is not a choice");
  const r = T.task_resolve(s, got.task.id, "done", "Enviar rascunho", null, NOW) as T.Task;
  expect(T.task_ordered(r)).toBe(true);
});

// Promises
// ========

test("a promise for later is found ('vou revisar', 'em seguida', 'I'll'); not a condition, a question, code, nor what's past", () => {
  expect(T.promises_in("Vou conferir se sobrou algum processo preso e encerrá-lo.")).toEqual(["Vou conferir se sobrou algum processo preso e encerrá-lo"]);
  expect(T.promises_in("Prometi: eu vou revisar e assinar em seguida.")).toEqual(["eu vou revisar e assinar em seguida"]);
  expect(T.promises_in("I'll check the DLQ tomorrow.")).toEqual(["I'll check the DLQ tomorrow"]);
  expect(T.promises_in("Ainda não fiz o rascunho da resposta ao Enzo (P76).")).toEqual([]);
  expect(T.promises_in("Se quiser, vou implementar.")).toEqual([]);
  expect(T.promises_in("Você vai gostar?")).toEqual([]);
  expect(T.promises_in("Rodei `vou fazer` no código.\n```\nvou fazer\n```")).toEqual([]);
  expect(T.promises_in("Vamos lá.")).toEqual([]);
  expect(T.promises_in("Vou A. Vou fazer B. Vou revisar C. Vou testar D. Vou mesclar E.")).toHaveLength(3);
  expect(T.promises_said(["vou revisar"])).toBe("Compromisso sem pendência: o Unii disse “vou revisar” e não registrou nem atualizou, neste turno, nenhuma pendência sua ligada a ele. Unii: registre-o com task_add (assignee unii, next_step e next_due) ou diga que não vai fazê-lo.");
  const s = T.tasks_load(dir);
  expect(T.tasks_moved_since(s, NOW)).toBe(false);
  theirs(s, "Do usuário", {}, NOW + 1);
  expect(T.tasks_moved_since(s, NOW)).toBe(false);
  mine(s, "Minha", {}, NOW + 1);
  expect(T.tasks_moved_since(s, NOW)).toBe(true);
});

test("a view's act on an order: Concluir refused (only evidence closes it), Cancelar (dropped) sent", () => {
  const s = T.tasks_load(dir);
  const t = theirs(s, "Reenviar?", { choices: ["Reenvie", "Deixe"], acts: { Reenvie: "unii", Deixe: "user" } });
  T.task_resolve(s, t.id, "done", "Reenvie", null, NOW);
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  expect(View.view_act(v, { $: "Task", task: t.id, state: "done" })).toEqual([]);
  expect(v.notes.at(-1)).toBe("A pendência " + t.id + " é uma ordem sua já recebida pelo Unii: ela só fecha com a evidência da execução. Para desistir dela, cancele-a (/descartar " + t.id + ").");
  expect(View.view_act(v, { $: "Task", task: t.id, state: "dropped" })).toEqual([{ $: "task", task: t.id, state: "dropped" }]);
  // one of Unii's that's no order: still no drop by the user
  const u = mine(s, "Minha");
  v.tasks = T.tasks_view(s, NOW);
  expect(View.view_act(v, { $: "Task", task: u.id, state: "dropped" })).toEqual([]);
});

test("a restart's order taken as one to restart now: the template's yes, or its own words with no wait", () => {
  expect(T.restart_now(T.RESTART_YES)).toBe(true);
  expect(T.restart_now("sim, REINICIE")).toBe(true);
  expect(T.restart_now("Reinicie agora")).toBe(true);
  expect(T.restart_now("Pode reiniciar")).toBe(true);
  expect(T.restart_now("Reinicie depois dos agentes")).toBe(false);
  expect(T.restart_now("Reinicie após os agentes terminarem")).toBe(false);
  expect(T.restart_now("Reinicie quando o GrandDove acabar")).toBe(false);
  expect(T.restart_now("Reinicie amanhã")).toBe(false);
  expect(T.restart_now("Não reinicie")).toBe(false);
  expect(T.restart_now(T.RESTART_LATER)).toBe(false);
  expect(T.restart_now("Mesclar o PR")).toBe(false);
  expect(T.restart_now(null)).toBe(false);
});

test("a restart for later (BrownOctopus): a time or an event to wait for keeps the order open; its own words with no wait are now", () => {
  expect(T.restart_now("Reinicie e avise")).toBe(true);
  expect(T.restart_now("Sim, pode reiniciar agora")).toBe(true);
  expect(T.restart_now("Reinicia já")).toBe(true);
  expect(T.restart_now("Restart now")).toBe(true);
  // a time or an event to wait for: later, the order stays open
  for (const later of ["Reinicie às 22h", "Reinicie as 22h", "Reinicie às 22:30", "Reinicie 22h30", "Reinicie ao terminar o PR", "Reinicie em 1 hora", "Reinicie em uma hora", "Reinicie em 30 minutos", "Reinicie daqui a pouco", "Reinicie assim que os agentes acabarem", "Reinicie logo que o GrandDove terminar", "Reinicie ao fim do dia", "Reinicie à tarde", "Reinicie quando puder", "Reinicie até as 18h", "Espere e reinicie", "Reinicie depois", "Restart at 10", "Restart in an hour", "Restart once the agents finish", "Restart as soon as they're done"]) {
    expect([later, T.restart_now(later)]).toEqual([later, false]);
  }
});

test("a restart for a day, a time in words or a condition (NeatFinch) stays open; a wait denied is now", () => {
  for (const later of ["Reinicie ao meio-dia", "Reinicie ao meio dia", "Reinicie à meia-noite", "Reinicie às dez", "Reinicie às três e meia", "Reinicie na sexta", "Reinicie segunda-feira", "Reinicie no sábado", "Reinicie no fim de semana", "Reinicie dia 27", "Reinicie no dia 27", "Reinicie em 27/10", "Reinicie e aguarde", "Aguarde e reinicie", "Reinicie se puder", "Reinicie se der", "Reinicie se possível", "Restart at noon", "Restart on friday", "Restart if you can", "Restart at ten"]) {
    expect([later, T.restart_now(later)]).toEqual([later, false]);
  }
  for (const now of ["Reiniciar sem esperar", "Reinicie, não espere", "Reinicie sem aguardar", "Não espere, reinicie", "Reinicie, nem aguarde os agentes", "Restart, don't wait", "Restart without waiting"]) {
    expect([now, T.restart_now(now)]).toEqual([now, true]);
  }
  // a wait denied doesn't hide another: still later, or no restart at all
  expect(T.restart_now("Reinicie sem esperar, mas às 22h")).toBe(false);
  expect(T.restart_now("Não espere: reinicie na sexta")).toBe(false);
  expect(T.restart_now("Não reinicie, espere")).toBe(false);
  expect(T.restart_now("Sem esperar")).toBe(false);
  // a known limit: "não depois" reads as a wait (the safe side: open)
  expect(T.restart_now("Reinicie já, não depois")).toBe(false);
});

test("a restart for a part of the day, a vague later, an ordinal date or 'à uma' (SnowyPigeon) stays open", () => {
  for (const later of ["Reinicie de manhã", "Reinicie pela manhã", "Reinicie de madrugada", "Reinicie cedo", "Reinicie mais cedo", "Reinicie ao anoitecer", "Reinicie ao amanhecer", "Reinicie em breve", "Reinicie logo mais", "Restart on the 27th", "Restart on the 1st", "Restart in the morning", "Restart this evening", "Restart shortly", "Reinicie à uma", "Reinicie a uma", "Reinicie à uma e meia", "Reinicie à 1"]) {
    expect([later, T.restart_now(later)]).toEqual([later, false]);
  }
  // the words of now still hold: no false wait from the new ones
  for (const now of ["Reinicie agora", "Reiniciar sem esperar", "Reinicie, não espere", "Restart, don't wait", "Reinicie já", "Pode reiniciar", "Restart now"]) {
    expect([now, T.restart_now(now)]).toEqual([now, true]);
  }
  // a known limit: a trailing "não" reads as a refusal (the safe side: open)
  expect(T.restart_now("Reinicie sem esperar não")).toBe(false);
  // a known limit: "a" is also the article (the safe side: open)
  expect(T.restart_now("Reinicie a uma instância")).toBe(false);
});
