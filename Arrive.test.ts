// what rises in as it arrives (web/src/Arrive.ts): the new, never the redrawn

import { expect, test } from "bun:test";
import { arrivals, type Paint } from "./web/src/Arrive.ts";

const paint = (p: Partial<Paint>): Paint => ({ shown: "", body: [], tail: [], tail_was: 0, tail_now: 0, ids: [], ...p });

test("a page seen the first time rises in nothing, its history included", () => {
  const last = new Map<string, number>();
  expect(arrivals(last, paint({ body: [1, 2, 3], ids: [1, 2, 3] }))).toEqual({ body: [], tail: [] });
});

test("a row past the last one shown rises in; one redrawn or older does not", () => {
  const last = new Map([["", 3]]);
  expect(arrivals(last, paint({ body: [2, 4], ids: [1, 2, 3, 4] })).body).toEqual([1]);
  expect(arrivals(last, paint({ body: [4], ids: [1, 2, 3, 4] })).body).toEqual([]);
});

test("the streamed reply rises once: a piece redraws it in its place", () => {
  const last = new Map([["", 3]]);
  expect(arrivals(last, paint({ tail: [0], tail_was: 0, tail_now: 1, ids: [3] })).tail).toEqual([0]);
  expect(arrivals(last, paint({ tail: [0], tail_was: 1, tail_now: 1, ids: [3] })).tail).toEqual([]);
});

test("the stream kept into the body doesn't rise again", () => {
  const last = new Map([["", 3]]);
  expect(arrivals(last, paint({ body: [4], tail_was: 1, tail_now: 0, ids: [3, 4] })).body).toEqual([]);
});

test("history arriving after an empty first paint rises in nothing, however short", () => {
  const last = new Map<string, number>();
  expect(arrivals(last, paint({ ids: [] }))).toEqual({ body: [], tail: [] });
  expect(arrivals(last, paint({ body: [1, 2, 3], ids: [1, 2, 3] }))).toEqual({ body: [], tail: [] });
  expect(arrivals(last, paint({ body: [4], ids: [1, 2, 3, 4] })).body).toEqual([0]);
});

test("a crowd at once (a reconnect catching up) rises in nothing", () => {
  const last = new Map([["", 3]]);
  expect(arrivals(last, paint({ body: [4, 5, 6, 7, 8], ids: [4, 5, 6, 7, 8] }))).toEqual({ body: [], tail: [] });
});

test("each page keeps its own last row", () => {
  const last = new Map([["", 10], ["agent", 3]]);
  expect(arrivals(last, paint({ shown: "agent", body: [4], ids: [4] })).body).toEqual([0]);
});
