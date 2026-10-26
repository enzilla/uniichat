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
  // this very process (it didn't restart) takes none; the next start
  // takes the mark once: said after, and what to resume
  expect(Restart.mark_take(dir)).toBeNull();
  expect(Restart.mark_read(dir)!.done).toBe(false);
  const asked = Date.parse(Restart.mark_read(dir)!.at);
  const back = Restart.mark_take(dir, asked + 5000, process.pid + 1, asked + 4000)!;
  expect(Restart.said_after(back)).toStartWith("Serve reiniciado (pedido às ");
  expect(Restart.resume_said(back)).toContain("It cut these agents: CalmCow (uniichat-ux-r4-impl): tell each to go on. Resume now: Seguir com a R6.");
  expect(Restart.mark_take(dir, asked + 5000, process.pid + 1, asked + 4000)).toBeNull();
  // none at work: no task needed
  (tools.agents as Map<string, any>).clear();
  expect(Tools.restart(tools, { why: "aplicar a R5", resume: "x" }, { cmd: "true" }).fail).toBe(false);
  expect(restarts).toEqual(["exit", { cmd: "true" }]);
});

test("restart's way: UNII_RESTART's command, else systemd's (INVOCATION_ID and started by systemd itself), else none", () => {
  expect(Restart.how({ UNII_RESTART: " ~/x/unii-restart ", INVOCATION_ID: "1" }, "bash")).toEqual({ cmd: "~/x/unii-restart" });
  expect(Restart.how({ INVOCATION_ID: "abc" }, "systemd")).toBe("exit");
  expect(Restart.how({}, "systemd")).toBeNull();
  // a serve started from an agent's shell under the unit inherits
  // INVOCATION_ID, not the parent: it must not exit as if systemd ran it
  expect(Restart.how({ INVOCATION_ID: "abc" }, "bash")).toBeNull();
  expect(Restart.how({ INVOCATION_ID: "abc" }, "bun")).toBeNull();
  expect(Restart.how({ INVOCATION_ID: "abc" }, null)).toBeNull();
  // this test's own process: bun under a shell, not systemd
  expect(Restart.parent_name()).not.toBe("systemd");
});

test("restart mark: taken only by a new process started after it was asked, within MARK_TTL; else dropped unsaid", () => {
  const at = Date.parse("2026-10-25T12:00:00Z");
  const mark = (o: Partial<Restart.Mark> = {}): Restart.Mark => ({ why: "aplicar a R5", resume: "x", at: new Date(at).toISOString(), agents: [], task: null, done: false, used: [], pid: 4242, ...o });
  // the process that asked: it didn't restart; the mark waits
  Restart.mark_write(dir, mark());
  expect(Restart.mark_take(dir, at + 5000, 4242, at - 3600e3)).toBeNull();
  expect(Restart.mark_read(dir)!.done).toBe(false);
  // another process, started before the asking (not a restart of it): dropped, said by none
  expect(Restart.mark_take(dir, at + 5000, 777, at - 60e3)).toBeNull();
  expect(Restart.mark_read(dir)!.done).toBe(true);
  expect(Restart.mark_take(dir, at + 6000, 778, at + 5000)).toBeNull();
  // a start long after it (the restart never happened as asked; a later start of any cause)
  Restart.mark_write(dir, mark());
  expect(Restart.mark_take(dir, at + Restart.MARK_TTL + 60e3, 779, at + Restart.MARK_TTL + 50e3)).toBeNull();
  expect(Restart.mark_read(dir)!.done).toBe(true);
  // the restart as asked: a new process, started after it, soon
  Restart.mark_write(dir, mark());
  expect(Restart.mark_take(dir, at + 8000, 780, at + 4000)).toMatchObject({ why: "aplicar a R5", pid: 4242 });
  expect(Restart.mark_take(dir, at + 9000, 780, at + 4000)).toBeNull();
  // a mark of before R5's fix (no pid): held by time alone
  Restart.mark_write(dir, mark({ pid: null }));
  expect(Restart.mark_take(dir, at + 8000, 781, at + 4000)).not.toBeNull();
});

test("restart with agents at work: only the user's pick lets it; Unii closing the task itself (task_edit) doesn't", async () => {
  (tools.agents as Map<string, any>).set("CalmCow", { name: "CalmCow", label: "uniichat-ux-r4-impl", call: {} });
  const s = T.tasks_load(dir);
  const t = T.task_new(s, { title: "Reiniciar com agentes rodando?", kind: "restart" }, "main", NOW) as T.Task;
  // Unii's own task_edit, done with "Sim, reinicie": recorded as Unii's, refused
  const self = await call("task_edit", { id: t.id, state: "done", answer: T.RESTART_YES });
  expect(self.fail).toBe(false);
  expect(T.tasks_load(dir).tasks.find((x) => x.id === t.id)!.closed_by).toBe("unii");
  const no = Tools.restart(tools, { why: "x", task: t.id }, "exit");
  expect(no.fail).toBe(true);
  expect(no.text).toContain("closed by you (task_edit), not by the user");
  expect(restarts).toEqual([]);
  expect(Restart.mark_read(dir)).toBeNull();
  // opened again (who closed it forgotten), then the user's pick: lets it
  const s2 = T.tasks_load(dir);
  T.task_resolve(s2, t.id, "open", null, null, NOW);
  expect(s2.tasks.find((x) => x.id === t.id)!.closed_by).toBeNull();
  T.task_resolve(s2, t.id, "done", T.RESTART_YES, null, NOW);
  expect(s2.tasks.find((x) => x.id === t.id)!.closed_by).toBe("user");
  // kept on disk as the user's
  T.tasks_forget();
  expect(T.tasks_load(dir).tasks.find((x) => x.id === t.id)!.closed_by).toBe("user");
  // Unii changing the answer afterwards makes it Unii's again: refused
  await call("task_edit", { id: t.id, answer: T.RESTART_LATER });
  await call("task_edit", { id: t.id, answer: T.RESTART_YES });
  expect(T.tasks_load(dir).tasks.find((x) => x.id === t.id)!.closed_by).toBe("unii");
  expect(Tools.restart(tools, { why: "x", task: t.id }, "exit").fail).toBe(true);
  // a note alone by Unii keeps who closed it
  const s3 = T.tasks_load(dir);
  const u = T.task_new(s3, { title: "Outro reinício?", kind: "restart" }, "main", NOW) as T.Task;
  T.task_resolve(s3, u.id, "done", T.RESTART_YES, null, NOW);
  await call("task_edit", { id: u.id, note: "visto" });
  expect(T.tasks_load(dir).tasks.find((x) => x.id === u.id)!.closed_by).toBe("user");
  expect(Tools.restart(tools, { why: "x", task: u.id }, "exit").fail).toBe(false);
  // a list of before it (no closed_by): a done task lets none
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 2, rev: 0, tasks: [{ id: "P1", title: "Reiniciar?", kind: "restart", state: "done", answer: T.RESTART_YES, choices: [T.RESTART_YES, T.RESTART_LATER], acts: { [T.RESTART_YES]: "unii" }, made: "2026-10-24T10:00:00Z" }] }));
  T.tasks_forget();
  fs.rmSync(dir + "/restart.json", { force: true });
  expect(Tools.restart(tools, { why: "x", task: "P1" }, "exit").text).toContain("not by the user");
});

test("a PR's contract can't be got round with a kind: a task of the user's citing a PR (title or detail) needs prs, whatever its kind", async () => {
  for (const kind of ["decision", "action", "info", "test", "restart"]) {
    const r = await call("task_add", { title: "Mesclar " + PR + " (" + kind + ")", origin: "chat", kind });
    expect(r.fail).toBe(true);
    expect(r.text).toContain("whatever its kind");
    const d = await call("task_add", { title: "Decidir (" + kind + ")", detail: "Contexto: " + PR, origin: "chat", kind });
    expect(d.fail).toBe(true);
    expect(d.text).toContain("in its detail");
  }
  const none = await call("task_add", { title: "Decidir sem kind", detail: "ver " + PR, origin: "chat" });
  expect(none.fail).toBe(true);
  expect(T.tasks_load(dir).tasks.length).toBe(0);
  // with its PR verified: kept, the kind given still its kind
  const ok = await call("task_add", { title: "Decidir o rumo", detail: "Contexto: " + PR, origin: "chat", kind: "decision", prs: [GOOD] });
  expect(ok.fail).toBe(false);
  expect(T.tasks_load(dir).tasks[0].kind).toBe("decision");
  // a task of Unii's follows a PR up: not an approval, held by its kind only
  expect((await call("task_add", { title: "Acompanhar a R5", detail: "PR: " + PR, origin: "chat", assignee: "unii", agent: "CalmCow" })).fail).toBe(false);
  // an edit can't add the link without prs, nor hand such a task to the user
  const plain = await call("task_add", { title: "Escolher a frente", origin: "chat", kind: "decision" });
  expect(plain.fail).toBe(false);
  const id = T.tasks_load(dir).tasks.at(-1)!.id;
  expect((await call("task_edit", { id, detail: "ver " + PR })).fail).toBe(true);
  expect((await call("task_edit", { id, title: "Escolher " + PR, kind: "info" })).fail).toBe(true);
  expect((await call("task_edit", { id: "P2", assignee: "user" })).fail).toBe(true);
  // links that aren't a pull (an issue) need nothing
  expect((await call("task_edit", { id, detail: "ver https://github.com/morum/uniichat/issues/3" })).fail).toBe(false);
});

test("info: priority low unless given; after every task to act on in Agora and never the Próxima while one waits", () => {
  const s = T.tasks_load(dir);
  const H = 3600e3;
  const info = T.task_new(s, { title: "Leia: resumo da R4", kind: "info" }, "main", NOW - 500 * H) as T.Task;     // P1, old
  const high = T.task_new(s, { title: "Leia: aviso urgente", kind: "info", priority: "high" }, "main", NOW - 400 * H) as T.Task; // P2
  const low = T.task_new(s, { title: "Escolher a cor", kind: "decision", priority: "low" }, "main", NOW) as T.Task; // P3, new and low
  const act = T.task_new(s, { title: "Rodar o teste", kind: "test" }, "main", NOW) as T.Task;                      // P4
  expect([info.priority, high.priority, low.priority, act.priority]).toEqual(["low", "high", "low", "normal"]);
  const tasks = T.tasks_view(s, NOW);
  const now = View.desk_list(tasks).find((g) => g.group === "now")!.tasks.map((t) => t.id);
  expect(now).toEqual([act.id, low.id, high.id, info.id]);
  expect(View.desk_next(tasks, null)!.id).toBe(act.id);
  expect(View.desk_next(tasks, act.id)!.id).toBe(low.id);
  // an info of before (normal priority, kept as it was) still goes after
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 3, rev: 0, tasks: [
    { id: "P1", title: "Leia isto", kind: "info", priority: "normal", made: "2026-10-01T10:00:00Z" },
    { id: "P2", title: "Aprovar algo", kind: "decision", priority: "low", made: "2026-10-25T10:00:00Z" },
  ] }));
  T.tasks_forget();
  const old = T.tasks_view(T.tasks_load(dir), NOW);
  expect(View.desk_list(old).find((g) => g.group === "now")!.tasks.map((t) => t.id)).toEqual(["P2", "P1"]);
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

test("a closed task's kind, choices and acts stay as the user picked from them: no leave to restart made after the pick", async () => {
  (tools.agents as Map<string, any>).set("CalmCow", { name: "CalmCow", label: "uniichat-ux-r4-impl", call: {} });
  // (a) the user closes a restart with "Eu reinicio depois" (theirs); Unii
  // gives that button its own act: refused, and no restart
  const s = T.tasks_load(dir);
  const a = T.task_new(s, { title: "Reiniciar com agentes rodando?", kind: "restart" }, "main", NOW) as T.Task;
  T.task_resolve(s, a.id, "done", T.RESTART_LATER, null, NOW);
  expect(T.tasks_load(dir).tasks.find((x) => x.id === a.id)!.closed_by).toBe("user");
  const ra = await call("task_edit", { id: a.id, acts: { [T.RESTART_YES]: "unii", [T.RESTART_LATER]: "unii" } });
  expect(ra.fail).toBe(true);
  expect(ra.text).toContain("is closed (done): its acts can't change");
  expect(T.task_act(T.tasks_load(dir).tasks.find((x) => x.id === a.id)!)).toBe("user");
  expect(Tools.restart(tools, { why: "x", task: a.id }, "exit").fail).toBe(true);
  // (b) the user closes any decision with "Sim"; Unii makes it a restart
  // with "Sim" Unii's: refused, together or one by one, and no restart
  const b = T.task_new(s, { title: "Seguir com a R6?", kind: "decision", choices: ["Sim", "Não"] }, "main", NOW) as T.Task;
  T.task_resolve(s, b.id, "done", "Sim", null, NOW);
  const rb = await call("task_edit", { id: b.id, kind: "restart", acts: { Sim: "unii" } });
  expect(rb.fail).toBe(true);
  expect(rb.text).toContain("its kind, acts can't change");
  expect((await call("task_edit", { id: b.id, kind: "restart" })).fail).toBe(true);
  expect((await call("task_edit", { id: b.id, acts: { Sim: "unii" } })).fail).toBe(true);
  expect((await call("task_edit", { id: b.id, choices: ["Sim", "Não", "Talvez"] })).fail).toBe(true);
  // closing and changing in one edit (dropped to done) doesn't get round it
  const c = T.task_new(s, { title: "Outra decisão", kind: "decision", choices: ["Sim", "Não"] }, "main", NOW) as T.Task;
  T.task_resolve(s, c.id, "dropped", null, null, NOW);
  expect((await call("task_edit", { id: c.id, state: "done", answer: "Sim", kind: "restart", acts: { Sim: "unii" } })).fail).toBe(true);
  const kept = T.tasks_load(dir).tasks.find((x) => x.id === b.id)!;
  expect(kept.kind).toBe("decision");
  expect(kept.acts).toEqual({});
  expect(Tools.restart(tools, { why: "x", task: b.id }, "exit").fail).toBe(true);
  expect(restarts).toEqual([]);
  // the rest of a closed task still edits (a note; the same kind given again)
  expect((await call("task_edit", { id: b.id, note: "visto", kind: "decision" })).fail).toBe(false);
  expect(T.tasks_load(dir).tasks.find((x) => x.id === b.id)!.closed_by).toBe("user");
  // opened again, it changes; then only the user's new pick lets a restart
  expect((await call("task_edit", { id: b.id, state: "open", kind: "restart", acts: { Sim: "unii" } })).fail).toBe(false);
  expect(T.tasks_load(dir).tasks.find((x) => x.id === b.id)!.closed_by).toBeNull();
  expect(Tools.restart(tools, { why: "x", task: b.id }, "exit").fail).toBe(true);
  T.task_resolve(T.tasks_load(dir), b.id, "done", "Sim", null, NOW);
  expect(Tools.restart(tools, { why: "x", task: b.id }, "exit").fail).toBe(false);
});

test("a PR link is known as people write it: http, no scheme, www., any case; not inside another host or path", async () => {
  const D = await import("./TaskDeps.ts");
  for (const l of ["http://github.com/a/b/pull/3", "github.com/a/b/pull/3", "https://www.github.com/a/b/pull/3", "HTTPS://GITHUB.COM/A/B/PULL/3", "www.GitHub.com/a/b/pull/3", "(ver github.com/a/b/pull/3)"]) {
    expect(D.PR_LINK.test(l)).toBe(true);
    expect(D.kind_of({ id: "", state: "open", made: "", title: "Mesclar " + l })).toBe("pr");
    const r = await call("task_add", { title: "Decidir", detail: "Contexto: " + l, origin: "chat", kind: "decision" });
    expect(r.fail).toBe(true);
    expect(r.text).toContain("in its detail");
  }
  for (const l of ["https://evil.com/github.com/a/b/pull/3", "evil.com/github.com/a/b/pull/3", "https://notgithub.com/a/b/pull/3", "notgithub.com/a/b/pull/3", "xgithub.com/a/b/pull/3", "https://github.com/a/b/issues/3", "x@github.com/a/b/pull/3", "a.github.com/a/b/pull/3", "github.com.evil.com/a/b/pull/3", "https://github.com.evil.com/a/b/pull/3"]) {
    expect(D.PR_LINK.test(l)).toBe(false);
    expect(D.pr_link(l)).toBeNull();
  }
  // the link alone, without the char before it (matched, not looked behind)
  expect(D.pr_link("ver (github.com/a/b/pull/3)")).toBe("github.com/a/b/pull/3");
  expect(D.pr_link("Mesclar HTTPS://WWW.GitHub.com/a/b/pull/3 hoje")).toBe("HTTPS://WWW.GitHub.com/a/b/pull/3");
  expect(D.pr_link("https://github.com/a/b/pull/3")).toBe("https://github.com/a/b/pull/3");
  expect(T.tasks_load(dir).tasks.length).toBe(0);
});

test("a task of Unii's follows a PR up: a link in its title or detail needs no prs; only kind pr given does", async () => {
  const titled = await call("task_add", { title: "Seguir " + PR, origin: "chat", assignee: "unii", agent: "CalmCow" });
  expect(titled.fail).toBe(false);
  expect((await call("task_add", { title: "Seguir github.com/a/b/pull/3", detail: "e " + PR, origin: "chat", assignee: "unii", agent: "CalmCow" })).fail).toBe(false);
  const given = await call("task_add", { title: "Aprovar a R6", origin: "chat", assignee: "unii", agent: "CalmCow", kind: "pr" });
  expect(given.fail).toBe(true);
  expect(given.text).toContain("needs prs");
  // handed to the user, the link makes it theirs to approve: prs needed
  const id = T.tasks_load(dir).tasks[0].id;
  const hand = await call("task_edit", { id, assignee: "user" });
  expect(hand.fail).toBe(true);
  expect(hand.text).toContain("as its title's PR link says");
});
