// Pipeline.server.test
// ====================
// `bun test Pipeline.server.test.ts`: the pipeline's panel in the server
// (R6): AGENTES.md written by the serve as an agent starts ("em
// andamento") and as it ends (its verdict), and /api/pipeline, the
// panel's page's data. The AI is a fake: a subagent's call ends when the
// test lets it, with its report.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask } from "./AskAI.ts";
import * as config from "./Config.ts";
import * as Pipeline from "./Pipeline.ts";
import { Chat, Main } from "./Server.ts";
import * as Tasks from "./Tasks.ts";
import { Tools } from "./Tools.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}
afterAll(() => {
  fs.rmSync(config.DIR, { recursive: true, force: true });
  fs.mkdirSync(config.DIR, { recursive: true });
});

// a subagent's call ends as the test says (end), with its report
let end: (text: string) => void = () => {};
(AskAI as any).ask = (ask: Ask, on: (ev: object) => void) => {
  if (!ask.agent) {
    return { send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "a summary", left: [] }) };
  }
  // its report streamed as the AI's is (an Entry, logged), then the end
  const done = new Promise((ok) => (end = (text) => {
    on({ $: "Entry", kind: "unii", text });
    ok({ ok: true, text, left: [] });
  }));
  return { send: () => {}, stop: () => {}, wake: () => {}, done };
};
Pipeline.GH.read = async () => null;

const chat = Chat.open() as any;
const tools: Tools = chat.tools;
const dir = chat.mem.dir;
const md = () => (fs.existsSync(dir + "/AGENTES.md") ? fs.readFileSync(dir + "/AGENTES.md", "utf8") : "");
const row = (name: string) => md().split("\n").find((l) => l.includes("| " + name + " |")) ?? "";

test("an agent's start and end write AGENTES.md: 'em andamento', then its verdict", async () => {
  const s = Tasks.tasks_load(dir);
  s.refs = ["num-9999"];
  const out = await Tools.call(tools, "main", "spawn", { tasks: ["Verifique Numih/auth#999 head abcdef1 (P1)."], labels: ["num-9999-verif"] }, new AbortController().signal, "id-1");
  const name = /Started (\w+)/.exec(out.text)![1];
  for (let k = 0; k < 100 && !row(name).includes("em andamento"); k++) {
    await Bun.sleep(5);
  }
  expect(row(name)).toMatch(new RegExp("^\\| num-9999-verif \\| " + name + " \\| num-9999 \\| verificação auth#999 \\(P1\\) \\| padrão \\| em andamento desde "));
  end("**Veredito: aprovado com ressalvas.**\n\n**Ressalvas:**\n1. MÉDIA: algo.\n2. Baixa: outra.");
  for (let k = 0; k < 100 && row(name).includes("em andamento"); k++) {
    await Bun.sleep(5);
  }
  expect(row(name)).toContain("| concluído: aprovado com ressalvas (ressalvas: 1 média e 1 baixa), ");
});

test("/api/pipeline: the fronts, the cycle just ended, the PR named", async () => {
  const res = await Main.page(chat, "/api/pipeline", new Request("http://x/api/pipeline"));
  expect(res.status).toBe(200);
  const panel = (await res.json()) as Pipeline.Panel;
  const f = panel.fronts.find((x) => x.ref === "num-9999")!;
  expect(f.cycles.length).toBe(1);
  expect(f.cycles[0].run.verdict).toBe("approved_with_notes");
  expect(f.prs.map((p) => [p.key, p.head, p.url])).toEqual([["auth#999", "abcdef1", "https://github.com/Numih/auth/pull/999"]]);
  expect(typeof panel.at).toBe("string");
});
