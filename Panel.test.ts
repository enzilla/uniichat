// Panel.test
// ==========
// `bun test Panel.test.ts`: the full screen's pending list (Panel.ts):
// its keys as the acts they ask, and its column laid out, on tasks made
// in a temporary dir and handed to a View as the server's state would.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Paint from "./Paint.ts";
import * as Panel from "./Panel.ts";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-panel-");
const NOW  = Date.parse("2026-10-23T12:00:00Z");
Panel.panel_clock(() => NOW);

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

// a view whose list holds P1 (frees P2), P2 (waits for P1), P3 (choices),
// P4 (Unii's), P5 (done)
function view(): View.View {
  T.tasks_forget();
  const s = T.tasks_load(fs.mkdtempSync(ROOT + "/chat-"));
  const add = (args: T.Edit) => {
    const t = T.task_new(s, args, "main", NOW);
    if (typeof t === "string") {
      throw new Error(t);
    }
    return t;
  };
  add({ title: "Revisar o PR" });
  add({ title: "Liberar o deploy", after: ["P1"] });
  add({ title: "Qual ambiente?", choices: ["hom", "prod"] });
  add({ title: "Rodar os jobs", who: "unii" });
  add({ title: "Backup" });
  T.task_resolve(s, "P5", "done", null, null, NOW);
  const v = View.view_new();
  v.tasks = T.tasks_view(s, NOW);
  return v;
}

const width = (l: Paint.Line) => l.reduce((n, r) => n + Paint.text_width(r.x), 0);

test("the keys move along the open tasks, then the closed; never one that waits", () => {
  const v = view();
  const p = Panel.panel_new();
  const seen = [0, 1, 2, 3, 4].map(() => (Panel.panel_key(p, v, "Down"), p.sel));
  expect(seen).toEqual(["P3", "P4", "P5", "P5", "P5"]);
  Panel.panel_key(p, v, "Up");
  expect(p.sel).toBe("P4");
});

test("space marks an open task done and the pick goes on; on a closed one, reopens it", () => {
  const v = view();
  const p = Panel.panel_new();
  expect(Panel.panel_key(p, v, " ")).toEqual({ $: "act", act: { $: "Task", task: "P1", state: "done", go: false } });
  expect(p.sel).toBe("P3");
  p.sel = "P5";
  expect(Panel.panel_key(p, v, " ")).toEqual({ $: "act", act: { $: "Task", task: "P5", state: "open", go: false } });
});

test("a task with choices: space asks for one, a number picks it, one out of range is refused", () => {
  const v = view();
  const p = { ...Panel.panel_new(), sel: "P3" };
  expect(Panel.panel_key(p, v, " ")?.$).toBe("note");
  expect(Panel.panel_key(p, v, "3")?.$).toBe("note");
  expect(Panel.panel_key(p, v, "2")).toEqual({ $: "act", act: { $: "Task", task: "P3", state: "done", answer: "prod", go: false } });
  expect(Panel.panel_key({ ...p, sel: "P3" }, v, "!")).toEqual({ $: "type", text: "/ok! P3 " });
});

test("! tells Unii now, d drops, c types the command, a tells all; d on a closed one is not the list's", () => {
  const v = view();
  expect(Panel.panel_key(Panel.panel_new(), v, "!")).toEqual({ $: "act", act: { $: "Task", task: "P1", state: "done", go: true } });
  expect(Panel.panel_key(Panel.panel_new(), v, "d")).toEqual({ $: "act", act: { $: "Task", task: "P1", state: "dropped", go: false } });
  expect(Panel.panel_key(Panel.panel_new(), v, "c")).toEqual({ $: "type", text: "/ok P1 " });
  expect(Panel.panel_key(Panel.panel_new(), v, "a")).toEqual({ $: "act", act: { $: "TasksTell" } });
  expect(Panel.panel_key({ ...Panel.panel_new(), sel: "P5" }, v, "d")).toBeUndefined();
});

test("the frame: h rows of w columns, the column beside the chat, a click on a box marks its task", () => {
  const v = view();
  const p = Panel.panel_new();
  const body = Array.from({ length: 50 }, (_, k) => [Paint.Run("linha " + k)]);
  const foot = [[Paint.Run("rodapé")]];
  const lines = Panel.panel_frame(p, v, body, foot, 120, 30);
  expect(lines.length).toBe(30);
  expect(lines.slice(0, 29).every((l) => width(l) === 120)).toBe(true);
  expect(lines[28].map((r) => r.x).join("")).toContain("linha 49");
  const [row, hit] = [...p.hits].find(([, h]) => h.id === "P1" && h.box > 0)!;
  const text = lines[row - 1].map((r) => r.x).join("");
  expect(text.slice(hit.box - 3, hit.box)).toBe("[ ]");
  expect(Panel.panel_mouse(p, v, "Mouse:0:" + hit.box + ":" + row + ":M")).toEqual({ $: "act", act: { $: "Task", task: "P1", state: "done", go: false } });
  expect(p.focus).toBe(true);
});

test("scrolled up, the chat shows older lines and says how many are below; the wheel scrolls", () => {
  const v = view();
  const p = Panel.panel_new();
  const body = Array.from({ length: 50 }, (_, k) => [Paint.Run("linha " + k)]);
  Panel.panel_frame(p, v, body, [], 120, 20);
  Panel.panel_scroll(p, 10);
  const lines = Panel.panel_frame(p, v, body, [], 120, 20);
  expect(lines[0].map((r) => r.x).join("")).toContain("linha 20");
  expect(lines[19].map((r) => r.x).join("")).toContain("10 linhas abaixo");
  Panel.panel_mouse(p, v, "Mouse:65:5:5:M");
  expect(p.scroll).toBe(7);
  Panel.panel_scroll(p, 1000);
  expect(p.scroll).toBe(30);
});

test("scrolled up, lines that come keep the reader's place; at the bottom, they show", () => {
  const v = view();
  const p = Panel.panel_new();
  const body = (n: number) => Array.from({ length: n }, (_, k) => [Paint.Run("linha " + k)]);
  Panel.panel_frame(p, v, body(50), [], 120, 20);
  Panel.panel_scroll(p, 10);
  const first = (n: number) => Panel.panel_frame(p, v, body(n), [], 120, 20)[0].map((r) => r.x).join("");
  expect(first(50)).toContain("linha 20");
  expect(first(58)).toContain("linha 20");
  Panel.panel_scroll(p, -1000);
  expect(first(60)).toContain("linha 40");
});

test("a narrow screen has no column", () => {
  const v = view();
  const lines = Panel.panel_frame(Panel.panel_new(), v, [[Paint.Run("oi")]], [], 80, 10);
  expect(Panel.panel_width(80)).toBe(0);
  expect(lines.every((l) => !l.some((r) => r.x.includes("Pendências")))).toBe(true);
});

test("the agents at work under the tasks: the keys reach them after the tasks, Enter or a click opens one's tab", () => {
  const v = view();
  v.agents = ["ana", "bob"];
  v.runs = { ana: { vendor: "claude-sub", model: "opus-5.5", effort: "high", speed: "slow" } } as never;
  const p = Panel.panel_new();
  const seen = [0, 1, 2, 3, 4, 5].map(() => (Panel.panel_key(p, v, "Down"), p.sel));
  expect(seen).toEqual(["P3", "P4", "P5", "@ana", "@bob", "@bob"]);
  expect(Panel.panel_key(p, v, "Enter")).toEqual({ $: "act", act: { $: "Goto", name: "bob" } });
  expect(Panel.panel_key(p, v, "d")).toBeUndefined();
  const lines = Panel.panel_frame(p, v, [], [], 120, 40).map((l) => l.map((r) => r.x).join(""));
  expect(lines.some((l) => l.includes("Agentes (2)"))).toBe(true);
  expect(lines.some((l) => l.includes("opus-5.5 · high"))).toBe(true);
  const [row] = [...p.hits].find(([, h]) => h.id === "@ana")!;
  expect(Panel.panel_mouse(p, v, "Mouse:0:100:" + row + ":M")).toEqual({ $: "act", act: { $: "Goto", name: "ana" } });
});

test("Unii's questions: the user's open tasks with choices, each once; not one that waits, nor Unii's own", () => {
  const v = view();
  const seen = new Set<string>();
  expect(Panel.panel_asks(v, seen).map((t) => t.id)).toEqual(["P3"]);
  expect(Panel.panel_asks(v, seen)).toEqual([]);
});

test("an open task with no change in 7 days goes down to Antigas, folded; Enter on it unfolds; any change brings it back", () => {
  T.tasks_forget();
  const s = T.tasks_load(fs.mkdtempSync(os.tmpdir() + "/unii-cold-"));
  const now = NOW;
  T.task_new(s, { title: "Nova" }, "main", now);
  T.task_new(s, { title: "Velha" }, "main", now - 8 * 86400e3);
  const v = View.view_new();
  v.tasks = T.tasks_view(s, now);
  const p = Panel.panel_new();
  const text = (lines: Paint.Line[]) => lines.map((l) => l.map((r) => r.x).join("")).join("\n");
  const frame = () => text(Panel.panel_frame(p, v, [], [], 120, 30));
  expect(View.task_cold(v.tasks.find((t) => t.id === "P2")!, now)).toBe(true);
  expect(frame()).toContain("Antigas (1)");
  expect(frame()).not.toContain("P2 Velha");
  Panel.panel_key(p, v, "Down");
  expect(p.sel).toBe("#antigas");
  Panel.panel_key(p, v, "Enter");
  expect(frame()).toContain("P2 Velha");
  T.task_say(s, "P2", "ainda vale?", now);
  v.tasks = T.tasks_view(s, now);
  expect(View.task_cold(v.tasks.find((t) => t.id === "P2")!, now)).toBe(false);
  expect(frame()).not.toContain("Antigas");
});
