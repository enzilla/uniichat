// Live.test
// =========
// A tool or a thought in the live tail is one line. When it closes, the
// line is a summary and the body opens like any other block.

import { expect, test } from "bun:test";
import * as Html from "./web/src/Render.tsx";
import * as Paint from "./Paint.ts";
import * as View from "./View.ts";

function tail(live: View.Live[]): View.Row[] {
  const v = View.view_new();
  v.live = live;
  return View.view_tail(v);
}

function sums(rows: View.Row[]): Extract<View.Row, { $: "Sum" }>[] {
  return rows.filter((row) => row.$ === "Sum");
}

test("while a tool or a thought runs, the tail is one line", () => {
  const rows = tail([
    { kind: "mind", text: "primeiro pensamento" },
    { kind: "tool", text: 'shell {"command":"git status"}' },
    { kind: "mind", text: "outro pensamento que chega depois" },
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ $: "Sum", n: 0, text: View.THINKING, mark: "live" });
  const grown = tail([{ kind: "mind", text: "primeiro pensamento, agora bem mais longo" }]);
  expect(grown).toHaveLength(1);
  expect(grown[0]).toMatchObject({ $: "Sum", text: "Pensando…" });
});

test("the reply still shows, and the running line stays one", () => {
  const rows = tail([
    { kind: "mind", text: "hmm" },
    { kind: "unii", text: "A resposta." },
    { kind: "tool", text: 'read {"path":"a.ts"}' },
  ]);
  expect(sums(rows)).toHaveLength(1);
  expect(rows.some((row) => row.$ === "Msg" && row.kind === "unii")).toBe(true);
});

test("a closed tool is one line, and opening it shows the body", () => {
  const v = View.view_new();
  v.turn = 1;
  const command = "git status --short " + "x".repeat(80);
  v.whole.set(2, { kind: "tool", text: "shell {\"command\":" + JSON.stringify(command) + "}" });
  v.parts = [[2, 1]];
  const sum = sums(View.view_body(v))[0];
  if (sum === undefined) throw new Error("sem linha");
  expect(sum).toMatchObject({ $: "Sum", id: 2, n: 1 });
  expect(sum.text.startsWith("shell ")).toBe(true);
  expect(sum.text.endsWith("…")).toBe(true);
  expect(sum.text.length).toBeLessThanOrEqual(80);
  const html = Html.row_html(sum);
  expect(html).toContain('class="block tool"');
  expect(html).toContain("Open");
  const ansi = Paint.rows_lines([sum], 80).map((line) => Paint.line_ansi(line)).join("\n");
  expect(ansi).toContain("/open #2");
  expect(View.view_act(v, { $: "Open", id: 2, n: 1 })).toEqual([]);
  const box = View.view_body(v).find((row) => row.$ === "Box");
  expect(box?.$).toBe("Box");
  if (box?.$ === "Box") {
    expect(box.rows.some((row) => row.$ === "Msg" && row.call !== null)).toBe(true);
  }
});

test("a closed thought is one short line, and opening it shows the text", () => {
  const v = View.view_new();
  v.turn = 1;
  const thought = "Um pensamento longo sobre o código. ".repeat(8);
  v.whole.set(3, { kind: "unii", text: "Pronto." });
  v.parts = [[3, 1]];
  v.minds.set(3, [thought]);
  const sum = sums(View.view_body(v))[0];
  if (sum === undefined) throw new Error("sem linha");
  expect(sum).toMatchObject({ $: "Sum", id: 3, n: 3 });
  expect(sum.text.endsWith("…")).toBe(true);
  expect(sum.text.length).toBeLessThanOrEqual(80);
  const html = Html.row_html(sum);
  expect(html).toContain('class="block mind"');
  expect(html).toContain("&quot;n&quot;:3");
  expect(View.view_act(v, { $: "Open", id: 3, n: 3 })).toEqual([]);
  const box = View.view_body(v).find((row) => row.$ === "Box");
  expect(box?.$).toBe("Box");
  if (box?.$ === "Box") {
    const body = box.rows.find((row) => row.$ === "Msg");
    expect(body?.$).toBe("Msg");
    if (body?.$ === "Msg") {
      expect(body.text).toBe(thought);
    }
  }
});

test("the live line uses the block, without a fake id", () => {
  const row = tail([{ kind: "mind", text: "hmm" }])[0];
  if (row === undefined) throw new Error("sem linha");
  const html = Html.row_html(row);
  expect(html).toContain("Pensando…");
  expect(html).toContain('class="block live"');
  expect(html).toContain("shimmer");
  expect(html).toContain('role="status"');
  expect(html).not.toContain("data-act");
  const ansi = Paint.rows_lines([row], 60).map((line) => Paint.line_ansi(line)).join("\n");
  expect(ansi).toContain("Pensando…");
  expect(ansi).not.toContain("/open #0");
});

// "Enviar agora" exists only while a message waits behind Unii's turn: it
// stops the turn, and the server runs the queue next (Run.loop)
test("the queue jump shows and stops the turn only while a message waits behind it", () => {
  const v = View.view_new();
  expect(View.view_queued(v)).toBe(0);
  expect(View.view_act(v, { $: "Jump" })).toEqual([]);
  v.busy = true;
  expect(View.view_queued(v)).toBe(0);
  expect(View.view_act(v, { $: "Jump" })).toEqual([]);
  v.queue = { [View.TURN]: [{ kind: "user", text: "e mais isto" }] };
  expect(View.view_queued(v)).toBe(1);
  expect(View.view_act(v, { $: "Jump" })).toEqual([{ $: "stop", name: View.TURN }]);
  v.busy = false;
  expect(View.view_queued(v)).toBe(0);
});
