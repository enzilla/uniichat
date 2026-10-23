// Tasks.test
// ==========
// `bun test Tasks.test.ts`: the pending list (Tasks.ts), on chats in a
// temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-tasks-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");
const H    = 3600000;
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

test("a new list is empty, and its block too", () => {
  const s = T.tasks_load(dir);
  expect(s.tasks).toEqual([]);
  expect(T.tasks_block(s, NOW)).toBe("");
  expect(fs.existsSync(dir + "/tasks.json")).toBe(false);
});

test("create: ids in order, kept on disk, read again", () => {
  const s = T.tasks_load(dir);
  const a = add(s, { title: "Reiniciar o unii serve", ref: "uniichat" });
  const b = add(s, { title: "Decidir o PR", choices: ["sim", "não", "sim"], who: "user", detail: "Ver **ressalva** 1." });
  expect([a.id, b.id]).toEqual(["P1", "P2"]);
  expect(b.choices).toEqual(["sim", "não"]);
  expect(a.who).toBe("user");
  expect(a.told).toBe(true);
  T.tasks_forget();
  const again = T.tasks_load(dir);
  expect(again.tasks.map((t) => t.id)).toEqual(["P1", "P2"]);
  expect(again.next).toBe(3);
  expect(add(again, { title: "Outra" }).id).toBe("P3");
});

test("create refuses: no title, a twin open, a bad who, too many choices, the open limit", () => {
  const s = T.tasks_load(dir);
  expect(T.task_new(s, { title: "  " }, "main", NOW)).toBe("A task needs a title.");
  add(s, { title: "Uma" });
  expect(T.task_new(s, { title: "uma" }, "main", NOW)).toContain("P1 is open");
  expect(T.task_new(s, { title: "x", who: "boss" }, "main", NOW)).toBe("who is user or unii.");
  expect(T.task_new(s, { title: "x", choices: "sim" }, "main", NOW)).toBe("choices is a list of strings.");
  expect(T.task_new(s, { title: "x", choices: Array.from({ length: 10 }, (_, k) => "c" + k) }, "main", NOW)).toContain("At most 9");
  for (let k = 1; k < T.OPEN; k++) {
    add(s, { title: "t" + k });
  }
  expect(T.task_new(s, { title: "a mais" }, "main", NOW)).toContain("100 open tasks");
});

test("texts lose control characters: no escape reaches a terminal", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "a\x1b[31mvermelho\x1b]8;;http://x\x07\nb c\u009b", detail: "linha 1\n\x1b[2Jlinha\t2\r\nfim\u2028x", choices: ["s\x1bim"], ref: "r\x00ef" });
  expect(t.title).toBe("a [31mvermelho ]8;;http://x b c");
  expect(t.detail).toBe("linha 1\n[2Jlinha  2\nfim\nx");
  expect(t.choices).toEqual(["s im"]);
  expect(t.ref).toBe("r ef");
  const all = JSON.stringify(t) + T.tasks_block(s, NOW) + T.tasks_list(s, { all: true }, NOW);
  expect(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(all.replace(/\\n/g, ""))).toBe(false);
});

test("long texts are cut", () => {
  const s = T.tasks_load(dir);
  const t = add(s, { title: "t".repeat(500), detail: "d".repeat(5000) });
  expect(t.title.length).toBe(T.TITLE);
  expect(t.detail.length).toBe(T.DETAIL);
});

test("edit by Unii: fields, close, reopen; told stays true", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Uma", choices: ["a", "b"] });
  const e = T.task_edit(s, { id: "p1", title: "Uma nova", ref: "numih", detail: "x" }, NOW + H) as T.Task;
  expect(e.title).toBe("Uma nova");
  expect(e.ref).toBe("numih");
  expect(e.changed).toBe(new Date(NOW + H).toISOString());
  expect(T.task_edit(s, { id: "P1", answer: "c" }, NOW)).toContain("No choice");
  const d = T.task_edit(s, { id: "1", state: "done", answer: "b", note: "feito" }, NOW + 2 * H) as T.Task;
  expect([d.state, d.answer, d.note, d.told]).toEqual(["done", "b", "feito", true]);
  expect(d.closed).toBe(new Date(NOW + 2 * H).toISOString());
  const o = T.task_edit(s, { id: "P1", state: "open" }, NOW + 3 * H) as T.Task;
  expect([o.state, o.closed]).toEqual(["open", null]);
  expect(T.task_edit(s, { id: "P9" }, NOW)).toBe("No task P9.");
  expect(T.task_edit(s, { id: "P1", state: "later" }, NOW)).toContain("state is one of");
  expect(T.tasks_untold(s)).toEqual([]);
});

test("resolve by the user: done with an answer and a comment, untold till told", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Abrir PR?", choices: ["sim", "não"] });
  expect(T.task_resolve(s, "P1", "done", "talvez", null, NOW)).toContain("não tem a opção");
  const r = T.task_resolve(s, "P1", "done", "sim", "pode mesclar", NOW + H) as T.Task;
  expect([r.state, r.answer, r.note, r.told]).toEqual(["done", "sim", "pode mesclar", false]);
  expect(T.task_said(r)).toBe('Pendência P1 concluída pelo usuário: "Abrir PR?". Resposta: sim. Comentário: "pode mesclar".');
  // done again: no change, no second note
  expect(T.task_resolve(s, "P1", "done", "sim", "pode mesclar", NOW + 2 * H)).toBeNull();
  expect(T.task_resolve(s, "P1", "done", "sim", null, NOW + 2 * H)).toBeNull();
  expect(T.task_resolve(s, "P9", "done", null, null, NOW)).toContain("não encontrada");
  expect(T.task_resolve(s, "P1", "maybe", null, null, NOW)).toContain("Estado inválido");
});

test("drop and reopen by the user", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Testar clique" });
  const d = T.task_resolve(s, "P1", "dropped", null, "já testei", NOW) as T.Task;
  expect(T.task_said(d)).toBe('Pendência P1 descartada pelo usuário: "Testar clique". Comentário: "já testei".');
  const o = T.task_resolve(s, "P1", "open", null, null, NOW + H) as T.Task;
  expect([o.state, o.answer, o.note, o.closed, o.told]).toEqual(["open", null, null, null, false]);
  expect(T.task_said(o)).toBe('Pendência P1 reaberta pelo usuário: "Testar clique".');
  expect(T.task_resolve(s, "P1", "open", null, null, NOW + H)).toBeNull();
});

test("block: changes, then the open ones, the user's first; told once the call ends well", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Conferir o Job", who: "unii", ref: "numih-3151" }, NOW - 26 * H);
  add(s, { title: "Reiniciar serve", ref: "uniichat" }, NOW - 5 * H);
  add(s, { title: "Abrir PR?", choices: ["sim", "não"] }, NOW - 2 * H);
  T.task_resolve(s, "P3", "done", "sim", "pode", NOW - H);
  const block = T.tasks_block(s, NOW);
  expect(block).toBe([
    "Tasks (your pending list; the user sees it beside the chat and resolves items there):",
    "Changed by the user since your last turn:",
    '- P3 done by user: "Abrir PR?" — answer: sim — note: "pode"',
    "Open (2; the user's first):",
    "- P2 [user] Reiniciar serve (ref uniichat, 5h)",
    "- P1 [unii] Conferir o Job (ref numih-3151, 1d)",
  ].join("\n") + "\n\n");
  // a change during the call stays to tell
  add(s, { title: "Nova" }, NOW);
  T.task_resolve(s, "P4", "dropped", null, null, NOW + 1);
  expect(T.tasks_told(s)).toBe(1);
  expect(T.tasks_untold(s).map((t) => t.id)).toEqual(["P4"]);
  T.tasks_forget();
  const again = T.tasks_load(dir);
  expect(again.tasks.find((t) => t.id === "P3")!.told).toBe(true);
  // a failed call (no told): shown again
  expect(T.tasks_block(again, NOW)).toContain("P4 dropped by user");
  expect(T.tasks_block(again, NOW)).toContain("P4 dropped by user");
});

test("a change made again after the block was built is told later", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  T.task_resolve(s, "P1", "done", null, null, NOW);
  T.tasks_block(s, NOW);
  T.task_resolve(s, "P1", "open", null, null, NOW + 1);
  expect(T.tasks_told(s)).toBe(0);
  expect(T.tasks_untold(s).length).toBe(1);
});

test("block with more than 30 open: the newest 30, and how many more", () => {
  const s = T.tasks_load(dir);
  for (let k = 1; k <= 35; k++) {
    add(s, { title: "t" + k }, NOW - (40 - k) * H);
  }
  const lines = T.tasks_block(s, NOW).trim().split("\n");
  expect(lines[1]).toBe("Open (35; the user's first):");
  expect(lines.length).toBe(2 + 30 + 1);
  expect(lines[2]).toStartWith("- P6 ");
  expect(lines.at(-1)).toBe("+5 older (the tasks tool lists them)");
});

test("tasks tool: open, all, by ref, one whole", () => {
  const s = T.tasks_load(dir);
  expect(T.tasks_list(s, {}, NOW)).toBe("No open tasks.");
  add(s, { title: "A", ref: "uniichat", detail: "linha 1\nlinha 2" });
  add(s, { title: "B", ref: "numih" });
  T.task_resolve(s, "P2", "done", null, "ok", NOW);
  expect(T.tasks_list(s, {}, NOW)).toBe("- P1 [user] A (ref uniichat, 0m)\n  linha 1\n  linha 2");
  expect(T.tasks_list(s, { all: true }, NOW)).toContain('- P2 [user] B (done, note: "ok") (ref numih, 0m)');
  expect(T.tasks_list(s, { all: true, ref: "NUMIH" }, NOW)).not.toContain("P1");
  expect(T.tasks_list(s, { id: "2" }, NOW)).toStartWith("- P2 ");
  expect(T.tasks_list(s, { id: "P7" }, NOW)).toBe("No task P7.");
});

test("views get the open ones and those closed in 7 days", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "old", who: "unii" }, NOW - 10 * 24 * H);
  add(s, { title: "recent" }, NOW - 10 * 24 * H);
  add(s, { title: "open unii", who: "unii" });
  add(s, { title: "open user" });
  T.task_edit(s, { id: "P1", state: "done" }, NOW - 8 * 24 * H);
  T.task_edit(s, { id: "P2", state: "dropped" }, NOW - 24 * H);
  expect(T.tasks_view(s, NOW).map((t) => t.id)).toEqual(["P4", "P3", "P2"]);
});

test("archive: told closed ones older than 30 days, or past 200, leave tasks.json", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "velha" }, NOW - 40 * 24 * H);
  T.task_edit(s, { id: "P1", state: "done" }, NOW - 35 * 24 * H);
  add(s, { title: "nova" });
  T.task_resolve(s, "P2", "done", null, null, NOW);
  expect(s.tasks.map((t) => t.id)).toEqual(["P2"]);
  const kept = fs.readFileSync(dir + "/tasks-arquivo.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(kept.map((t) => t.id)).toEqual(["P1"]);
  // untold ones stay, even old
  T.task_resolve(s, "P2", "open", null, null, NOW);
  T.task_resolve(s, "P2", "done", null, null, NOW);
  T.tasks_archive(s, NOW + 40 * 24 * H);
  expect(s.tasks.map((t) => t.id)).toEqual(["P2"]);
  for (let k = 0; k < T.KEEP + 3; k++) {
    add(s, { title: "c" + k });
    T.task_edit(s, { id: "P" + (s.next - 1), state: "done" }, NOW + k);
  }
  expect(s.tasks.filter((t) => t.state !== "open" && t.told).length).toBe(T.KEEP);
  expect(s.next).toBe(3 + T.KEEP + 3);
});

test("tell: every untold change at once, then none", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  add(s, { title: "B" });
  T.task_resolve(s, "P1", "done", null, null, NOW);
  T.task_resolve(s, "P2", "dropped", null, null, NOW + 1);
  expect(T.tasks_tell(s).map((t) => t.id)).toEqual(["P1", "P2"]);
  expect(T.tasks_tell(s)).toEqual([]);
});

test("an unreadable tasks.json is kept aside, the list empty", () => {
  fs.writeFileSync(dir + "/tasks.json", "{not json");
  const s = T.tasks_load(dir);
  expect(s.tasks).toEqual([]);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(true);
});

test("ids: P7, p7, 7", () => {
  expect(["P7", "p7", " 7 ", "P07"].map(T.task_id)).toEqual(["P7", "P7", "P7", "P7"]);
});
