// TasksRecommend.test
// ===================
// `bun test TasksRecommend.test.ts`: Unii's recommendation (a task's
// recommend, a field's) through the store and the views, and "Aceitar as
// recomendadas" (P2, 25/10/2026), on chats in a temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-recommend-");
const NOW  = Date.parse("2026-10-25T12:00:00Z");
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

const FIELDS = [
  { id: "aviso", label: "Avisar o Unii", kind: "choice", choices: ["sempre, em lote de 60 s", "só quando pede ação", "manual"], recommend: "sempre, em lote de 60 s" },
  { id: "dias", label: "Dias", kind: "multi", choices: ["seg", "ter", "qua"], recommend: ["seg", "qua"] },
  { id: "pt", label: "Interface em português?", kind: "yesno", recommend: "sim" },
  { id: "obs", label: "Observação", kind: "text", required: false, recommend: "nenhuma" },
  { id: "prazo", label: "Prazo", kind: "text" },
];

test("store: recommend is one of the choices (any case), kept on reload; a field's must be an answer it takes; bad ones refused", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "Reiniciar?", choices: ["Sim, reinicie", "Eu reinicio depois"], recommend: "sim, reinicie", fields: FIELDS });
  expect(t.recommend).toBe("Sim, reinicie");
  expect(t.fields.map((f) => f.recommend)).toEqual(["sempre, em lote de 60 s", ["seg", "qua"], "sim", "nenhuma", undefined]);
  T.tasks_forget();
  const back = T.task_find(T.tasks_load(dir), t.id)!;
  expect(back.recommend).toBe("Sim, reinicie");
  expect(back.fields[1].recommend).toEqual(["seg", "qua"]);
  // refused: not a choice; none to pick from; a field's not among its choices
  expect(T.task_new(s, { title: "X", choices: ["a", "b"], recommend: "c" }, "main", NOW)).toBe("recommend is one of the choices: a | b.");
  expect(T.task_new(s, { title: "Y", recommend: "a" }, "main", NOW)).toBe("recommend is one of the task's choices, and it has none.");
  expect(T.task_new(s, { title: "Z", fields: [{ id: "a", label: "A", kind: "choice", choices: ["x", "y"], recommend: "w" }] }, "main", NOW)).toStartWith("Field a: recommend must be one of its choices");
  expect(T.task_new(s, { title: "W", fields: [{ id: "a", label: "A", kind: "choice", choices: ["x", "y"], recommend: ["x", "y"] }] }, "main", NOW)).toStartWith("Field a: recommend must be one of its choices");
  // a hand-edited file: a recommend not a choice read as none
  const file = JSON.parse(fs.readFileSync(dir + "/tasks.json", "utf8"));
  file.tasks[0].recommend = "talvez";
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify(file));
  T.tasks_forget();
  expect(T.task_find(T.tasks_load(dir), t.id)!.recommend).toBeNull();
});

test("edit: recommend set, cleared with \"\", dropped when its choice goes; Unii's line says it", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "Mesclar?", choices: ["Mesclado", "Corrija antes"] });
  expect((T.task_edit(s, { id: t.id, recommend: "Corrija antes" }, NOW) as T.Task).recommend).toBe("Corrija antes");
  expect(T.task_line(T.task_find(s, t.id)!, NOW)).toContain("options: Mesclado | Corrija antes (recommended: Corrija antes)");
  expect(T.task_edit(s, { id: t.id, recommend: "Outro" }, NOW)).toBe("recommend is one of the choices: Mesclado | Corrija antes.");
  expect((T.task_edit(s, { id: t.id, choices: ["Mesclado", "Outro PR"] }, NOW) as T.Task).recommend).toBeNull();
  expect((T.task_edit(s, { id: t.id, recommend: "Outro PR" }, NOW) as T.Task).recommend).toBe("Outro PR");
  expect((T.task_edit(s, { id: t.id, recommend: "" }, NOW) as T.Task).recommend).toBeNull();
  const f = add(s, { title: "Campos", fields: FIELDS });
  expect(T.task_line(f, NOW)).toContain("aviso* \"Avisar o Unii\" (choice: sempre, em lote de 60 s | só quando pede ação | manual, recommended: sempre, em lote de 60 s)");
  expect(T.task_line(f, NOW)).toContain("dias* \"Dias\" (multi: seg | ter | qua, recommended: seg + qua)");
});

test("view: the recommendation given, else a choice marked (recomendado) in its text, the only one so marked", () => {
  const s = T.tasks_load(dir);
  const given = add(s, { title: "A", choices: ["x", "y"], recommend: "y" });
  const marked = add(s, { title: "B", choices: ["Corrija antes (recomendado)", "Mesclado"] });
  const twice = add(s, { title: "C", choices: ["a (recomendada)", "b (recomendada)"] });
  const none = add(s, { title: "D", choices: ["a", "b"] });
  expect(View.task_rec(given)).toBe("y");
  expect(View.task_rec(marked)).toBe("Corrija antes (recomendado)");
  expect(View.task_rec(twice)).toBeNull();
  expect(View.task_rec(none)).toBeNull();
  const f = add(s, { title: "E", fields: [{ id: "a", label: "A", kind: "choice", choices: ["um (recomendado)", "dois"] }, { id: "b", label: "B", kind: "multi", choices: ["p (recomendada)", "q", "r (Recomendada)"] }, { id: "c", label: "C", kind: "text" }] });
  expect(f.fields.map(View.field_rec)).toEqual(["um (recomendado)", ["p (recomendada)", "r (Recomendada)"], undefined]);
});

test("accept: who offers it; the given answers kept, the empty take the recommended; a required one with none: said, nothing sent", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "Decisões", choices: ["Pode seguir", "Espere"], recommend: "Pode seguir", fields: FIELDS });
  expect(View.task_accepts(t)).toBe(true);
  // prazo (required, no recommendation) missing
  expect(View.task_accept(t, {})).toBe("Sem recomendação para o campo obrigatório “Prazo”: responda esse campo e conclua.");
  const got = View.task_accept(t, { prazo: "sexta", dias: ["ter"], obs: "" });
  expect(got).toEqual({ answer: "Pode seguir", fields: { aviso: "sempre, em lote de 60 s", dias: ["ter"], pt: "sim", obs: "nenhuma", prazo: "sexta" } });
  // the fill alone (main.ts puts it in the form even with a required one left): hom taken, prazo empty
  expect(View.task_accept_fill(t, { dias: [] })).toEqual({ aviso: "sempre, em lote de 60 s", dias: ["seg", "qua"], pt: "sim", obs: "nenhuma" });
  // choices with none recommended, fields recommended: offered, only to fill (R1)
  const fill = add(s, { title: "Sem", choices: ["a", "b"], fields: [{ id: "a", label: "A", kind: "yesno", recommend: "não" }] });
  expect(View.task_accepts(fill)).toBe(true);
  expect(View.task_accept_mode(fill)).toBe("fill");
  expect(View.task_accept_mode(t)).toBe("conclude");
  // choices with nothing recommended at all: not offered
  expect(View.task_accept_mode(add(s, { title: "Nada", choices: ["a", "b"], fields: [{ id: "a", label: "A", kind: "yesno" }] }))).toBeNull();
  // fields alone: offered
  expect(View.task_accepts(add(s, { title: "Só campos", fields: [{ id: "a", label: "A", kind: "yesno", recommend: "não" }] }))).toBe(true);
  // Unii's, or closed: not offered
  expect(View.task_accepts(add(s, { title: "Do Unii", assignee: "unii", choices: ["a", "b"], recommend: "a" }))).toBe(false);
  // the act: as a Task done, the draft as the answers given
  const v = View.view_new();
  T.task_draft(s, t.id, { prazo: "amanhã" });
  v.tasks = T.tasks_view(s, NOW);
  expect(View.view_act(v, { $: "TaskAccept", task: t.id, note: "ok" })).toEqual([{ $: "task", task: t.id, state: "done", answer: "Pode seguir", note: "ok", fields: { aviso: "sempre, em lote de 60 s", dias: ["seg", "qua"], pt: "sim", obs: "nenhuma", prazo: "amanhã" } }]);
  expect(View.view_act(v, { $: "TaskAccept", task: "P99" })).toEqual([]);
  // the server takes it: concluded with those answers
  const done = T.task_resolve(s, t.id, "done", "Pode seguir", null, NOW, { aviso: "sempre, em lote de 60 s", dias: ["seg", "qua"], pt: "sim", obs: "nenhuma", prazo: "amanhã" }) as T.Task;
  expect(done.state).toBe("done");
  expect(done.answers).toEqual({ aviso: "sempre, em lote de 60 s", dias: ["seg", "qua"], pt: "sim", obs: "nenhuma", prazo: "amanhã" });
});

test("web: the recommended choice framed and tagged (not twice if its text says it), Aceitar with key a; none on Unii's; terminal marks it", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "Decisões", choices: ["Pode seguir", "Espere"], recommend: "Pode seguir", fields: FIELDS.slice(0, 4) });
  const m = add(s, { title: "Marcada", choices: ["Corrija antes (recomendado)", "Mesclado"] });
  const u = add(s, { title: "Do Unii", assignee: "unii", choices: ["a", "b"], recommend: "a" });
  const tasks = T.tasks_view(s, NOW);
  const desk = (id: string) => Html.desk_html(tasks, "", "", id, NOW).detail.join("");
  const html = desk(t.id);
  expect(html).toContain('<button class="opt rec"');
  expect(html).toContain('>Pode seguir <span class="rec-tag">recomendada</span></button>');
  expect(html).toContain('<button class="accept" aria-keyshortcuts="a" title="Atalho: a"');
  expect(html).toContain(">Aceitar as recomendadas</button>");
  expect(html).toContain('<label class="rec"><input type="checkbox" name="f-' + t.id + '-dias" value="seg"> seg <span class="rec-tag">recomendada</span></label>');
  expect(html).toContain('<p class="rec-text"><span class="rec-tag">recomendado</span> nenhuma</p>');
  expect(html).toContain("O Unii é avisado sozinho em até 1 min.");
  expect(html).not.toContain("Avisar o Unii agora");
  const marked = desk(m.id);
  expect(marked).toContain(">Corrija antes (recomendado)</button>");
  expect(marked).not.toContain("rec-tag");
  expect(marked).toContain(">Aceitar a recomendada</button>");
  const theirs = desk(u.id);
  expect(theirs).not.toContain('class="accept"');
  expect(theirs).toContain(">Cobrar agora</button>");
  expect(theirs).toContain(">Pode fechar</button>");
  // Unii already asked, not replied: Cobrar disabled, said why
  T.task_say(s, u.id, View.CHASE, NOW);
  const asked = Html.desk_html(T.tasks_view(s, NOW), "", "", u.id, NOW).detail.join("");
  // why: visible text, the button's description (R3), not a title alone
  expect(asked).toContain('<button class="chase" disabled aria-describedby="chase-why-' + u.id + '"');
  expect(asked).toContain('<span class="hint" id="chase-why-' + u.id + '">Você já cobrou e o Unii ainda não respondeu. “Cobrar agora” volta quando ele responder na conversa.</span>');
  expect(asked).not.toContain('title="O Unii ainda não respondeu');
  expect(asked).toContain(">Cobrado: aguardando o Unii</button>");
  // terminal
  const v = View.view_new();
  v.tasks = tasks;
  expect(View.tasks_md(v)).toContain("1) Pode seguir (recomendada)  2) Espere");
  expect(View.tasks_md(v)).toContain("1) Corrija antes (recomendado)  2) Mesclado");
  expect(View.tasks_md(v, tasks.find((x) => x.id === t.id)!)).toContain("1) seg (recomendada)  2) ter  3) qua (recomendada)");
});

test("accept with choices and only the fields recommended (R1): fills the fields as a draft, never concludes; the choice is the user's", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "Escolha", choices: ["Mesclar", "Esperar"], fields: [{ id: "pt", label: "Interface em português?", kind: "yesno", recommend: "sim" }, { id: "obs", label: "Obs", kind: "text", required: false, recommend: "nenhuma" }] });
  expect(View.task_accept(t, {})).toBe("Respostas recomendadas preenchidas em " + t.id + ". Escolha uma opção para concluir: Mesclar | Esperar (no terminal: /ok " + t.id + " opção).");
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  // the act: a draft with the recommended (the given kept), not a Task done
  expect(View.view_act(v, { $: "TaskAccept", task: t.id, fields: { obs: "minha" } })).toEqual([{ $: "task_draft", task: t.id, fields: { pt: "sim", obs: "minha" } }]);
  expect(v.notes.at(-1)).toBe("Respostas recomendadas preenchidas em " + t.id + ". Escolha uma opção para concluir: Mesclar | Esperar (no terminal: /ok " + t.id + " opção).");
  // the server keeps it as the draft; the task stays open
  T.task_draft(s, t.id, { pt: "sim", obs: "minha" });
  const after = T.tasks_view(s, NOW).find((x) => x.id === t.id)!;
  expect(after.state).toBe("open");
  expect(after.draft).toEqual({ pt: "sim", obs: "minha" });
  // the web: the button says it only fills
  const html = Html.desk_html(T.tasks_view(s, NOW), "", "", t.id, NOW).detail.join("");
  expect(html).toContain(">Preencher as recomendadas</button>");
  expect(html).not.toContain(">Aceitar as recomendadas</button>");
});

test("contrast (R3): the accent of .rec-tag and .accept, and the disabled Cobrar's text, at least 4.5:1 on every fill they may sit on, light and dark (style.css)", () => {
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
  expect(css).toMatch(/\.rec-tag \{[^}]*color: var\(--accent\)/);
  expect(css).toMatch(/\.acts \.accept \{[^}]*color: var\(--accent\)/);
  expect(css).toMatch(/\.chase:disabled \{[^}]*background: var\(--block\); color: var\(--mid\)/);
  for (const x of [light, night]) {
    for (const fill of ["paper", "lift", "block", "hover"]) {
      expect(ratio(hex(x, "accent"), hex(x, fill))).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(hex(x, "mid"), hex(x, "block"))).toBeGreaterThanOrEqual(4.5);
    // .accept under the pointer: paper on accent, with room above 4.5:1
    expect(ratio(hex(x, "paper"), hex(x, "accent"))).toBeGreaterThanOrEqual(6);
  }
  expect(css).toMatch(/\.acts \.accept:hover \{[^}]*background: var\(--accent\); color: var\(--paper\)/);
});

test("/aceitar's help (R3 verif2): says it only fills when the choice is the user's, and names /ok", () => {
  const src = fs.readFileSync(import.meta.dir + "/Term.ts", "utf8");
  const line = src.split("\n").find((l) => l.includes('"/aceitar P7'))!;
  expect(line).toContain("só preenche");
  expect(line).toContain("/ok P7 opção");
});
