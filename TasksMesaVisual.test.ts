// TasksMesaVisual.test
// ====================
// `bun test TasksMesaVisual.test.ts`: the Mesa visual round. Whose move
// a task is (TaskDeps.user_move: "sua vez" only with a step of the
// user's; Unii's reply in the thread of a task of Unii's is news, the
// bug that kept such tasks "sua vez" for good), read the same by the
// Mesa's Agora, the count and the pushes; the line that says it first
// (View.task_turn_said); the ficha beside (Html.desk_html), every value
// escaped; the limit said (View.task_limit_said); the Conversa without
// the list (web/index.html, main.ts), on chats in a temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Deps from "./TaskDeps.ts";
import * as TaskPush from "./TaskPush.ts";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Render.tsx";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-mesa-visual-");
const NOW  = Date.parse("2026-10-26T12:00:00Z");
const H    = 3600e3;
let dir    = "";

beforeEach(() => {
  T.tasks_forget();
  dir = fs.mkdtempSync(ROOT + "/chat-");
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function add(s: T.Store, args: T.Edit, now = NOW): T.Task {
  const t = T.task_new(s, { origin: "chat", ...args }, "main", now);
  if (typeof t === "string") {
    throw new Error(t);
  }
  return t;
}

const shown = (tasks: T.Task[], id: string, now = NOW) => Html.desk_html(tasks, "", "", id, now).detail.join("");
const group = (tasks: T.Task[], id: string) => View.desk_group(tasks.find((t) => t.id === id)!, Deps.blocked_ids(tasks));

test("user_move: the user's own and open, or Unii's waiting for them; never waiting for Unii, for others, blocked or closed", () => {
  const base = { id: "P1", state: "open", after: [] as string[] };
  const no = new Set<string>();
  expect(Deps.user_move({ ...base, assignee: "user" }, no)).toBe(true);
  expect(Deps.user_move({ ...base, assignee: "user", talk: "user" }, no)).toBe(true);
  expect(Deps.user_move({ ...base, assignee: "unii", talk: "user" }, no)).toBe(false);
  expect(Deps.user_move({ ...base, assignee: "unii", status: "waiting_user" }, no)).toBe(true);
  expect(Deps.user_move({ ...base, assignee: "unii", status: "waiting_user", talk: "unii" }, no)).toBe(false);
  expect(Deps.user_move({ ...base, assignee: "user", talk: "unii" }, no)).toBe(false);
  expect(Deps.user_move({ ...base, assignee: "user" }, new Set(["P1"]))).toBe(false);
  expect(Deps.user_move({ ...base, assignee: "user", status: "blocked" }, no)).toBe(false);
  expect(Deps.user_move({ ...base, state: "done", assignee: "user" }, no)).toBe(false);
  expect(Deps.user_move({ ...base, assignee: "agente-x", talk: "user" }, no)).toBe(false);
  // an older list's task, no assignee: the user's
  expect(Deps.user_move(base, no)).toBe(true);
});

test("the bug: a task of Unii's the user talked about stays out of Agora once Unii replies (reply or the turn's end), till Unii waits for the user", () => {
  const s = T.tasks_load(dir);
  const unii = add(s, { title: "Corrigir as portas", assignee: "unii", next_step: "relato do agente" });
  const mine = add(s, { title: "Aprovar o PR", choices: ["Mesclar", "Corrigir antes"] });
  T.task_say(s, unii.id, "Qual é o andamento?", NOW);
  T.task_say(s, mine.id, "Pode resumir?", NOW);
  let tasks = T.tasks_view(s, NOW);
  expect(group(tasks, unii.id)).toBe("unii");
  expect(group(tasks, mine.id)).toBe("unii");
  // the reply by task_reply, the other by the turn's end (tasks_talked)
  T.task_reply(s, unii.id, "O agente corrige; volto com o relato.", NOW + 60e3);
  T.tasks_talked(s, "Resumo: corrige duas ressalvas.", NOW + 2 * 60e3);
  tasks = T.tasks_view(s, NOW + 3 * 60e3);
  expect(T.task_find(s, unii.id)!.talk).toBe("user");
  expect(T.task_find(s, mine.id)!.talk).toBe("user");
  // Unii's: news, no step of the user's
  expect(group(tasks, unii.id)).toBe("others");
  expect(View.task_talk_said(tasks.find((t) => t.id === unii.id)!)).toBe("Unii respondeu");
  // the user's own: their turn, as it should
  expect(group(tasks, mine.id)).toBe("now");
  expect(View.task_talk_said(tasks.find((t) => t.id === mine.id)!)).toBe("sua vez");
  // one rule for the Agora, the count (tab, badge) and the pushes
  expect(TaskPush.turn_count(tasks)).toBe(1);
  expect(TaskPush.actionable(tasks)).toEqual([mine.id]);
  expect(View.desk_turn(tasks.filter((t) => t.id === unii.id))).toBe(false);
  const d = shown(tasks, unii.id, NOW + 3 * 60e3);
  expect(d).toContain('<span class="talk replied">Unii respondeu</span>');
  expect(d).not.toContain("sua vez");
  expect(d).toContain('<p class="turn-line others"><strong>Com o Unii</strong> Nada a fazer agora. O Unii respondeu na conversa. Próximo passo: relato do agente. Você pode cobrar o andamento ou liberar para fechar.</p>');
  // the row says it too, quiet
  const row = Html.desk_html(tasks, "", "", null, NOW).list.find((x) => x.includes(`data-desk="${unii.id}"`))!;
  expect(row).toContain('class="row others"');
  expect(row).toContain('<span class="talk replied">Unii respondeu</span>');
  // Unii tells the user it waits for them: now theirs
  expect(typeof T.task_edit(s, { id: unii.id, status: "waiting_user", status_why: "o token do Slack" }, NOW + 4 * 60e3)).not.toBe("string");
  tasks = T.tasks_view(s, NOW + 5 * 60e3);
  expect(group(tasks, unii.id)).toBe("now");
  expect(View.task_talk_said(tasks.find((t) => t.id === unii.id)!)).toBe("sua vez");
  expect(shown(tasks, unii.id, NOW + 5 * 60e3)).toContain('<p class="turn-line user"><strong>Sua vez</strong> O Unii aguarda você: o token do Slack. Responda na conversa desta pendência.</p>');
  expect(TaskPush.turn_count(tasks)).toBe(2);
});

test("a task the user talked about, handed to Unii, or waiting for others, isn't the user's move; Unii is told it replied, not that it's the user's turn", () => {
  const s = T.tasks_load(dir);
  const a = add(s, { title: "Revisar" });
  const b = add(s, { title: "Aplicar", after: [a.id] });
  T.task_say(s, a.id, "Posso?", NOW);
  T.task_reply(s, a.id, "Pode.", NOW);
  T.task_say(s, b.id, "E esta?", NOW);
  T.task_reply(s, b.id, "Depois da outra.", NOW);
  expect(typeof T.task_edit(s, { id: a.id, assignee: "unii", next_step: "revisar", done_when: "revisado" }, NOW)).not.toBe("string");
  const tasks = T.tasks_view(s, NOW);
  expect(group(tasks, a.id)).toBe("others");
  expect(group(tasks, b.id)).toBe("waiting");
  expect(View.task_talk_said(tasks.find((t) => t.id === b.id)!, Deps.blocked_ids(tasks))).toBe("Unii respondeu");
  expect(TaskPush.turn_count(tasks)).toBe(0);
  expect(T.task_line(T.task_find(s, a.id)!, NOW, true, s.tasks)).toContain("you replied; the next step is yours, not the user's");
  const c = add(s, { title: "Minha" });
  T.task_say(s, c.id, "?", NOW);
  T.task_reply(s, c.id, "!", NOW);
  expect(T.task_line(T.task_find(s, c.id)!, NOW, true, s.tasks)).toContain("the user's turn");
});

test("the line that says whose move first: what's expected of the user (fields left, the choice recommended, the kind and how late)", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "Vigia", kind: "decision", choices: ["Sim", "Não"], recommend: "Sim", fields: [
    { id: "lim", label: "Limite", kind: "choice", choices: ["5", "10"], required: true },
    { id: "acao", label: "Ação", kind: "choice", choices: ["avisar", "retomar"], required: true },
    { id: "obs", label: "Obs", kind: "text", required: false },
  ] }, NOW - 80 * H);
  let tasks = T.tasks_view(s, NOW);
  const said = View.task_turn_said(tasks[0], tasks, NOW);
  expect(said).toEqual({ cls: "user", lead: "Sua vez", text: "Preencha 2 campos obrigatórios e escolha uma das 2 opções (recomendada: “Sim”). Decisão, prazo 72 h; atrasada há 3 d." });
  T.task_draft(s, t.id, { lim: "10" });
  tasks = T.tasks_view(s, NOW);
  expect(View.task_turn_said(tasks[0], tasks, NOW).text).toStartWith("Preencha o campo obrigatório “Ação” e escolha");
  expect(View.task_fields_left(tasks[0]).map((f) => f.id)).toEqual(["acao"]);
  // the ficha counts them
  expect(shown(tasks, t.id)).toContain("<dt>Campos</dt><dd>1 de 3 respondidos; faltam: Ação</dd>");
  // one choice; none
  const one = add(s, { title: "Assinar", choices: ["Assinei"] });
  const none = add(s, { title: "Ler" });
  tasks = T.tasks_view(s, NOW);
  expect(View.task_turn_said(tasks.find((x) => x.id === one.id)!, tasks, NOW).text).toBe("Conclua como “Assinei” ou descarte.");
  expect(View.task_turn_said(tasks.find((x) => x.id === none.id)!, tasks, NOW).text).toBe("Conclua ou descarte.");
  // blocked by its status: no move of the user's
  expect(typeof T.task_edit(s, { id: none.id, status: "blocked", status_why: "o CI caiu", unblock: "o CI voltar" }, NOW)).not.toBe("string");
  tasks = T.tasks_view(s, NOW);
  expect(group(tasks, none.id)).toBe("others");
  expect(View.task_turn_said(tasks.find((x) => x.id === none.id)!, tasks, NOW)).toEqual({ cls: "others", lead: "Bloqueada", text: "o CI caiu. Desbloqueia: o CI voltar." });
});

test("the ficha: whose, origin, front, kind, priority, limit, next step, done when, outside wait, depends and frees, PRs with verdict, thread, dates; every value escaped", () => {
  const s = T.tasks_load(dir);
  const bad = "<img src=x onerror=alert(1)>";
  const a = add(s, { title: "Base", ref: "r1", ref_new: true });
  const t = add(s, {
    title: "PR", kind: "pr", priority: "high", ref: "r1", assignee: "unii", agent: "GrayShark", next_step: bad, done_when: bad, waits_for: bad,
    origin: "slack", origin_url: "https://numih.slack.com/archives/C1/p2", after: [a.id],
    prs: [{ url: "https://github.com/morum/uniichat/pull/20", head: "8c80f79", verdict: "rejected", verifier: "X", notes: [], untested: [] }],
  }, NOW - 2 * H);
  add(s, { title: "Depois", after: [t.id] });
  const tasks = T.tasks_view(s, NOW);
  const html = Html.desk_html(tasks, "", "", t.id, NOW).detail.join("");
  expect(html).not.toContain("<img");
  const ficha = html.slice(html.indexOf('<aside class="facts"'));
  for (const fact of [
    "<dt>Responsável</dt><dd>Unii</dd>",
    "<dt>Agente</dt><dd>GrayShark</dd>",
    '<dt>Origem</dt><dd><a class="origin" title="Origem" href="https://numih.slack.com/archives/C1/p2"',
    '<dt>Frente</dt><dd><span class="ref">r1</span></dd>',
    "<dt>Tipo</dt><dd>aprovação de PR, prazo 24 h</dd>",
    "<dt>Prioridade</dt><dd>alta</dd>",
    "<dt>Próximo passo</dt><dd>&lt;img src=x onerror=alert(1)&gt;</dd>",
    "<dt>Pronto quando</dt><dd>&lt;img src=x onerror=alert(1)&gt;</dd>",
    "<dt>Aguarda (fora da lista)</dt><dd>&lt;img src=x onerror=alert(1)&gt;</dd>",
    '<dt>Depende de</dt><dd><button class="goto" data-desk="P1">P1 (sua)</button></dd>',
    '<dt>Libera</dt><dd><button class="goto" data-desk="P3">P3 (sua)</button></dd>',
    '<dt>PR</dt><dd><span class="pr-fact"><a class="pr" href="https://github.com/morum/uniichat/pull/20" target="_blank" rel="noopener noreferrer">uniichat#20</a> <span class="verdict rejected">reprovado</span> <code>8c80f79</code></span></dd>',
    '<dt>Criada</dt><dd><time dateTime="2026-10-26T10:00:00.000Z">',
  ]) {
    expect(ficha).toContain(fact);
  }
  // waiting for P1: its ficha still shows, the line says what it waits for
  expect(html).toContain('<p class="turn-line waiting"><strong>Aguardando outras pendências</strong> Só pode ser resolvida depois de P1 (sua).</p>');
  // a closed one: when, the answer, the comment
  T.task_resolve(s, a.id, "done", null, "feito <b>", NOW);
  const closed = shown(T.tasks_view(s, NOW), a.id);
  expect(closed).toContain('<p class="turn-line closed"><strong>Concluída</strong>');
  expect(closed).toContain("<dt>Resolvida</dt>");
  expect(closed).toContain("<dt>Comentário</dt><dd>feito &lt;b&gt;</dd>");
  expect(closed).not.toContain("<b>");
});

test("the limit: the user's by its kind, past due said, waiting for Unii not late; someone else's next step's due; ago and ahead", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "Teste", kind: "test" }, NOW - H);
  const info = add(s, { title: "Ler", kind: "info" }, NOW - H);
  const u = add(s, { title: "Do Unii", assignee: "unii", next_step: "x", next_due: new Date(NOW + 3 * H).toISOString() });
  let tasks = T.tasks_view(s, NOW);
  const of = (id: string) => View.task_limit_said(tasks.find((x) => x.id === id)!, tasks, NOW);
  expect(of(t.id)).toMatch(/^vence \d\d\/\d\d, \d\d:\d\d \(em 1 h\)$/);
  expect(of(info.id)).toBe("sem prazo");
  expect(of(u.id)).toMatch(/^próximo passo até \d\d\/\d\d, \d\d:\d\d \(em 3 h\)$/);
  tasks = T.tasks_view(s, NOW + 3 * H);
  expect(View.task_limit_said(tasks.find((x) => x.id === t.id)!, tasks, NOW + 3 * H)).toMatch(/^atrasada há 4 h; venceu \d\d\/\d\d, \d\d:\d\d$/);
  T.task_say(s, t.id, "?", NOW + 3 * H);
  tasks = T.tasks_view(s, NOW + 3 * H);
  expect(View.task_limit_said(tasks.find((x) => x.id === t.id)!, tasks, NOW + 3 * H)).toMatch(/^venceu .* \(há 2 h; aguardando o Unii\)$/);
  expect(View.task_limit_said(tasks.find((x) => x.id === u.id)!, tasks, NOW + 4 * H)).toMatch(/\(vencido há 1 h\)$/);
  expect([View.ago_said(new Date(NOW).toISOString(), NOW + 30e3), View.ago_said(new Date(NOW).toISOString(), NOW + 5 * 60e3), View.ago_said(new Date(NOW + 2 * H).toISOString(), NOW), View.ago_said("x", NOW)]).toEqual(["agora", "há 5 min", "em 2 h", ""]);
});

test("the Conversa shows no list: only the rail's Mesa with its count; the Mesa's article in two columns, stacked on a phone", () => {
  const html = fs.readFileSync(import.meta.dir + "/web/index.html", "utf8");
  expect(html).not.toContain('id="tasks"');
  expect(html).not.toContain('class="tasks"');
  const app = fs.readFileSync(import.meta.dir + "/web/src/App.tsx", "utf8");
  expect(app).not.toContain('"#tasks');
  expect(app).not.toContain("tasks_bar");
  expect(app).toContain('label="Mesa" here={place === "desk"} badge={turn}');
  expect("tasks_html" in Html).toBe(false);
  const css = fs.readFileSync(import.meta.dir + "/web/style.css", "utf8");
  expect(css).not.toContain("#tasks");
  // the brand's mark (a mask) no longer catches the task's marks
  expect(css).toContain("i.mark { display: block;");
  expect(css).toMatch(/#desk article \.cols \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(240px, 300px\);/);
  expect(css).toMatch(/@media \(max-width: 760px\) \{\n  #desk article :is\(\.cols, \.main, \.decide\) \{ display: contents; \}/);
});

// Correção 1 da Verificação Mesa visual (baixa 2): on a phone the acts
// stay at the screen's bottom through the whole task, the ficha too: a
// sticky bottom only holds a box above its own place, so their place is
// the article's last (the article a flex column, the acts order 1)
test("phone: the acts are the article's last item (sticky through the ficha too)", () => {
  const css = fs.readFileSync(import.meta.dir + "/web/style.css", "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 760px) {\n  #desk article :is(.cols"));
  const block = phone.slice(0, phone.indexOf("\n}\n"));
  expect(block).toContain("#desk article.task { display: flex; flex-direction: column; }");
  expect(block).toContain("#desk article :is(.decide, .main) > .acts { order: 1; }");
  expect(block).toMatch(/#desk article :is\(\.decide, \.main\) > \.acts \{ position: sticky; bottom:/);
  // the ficha keeps order 0: before the acts
  expect(block).toContain("#desk article .facts { order: 0;");
  // every article the Mesa shows is a .task (the rule reaches both kinds)
  const s = T.tasks_load(dir);
  const mine = add(s, { title: "Minha" });
  const unii = add(s, { title: "Do Unii", assignee: "unii", next_step: "x" });
  const tasks = T.tasks_view(s, NOW);
  expect(shown(tasks, mine.id)).toMatch(/<article class="task user[^"]*"/);
  expect(shown(tasks, unii.id)).toMatch(/<article class="task other unii[^"]*"/);
  expect(shown(tasks, mine.id)).toContain('<section class="decide" aria-label="Decisão">');
});

// baixa 3: a turn that ends with no reply to the user's message in a
// task's thread (failed, halted, the server restarted) gives the task
// back marked: "Unii não respondeu", not "sua vez" as if Unii had
// answered; the move stays whose it was (the user's own: theirs; one of
// Unii's: not theirs), and Unii's next turn is told to reply
test("a turn with no reply: 'Unii não respondeu', the move unchanged, Unii told; a real reply clears it", () => {
  const s = T.tasks_load(dir);
  const mine = add(s, { title: "Aprovar o PR", choices: ["Mesclar", "Corrigir antes"] });
  const unii = add(s, { title: "Corrigir as portas", assignee: "unii", next_step: "relato" });
  T.task_say(s, mine.id, "Pode resumir?", NOW);
  T.task_say(s, unii.id, "Andamento?", NOW);
  T.tasks_talked(s, null, NOW + 60e3);
  let tasks = T.tasks_view(s, NOW + 2 * 60e3);
  const m = tasks.find((t) => t.id === mine.id)!;
  const u = tasks.find((t) => t.id === unii.id)!;
  expect(m.thread[m.thread.length - 1]).toMatchObject({ who: "unii", none: true });
  expect(Deps.task_missed(m)).toBe(true);
  expect(Deps.task_missed(u)).toBe(true);
  expect(View.task_talk_said(m)).toBe("Unii não respondeu");
  expect(View.task_talk_said(u)).toBe("Unii não respondeu");
  expect(View.talk_cls(View.MISSED)).toBe("missed");
  // the move: the user's own stays theirs (they may still decide), Unii's not
  expect(group(tasks, mine.id)).toBe("now");
  expect(group(tasks, unii.id)).toBe("others");
  expect(TaskPush.turn_count(tasks)).toBe(1);
  const dm = shown(tasks, mine.id, NOW + 2 * 60e3);
  expect(dm).toContain('<span class="talk missed">Unii não respondeu</span>');
  expect(dm).toContain("O Unii não respondeu à sua última mensagem na conversa");
  expect(dm).not.toContain('<span class="talk user">sua vez</span>');
  expect(shown(tasks, unii.id, NOW + 2 * 60e3)).toContain("O Unii não respondeu à sua última mensagem na conversa");
  // Unii is told, next turn
  expect(T.task_line(T.task_find(s, unii.id)!, NOW, true, s.tasks)).toContain("your turn ended with no reply to the user's message in its thread: reply with task_reply");
  expect(T.task_line(T.task_find(s, mine.id)!, NOW, true, s.tasks)).toContain("the user still waits for one");
  // kept across a reload (the server restarted)
  T.tasks_forget();
  expect(Deps.task_missed(T.task_find(T.tasks_load(dir), mine.id)!)).toBe(true);
  // a failed turn too
  const s2 = T.tasks_load(dir);
  T.task_say(s2, mine.id, "De novo?", NOW + 3 * 60e3);
  T.tasks_talked(s2, null, NOW + 4 * 60e3, "down");
  expect(Deps.task_missed(T.task_find(s2, mine.id)!)).toBe(true);
  // Unii's reply clears it (task_reply, or a turn's last reply)
  T.task_reply(s2, mine.id, "Resumo: mesclar.", NOW + 5 * 60e3);
  T.task_say(s2, unii.id, "E aí?", NOW + 5 * 60e3);
  T.tasks_talked(s2, "Corrigindo.", NOW + 6 * 60e3);
  tasks = T.tasks_view(s2, NOW + 7 * 60e3);
  expect(Deps.task_missed(tasks.find((t) => t.id === mine.id)!)).toBe(false);
  expect(View.task_talk_said(tasks.find((t) => t.id === mine.id)!)).toBe("sua vez");
  expect(View.task_talk_said(tasks.find((t) => t.id === unii.id)!)).toBe("Unii respondeu");
  // a hand-made none on the user's message is not read
  expect(Deps.task_missed({ talk: "user", thread: [{ who: "user", none: true }] })).toBe(false);
});

// baixa 1 (P85, decided by the user): a task with waits_for set is a
// wait: out of Agora, no push, not in "Mesa · N", not late; the line
// says what it waits for; the wait removed, it's the user's again, its
// lateness counted from then (ready)
test("waits_for: a wait (P85): out of Agora, no push, not counted, not late; back to Agora when cleared", () => {
  const s = T.tasks_load(dir);
  const ci = add(s, { title: "Aplicar em hom", kind: "test", waits_for: "CI do #42" }, NOW - 10 * H);
  const free = add(s, { title: "Aprovar", kind: "test" }, NOW - 10 * H);
  const unii = add(s, { title: "Do Unii", assignee: "unii", next_step: "x" }, NOW - 10 * H);
  expect(typeof T.task_edit(s, { id: unii.id, status: "waiting_user", status_why: "o token", waits_for: "deploy" }, NOW - 10 * H)).not.toBe("string");
  let tasks = T.tasks_view(s, NOW);
  const blocked = Deps.blocked_ids(tasks);
  const of = (id: string) => tasks.find((t) => t.id === id)!;
  expect(Deps.user_move(of(ci.id), blocked)).toBe(false);
  expect(Deps.user_move(of(unii.id), blocked)).toBe(false);
  expect(Deps.user_move({ id: "P9", state: "open", assignee: "user", waits_for: "  " }, blocked)).toBe(true);
  expect(group(tasks, ci.id)).toBe("others");
  expect(group(tasks, unii.id)).toBe("others");
  expect(group(tasks, free.id)).toBe("now");
  expect(TaskPush.turn_count(tasks)).toBe(1);
  expect(TaskPush.actionable(tasks)).toEqual([free.id]);
  // not late, though past a test's 2 h; the free one is
  expect(View.task_late_said(of(ci.id), blocked, NOW)).toBe("");
  expect(View.task_late_said(of(free.id), blocked, NOW)).toContain("atrasada");
  expect(View.task_limit_said(of(ci.id), tasks, NOW)).toBe("em espera: o prazo conta quando a espera acabar");
  const said = View.task_turn_said(of(ci.id), tasks, NOW);
  expect(said).toEqual({ cls: "waiting", lead: "Aguardando", text: "Espera algo fora da lista: CI do #42. Nada a fazer até lá; volta para Agora quando a espera for retirada." });
  const d = shown(tasks, ci.id, NOW);
  expect(d).toContain('<p class="turn-line waiting"><strong>Aguardando</strong>');
  expect(d).not.toContain("Sua vez");
  // Unii's reply in its thread: news, not "sua vez"
  T.task_say(s, ci.id, "E o CI?", NOW);
  T.task_reply(s, ci.id, "Rodando.", NOW);
  tasks = T.tasks_view(s, NOW);
  expect(View.task_talk_said(tasks.find((t) => t.id === ci.id)!)).toBe("Unii respondeu");
  // the wait removed: the user's again, late counted from now
  expect(typeof T.task_edit(s, { id: ci.id, waits_for: "" }, NOW + H)).not.toBe("string");
  tasks = T.tasks_view(s, NOW + H);
  expect(group(tasks, ci.id)).toBe("now");
  expect(TaskPush.actionable(tasks).sort()).toEqual([ci.id, free.id].sort());
  expect(View.task_late_said(tasks.find((t) => t.id === ci.id)!, Deps.blocked_ids(tasks), NOW + H + 60e3)).toBe("");
  expect(View.task_late_said(tasks.find((t) => t.id === ci.id)!, Deps.blocked_ids(tasks), NOW + 4 * H)).toContain("atrasada");
});
