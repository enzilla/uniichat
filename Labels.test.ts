// Labels.test
// ===========
// `UNII_DIR=$(mktemp -d /tmp/x-XXXX) bun test Labels.test.ts`: a
// subagent's label (Tools.start): kept in its log's note, so it outlives
// a restart; told to the views (State.labels) and to Unii (Agents at work
// now, spawn's answer); shown where people read an agent, its generated
// name after it; agents without one as before. The AI is a fake that
// never ends a subagent's call, so they stay at work.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask } from "./AskAI.ts";
import * as Call from "./Call.ts";
import * as config from "./Config.ts";
import { Memory } from "./Memory.ts";
import * as Paint from "./Paint.ts";
import { Chat } from "./Server.ts";
import { Tools } from "./Tools.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}
afterAll(() => fs.rmSync(config.DIR, { recursive: true, force: true }));

// a subagent's call never ends (it stays at work); others end at once
(AskAI as any).ask = (ask: Ask) => {
  const done = ask.agent ? new Promise(() => {}) : Promise.resolve({ ok: true, text: "a summary", left: [] });
  return { send: () => {}, stop: () => {}, wake: () => {}, done };
};

const chat = Chat.open() as any;
const tools: Tools = chat.tools;
const call = (name: string, args: object) => Tools.call(tools, "main", name, args, new AbortController().signal, "id-" + Math.random());

// the view a state makes
function viewed(): View.View {
  const v = View.view_new();
  View.view_hear(v, JSON.parse(JSON.stringify(Chat.state(chat))));
  return v;
}

let A = "";
let B = "";
let C = "";

test("label_clean: one line, trimmed, at most 60 characters; empty is none", () => {
  expect(Tools.label_clean("  num-3182 \n verificador\t ")).toBe("num-3182 verificador");
  expect(Tools.label_clean("a\u0007b\u001b[31mc d\u0085e")).toBe("a b [31mc d e");
  expect(Tools.label_clean(" \n ")).toBeNull();
  expect(Tools.label_clean("")).toBeNull();
  expect(Array.from(Tools.label_clean("é".repeat(80) + "😀")!).length).toBe(60);
  expect(Tools.label_clean("x".repeat(59) + "😀😀")).toBe("x".repeat(59) + "😀");
});

test("spawn with labels: the answer names each with its label; one without stays bare", async () => {
  const out = await call("spawn", { tasks: ["tarefa a", "tarefa b", "tarefa c"], labels: ["num-3182-verificador", " uniichat \n links "] });
  expect(out.fail).toBe(false);
  const m = /^Started (\w+) \(num-3182-verificador\), (\w+) \(uniichat links\), (\w+)\. /.exec(out.text);
  expect(m).not.toBeNull();
  [A, B, C] = [m![1], m![2], m![3]];
  expect(tools.agents.get(A)!.label).toBe("num-3182-verificador");
  expect(tools.agents.get(C)!.label).toBeNull();
});

test("the note keeps the label, after model and effort; one without as before", async () => {
  expect(Memory.agent(chat.mem, A)![0]).toMatchObject({ kind: "note", text: "subagent, labeled num-3182-verificador" });
  expect(Memory.agent(chat.mem, C)![0].text).toBe("subagent");
  const out = await call("spawn", { tasks: ["d"], labels: ["com modelo"], effort: "high" });
  const d = /^Started (\w+)/.exec(out.text)![1];
  expect(Memory.agent(chat.mem, d)![0].text).toBe("subagent at effort high, labeled com modelo");
});

test("Agents at work now names the labeled ones with their label", () => {
  const text = Tools.at_work(tools).text;
  expect(text).toContain(A + " (num-3182-verificador)");
  expect(text).toContain(B + " (uniichat links)");
  expect(text).toMatch(new RegExp(C + "[,.]"));
});

test("state tells every label; tabs show the label, the name after it", () => {
  const v = viewed();
  expect(v.labels![A]).toBe("num-3182-verificador");
  expect(v.labels![C]).toBeUndefined();
  const tabs = View.view_tabs(v);
  const a = tabs.find((t) => t.name === A)!;
  expect(a.text).toEndWith(" num-3182-verificador");
  expect(a.sub).toBe(A);
  const c = tabs.find((t) => t.name === C)!;
  expect(c.text).toEndWith(" " + C);
  expect(c.sub).toBeUndefined();
  expect(Html.tabs_html(tabs).find((h) => h.includes("num-3182"))).toContain("<small>" + A + "</small>");
});

test("tell, stop and zoom still take the generated name", async () => {
  expect((await call("tell", { name: A, message: "oi" })).text).toStartWith("Sent. " + A);
  expect((await call("zoom", { id: A })).text).toContain("labeled num-3182-verificador");
  expect((await call("tell", { name: "num-3182-verificador", message: "oi" })).text).toStartWith("No agent");
});

test("a restart reads the labels back from the notes; an agent taken back keeps its label", () => {
  const again = Tools.labels(chat.mem);
  expect(again.get(A)).toBe("num-3182-verificador");
  expect(again.get(B)).toBe("uniichat links");
  expect(again.has(C)).toBe(false);
  const other = { ...tools, agents: new Map(), labels: again };
  expect(Tools.agent(other, A)!.label).toBe("num-3182-verificador");
  expect(Tools.agent(other, C)!.label).toBeNull();
  expect(Tools.agent(other, C)!.role).toEqual({ effort: null, model: null });
});

test("old notes (before labels) read as before", () => {
  const dir = chat.mem.dir + "/docs/agent/";
  fs.writeFileSync(dir + "OldOwl.jsonl", JSON.stringify(Memory.root(0, { kind: "note", text: "subagent on opus-5.5 at effort high" })) + "\n");
  fs.writeFileSync(dir + "EmptyEel.jsonl", "");
  fs.writeFileSync(dir + "BadBat.jsonl", "{not json\n");
  const again = Tools.labels(chat.mem);
  expect(again.has("OldOwl")).toBe(false);
  const other = { ...tools, agents: new Map(), labels: again };
  const old = Tools.agent(other, "OldOwl")!;
  expect(old.label).toBeNull();
  expect(old.role).toEqual({ effort: "high", model: "opus-5.5" });
});

test("a report and a [Name] show the label, the name after it; unknown names as before", () => {
  viewed(); // the labels known
  const rows = View.entry_rows(1, "work", Call.report_text(A, "feito"));
  expect((rows[0] as any).who).toBe("num-3182-verificador (" + A + ")");
  expect((View.entry_rows(2, "work", Call.report_text("Timer ab12", "x"))[0] as any).who).toBe("Timer ab12");
  const html = Html.row_html(View.entry_rows(3, "unii", "veja [" + A + "] e [" + C + "]")[0]);
  expect(html).toContain("[num-3182-verificador <small>" + A + "</small>]");
  expect(html).toContain("[" + C + "]");
  const ansi = Paint.rows_lines([View.entry_rows(4, "unii", "veja [" + A + "]")[0]], 80).map((l) => Paint.line_ansi(l)).join("\n");
  expect(ansi.replace(/\x1b\[[0-9;]*m/g, "")).toContain("[num-3182-verificador " + A + "]");
});

test("labels are escaped in HTML and cleaned in the terminal", async () => {
  const out = await call("spawn", { tasks: ["e"], labels: ["<img src=x onerror=alert(1)>\"&"] });
  const e = /^Started (\w+)/.exec(out.text)![1];
  const v = viewed();
  const html = Html.tabs_html(View.view_tabs(v)).join("") + Html.row_html(View.entry_rows(5, "unii", "[" + e + "]")[0]);
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;&amp;");
  const line = Paint.line_ansi(Paint.tabs_line(v, 400)).replace(/\x1b\[[0-9;]*m/g, "");
  expect(line).toContain("<img src=x onerror=alert(1)>\"& " + e);
  expect(line).not.toContain("\x1b");
});

test("the spawn call shows its labels", () => {
  const c = Call.call_parse('spawn {"tasks":["a","b"],"labels":["x-impl","y-verif"],"model":"opus-5.5"}');
  expect(c.head).toBe("2 agents: x-impl, y-verif · opus-5.5");
  expect(Call.call_parse('spawn {"tasks":["a"]}').head).toBe("1 agent");
});
