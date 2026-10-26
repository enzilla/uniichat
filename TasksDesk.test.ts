// TasksDesk.test
// ==============
// `bun test TasksDesk.test.ts`: the Mesa (phase 2): its groups, search,
// project filter and keys' order (View.desk_*), its markup
// (Html.desk_html, every text escaped), the terminal's /mesa, a task of
// an older server made whole (assignee from who), on chats in a
// temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-desk-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");
let dir    = "";

beforeEach(() => {
  T.tasks_forget();
  dir = fs.mkdtempSync(ROOT + "/chat-");
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function add(s: T.Store, args: T.Edit): T.Task {
  const t = T.task_new(s, args, "main", NOW);
  if (typeof t === "string") {
    throw new Error(t);
  }
  return t;
}

// P1 the user's; P2 Unii's; P3 the user's, waiting for P2; P4 the
// user's, the user wrote in its thread; P5 Unii's, Unii answered in its
// thread; P6 done
function desk(): T.Task[] {
  const s = T.tasks_load(dir);
  add(s, { title: "Mesclar o PR", ref: "num-3182" });
  add(s, { title: "Trocar o require", assignee: "unii", ref: "num-3182" });
  add(s, { title: "Mesclar o #18", after: ["P2"], ref: "num-3182" });
  add(s, { title: "Reiniciar o serve", ref: "uniichat", detail: "Depois do merge da fase 2." });
  add(s, { title: "Configurar o Slack", assignee: "unii", ref: "slack" });
  add(s, { title: "Já feito", ref: "uniichat", fields: [{ id: "amb", label: "Ambiente", kind: "choice", choices: ["hom", "prod"] }] });
  T.task_say(s, "P4", "Pode esperar?", NOW);
  T.task_reply(s, "P5", "Preciso do token.", NOW);
  T.task_resolve(s, "P6", "done", null, null, NOW, { amb: "prod" });
  return T.tasks_view(s, NOW);
}

test("groups: now (the user's, or Unii answered), Unii's turn, at work, waiting, closed; in DESK's order", () => {
  const tasks = desk();
  const groups = View.desk_list(tasks);
  expect(groups.map((g) => [g.group, g.label, g.tasks.map((t) => t.id)])).toEqual([
    ["now", "Agora", ["P1", "P5"]],
    ["unii", "Aguardando o Unii", ["P4"]],
    ["others", "Em andamento", ["P2"]],
    ["waiting", "Aguardando outras pendências", ["P3"]],
    ["closed", "Resolvidas recentemente", ["P6"]],
  ]);
  expect(View.desk_turn(tasks)).toBe(true);
  // only Unii's and the user waiting on Unii: not the user's move (P19 opens the Conversa)
  expect(View.desk_turn(tasks.filter((t) => ["P2", "P4", "P6"].includes(t.id)))).toBe(false);
  expect(View.desk_turn([])).toBe(false);
});

test("in now, a task that frees others comes first", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  add(s, { title: "B" });
  add(s, { title: "C", after: ["P2"] });
  const now = View.desk_list(T.tasks_view(s, NOW)).find((g) => g.group === "now")!;
  expect(now.tasks.map((t) => t.id)).toEqual(["P2", "P1"]);
});

test("search: every word, no case, no accents, in id, title, detail, ref, fields and thread; project filter", () => {
  const tasks = desk();
  const ids = (q: string, ref = "") => View.desk_list(tasks, q, ref).flatMap((g) => g.tasks.map((t) => t.id));
  expect(ids("mesclar")).toEqual(["P1", "P3"]);
  expect(ids("MESCLAR  #18")).toEqual(["P3"]);
  expect(ids("ja feito")).toEqual(["P6"]);
  expect(ids("fase 2")).toEqual(["P4"]);
  expect(ids("token")).toEqual(["P5"]);
  expect(ids("ambiente")).toEqual(["P6"]);
  expect(ids("p2")).toEqual(["P2"]);
  expect(ids("nada disso")).toEqual([]);
  expect(ids("", "uniichat")).toEqual(["P4", "P6"]);
  expect(ids("reiniciar", "num-3182")).toEqual([]);
  expect(View.desk_refs(tasks)).toEqual(["num-3182", "slack", "uniichat"]);
  expect(View.desk_fold("  Pendência   É  ")).toBe("pendencia e");
});

test("keys: j and k step through the list, held at its ends; none shown starts at an end", () => {
  const ids = ["P1", "P5", "P4"];
  expect(View.desk_step(ids, "P1", 1)).toBe("P5");
  expect(View.desk_step(ids, "P4", 1)).toBe("P4");
  expect(View.desk_step(ids, "P1", -1)).toBe("P1");
  expect(View.desk_step(ids, null, 1)).toBe("P1");
  expect(View.desk_step(ids, null, -1)).toBe("P4");
  expect(View.desk_step(ids, "P9", 1)).toBe("P1");
  expect(View.desk_step([], "P1", 1)).toBe(null);
});

test("web: the list by group, the one shown marked; its detail whole, with fields, acts and an open thread", () => {
  const tasks = desk();
  const html = Html.desk_html(tasks, "", "", "P4");
  expect(html.ids).toEqual(["P1", "P5", "P4", "P2", "P3", "P6"]);
  expect(html.list[0]).toBe('<p class="group now" role="presentation">Agora <span class="n">(2)</span></p>');
  const p4 = html.list.find((x) => x.includes('data-desk="P4"'))!;
  expect(p4).toContain('aria-selected="true"');
  expect(p4).toContain('class="row unii sel"');
  expect(p4).toContain("aguardando o Unii");
  expect(html.list.find((x) => x.includes('data-desk="P1"'))).toContain('aria-selected="false"');
  expect(html.list.find((x) => x.includes('data-desk="P3"'))).toContain("aguarda P2 (do Unii)");
  expect(html.list.find((x) => x.includes('data-desk="P2"'))).toContain("libera P3");
  const d = html.detail.join("");
  // P4 waits for Unii: the next of Agora offered under it
  expect(html.detail.length).toBe(3);
  expect(html.detail[2]).toBe('<button class="next" type="button" data-desk="P1">Próxima: <span class="id">P1</span> Mesclar o PR →</button>');
  expect(d).toContain('<button class="back" type="button" data-desk-back');
  expect(d).toContain('<article class="task user talk-unii" data-task="P4">');
  expect(d).toContain('<div class="detail"><div class="md">');
  expect(d).not.toContain("<summary>Detalhes</summary>");
  expect(d).toContain('<section class="thread">');
  expect(d).toContain("Pode esperar?");
  expect(d).toContain('data-keep="say"');
  expect(d).toContain(">Concluir</button>");
  // the aside's item of the same task keeps its folds
  const aside = Html.tasks_html(tasks).open.find((x) => x.includes('data-task="P4"'))!;
  expect(aside).toContain("<summary>Detalhes</summary>");
  expect(aside).toContain('<details class="thread"');
});

test("web: a waiting task links to what it waits for; a closed one shows its answers and Reabrir; none shown, a note", () => {
  const tasks = desk();
  const waiting = Html.desk_html(tasks, "", "", "P3").detail.join("");
  expect(waiting).toContain('<article class="task waiting user" data-task="P3">');
  expect(waiting).toContain('Só pode ser resolvida depois de: <button class="goto" data-desk="P2">P2 (do Unii)</button>.');
  expect(waiting).not.toContain(">Concluir</button>");
  const closed = Html.desk_html(tasks, "", "", "P6").detail.join("");
  expect(closed).toContain('<dl class="answers"><dt>Ambiente</dt><dd>prod</dd></dl>');
  expect(closed).toContain(">Reabrir</button>");
  expect(Html.desk_html(tasks, "", "", null).detail[0]).toContain("Escolha uma pendência na lista");
  expect(Html.desk_html(tasks, "zzz", "", null).list).toEqual(['<p class="none">Nenhuma pendência na busca.</p>']);
  expect(Html.desk_html(tasks, "mesclar", "", null).list.join("")).not.toContain("Nenhuma pendência");
  expect(Html.desk_html([], "", "", null).list[0]).toContain("Nenhuma pendência. Quando o Unii precisar de você");
});

test("web: every text of a task escaped on the Mesa, a link only http(s)", () => {
  const s = T.tasks_load(dir);
  const bad = "<img src=x onerror=alert(1)>\"'";
  add(s, { title: bad, detail: bad + " [x](javascript:alert(1))", ref: "r<b>", fields: [{ id: "f", label: bad, kind: "text" }] });
  T.task_say(s, "P1", bad, NOW);
  add(s, { title: "B", after: ["P1"] });
  const tasks = T.tasks_view(s, NOW);
  for (const sel of ["P1", "P2"]) {
    const html = Html.desk_html(tasks, "", "", sel);
    const all = [...html.list, ...html.detail].join("");
    expect(all).not.toContain("<img");
    expect(all).not.toContain("<b>");
    expect(all).not.toContain('href="javascript');
    expect(all).toContain("&lt;img src=x onerror=alert(1)&gt;");
  }
});

test("terminal: /mesa by group, a project's only, or why none", () => {
  const v = View.view_new();
  v.tasks = desk();
  const md = View.desk_md(v);
  expect(md).toContain("**Agora (2)**\n\n- **P1** Mesclar o PR · num-3182\n- **P5** Configurar o Slack · slack · com o Unii");
  expect(md).toContain("**Aguardando outras pendências (1)**\n\n- **P3** Mesclar o #18 · num-3182 · aguarda P2");
  expect(md).toContain("- **P2** Trocar o require · num-3182 · com o Unii · libera 1");
  expect(md).toContain("- **P6** Já feito · uniichat · concluída");
  expect(View.desk_md(v, "uniichat")).toBe("**Aguardando o Unii (1)**\n\n- **P4** Reiniciar o serve\n\n**Resolvidas recentemente (1)**\n\n- **P6** Já feito · concluída\n\n`/p P7` detalha · `/conversa P7 mensagem` conversa · `/ok P7` conclui · `/mesa projeto` filtra por projeto");
  expect(View.desk_md(v, "nada")).toBe("Nenhuma pendência do projeto “nada”. Projetos: num-3182, slack, uniichat.");
  v.tasks = [];
  expect(View.desk_md(v)).toBe("A Mesa está vazia: nenhuma pendência.");
});

test("a task of an older server (who, no assignee) is made whole: Unii's stays Unii's, nothing missing breaks the views", () => {
  const old = (who: string) => ({ id: "P1", title: "Velha", detail: "", state: "open", who, by: "main", choices: [], answer: null, note: null, ref: null, made: "2026-10-23T12:00:00Z", changed: "2026-10-23T12:00:00Z", closed: null, told: true, rev: 1 });
  const v = View.view_new();
  View.view_hear(v, { $: "state", tasks: [old("unii"), { ...old("user"), id: "P2" }, { ...old(""), id: "P3", assignee: "agente-x" }] } as any);
  expect(v.tasks.map((t) => t.assignee)).toEqual(["unii", "user", "agente-x"]);
  expect(v.tasks[0]).toMatchObject({ after: [], fields: [], thread: [], talk: null, origin: null, origin_url: null, draft: {} });
  expect(Html.tasks_html(v.tasks).now.join("")).toContain("com o Unii");
  expect(View.desk_list(v.tasks).map((g) => g.group)).toEqual(["now", "others"]);
  // a whole one stays the same object
  const s = T.tasks_load(dir);
  add(s, { title: "Nova" });
  const whole = T.tasks_view(s, NOW)[0];
  expect(View.task_whole(whole)).toBe(whole);
});

test("web: after one resolved, the next of Agora; none past the last; a task of Agora shown offers none", () => {
  const tasks = desk();
  expect(View.desk_next(tasks, "P6")?.id).toBe("P1");
  expect(View.desk_next(tasks, "P1")?.id).toBe("P5");
  expect(Html.desk_html(tasks, "", "", "P6").detail.at(-1)).toContain('class="next" type="button" data-desk="P1"');
  expect(Html.desk_html(tasks, "", "", "P1").detail.join("")).not.toContain('class="next"');
  // the search narrows what's next too
  expect(View.desk_next(tasks, "P6", "slack")?.id).toBe("P5");
  expect(View.desk_next(tasks, "P6", "zzz")).toBe(null);
  expect(Html.desk_html(tasks, "zzz", "", "P6").detail.join("")).not.toContain('class="next"');
});

test("late: the user's move over TASK_LATE (= TaskPush.LATE) says how late, in the row and the detail; not Unii's, waiting, closed", async () => {
  const { LATE } = await import("./TaskPush.ts");
  const Deps = await import("./TaskDeps.ts");
  expect(View.TASK_LATE).toBe(LATE);
  expect(View.TASK_LATE).toBe(Deps.LATE);
  // one definition: neither TaskPush nor View writes the value again
  for (const file of ["TaskPush.ts", "View.ts"]) {
    expect(await Bun.file(import.meta.dir + "/" + file).text()).not.toMatch(/LATE\s*=\s*\d/);
  }
  const tasks = desk();
  const blocked = new Set(["P3"]);
  const p1 = tasks.find((t) => t.id === "P1")!;
  expect(View.task_late_said(p1, blocked, NOW + View.TASK_LATE)).toBe("");
  expect(View.task_late_said(p1, blocked, NOW + View.TASK_LATE + 3600e3)).toBe("atrasada há 25 h");
  expect(View.task_late_said(p1, blocked, NOW + 3 * View.TASK_LATE + 1)).toBe("atrasada há 3 d");
  for (const id of ["P2", "P3", "P4", "P6"]) {
    expect(View.task_late_said(tasks.find((t) => t.id === id)!, blocked, NOW + 9 * View.TASK_LATE)).toBe("");
  }
  const html = Html.desk_html(tasks, "", "", "P1", NOW + 2 * View.TASK_LATE + 1);
  expect(html.list.find((x) => x.includes('data-desk="P1"'))).toContain('<span class="late">atrasada há 2 d</span>');
  expect(html.list.find((x) => x.includes('data-desk="P2"'))).not.toContain("atrasada");
  expect(html.detail.join("")).toContain('<span class="late">atrasada há 2 d</span>');
  expect(Html.desk_html(tasks, "", "", "P1", NOW).list.join("")).not.toContain("atrasada");
});

test("PRs: GitHub pull links of the detail and origin, each once, as repo#n; a link in the row's line and over the detail", () => {
  const s = T.tasks_load(dir);
  // from outside (as the inbox makes them): links only, no PR verified (the contract holds only Unii's, R5)
  T.task_new(s, { title: "Mesclar", detail: "https://github.com/Numih/dp-bk-http/pull/42 e de novo https://github.com/Numih/dp-bk-http/pull/42, depois https://github.com/Numih/fractal/pull/57. Issue https://github.com/Numih/x/issues/3; falso http://github.com/a/b/pull/1", origin: "github", origin_url: "https://github.com/Numih/infra-tf-numih/pull/1135" }, "inbox", NOW);
  add(s, { title: "Um só", detail: "PR: https://github.com/morum/uniichat/pull/13", prs: [{ url: "https://github.com/morum/uniichat/pull/13", head: "88f1899" }] });
  add(s, { title: "Nenhum", detail: "sem links <b>" });
  const tasks = T.tasks_view(s, NOW);
  expect(View.task_prs(tasks[0])).toEqual([
    { url: "https://github.com/Numih/dp-bk-http/pull/42", label: "dp-bk-http#42" },
    { url: "https://github.com/Numih/fractal/pull/57", label: "fractal#57" },
    { url: "https://github.com/Numih/infra-tf-numih/pull/1135", label: "infra-tf-numih#1135" },
  ]);
  const html = Html.desk_html(tasks, "", "", "P1", NOW);
  expect(html.list.find((x) => x.includes('data-desk="P1"'))).toContain('<span class="pr">3 PRs</span>');
  expect(html.list.find((x) => x.includes('data-desk="P2"'))).toContain('<span class="pr">PR uniichat#13</span>');
  expect(html.list.find((x) => x.includes('data-desk="P3"'))).not.toContain('class="pr"');
  expect(html.detail.join("")).toContain('<p class="prs"><span class="lead">PRs:</span> <a class="pr" href="https://github.com/Numih/dp-bk-http/pull/42" target="_blank" rel="noopener noreferrer">dp-bk-http#42</a>');
  expect(Html.desk_html(tasks, "", "", "P3", NOW).detail.join("")).not.toContain('class="prs"');
});

test("web: a choice says it concludes, the comment comes before it; required fields marked for the browser's check", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Escolher", choices: ["Sim", "Não"], fields: [{ id: "a", label: "A", kind: "choice", choices: ["x", "y"] }, { id: "b", label: "B", kind: "text", required: false }] });
  const d = Html.desk_html(T.tasks_view(s, NOW), "", "", "P1", NOW).detail.join("");
  expect(d).toContain('<div class="opts" role="group" aria-label="Concluir como"><span class="lead">Concluir como:</span>');
  expect(d.indexOf('class="note"')).toBeLessThan(d.indexOf('class="opts"'));
  expect(d).toContain('<fieldset class="field" data-field="a" data-kind="choice" data-required="true">');
  expect(d).toContain('<fieldset class="field" data-field="b" data-kind="text">');
});

// Rodada 2 ("nada se perde", projetos/uniichat-ux-r1.md §6)
// --------------------------------------------------------

test("Próxima: from the one resolved in the middle, the next of Agora in the list's order, not the first; past the last, the top", () => {
  const s = T.tasks_load(dir);
  for (const title of ["A", "B", "C", "D", "E"]) {
    add(s, { title });
  }
  const before = T.tasks_view(s, NOW);
  const order = View.desk_list(before).flatMap((g) => g.tasks.map((t) => t.id));
  expect(order).toEqual(["P1", "P2", "P3", "P4", "P5"]);
  // still in Agora: the next after it
  expect(View.desk_next(before, "P3", "", "", order)?.id).toBe("P4");
  T.task_resolve(s, "P3", "done", null, null, NOW);
  const after = T.tasks_view(s, NOW);
  // resolved, it's in Resolvidas: the order it had says where it was
  expect(View.desk_next(after, "P3", "", "", order)?.id).toBe("P4");
  expect(Html.desk_html(after, "", "", "P3", NOW, { order }).detail.at(-1)).toContain('data-desk="P4"');
  // the last resolved: back to the top
  T.task_resolve(s, "P5", "done", null, null, NOW);
  expect(View.desk_next(T.tasks_view(s, NOW), "P5", "", "", order)?.id).toBe("P1");
  // a task skipped meanwhile (P4 resolved too): the next one still open
  T.task_resolve(s, "P4", "done", null, null, NOW);
  expect(View.desk_next(T.tasks_view(s, NOW), "P3", "", "", order)?.id).toBe("P1");
  // no order kept (or it doesn't have the one shown): the list of now
  expect(View.desk_next(T.tasks_view(s, NOW), "P3", "", "", ["P9"])?.id).toBe("P1");
});

test("a task of Unii's: 'parada há N h' from its last change, late past TASK_LATE; the agent linked, or 'sem agente'", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Acompanhar a leva de UX", assignee: "unii", ref: "uniichat-ux", agent: "WiseDolphin" });
  add(s, { title: "NUM-2337: tags e portas", assignee: "unii", ref: "num-2337" });
  add(s, { title: "Mesclar", ref: "num-2337" });
  const tasks = T.tasks_view(s, NOW);
  const [p1, p2, p3] = ["P1", "P2", "P3"].map((id) => tasks.find((t) => t.id === id)!);
  expect(p1.agent).toBe("WiseDolphin");
  expect(p2.agent).toBe(null);
  const none = new Set<string>();
  expect(View.task_stalled_said(p1, none, NOW + 30 * 60e3)).toEqual({ text: "", late: false });
  expect(View.task_stalled_said(p1, none, NOW + 3 * 3600e3)).toEqual({ text: "parada há 3 h", late: false });
  expect(View.task_stalled_said(p2, none, NOW + 28 * 3600e3)).toEqual({ text: "parada há 28 h", late: true });
  expect(View.task_stalled_said(p3, none, NOW + 28 * 3600e3).text).toBe("");
  expect(View.task_agent_said(p1)).toBe("agente WiseDolphin");
  expect(View.task_agent_said(p2)).toBe("sem agente");
  expect(View.task_agent_said(p3)).toBe("");
  const html = Html.desk_html(tasks, "", "", "P2", NOW + 28 * 3600e3);
  const row = (id: string) => html.list.find((x) => x.includes(`data-desk="${id}"`))!;
  expect(row("P1")).toContain('<span class="agent">agente WiseDolphin</span>');
  expect(row("P1")).toContain('<span class="late">parada há 28 h</span>');
  expect(row("P2")).toContain('<span class="agent none">sem agente</span>');
  expect(html.detail.join("")).toContain('<span class="late">parada há 28 h</span>');
  expect(html.detail.join("")).toContain("sem agente");
  // the tools' line says it; edited, cleared, or refused as said
  expect(T.task_line(p1, NOW)).toContain("agent WiseDolphin");
  expect((T.task_edit(s, { id: "P2", agent: "SoftMule" }, NOW) as T.Task).agent).toBe("SoftMule");
  expect((T.task_edit(s, { id: "P2", agent: "" }, NOW) as T.Task).agent).toBe(null);
  expect(T.task_edit(s, { id: "P2", agent: "um nome" }, NOW)).toContain("agent is an agent's name");
  expect(T.task_new(s, { title: "X", agent: "<b>" }, "main", NOW)).toContain("agent is an agent's name");
  // kept on disk
  T.tasks_forget();
  expect(T.task_find(T.tasks_load(dir), "P1")!.agent).toBe("WiseDolphin");
});

test("'parada há' goes on as its agent is linked, swapped or cleared; any other change (or the agent with it) moves it; kept on disk; an older list reads its last change", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "NUM-2337: tags e portas", assignee: "unii", ref: "num-2337" });
  const H = 3600e3;
  const none = new Set<string>();
  const stalled = (at: number) => View.task_stalled_said(T.task_find(s, "P1")!, none, at).text;
  // linked, swapped, cleared hours later: still stalled since it was made
  expect((T.task_edit(s, { id: "P1", agent: "SoftMule" }, NOW + 5 * H) as T.Task).moved).toBe(new Date(NOW).toISOString());
  T.task_edit(s, { id: "P1", agent: "BlackBear" }, NOW + 10 * H);
  T.task_edit(s, { id: "P1", agent: "" }, NOW + 20 * H);
  expect(T.task_find(s, "P1")!.changed).toBe(new Date(NOW + 20 * H).toISOString());
  expect(stalled(NOW + 26 * H)).toBe("parada há 26 h");
  // the same agent again: nothing moved either
  T.task_edit(s, { id: "P1", agent: "" }, NOW + 21 * H);
  expect(stalled(NOW + 26 * H)).toBe("parada há 26 h");
  // its detail changed (with an agent, too): moved
  T.task_edit(s, { id: "P1", detail: "auth#307 mesclado", agent: "SaltyMouse" }, NOW + 24 * H);
  expect(stalled(NOW + 26 * H)).toBe("parada há 2 h");
  T.task_edit(s, { id: "P1", agent: "WoodenTurtle" }, NOW + 25 * H);
  expect(stalled(NOW + 27 * H)).toBe("parada há 3 h");
  T.tasks_forget();
  expect(T.task_find(T.tasks_load(dir), "P1")!.moved).toBe(new Date(NOW + 24 * H).toISOString());
  // tasks.json of an older version (no moved): its last change
  const old = { ...T.task_find(T.tasks_load(dir), "P1")!, moved: undefined };
  expect(T.task_read(JSON.parse(JSON.stringify(old)), NOW)!.moved).toBe(old.changed);
  expect(View.task_stalled_said({ ...old, moved: undefined } as any, none, Date.parse(old.changed) + 2 * H).text).toBe("parada há 2 h");
});

test("the red of 'sem agente' (and 'atrasada'): at least 4.5:1 on every fill it may sit on, light and dark (style.css)", () => {
  const css = fs.readFileSync(import.meta.dir + "/web/style.css", "utf8");
  const dark = css.indexOf("@media (prefers-color-scheme: dark)");
  const vars = (part: string) => Object.fromEntries([...part.matchAll(/--([a-z]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = vars(css.slice(0, dark));
  const night = { ...light, ...vars(css.slice(dark, css.indexOf("}\n}", dark))) };
  const hex = (x: Record<string, string>, k: string): string => (x[k].startsWith("var(--") ? hex(x, x[k].slice(6, -1)) : x[k]);
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  expect(css).toMatch(/\.agent\.none \{[^}]*color: var\(--red\)/);
  for (const x of [light, night]) {
    for (const fill of ["paper", "lift", "block", "hover"]) {
      expect(ratio(hex(x, "red"), hex(x, fill))).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("aguardando o Unii: how long since the user wrote, and why, by Unii's turn; in the row and the detail", () => {
  const tasks = desk();
  const p4 = tasks.find((t) => t.id === "P4")!;
  const turn = (over: Partial<View.Turn> = {}): View.Turn => ({ busy: true, wait: "", limited: false, up: true, ...over });
  const at = NOW + 5 * 60e3;
  expect(View.task_talk_wait_said(p4, at)).toBe("aguardando o Unii há 5 min");
  expect(View.task_talk_wait_said(p4, at, turn({ wait: View.SUMMARIES }))).toBe("aguardando o Unii há 5 min · compactando mensagens antigas");
  expect(View.task_talk_wait_said(p4, at, turn())).toBe("aguardando o Unii há 5 min · turno em andamento");
  expect(View.task_talk_wait_said(p4, at, turn({ wait: "opus" }))).toBe("aguardando o Unii há 5 min · esperando a resposta de opus");
  expect(View.task_talk_wait_said(p4, at, turn({ busy: false }))).toBe("aguardando o Unii há 5 min · nenhum turno em andamento (o servidor pode ter reiniciado)");
  expect(View.task_talk_wait_said(p4, at, turn({ limited: true }))).toBe("aguardando o Unii há 5 min · esperando o limite de uso do serviço de IA");
  expect(View.task_talk_wait_said(p4, at, turn({ up: false }))).toBe("aguardando o Unii há 5 min · sem conexão com o servidor");
  expect(View.task_talk_wait_said(p4, NOW + 3 * 3600e3)).toBe("aguardando o Unii há 3 h");
  // Unii answered: the user's turn, as before
  expect(View.task_talk_wait_said(tasks.find((t) => t.id === "P5")!, at, turn())).toBe("sua vez");
  // the view's state read as a turn
  expect(View.turn_of({ busy: true, wait: "", limits: { [View.TURN]: { until: 0, known: true } }, up: true }).limited).toBe(true);
  expect(View.turn_of({ busy: false, wait: "", limits: {}, up: true }).limited).toBe(false);
  // no model on the server (the turn never ends): the Mesa says why
  const html = Html.desk_html(tasks, "", "", "P4", at, { turn: turn({ busy: false }) });
  expect(html.list.find((x) => x.includes('data-desk="P4"'))).toContain("aguardando o Unii há 5 min · nenhum turno em andamento");
  expect(html.detail.join("")).toContain('<span class="talk unii">aguardando o Unii há 5 min · nenhum turno em andamento (o servidor pode ter reiniciado)</span>');
});

test("blocked: its PR chips on the Mesa; what it waits for with whose it is; what a task frees, named", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Mesclar o #46", detail: "https://github.com/Numih/infra-tf-numih/pull/1127", prs: [{ url: "https://github.com/Numih/infra-tf-numih/pull/1127", head: "88f1899" }] });  // P1
  add(s, { title: "Trocar o require", assignee: "unii" });                                    // P2
  add(s, { title: "Aplicar em prod", after: ["P1", "P2"], detail: "PR: https://github.com/Numih/infra-tf-numih/pull/1128", prs: [{ url: "https://github.com/Numih/infra-tf-numih/pull/1128", head: "88f1899" }] }); // P3
  const tasks = T.tasks_view(s, NOW);
  const p3 = tasks.find((t) => t.id === "P3")!;
  expect(View.task_waits_named(tasks, p3)).toBe("aguarda P1 (sua) e P2 (do Unii)");
  expect(View.task_frees_named(tasks, tasks[0])).toBe("libera P3");
  const d = Html.desk_html(tasks, "", "", "P3", NOW).detail.join("");
  expect(d).toContain('<a class="pr" href="https://github.com/Numih/infra-tf-numih/pull/1128" target="_blank" rel="noopener noreferrer">infra-tf-numih#1128</a>');
  expect(d).toContain('Só pode ser resolvida depois de: <button class="goto" data-desk="P1">P1 (sua)</button> e <button class="goto" data-desk="P2">P2 (do Unii)</button>.');
  const list = Html.desk_html(tasks, "", "", "P1", NOW).list;
  expect(list.find((x) => x.includes('data-desk="P3"'))).toContain("aguarda P1 (sua) e P2 (do Unii)");
  expect(list.find((x) => x.includes('data-desk="P1"'))).toContain('<span class="frees">libera P3</span>');
  expect(Html.tasks_html(tasks).waiting[0]).toContain("aguarda P1 (sua) e P2 (do Unii)");
  // many freed: the first ones and how many more, through others too
  for (const title of ["D", "E", "F", "G"]) {
    add(s, { title, after: ["P3"] });
  }
  const more = T.tasks_view(s, NOW);
  expect(View.task_frees_named(more, more.find((t) => t.id === "P1")!)).toBe("libera P3, P4 e mais 3");
  expect(View.and_said(["P1", "P2", "P3"])).toBe("P1, P2 e P3");
});
