// Screen.test
// ===========
// `bun test Screen.test.ts`: the terminal's keys read (Screen.screen_feed)
// for the focus it tells, and the notification each terminal takes
// (Screen.screen_notify).

import { expect, test } from "bun:test";
import * as Screen from "./Screen.ts";

test("the focus the terminal tells comes as FocusIn and FocusOut, not as keys typed", () => {
  const keys: string[] = [];
  const ed = { text: "", pos: 0, hist: [], at: 0, draft: "", moved: false, w: 80, tall: 1 };
  const scr = { tty: true, kitty: false, ed, off: false, full: true, grab: false, first: () => false, rest: "", up: 0, rows: 0, on: (k: string) => keys.push(k) };
  Screen.screen_feed(scr as Screen.Screen, "\x1b[O\x1b[I");
  expect(keys.filter((k) => k !== "")).toEqual(["FocusOut", "FocusIn"]);
  expect(ed.text).toBe("");
});

test("the bell, and the notification each terminal takes; inside tmux, the bell alone", () => {
  const say = (env: Record<string, string>) => Screen.screen_notify(env, "O Unii terminou", "Pronto; feito.\n");
  expect(say({ TERM: "xterm-kitty" })).toBe("\x07\x1b]99;;O Unii terminou: Pronto feito.\x1b\\");
  expect(say({ TERM: "xterm-256color", TERM_PROGRAM: "ghostty" })).toBe("\x07\x1b]9;O Unii terminou: Pronto feito.\x07");
  expect(say({ TERM: "foot" })).toBe("\x07\x1b]777;notify;O Unii terminou;Pronto feito.\x07");
  expect(say({ TERM: "alacritty" })).toBe("\x07");
  expect(say({ TERM: "xterm-kitty", TMUX: "/tmp/tmux-1000/default,1,0" })).toBe("\x07");
});
