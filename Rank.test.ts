// Rank.test
// =========
// `UNII_DIR=$(mktemp -d /tmp/unii-t.XXXX) bun test Rank.test.ts`: texts
// ranked by a query (Rank.ts), and the skills block a turn gets
// (Tools.skills): each skill with what it is for, in a steady order; and
// a skill a message invokes by /name, loaded for its turn (Chat.invoked).

import { expect, test } from "bun:test";
import * as Rank from "./Rank.ts";
import { Tools } from "./Tools.ts";

const SKILLS = [
  { name: "revisar-diff", description: "Revisa o diff atual antes de abrir o PR." },
  { name: "executar-hotfix", description: "Fluxo de hotfix e release de um módulo." },
  { name: "erp:criar-issue-linear", description: "Cria issues no Linear com labels padronizadas." },
  { name: "dataviz", description: "Use whenever you create a chart, graph or dashboard." },
];

// tools with open devices holding skills (Tools.opened: a device with a
// terminal attached), the rest of Tools left out
function tools(devices: Record<string, typeof SKILLS>): Tools {
  const map = new Map(Object.entries(devices).map(([name, skills]) => [name, { terms: new Map([["t", {}]]), skills }]));
  return { devices: map } as unknown as Tools;
}

test("words: lowercase, no accents, split at what is no letter or digit", () => {
  expect(Rank.words("Revisa o módulo erp:criar-issue")).toEqual(["revisa", "modulo", "erp", "criar", "issue"]);
});

test("rank: those that share words with the query, best first; none for none", () => {
  const texts = SKILLS.map((s) => s.name + " " + s.description);
  expect(Rank.rank(texts, "abre uma issue no linear", 3)).toEqual([2]);
  expect(Rank.rank(texts, "preciso de um hotfix no modulo", 3)[0]).toBe(1);
  expect(Rank.rank(texts, "bom dia", 3)).toEqual([]);
});

test("the block gives every skill what it is for, the devices in their names' order, whatever order they opened in", () => {
  const block = Tools.skills(tools({ pi: SKILLS.slice(2), notebook: SKILLS.slice(0, 2) })).text;
  expect(block).toContain("- notebook: revisar-diff: Revisa o diff atual antes de abrir o PR.\n- notebook: executar-hotfix: Fluxo de hotfix e release de um módulo.\n- pi: erp:criar-issue-linear: Cria issues no Linear com labels padronizadas.");
  expect(block).toBe(Tools.skills(tools({ notebook: SKILLS.slice(0, 2), pi: SKILLS.slice(2) })).text);
  expect(Tools.skills(tools({ notebook: [] })).text).toBe("");
});

test("skills_fit searches every open device", () => {
  const found = Tools.skills_fit(tools({ notebook: SKILLS.slice(0, 2), pi: SKILLS.slice(2) }), "gráfico dashboard chart", 10);
  expect(found).toEqual(["- pi: dataviz: Use whenever you create a chart, graph or dashboard."]);
});

test("a message's /name loads that skill for the turn, from the device that has it; others are text", async () => {
  const { Chat } = await import("./Server.ts");
  const t = tools({ notebook: SKILLS });
  const job = Tools.job;
  const asked: string[] = [];
  Tools.job = (async (_t: Tools, device: string, j: { input: { name: string } }) => (asked.push(device + ":" + j.input.name), { text: "# " + j.input.name, fail: false })) as unknown as typeof Tools.job;
  try {
    const blocks = await Chat.invoked({ tools: t } as never, "/revisar-diff do PR 644\n/model opus\nveja /dataviz", new AbortController().signal);
    expect(asked).toEqual(["notebook:revisar-diff"]);
    expect(blocks.map((b) => b.text)).toEqual(["The user invoked the skill revisar-diff on notebook; it loaded here, follow it for their message:\n\n# revisar-diff\n\n"]);
  } finally {
    Tools.job = job;
  }
});
