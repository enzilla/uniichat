// What web/app.js may hold for the Safari it has to load in: no regex
// lookbehind ((?<! or (?<=), which Safari before 16.4 can't parse, so the
// whole script would fail, not just the one regex. Md.ts and TaskDeps.ts
// (bundled in it) read the char before a match instead; these check
// they read it as the lookbehinds did

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as vm from "node:vm";
import * as Md from "./Md.ts";

test("web/app.js and the sources bundled in it hold no regex lookbehind", () => {
  const LB = /\(\?<[!=]/;
  expect(LB.test(fs.readFileSync(import.meta.dir + "/web/app.js", "utf8"))).toBe(false);
  const web = fs.readdirSync(import.meta.dir + "/web/src").filter((f) => /\.tsx?$/.test(f)).map((f) => "web/src/" + f);
  for (const f of ["Md.ts", "TaskDeps.ts", "View.ts", ...web]) {
    expect(LB.test(fs.readFileSync(import.meta.dir + "/" + f, "utf8"))).toBe(false);
  }
});

// a paragraph's spans, and a text span, through Md's public parse (its
// span parser and Text aren't exported)
const spans = (s: string): Md.Span[] => (Md.md_parse(s)[0] as { x: Md.Span[] } | undefined)?.x ?? [];
const Text = (x: string): Md.Span => ({ $: "Text", x }) as Md.Span;

test("italics need no * nor word char before; a bare link, a start, space or (", () => {
  expect(spans("a *b* c")).toMatchObject([Text("a "), { $: "Ital", x: [Text("b")] }, Text(" c")]);
  // inside a word too, as GFM reads it (arteeh's Md.ts, #26)
  expect(spans("x*b* c")).toMatchObject([Text("x"), { $: "Ital", x: [Text("b")] }, Text(" c")]);
  expect(spans("*b*")).toMatchObject([{ $: "Ital", x: [Text("b")] }]);
  expect(spans("(https://a.io/x)")).toMatchObject([Text("("), { $: "Link", x: [Text("https://a.io/x")], k: "https://a.io/x" }, Text(")")]);
  expect(spans("https://a.io")).toMatchObject([{ $: "Link", x: [Text("https://a.io")], k: "https://a.io" }]);
  expect(spans("xhttps://a.io")).toMatchObject([Text("xhttps://a.io")]);
  // refused at one char, tried again at the next: the italics after it
  expect(spans("a*b *c*")).toMatchObject([Text("a*b "), { $: "Ital", x: [Text("c")] }]);
});

test("a long run of links glued to a word is read once, not again from each char", () => {
  const s = "x" + "https://a.b/c".repeat(5000);
  const t = performance.now();
  expect(spans(s)).toEqual([Text(s)]);
  expect(performance.now() - t).toBeLessThan(1000);
});

test("a table row splits at each | but an escaped one", () => {
  const t = Md.md_parse("| a | b |\n|---|---|\n| c \\| d | e |\n");
  expect(t).toMatchObject([{ $: "Tabl", x: [[[Text("a")], [Text("b")]], [[Text("c | d")], [Text("e")]]] }]);
  const u = Md.md_parse("| a | b |\n|---|---|\n| c | d \\|\n");
  expect((u[0] as { x: unknown[][] }).x[1]).toEqual([[Text("c")], [Text("d |")]]);
});

// the service worker's cache name is code, not the end of a comment: a
// merge once glued it to its heading, every fetch then threw on CACHE and
// each page it controlled failed to load (ERR_FAILED)
test("web/sw.js declares CACHE and runs", () => {
  const sw = fs.readFileSync(import.meta.dir + "/web/sw.js", "utf8").replace("{build}", "test");
  expect(sw).toMatch(/^const CACHE = "unii-shell-test";$/m);
  const listeners: string[] = [];
  const self = { addEventListener: (name: string) => listeners.push(name) };
  const ran: unknown = vm.runInNewContext(sw + "\ntypeof CACHE", { self, navigator: { userAgent: "" } });
  expect(ran).toBe("string");
  expect(listeners).toContain("fetch");
});
