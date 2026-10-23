// View.copy.test
// ==============
// `bun test View.copy.test.ts`: what /copy takes from the chat
// (View.view_copy): Unii's last answer, or its n-th code block.

import { expect, test } from "bun:test";
import * as View from "./View.ts";

function view(entries: [number, View.Entry][]): View.View {
  const v = View.view_new();
  v.whole = new Map(entries);
  return v;
}

const ANSWER = "Assim:\n\n```sh\nls -la\n```\n\n- passo\n\n  ```ts\n  const x = 1;\n  ```\n\n> ```\n> citado\n> ```";

test("the last answer, whole; the user's messages and older answers left out", () => {
  const v = view([[3, { kind: "unii", text: "velha" }], [9, { kind: "unii", text: ANSWER }], [12, { kind: "user", text: "valeu" }]]);
  expect(View.view_copy(v, 0)).toEqual({ text: ANSWER, what: "a última resposta" });
});

test("its code blocks by number, those in lists and quotes too; past the last, how many there are", () => {
  const v = view([[9, { kind: "unii", text: ANSWER }]]);
  expect(View.view_copy(v, 1)).toEqual({ text: "ls -la", what: "o bloco de código 1" });
  expect((View.view_copy(v, 2) as { text: string }).text).toBe("const x = 1;");
  expect((View.view_copy(v, 3) as { text: string }).text).toBe("citado");
  expect(View.view_copy(v, 4)).toBe("A última resposta tem 3 blocos de código: /copy 1 a /copy 3.");
});

test("none to copy", () => {
  expect(View.view_copy(view([]), 0)).toBe("Nenhuma resposta do Unii para copiar.");
  expect(View.view_copy(view([[1, { kind: "unii", text: "sem código" }]]), 1)).toBe("A última resposta não tem bloco de código.");
});
