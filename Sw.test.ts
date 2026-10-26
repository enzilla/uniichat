// Sw.test
// =======
// `bun test Sw.test.ts`: the service worker's pushes and taps (web/sw.js),
// run in a fake worker scope: a task's push shows only its text, tagged
// as the tasks', sets the badge to the count; a tap on it opens the Mesa
// (a new tab at /?mesa, or a message to one open); a reply's opens "/".
// A real browser (and Safari, iOS) is not run here.

import { expect, test } from "bun:test";
import * as fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("./web/sw.js", import.meta.url), "utf8");

// a fake worker scope (tabs: the windows open), sw.js run in it
function worker(tabs: { url: string; focused?: boolean }[] = [], agent = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130") {
  const on: Record<string, (ev: any) => void> = {};
  const got = { shown: [] as any[], badge: [] as (number | "clear")[], opened: [] as string[], posted: [] as any[], focused: 0 };
  const clients = tabs.map((t) => ({ url: t.url, focused: t.focused ?? false, postMessage: (m: any) => got.posted.push(m), focus: async () => got.focused++ }));
  const self = {
    addEventListener: (name: string, fn: (ev: any) => void) => (on[name] = fn),
    registration: { showNotification: async (title: string, options: any) => got.shown.push({ title, ...options }) },
    clients: { matchAll: async () => clients, openWindow: async (url: string) => got.opened.push(url), claim: async () => {} },
    navigator: { setAppBadge: async (n: number) => got.badge.push(n), clearAppBadge: async () => got.badge.push("clear") },
    skipWaiting: () => {},
  };
  new Function("self", "navigator", "location", "caches", SOURCE)(self, { userAgent: agent }, { origin: "https://office.example" }, {});
  // an event fired, its waitUntil awaited
  const fire = async (name: string, ev: any) => {
    let wait: Promise<unknown> = Promise.resolve();
    on[name]({ ...ev, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
  };
  const push = (data: object) => fire("push", { data: { json: () => data } });
  const tap = (n: any) => fire("notificationclick", { notification: { ...n, close: () => {} } });
  return { got, push, tap };
}

test("a task's push shows only its text, tagged as the tasks', and sets the badge", async () => {
  const w = worker();
  await w.push({ kind: "tasks", tasks: 3, ids: ["P7"], text: "Pendência P7 precisa de você" });
  expect(w.got.shown).toEqual([{ title: "UniiChat", body: "Pendência P7 precisa de você", icon: "/icon-192.png", badge: "/icon-192.png", tag: "unii-tasks", renotify: true, data: { mesa: true } }]);
  expect(w.got.badge).toEqual([3]);
  await w.push({ kind: "reply", tasks: 0, text: "Pronto." });
  expect(w.got.shown[1].data).toEqual({ mesa: false });
  expect(w.got.shown[1].tag).toBe("unii");
  expect(w.got.badge).toEqual([3, "clear"]);
});

test("a tap on a task's push with no tab open opens /?mesa; a reply's, /", async () => {
  const w = worker();
  await w.tap({ data: { mesa: true } });
  await w.tap({ data: { mesa: false } });
  expect(w.got.opened).toEqual(["/?mesa", "/"]);
});

test("a tap with the chat open brings its tab to front, on the Mesa if a task's", async () => {
  const w = worker([{ url: "https://other.example/" }, { url: "https://office.example/" }]);
  await w.tap({ data: { mesa: true } });
  expect(w.got.opened).toEqual([]);
  expect(w.got.posted).toEqual([{ $: "mesa" }]);
  expect(w.got.focused).toBe(1);
  await w.tap({ data: { mesa: false } });
  expect(w.got.posted.length).toBe(1);
  expect(w.got.focused).toBe(2);
});

test("over a tab in front nothing shows, but on Safari (it takes back a quiet subscription)", async () => {
  const tabs = [{ url: "https://office.example/", focused: true }];
  const w = worker(tabs);
  await w.push({ kind: "tasks", tasks: 1, ids: ["P1"], text: "Pendência P1 precisa de você" });
  expect(w.got.shown).toEqual([]);
  expect(w.got.badge).toEqual([1]);
  const safari = worker(tabs, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1");
  await safari.push({ kind: "tasks", tasks: 1, ids: ["P1"], text: "Pendência P1 precisa de você" });
  expect(safari.got.shown.length).toBe(1);
});
