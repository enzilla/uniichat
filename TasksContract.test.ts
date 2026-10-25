// TasksContract.test
// ==================
// `bun test TasksContract.test.ts`: UX round 5, the task's contract
// (R5): kind (pr, decision, test, action, restart, info), prs as
// verified (a PR's approval without its link and head refused), acts by
// option, waits_for, a ref of the list's fronts, origin given (never the
// turn's), the restart's template and tool (P8), and how the views and
// the terminal show them. On chats in a temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Restart from "./Restart.ts";
import * as T from "./Tasks.ts";
import { Tools, type Tools as Kit } from "./Tools.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-contract-");
const NOW  = Date.parse("2026-10-25T12:00:00Z");
let dir    = "";
let notes: string[] = [];
let restarts: Restart.How[] = [];
let tools: Kit;

beforeEach(() => {
  T.tasks_forget();
  dir = fs.mkdtempSync(ROOT + "/chat-");
  notes = [];
  restarts = [];
  tools = { mem: { dir }, agents: new Map(), hooks: { change: () => {}, note: (t: string) => notes.push(t), restart: (h: Restart.How) => restarts.push(h) } } as unknown as Kit;
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const call = (name: string, args: object) => Tools.call(tools, "main", name, args, new AbortController().signal, "x");
const PR = "https://github.com/morum/uniichat/pull/18";
const GOOD = { url: PR, head: "88F18996d287", verdict: "approved_with_notes", verifier: "GoldenJay", notes: [{ sev: "low", text: "texto em inglês" }, { sev: "high", text: "quebra o vigia" }], untested: ["iPhone", "Safari"] };

test("a PR's approval (kind pr) without its link and head is refused; with them, kept and said", async () => {
  const none = await call("task_add", { title: "Aprovar a R5", origin: "chat", kind: "pr" });
  expect(none.fail).toBe(true);
  expect(none.text).toContain("needs prs");
  expect(none.text).toContain("Refused: no PR given with its link and head.");
  // a link, no head; a head, no link; a link not of a pull; a head not hex
  expect(await call("task_add", { title: "Aprovar a R5", origin: "chat", kind: "pr", prs: [{ url: PR }] })).toEqual({ text: "prs 1: head is the commit verified, 7 to 40 hex characters (none given).", fail: true });
  expect(await call("task_add", { title: "Aprovar a R5", origin: "chat", kind: "pr", prs: [{ head: "88f1899" }] })).toEqual({ text: "prs 1: url is the PR's GitHub link, https://github.com/<owner>/<repo>/pull/<n> (none given).", fail: true });
  expect((await call("task_add", { title: "Aprovar a R5", origin: "chat", kind: "pr", prs: [{ url: "https://github.com/morum/uniichat/issues/18", head: "88f1899" }] })).fail).toBe(true);
  expect((await call("task_add", { title: "Aprovar a R5", origin: "chat", kind: "pr", prs: [{ url: PR, head: "xyz1234" }] })).fail).toBe(true);
  expect((await call("task_add", { title: "Aprovar a R5", origin: "chat", kind: "pr", prs: [{ url: PR, head: "88f1899", notes: [{ sev: "grave", text: "x" }] }] })).text).toBe("prs 1: each note is {sev: high, medium or low, text}.");
  expect((await call("task_add", { title: "Aprovar a R5", origin: "chat", kind: "pr", prs: [GOOD, GOOD] })).text).toBe("prs 2: " + PR + " is given twice.");
  // a PR link in the title makes it pr: held to the same
  const titled = await call("task_add", { title: "Mesclar " + PR, origin: "chat" });
  expect(titled.fail).toBe(true);
  expect(titled.text).toContain("as its title's PR link says");
  expect(T.tasks_load(dir).tasks.length).toBe(0);
  const ok = await call("task_add", { title: "Aprovar a R5", origin: "chat", kind: "pr", prs: [GOOD] });
  expect(ok.fail).toBe(false);
  expect(ok.text).toContain("pr " + PR + " @88f18996d287 approved_with_notes by GoldenJay notes 1 high 1 low untested 2");
  const t = T.tasks_load(dir).tasks[0];
  expect(t.prs).toEqual([{ url: PR, head: "88f18996d287", verdict: "approved_with_notes", verifier: "GoldenJay", notes: [{ sev: "low", text: "texto em inglês" }, { sev: "high", text: "quebra o vigia" }], untested: ["iPhone", "Safari"] }]);
  // kept on disk, read back whole
  T.tasks_forget();
  expect(T.tasks_load(dir).tasks[0].prs).toEqual(t.prs);
});

test("edit: making it pr needs prs; prs replaced and checked; an older task without them still edited otherwise", async () => {
  const s = T.tasks_load(dir);
  const old = T.task_new(s, { title: "Mesclar o #46", detail: "x" }, "main", NOW) as T.Task;
  expect((await call("task_edit", { id: old.id, kind: "pr" })).text).toContain("needs prs");
  expect((await call("task_edit", { id: old.id, prs: [{ url: PR, head: "nothex!" }] })).fail).toBe(true);
  expect((await call("task_edit", { id: old.id, detail: "só o texto" })).fail).toBe(false);
  const done = await call("task_edit", { id: old.id, kind: "pr", prs: [{ url: PR, head: "a9e8586", verdict: "aprovado" }] });
  expect(done.fail).toBe(false);
  expect(T.task_find(s, old.id)!.prs[0]).toMatchObject({ head: "a9e8586", verdict: "approved", verifier: null, notes: [], untested: [] });
  // emptied: refused while it's pr; dropped, let go
  expect((await call("task_edit", { id: old.id, prs: [] })).text).toContain("needs prs");
  expect((await call("task_edit", { id: old.id, prs: [], state: "dropped" })).fail).toBe(false);
});

test("the inbox's PR links aren't held to the contract (they say what it's about, not a verification)", () => {
  const s = T.tasks_load(dir);
  const got = T.task_inbox(s, { title: "Revisar " + PR, origin: "github", ref: "github:morum/uniichat#18" }, NOW);
  expect(typeof got).not.toBe("string");
});

test("acts: by choice, user or unii; checked; kept as choices change; said to Unii and in the views", async () => {
  expect((await call("task_add", { title: "Mesclar?", origin: "chat", choices: ["Mesclado", "Corrija antes"], acts: { Talvez: "unii" } })).text).toBe('acts: "Talvez" is not a choice; one of: Mesclado | Corrija antes.');
  expect((await call("task_add", { title: "Mesclar?", origin: "chat", choices: ["Mesclado", "Corrija antes"], acts: { Mesclado: "eu" } })).text).toBe('acts: who acts on "Mesclado" is user or unii.');
  const ok = await call("task_add", { title: "Mesclar?", origin: "chat", choices: ["Mesclado", "Corrija antes"], acts: { mesclado: "user", "Corrija antes": "unii" } });
  expect(ok.text).toContain("options: Mesclado | Corrija antes (you act on: Corrija antes)");
  const s = T.tasks_load(dir);
  const t = s.tasks[0];
  expect(t.acts).toEqual({ Mesclado: "user", "Corrija antes": "unii" });
  expect(T.task_act(t, "Corrija antes")).toBe("unii");
  expect(T.task_act(t, "Mesclado")).toBe("user");
  // choices changed: the acts of those kept stay
  await call("task_edit", { id: t.id, choices: ["Corrija antes", "Outro PR"] });
  expect(T.task_find(s, t.id)!.acts).toEqual({ "Corrija antes": "unii" });
  // the views: the option tagged, the hint says it's told at once
  const v = T.tasks_view(s, NOW);
  const html = Html.desk_html(v, "", "", t.id, NOW).detail.join("");
  expect(html).toContain('Corrija antes <span class="act-tag">o Unii executa</span>');
  expect(html).toContain("avisam o Unii na hora; as demais, em até 1 min.");
  const view = View.view_new();
  view.tasks = v;
  const md = View.tasks_md(view, v[0]);
  expect(md).toContain("1) Corrija antes (o Unii executa)");
  expect(md).toContain("`/ok " + t.id + " opção`");
  // resolved with it: said as an order
  const r = T.task_resolve(s, t.id, "done", "Corrija antes", null, NOW) as T.Task;
  expect(T.task_said(r)).toContain("Resposta: Corrija antes. Essa opção é uma ordem: cabe ao Unii executá-la.");
  expect(T.tasks_block(s, NOW)).toContain("answer: Corrija antes (an order: you act on it now)");
});

test("waits_for: kept, cleared, said to Unii and in the views", async () => {
  const add = await call("task_add", { title: "Aplicar em hom", origin: "chat", waits_for: "CI do #42" });
  expect(add.text).toContain('waits for "CI do #42"');
  const s = T.tasks_load(dir);
  const id = s.tasks[0].id;
  const v = T.tasks_view(s, NOW);
  expect(Html.tasks_html(v).open.join("")).toContain('<span class="waits-for">aguarda: CI do #42</span>');
  const view = View.view_new();
  view.tasks = v;
  expect(View.desk_md(view)).toContain("aguarda: CI do #42");
  await call("task_edit", { id, waits_for: "" });
  expect(T.task_find(s, id)!.waits_for).toBeNull();
});

test("ref: one of the list's fronts, as it writes it; an unknown refused with the nearest; ref_new starts one", async () => {
  const first = await call("task_add", { title: "A", origin: "chat", ref: "uniichat-ux" });
  expect(first).toEqual({ text: 'No front (ref) "uniichat-ux" Fronts: none yet. To start a new front, give ref_new: true.', fail: true });
  expect((await call("task_add", { title: "A", origin: "chat", ref: "uniichat-ux", ref_new: true })).fail).toBe(false);
  expect((await call("task_add", { title: "B", origin: "chat", ref: "num-2337", ref_new: true })).fail).toBe(false);
  // any case: the list's way
  expect((await call("task_add", { title: "C", origin: "chat", ref: "UniiChat-UX" })).text).toContain("(ref uniichat-ux,");
  const typo = await call("task_add", { title: "D", origin: "chat", ref: "uniichat-xu" });
  expect(typo.text).toBe('No front (ref) "uniichat-xu"; did you mean "uniichat-ux"? Fronts: uniichat-ux, num-2337. To start a new front, give ref_new: true.');
  const part = await call("task_add", { title: "D", origin: "chat", ref: "uniichat" });
  expect(part.text).toContain('did you mean "uniichat-ux"?');
  expect((await call("task_edit", { id: "P1", ref: "fractal-ritsu" })).fail).toBe(true);
  expect((await call("task_edit", { id: "P1", ref: "" })).fail).toBe(false);
  // kept on disk
  T.tasks_forget();
  expect(T.tasks_load(dir).refs).toEqual(["uniichat-ux", "num-2337"]);
});

test("ref: a list of before R5 takes its fronts from its tasks (not the inbox's); the inbox adds none", () => {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 4, rev: 0, tasks: [
    { id: "P1", title: "a", ref: "uniichat-mesa", made: "2026-10-24T10:00:00Z" },
    { id: "P2", title: "b", ref: "Uniichat-Mesa", made: "2026-10-24T10:00:00Z" },
    { id: "P3", title: "c", ref: "slack:D0123", by: "inbox", made: "2026-10-24T10:00:00Z" },
  ] }));
  const s = T.tasks_load(dir);
  expect(s.refs).toEqual(["uniichat-mesa"]);
  T.task_inbox(s, { title: "Nova do Slack", origin: "slack", ref: "slack:D999" }, NOW);
  expect(s.refs).toEqual(["uniichat-mesa"]);
});

test("restart: kind restart with no choices gets its template (P8); its own choices kept", () => {
  const s = T.tasks_load(dir);
  const t = T.task_new(s, { title: "Reiniciar com agentes rodando?", kind: "restart" }, "main", NOW) as T.Task;
  expect([t.choices, t.recommend, t.acts, t.detail]).toEqual([[T.RESTART_YES, T.RESTART_LATER], T.RESTART_YES, { [T.RESTART_YES]: "unii", [T.RESTART_LATER]: "user" }, T.RESTART_DETAIL]);
  const own = T.task_new(s, { title: "Outro reinício", kind: "restart", choices: ["Pode", "Não"], detail: "x" }, "main", NOW) as T.Task;
  expect([own.choices, own.recommend, own.acts]).toEqual([["Pode", "Não"], null, {}]);
  expect(View.task_kind_said(t)).toBe("reinício, prazo 24 h");
  expect(View.task_kind_said({ ...t, kind: "info" })).toBe("informação, sem prazo");
  expect(View.task_late_said({ ...t, kind: "info" }, new Set(), NOW + 1000 * 3600e3)).toBe("");
});

test("restart tool: why needed; refused with no way to restart, or agents at work (P8); else marked, said before, the hook called", async () => {
  expect((await call("restart", { resume: "x" })).text).toBe("Give why: what the restart is for (it's said in the chat).");
  expect(Tools.restart(tools, { why: "aplicar a R5" }, null).text).toContain("can't restart itself");
  (tools.agents as Map<string, any>).set("CalmCow", { name: "CalmCow", label: "uniichat-ux-r4-impl", call: {} });
  const busy = Tools.restart(tools, { why: "aplicar a R5" }, "exit");
  expect(busy.fail).toBe(true);
  expect(busy.text).toStartWith("Agents at work: CalmCow (uniichat-ux-r4-impl). The standing leave (P8)");
  expect(restarts).toEqual([]);
  expect(Restart.mark_read(dir)).toBeNull();
  // a task of kind restart the user resolved with "Sim, reinicie" lets it, once
  const s = T.tasks_load(dir);
  const t = T.task_new(s, { title: "Reiniciar com agentes rodando?", kind: "restart" }, "main", NOW) as T.Task;
  expect(Tools.restart(tools, { why: "x", task: t.id }, "exit").text).toContain("hasn't picked an option of yours (Sim, reinicie)");
  T.task_resolve(s, t.id, "done", T.RESTART_YES, null, NOW);
  const go = Tools.restart(tools, { why: "aplicar a R5", resume: "Seguir com a R6.", task: t.id }, "exit");
  expect(go.fail).toBe(false);
  expect(go.text).toStartWith("Restarting in 3 s");
  expect(restarts).toEqual(["exit"]);
  expect(notes).toEqual(["Reiniciando o serve: aplicar a R5. O chat volta em alguns segundos, e o Unii retoma o trabalho sozinho. Agentes interrompidos: CalmCow (uniichat-ux-r4-impl); o Unii os retoma em seguida."]);
  expect(Restart.mark_read(dir)).toMatchObject({ why: "aplicar a R5", resume: "Seguir com a R6.", agents: ["CalmCow (uniichat-ux-r4-impl)"], task: t.id, done: false, used: [t.id] });
  expect(Tools.restart(tools, { why: "de novo", task: t.id }, "exit").text).toBe(t.id + " let a restart already: each lets one. Add a new task of kind restart.");
  // the next start takes the mark once: said after, and what to resume
  const back = Restart.mark_take(dir)!;
  expect(Restart.said_after(back)).toStartWith("Serve reiniciado (pedido às ");
  expect(Restart.resume_said(back)).toContain("It cut these agents: CalmCow (uniichat-ux-r4-impl): tell each to go on. Resume now: Seguir com a R6.");
  expect(Restart.mark_take(dir)).toBeNull();
  // none at work: no task needed
  (tools.agents as Map<string, any>).clear();
  expect(Tools.restart(tools, { why: "aplicar a R5", resume: "x" }, { cmd: "true" }).fail).toBe(false);
  expect(restarts).toEqual(["exit", { cmd: "true" }]);
});

test("restart's way: UNII_RESTART's command, else systemd's (INVOCATION_ID), else none", () => {
  expect(Restart.how({ UNII_RESTART: " ~/x/unii-restart ", INVOCATION_ID: "1" })).toEqual({ cmd: "~/x/unii-restart" });
  expect(Restart.how({ INVOCATION_ID: "abc" })).toBe("exit");
  expect(Restart.how({})).toBeNull();
});

test("the Mesa's detail: each PR verified a card (head, verdict, verifier, notes by severity, untested); other links still chips; escaped", async () => {
  await call("task_add", { title: "Aprovar a R5", origin: "chat", kind: "pr", detail: "Ver também https://github.com/morum/uniichat/pull/17", prs: [{ ...GOOD, notes: [...GOOD.notes, { sev: "medium", text: "<b>x</b>" }] }] });
  const s = T.tasks_load(dir);
  const v = T.tasks_view(s, NOW);
  const html = Html.desk_html(v, "", "", "P1", NOW).detail.join("");
  expect(html).toContain('<section class="checks" aria-label="Verificação"><div class="check approved_with_notes">');
  expect(html).toContain('<span class="lead">head</span> <code class="head">88f18996d287</code> <span class="verdict">aprovado com ressalvas por GoldenJay</span> <span class="count">ressalvas: 1 alta, 1 média e 1 baixa</span>');
  expect(html).toContain('<li class="sev medium"><span class="sev-tag">média</span> &lt;b&gt;x&lt;/b&gt;</li>');
  expect(html).toContain('<p class="untested"><span class="lead">Não testado:</span> iPhone; Safari</p>');
  expect(html).toContain('<p class="prs"><span class="lead">PR:</span> <a class="pr" href="https://github.com/morum/uniichat/pull/17"');
  expect(html.match(/uniichat\/pull\/18"/g)!.length).toBe(1);
  // the terminal's /p: the card as Markdown
  const view = View.view_new();
  view.tasks = v;
  const md = View.tasks_md(view, v[0]);
  expect(md).toContain("aprovação de PR, prazo 24 h");
  expect(md).toContain("**Verificação**\n\n- **uniichat#18** " + PR + " · head `88f18996d287` · aprovado com ressalvas por GoldenJay · ressalvas: 1 alta, 1 média e 1 baixa\n  - ressalva baixa: texto em inglês");
  expect(md).toContain("  - não testado: iPhone; Safari");
  // an older server's task, without them: made whole
  const whole = View.task_whole({ id: "P9", title: "x", assignee: "user", after: [], fields: [], thread: [], choices: [], draft: {}, origin: null, agent: null });
  expect([whole.prs, whole.acts, whole.waits_for]).toEqual([[], {}, null]);
});

test("the Mesa's list: a row says what it waits for outside and a PR rejected", async () => {
  await call("task_add", { title: "Aprovar", origin: "chat", kind: "pr", waits_for: "CI do #18", prs: [{ url: PR, head: "88f1899", verdict: "rejected", notes: [{ sev: "high", text: "quebra" }] }] });
  const list = Html.desk_html(T.tasks_view(T.tasks_load(dir), NOW), "", "", null, NOW).list.join("");
  expect(list).toContain('<span class="late">1 PR reprovado</span> · <span class="waits-for">aguarda: CI do #18</span>');
});
