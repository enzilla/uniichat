// ClaudeMcp.test
// ==============
// `bun test ClaudeMcp.test.ts`: a device's Claude Code MCP servers
// (Machine.claude_mcps), named for the chat and off till turned on
// (Tools.claude_conf, Tools.off), and run on the device by name alone
// (Mcp.here reads the program there), on a home made in a temporary dir.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Machine } from "./Machine.ts";
import { Mcp } from "./Mcp.ts";
import { Tools } from "./Tools.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-claude-mcp-");

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// an MCP server of one tool, eco, that says back its text and the
// variable SEGREDO it was given
const ECO = `
for await (const line of console) {
  const m = JSON.parse(line);
  const said = (result) => console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
  if (m.method === "initialize") said({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "eco", version: "1" } });
  if (m.method === "tools/list") said({ tools: [{ name: "eco", description: "Ecoa.", inputSchema: { type: "object", properties: { texto: { type: "string" } } } }] });
  if (m.method === "tools/call") said({ content: [{ type: "text", text: m.params.arguments.texto + " / " + process.env.SEGREDO }] });
}
`;

// a home whose Claude Code has a stdio server (with a secret in its env),
// a URL one, and an enabled plugin's server under ${CLAUDE_PLUGIN_ROOT}
function home(): string {
  const h = fs.mkdtempSync(ROOT + "/home-");
  const plugin = h + "/.claude/plugins/cache/pony";
  put(h + "/eco.js", ECO);
  put(plugin + "/eco.js", ECO);
  put(h + "/.claude.json", JSON.stringify({ mcpServers: {
    eco: { type: "stdio", command: process.execPath, args: [h + "/eco.js"], env: { SEGREDO: "s3cr3t" } },
    remoto: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
  } }));
  put(plugin + "/.mcp.json", JSON.stringify({ mcpServers: { "mcp-search": { command: process.execPath, args: ["${CLAUDE_PLUGIN_ROOT}/eco.js"], env: { SEGREDO: "${NAO_DEFINIDA:-padrao}" } } } }));
  put(h + "/.claude/settings.json", JSON.stringify({ enabledPlugins: { "pony@market": true } }));
  put(h + "/.claude/plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: { "pony@market": [{ scope: "user", installPath: plugin }] } }));
  return h;
}

test("Claude Code's stdio servers and its enabled plugins', a URL one left out; the plugin's folder and defaults read", () => {
  const h = home();
  const found = Machine.claude_mcps(h);
  expect(found.map((m) => m.name)).toEqual(["eco", "pony:mcp-search"]);
  expect(found[1].conf.args).toEqual([h + "/.claude/plugins/cache/pony/eco.js"]);
  expect(found[1].conf.env).toEqual({ SEGREDO: "padrao" });
});

test("named <device>_<name> as a device's config servers are (Config.ts config_mcp_prefix); off till the chat turns one on", () => {
  expect(Tools.claude_conf("enzo", "pony:mcp-search").name).toBe("enzo_pony-mcp-search");
  expect(Tools.claude_conf("my.mac", "a__b").name).toBe("my-mac_a--b");
  const servers = Mcp.servers(() => {}, async () => ({ text: "", fail: true }), () => true);
  Mcp.sync(servers, [Tools.claude_conf("enzo", "eco")]);
  const tools = { mcp: servers, mem: { off: [], on: [] } } as unknown as Tools;
  expect(Tools.off(tools)).toEqual(["enzo_eco"]);
  (tools.mem as any).on = ["enzo_eco"];
  expect(Tools.off(tools)).toEqual([]);
});

test("on the device, the server runs by its name alone: its program and secret read there", async () => {
  const h = home();
  try {
    const conf = { ...Tools.claude_conf("enzo", "eco"), claude: "eco" };
    const ask = async (method: string, params: object) => JSON.parse((await Mcp.here({ key: "k", method, params, conf: method === "initialize" ? conf : undefined }, AbortSignal.timeout(10e3), h)).text);
    expect((await ask("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })).result.serverInfo.name).toBe("eco");
    expect((await ask("tools/list", {})).result.tools.map((t: any) => t.name)).toEqual(["eco"]);
    expect((await ask("tools/call", { name: "eco", arguments: { texto: "oi" } })).result.content[0].text).toBe("oi / s3cr3t");
    const gone = JSON.parse((await Mcp.here({ key: "k2", method: "initialize", params: {}, conf: { ...conf, claude: "sumiu" } }, AbortSignal.timeout(10e3), h)).text);
    expect(gone.dead).toContain("isn't in Claude Code's config");
  } finally {
    Mcp.lost();
  }
});
