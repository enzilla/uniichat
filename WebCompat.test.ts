// What web/app.js may hold for the Safari it has to load in: no regex
// lookbehind ((?<! or (?<=), which Safari before 16.4 can't parse, so the
// whole script would fail, not just the one regex. Md.ts and TaskDeps.ts
// (bundled in it) read the char before a match instead; these check
// they read it as the lookbehinds did

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as Md from "./Md.ts";

test("web/app.js and the sources bundled in it hold no regex lookbehind", () => {
  const LB = /\(\?<[!=]/;
  expect(LB.test(fs.readFileSync(import.meta.dir + "/web/app.js", "utf8"))).toBe(false);
  for (const f of ["Md.ts", "TaskDeps.ts", "web/src/Html.ts", "web/src/main.ts", "View.ts"]) {
    expect(LB.test(fs.readFileSync(import.meta.dir + "/" + f, "utf8"))).toBe(false);
  }
});

test("italics need no * nor word char before; a bare link, a start, space or (", () => {
  expect(Md.span_parse("a *b* c")).toMatchObject([Md.Text("a "), { $: "Ital", x: [Md.Text("b")] }, Md.Text(" c")]);
  // inside a word too, as GFM reads it (arteeh's Md.ts, #26)
  expect(Md.span_parse("x*b* c")).toMatchObject([Md.Text("x"), { $: "Ital", x: [Md.Text("b")] }, Md.Text(" c")]);
  expect(Md.span_parse("*b*")).toMatchObject([{ $: "Ital", x: [Md.Text("b")] }]);
  expect(Md.span_parse("(https://a.io/x)")).toMatchObject([Md.Text("("), { $: "Link", x: [Md.Text("https://a.io/x")], k: "https://a.io/x" }, Md.Text(")")]);
  expect(Md.span_parse("https://a.io")).toMatchObject([{ $: "Link", x: [Md.Text("https://a.io")], k: "https://a.io" }]);
  expect(Md.span_parse("xhttps://a.io")).toMatchObject([Md.Text("xhttps://a.io")]);
  // refused at one char, tried again at the next: the italics after it
  expect(Md.span_parse("a*b *c*")).toMatchObject([Md.Text("a*b "), { $: "Ital", x: [Md.Text("c")] }]);
});

test("a long run of links glued to a word is read once, not again from each char", () => {
  const s = "x" + "https://a.b/c".repeat(5000);
  const t = performance.now();
  expect(Md.span_parse(s)).toEqual([Md.Text(s)]);
  expect(performance.now() - t).toBeLessThan(1000);
});

test("a table row splits at each | but an escaped one", () => {
  const t = Md.md_parse("| a | b |\n|---|---|\n| c \\| d | e |\n");
  expect(t).toMatchObject([{ $: "Tabl", x: [[[Md.Text("a")], [Md.Text("b")]], [[Md.Text("c | d")], [Md.Text("e")]]] }]);
  const u = Md.md_parse("| a | b |\n|---|---|\n| c | d \\|\n");
  expect((u[0] as { x: unknown[][] }).x[1]).toEqual([[Md.Text("c")], [Md.Text("d |")]]);
});
