// Activity.test
// =============
// `bun test Activity.test.ts`: what Unii is doing, the line in sight
// while it works (View.activity_of): the step by what streams last, the
// subagents by label; none while nothing runs.

import { expect, test } from "bun:test";
import * as View from "./View.ts";

function busy(live: View.Live[], agents: string[] = [], wait = ""): View.View {
  const v = View.view_new();
  Object.assign(v, { busy: true, live, agents, wait });
  return v;
}

test("nothing runs: no line", () => {
  expect(View.activity_of(View.view_new())).toBe(null);
});

test("the step is what streams last: a tool and its input, a thought, the reply; the tool's result read after it", () => {
  expect(View.activity_of(busy([{ kind: "tool", text: 'shell {"device":"enzo","command":"git status"}' }]))!.step).toBe("Executando shell: git status · enzo");
  expect(View.activity_of(busy([{ kind: "mind", text: "hmm" }]))!.step).toBe("Pensando…");
  expect(View.activity_of(busy([{ kind: "unii", text: "Pronto" }]))!.step).toBe("Escrevendo a resposta…");
  expect(View.activity_of(busy([{ kind: "tool", text: 'read {"path":"a.ts"}' }, { kind: "echo", text: "x" }]))!.step).toStartWith("Analisando o resultado de read");
  expect(View.activity_of(busy([], [], View.SUMMARIES))!.step).toBe("Resumindo mensagens para a memória…");
  expect(View.activity_of(busy([]))!.step).toBe("Trabalhando…");
});

test("the subagents at work, by label (the name when none); alone, they keep the line", () => {
  const v = busy([], ["GiantSnake", "Owl"]);
  const a = View.activity_of(v)!;
  expect(a.agents.map((x) => x.name)).toEqual(["GiantSnake", "Owl"]);
  const idle = View.view_new();
  Object.assign(idle, { busy: false, agents: ["Owl"] });
  expect(View.activity_of(idle)!.step).toBe("Um subagente em andamento");
});
