// Tasks.test
// ==========
// `bun test Tasks.test.ts`: the pending list (Tasks.ts), on chats in a
// temporary dir.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as T from "./Tasks.ts";

// evidence that closes a task (the evidence round): a file that exists
const EV = { type: "file", path: import.meta.path };

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
  expect(a.assignee).toBe("user");
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
  expect(T.task_new(s, { title: "x", who: "boss" }, "main", NOW)).toBe("assignee is one of: user, unii.");
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
  const d = T.task_edit(s, { id: "1", state: "done", evidence: EV, answer: "b", note: "feito" }, NOW + 2 * H) as T.Task;
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
  expect(T.task_said(r)).toBe('Pendência P1 concluída pelo usuário: “Abrir PR?”. Resposta: sim. Comentário: “pode mesclar”.');
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
  expect(T.task_said(d)).toBe('Pendência P1 descartada pelo usuário: “Testar clique”. Comentário: “já testei”.');
  const o = T.task_resolve(s, "P1", "open", null, null, NOW + H) as T.Task;
  expect([o.state, o.answer, o.note, o.closed, o.told]).toEqual(["open", null, null, null, false]);
  expect(T.task_said(o)).toBe('Pendência P1 reaberta pelo usuário: “Testar clique”.');
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
    // (the evidence round: Unii's, still 26 h on, past its due, 4 h after it moved)
    "OVERDUE (yours, past their next step's due; the user was alerted): P1. Do the step, or give a new next_step and next_due, or set status blocked/waiting_user, or close with evidence.",
    "Changed since your last turn (by the user, or freed):",
    '- P3 done by user: "Abrir PR?" — answer: sim — note: "pode"',
    "Open (2; those that free others first, then the user's):",
    "- P2 [user] Reiniciar serve (ref uniichat, 5h)",
    "- P1 [unii] Conferir o Job (OVERDUE since " + new Date(NOW - 22 * H).toISOString() + ", ref numih-3151, 1d)",
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
  expect(lines[1]).toBe("Open (35; those that free others first, then the user's):");
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
  expect(T.tasks_list(s, { all: true }, NOW)).toContain('- P2 [user] B (done, note: "ok") (evidence: user\'s resolution, ref numih, 0m)');
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
  T.task_edit(s, { id: "P1", state: "done", evidence: EV }, NOW - 8 * 24 * H);
  T.task_edit(s, { id: "P2", state: "dropped", evidence: EV }, NOW - 24 * H);
  expect(T.tasks_view(s, NOW).map((t) => t.id)).toEqual(["P4", "P3", "P2"]);
});

test("archive: told closed ones older than 30 days, or past 200, leave tasks.json", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "velha" }, NOW - 40 * 24 * H);
  T.task_edit(s, { id: "P1", state: "done", evidence: EV }, NOW - 35 * 24 * H);
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
    T.task_edit(s, { id: "P" + (s.next - 1), state: "done", evidence: EV }, NOW + k);
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

// tasks.json edited by hand, or of another version (SmokyRadish's block)
// ======================================================================

function hand(json: unknown): T.Store {
  fs.writeFileSync(dir + "/tasks.json", typeof json === "string" ? json : JSON.stringify(json));
  return T.tasks_load(dir, NOW);
}

const OK = { id: "P1", title: "Boa", detail: "", state: "open", who: "user", by: "main", choices: ["sim"], answer: null, note: null, ref: null, made: "2026-10-23T10:00:00.000Z", changed: "2026-10-23T10:00:00.000Z", closed: null, told: true };

test("hand-edited tasks.json: an item without choices is completed; block, views and list work", () => {
  const s = hand({ next: 3, tasks: [{ id: "P1", title: "Sem opções", state: "done", told: false }, { id: "P2", title: "Aberta" }] });
  expect(s.tasks.map((t) => [t.id, t.choices, t.assignee, t.by, t.answer, t.told])).toEqual([["P1", [], "user", "main", null, false], ["P2", [], "user", "main", null, true]]);
  expect(T.tasks_block(s, NOW)).toContain("P1 done by user");
  expect(T.tasks_block(s, NOW)).toContain("- P2 [user] Aberta");
  expect(T.tasks_list(s, { all: true }, NOW)).toContain("P1");
  expect(T.tasks_view(s, NOW).length).toBe(2);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(false);
});

test("hand-edited tasks.json: items without an id, or with id Pabc, left out; the next id past the good ones; file kept aside", () => {
  const s = hand({ next: "x", tasks: [{ title: "sem id" }, { ...OK, id: "Pabc" }, { ...OK, id: "P4" }, { ...OK, id: "P4", title: "gêmea" }, null, 7, "P9"] });
  expect(s.tasks.map((t) => t.id)).toEqual(["P4"]);
  expect(s.next).toBe(5);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(true);
  expect(T.tasks_block(s, NOW)).toContain("P4 [user] Boa");
  expect(add(s, { title: "Nova" }).id).toBe("P5");
  // what was left out never comes back on the next save
  const disk = JSON.parse(fs.readFileSync(dir + "/tasks.json", "utf8"));
  expect(disk.tasks.map((t: T.Task) => t.id)).toEqual(["P4", "P5"]);
  expect(disk.next).toBe(6);
});

test("hand-edited tasks.json: wrong types become defaults; bad dates, states and answers are fixed", () => {
  const s = hand({ next: 2, tasks: [{ id: "P1", title: 42, detail: { x: 1 }, state: "later", who: "boss", by: [], choices: "sim", answer: 3, note: 5, ref: false, made: "ontem", changed: 1, closed: "x", told: "no", rev: -3 }] });
  const t = s.tasks[0];
  expect([t.title, t.detail, t.state, t.assignee, t.by, t.choices, t.answer, t.note, t.ref, t.closed, t.told, t.rev]).toEqual(["(sem título)", "", "open", "user", "main", [], null, null, null, null, true, 0]);
  expect(t.made).toBe(new Date(NOW).toISOString());
  expect(t.changed).toBe(t.made);
  const d = hand.call(null, "{}");
  expect(d).toBe(s); // read once per process: the list kept
  T.tasks_forget();
  const answer = hand({ tasks: [{ ...OK, state: "done", choices: ["sim", 3, "", "sim"], answer: "talvez" }, { ...OK, id: "P2", state: "done", answer: "sim", closed: null }] });
  expect(answer.tasks.map((x) => [x.choices, x.answer, x.closed])).toEqual([[["sim"], null, OK.changed], [["sim"], "sim", OK.changed]]);
});

test("hand-edited tasks.json: control characters in texts never reach the prompt", () => {
  const s = hand({ tasks: [{ ...OK, title: "a\x1b]8;;http://x\x1b\\b\x07c", detail: "l1\nl2\x1b[31m", ref: "r\x00", choices: ["s\x1bim"], note: "n\x9bx", state: "done", told: false }] });
  const block = T.tasks_block(s, NOW);
  expect(block).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
  expect(T.tasks_list(s, { id: "P1" }, NOW)).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
  expect(s.tasks[0].detail).toBe("l1\nl2[31m");
});

test("tasks.json without a list of tasks, or null: kept aside, the list empty and usable", () => {
  expect(hand("null").tasks).toEqual([]);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(true);
  T.tasks_forget();
  fs.rmSync(dir + "/tasks.json.bad");
  const s = hand({ next: 3, tasks: "P1" });
  expect(s.tasks).toEqual([]);
  expect(fs.existsSync(dir + "/tasks.json.bad")).toBe(true);
  expect(add(s, { title: "x" }).id).toBe("P1");
});

// told and versions (SmokyRadish's ressalvas 1 and 2)
// ===================================================

test("Unii editing a task the user resolved, unseen, keeps it to tell, a change of state too (said as made since)", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "Abrir PR?", choices: ["sim", "não"] });
  add(s, { title: "Outra" });
  T.task_resolve(s, "P1", "done", "sim", "pode", NOW + 1);
  const e = T.task_edit(s, { id: "P1", detail: "mais contexto", ref: "uniichat" }, NOW + 2) as T.Task;
  expect([e.told, e.state, e.answer]).toEqual([false, "done", "sim"]);
  expect(T.tasks_block(s, NOW + 3)).toContain("P1 done by user");
  // a state set again (the same) is no change of state
  expect((T.task_edit(s, { id: "P1", state: "done", evidence: EV }, NOW + 4) as T.Task).told).toBe(false);
  // shown, then edited by Unii during the call: still told when it ends well
  expect(T.tasks_told(s)).toBe(1);
  T.task_resolve(s, "P2", "dropped", null, null, NOW + 5);
  const o = T.task_edit(s, { id: "P2", state: "open" }, NOW + 6) as T.Task;
  expect(o.told).toBe(false);
  expect(T.tasks_block(s, NOW + 7)).toContain("- P2 dropped by user: \"Outra\" — since then you made it open");
  expect(T.tasks_told(s)).toBe(1);
  expect(T.tasks_untold(s)).toEqual([]);
  // told, a change of state by Unii is its own: nothing to tell
  const d = T.task_edit(s, { id: "P2", state: "dropped", evidence: EV }, NOW + 8) as T.Task;
  expect([d.told, d.heard]).toEqual([true, null]);
});

test("two changes by the user in one millisecond: the one after the block stays to tell", () => {
  const s = T.tasks_load(dir);
  add(s, { title: "A" });
  T.task_resolve(s, "P1", "done", null, null, NOW);
  T.tasks_block(s, NOW);
  T.task_resolve(s, "P1", "open", null, null, NOW); // the same ms
  expect(T.tasks_told(s)).toBe(0);
  expect(T.tasks_untold(s).map((t) => [t.id, t.state])).toEqual([["P1", "open"]]);
  // versions only go up, read back after a restart too
  const rev = s.rev;
  T.tasks_forget();
  const again = T.tasks_load(dir);
  expect(again.rev).toBe(rev);
  T.task_resolve(again, "P1", "dropped", null, null, NOW);
  expect(again.tasks[0].rev).toBe(rev + 1);
});

test("an old tasks.json, without versions: its untold changes told by the next block", () => {
  const s = hand({ next: 2, tasks: [{ ...OK, state: "done", told: false }] });
  expect(s.tasks[0].rev).toBe(0);
  T.tasks_block(s, NOW);
  expect(T.tasks_told(s)).toBe(1);
});
