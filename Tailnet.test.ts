// Tailnet.test
// ============
// `UNII_DIR=$(mktemp -d /tmp/unii-t.XXXX) bun test Tailnet.test.ts`: the
// owner's tailnet nodes signed in by their Tailscale identity (Tailnet.ts),
// with a whois of our own in place of tailscaled's.

import { expect, test } from "bun:test";
import * as config from "./Config.ts";
import { Owner } from "./Owner.ts";
import * as Tailnet from "./Tailnet.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

const OWNER = "dono@github";
const NODES: Record<string, Tailnet.Who> = {
  "100.64.0.1": { login: "Dono@GitHub", node: "iphone", id: "nA", tagged: false },
  "100.64.0.2": { login: "outra@github", node: "dela", id: "nB", tagged: false },
  "100.64.0.3": { login: "dono@github", node: "servidor", id: "nC", tagged: true },
  "100.64.0.4": { login: "dono@github", node: "notebook", id: "nD", tagged: false },
};
const ask = async (ip: string) => NODES[ip] ?? null;
const req = (real?: string, auth?: string) => new Request("http://127.0.0.1:8788/api/me", { headers: { ...(real ? { "x-real-ip": real } : {}), ...(auth ? { authorization: "Bearer " + auth } : {}) } });

test("the real address counts only from the proxy on this host", () => {
  expect(Tailnet.peer(req("100.64.0.1"), "127.0.0.1")).toBe("100.64.0.1");
  expect(Tailnet.peer(req("100.64.0.1"), "::ffff:127.0.0.1")).toBe("100.64.0.1");
  expect(Tailnet.peer(req("100.64.0.1"), "100.64.0.9")).toBeNull();
  expect(Tailnet.peer(req(), "127.0.0.1")).toBeNull();
  expect(Tailnet.peer(req("127.0.0.1"), "127.0.0.1")).toBeNull();
});

test("the owner's untagged node is signed in, with a session of its own", async () => {
  const r = req("100.64.0.1");
  expect(Owner.is(r)).toBe(false);
  const token = await Tailnet.adopt(r, "127.0.0.1", OWNER, ask);
  expect(token).not.toBeNull();
  expect(Owner.is(r)).toBe(true);
  expect(Owner.is(req(undefined, token!))).toBe(true);
});

test("each node's token is its own and outlives the server (the same each time)", async () => {
  const a = await Tailnet.adopt(req("100.64.0.4"), "127.0.0.1", OWNER, ask);
  expect(a).toBe(Tailnet.node_token("nD"));
  expect(a).not.toBe(Tailnet.node_token("nA"));
});

test("another user's node, a tagged one, one not on the tailnet, or no owner set: no sign-in", async () => {
  for (const [ip, owner] of [["100.64.0.2", OWNER], ["100.64.0.3", OWNER], ["100.64.0.8", OWNER], ["100.64.0.1", ""]]) {
    const r = req(ip);
    expect(await Tailnet.adopt(r, "127.0.0.1", owner, ask)).toBeNull();
    expect(Owner.is(r)).toBe(false);
  }
  expect(await Tailnet.adopt(req("100.64.0.1"), "100.64.0.1", OWNER, ask)).toBeNull();
});

test("a request already signed in keeps its own session", async () => {
  const token = Tailnet.node_token("nA");
  expect(await Tailnet.adopt(req("100.64.0.4", token), "127.0.0.1", OWNER, ask)).toBeNull();
});
