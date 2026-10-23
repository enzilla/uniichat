// Instructions.test
// =================
// `UNII_DIR=$(mktemp -d /tmp/unii-t.XXXX) bun test Instructions.test.ts`:
// what Claude Code would load on a device (Instructions.ts), on a home,
// a managed policy folder and repositories made in a temporary dir; and
// the block a turn gets of it (Tools.instructions).

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as I from "./Instructions.ts";
import { Tools } from "./Tools.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-instr-");
let home = "";
let managed = "";
let n = 0;

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

beforeEach(() => {
  I.forget();
  n += 1;
  home = path.join(ROOT, "home" + n);
  managed = path.join(ROOT, "managed" + n);
  fs.mkdirSync(managed, { recursive: true });
});

function put(file: string, text: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

const titles = (parts: I.Part[]) => parts.map((p) => p.title.replace(home, "~").replace(managed, "<managed>").replace(ROOT, "<root>"));
const texts = (parts: I.Part[]) => parts.map((p) => p.text);

test("global: the organization's file and policy, the user's file with its imports, then the rules that always hold; those for some files listed by their paths", async () => {
  put(managed + "/CLAUDE.md", "Política da organização.");
  put(managed + "/managed-settings.json", JSON.stringify({ claudeMd: "Do arquivo gerenciado." }));
  put(home + "/.claude/CLAUDE.md", "Do usuário.\n<!-- nota para humanos -->\n@extra.md e `@nao-importa.md`\n```\n@tambem-nao.md\n```\n");
  put(home + "/.claude/extra.md", "Importado.\n@~/.claude/fundo.md");
  put(home + "/.claude/fundo.md", "Importado do importado.");
  put(home + "/.claude/nao-importa.md", "NÃO");
  put(home + "/.claude/tambem-nao.md", "NÃO");
  put(home + "/.claude/rules/b-sempre.md", "Regra sempre.");
  put(home + "/.claude/rules/a-go.md", "---\npaths:\n  - \"**/server/**/*.go\"\n---\nRegra de Go.");
  const parts = await I.global(home, path.join(home, "work"), managed);
  expect(texts(parts)).toEqual(["Política da organização.", "Do arquivo gerenciado.", "Do usuário.\n@extra.md e `@nao-importa.md`\n```\n@tambem-nao.md\n```", "Importado.\n@~/.claude/fundo.md", "Importado do importado.", "Regra sempre.", "- " + home + "/.claude/rules/a-go.md: **/server/**/*.go"]);
  expect(texts(parts).join("")).not.toContain("nota para humanos");
});

test("the server-managed settings, when cached, are the policy: the managed files' claudeMd is skipped, the managed CLAUDE.md file is not", async () => {
  put(managed + "/CLAUDE.md", "Arquivo gerenciado.");
  put(managed + "/managed-settings.json", JSON.stringify({ claudeMd: "Do arquivo." }));
  put(home + "/.claude/remote-settings.json", JSON.stringify({ claudeMd: "Do servidor." }));
  expect(texts(await I.global(home, path.join(home, "work"), managed))).toEqual(["Arquivo gerenciado.", "Do servidor."]);
});

test("project: each folder's CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md from the root down; AGENTS.md only where none is; its rules; the rules for the file; auto memory's first lines", () => {
  const repo = path.join(ROOT, "repos" + n, "app");
  put(repo + "/.git/HEAD", "ref: refs/heads/main\n");
  put(path.dirname(repo) + "/CLAUDE.md", "Acima do repositório.");
  put(repo + "/CLAUDE.md", "Raiz do projeto.");
  put(repo + "/CLAUDE.local.md", "Local do projeto.");
  put(repo + "/AGENTS.md", "NÃO: há CLAUDE.md.");
  put(repo + "/server/CLAUDE.md", "Do server.");
  put(repo + "/.claude/rules/sempre.md", "Regra do projeto.");
  put(repo + "/.claude/rules/sql.md", "---\npaths: \"**/*.sql\"\n---\nRegra de SQL.");
  put(home + "/.claude/rules/go.md", "---\npaths:\n  - \"**/server/**/*.go\"\n---\nRegra de Go do usuário.");
  const mem = path.join(home, ".claude/projects", repo.replace(/[^A-Za-z0-9]/g, "-"), "memory/MEMORY.md");
  put(mem, Array.from({ length: 250 }, (_, k) => "- memória " + k).join("\n"));
  const parts = I.project(home, [repo + "/server/internal/a.go"], managed);
  expect(texts(parts).slice(0, 5)).toEqual(["Acima do repositório.", "Raiz do projeto.", "Local do projeto.", "Do server.", "Regra do projeto."]);
  expect(texts(parts)[5].split("\n").length).toBe(200);
  expect(texts(parts)[6]).toBe("Regra de Go do usuário.");
  expect(parts.length).toBe(7);
  expect(texts(I.project(home, [repo + "/db/x.sql"], managed))).toContain("Regra de SQL.");
});

test("a repository without CLAUDE.md gets its AGENTS.md; a worktree shares its main checkout's auto memory; claudeMdExcludes leaves a file out", () => {
  const main = path.join(ROOT, "repos" + n, "main");
  const wt = path.join(ROOT, "repos" + n, "wt");
  put(main + "/.git/HEAD", "x");
  put(wt + "/.git", "gitdir: " + main + "/.git/worktrees/wt\n");
  put(wt + "/AGENTS.md", "Do AGENTS.");
  put(wt + "/docs/CLAUDE.md", "Excluído.");
  put(home + "/.claude/settings.json", JSON.stringify({ claudeMdExcludes: ["**/docs/CLAUDE.md"] }));
  put(path.join(home, ".claude/projects", main.replace(/[^A-Za-z0-9]/g, "-"), "memory/MEMORY.md"), "Memória do repositório.");
  expect(texts(I.project(home, [wt + "/docs/a.md"], managed))).toEqual(["Do AGENTS.", "Memória do repositório."]);
});

test("plugins: the organization's enable its managed ones; their SessionStart hooks run as at a new session, their context is the instructions'; a failing or resume-only hook adds none", async () => {
  const plug = put(home + "/.claude/plugins/cache/numih/erp/v1/hooks/hooks.json", JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "mkdir -p \"$HOME_RULES\" && echo 'Regra sincronizada.' > \"$HOME_RULES/numih.md\" && printf '%s' '{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"Contexto do plugin em '\"$(basename ${CLAUDE_PLUGIN_ROOT})\"'\"}}'" }] }] } }));
  const root = path.dirname(path.dirname(plug));
  put(home + "/.claude/plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: { "erp@numih": [{ scope: "managed", installPath: root }] } }));
  put(home + "/.claude/remote-settings.json", JSON.stringify({ enabledPlugins: { "erp@numih": true } }));
  put(home + "/.claude/settings.json", JSON.stringify({ hooks: { SessionStart: [
    { matcher: "startup", hooks: [{ type: "command", command: "cat > /dev/null; echo \"Do usuário em $(basename $CLAUDE_PROJECT_DIR)\"" }] },
    { matcher: "resume", hooks: [{ type: "command", command: "echo NÃO" }] },
    { hooks: [{ type: "command", command: "echo NÃO; exit 1" }] },
  ] } }));
  process.env.HOME_RULES = home + "/.claude/rules";
  expect(I.plugins(home, managed)).toEqual([["erp", root]]);
  const parts = await I.global(home, path.join(home, "work"), managed, 10000);
  delete process.env.HOME_RULES;
  // the hooks ran before the files were read: the rule one wrote is in
  expect(texts(parts)).toEqual(["Regra sincronizada.", "Do usuário em work", "Contexto do plugin em v1"]);
  expect(I.start_hooks(home, managed).length).toBe(3);
  put(home + "/.claude/settings.json", JSON.stringify({ disableAllHooks: true }));
  expect(I.start_hooks(home, managed)).toEqual([]);
});

test("the block: each open device's, in their names' order, its standing parts then the projects' (none twice)", () => {
  const part = (id: string, text: string): I.Part => ({ id, title: id, text });
  const dev = (rules: I.Part[], proj: I.Part[]) => ({ terms: new Map([["t", {}]]), skills: [], rules, proj, paths: [], shown: new Set() });
  const tools = { devices: new Map<string, unknown>([["pi", dev([part("u", "Do usuário no pi.")], [])], ["notebook", dev([part("o", "Da organização."), part("u", "Do usuário.")], [part("u", "Do usuário."), part("p", "Do projeto.")])]]) } as unknown as Tools;
  const text = Tools.instructions(tools).text;
  expect(text.indexOf("# Instructions on device notebook")).toBeLessThan(text.indexOf("# Instructions on device pi"));
  expect(text.match(/Do usuário\./g)?.length).toBe(1);
  expect(text.indexOf("Da organização.")).toBeLessThan(text.indexOf("Do projeto."));
  expect(Tools.instructions({ devices: new Map() } as unknown as Tools).text).toBe("");
});

test("a plugin the organization enables brings its skills too (Machine.skills)", async () => {
  const { Machine } = await import("./Machine.ts");
  const root = path.join(home, ".claude/plugins/cache/numih/erp/v1");
  put(root + "/skills/criar-prd/SKILL.md", "---\nname: criar-prd\ndescription: Cria PRDs.\n---\nCorpo.");
  put(home + "/.claude/plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: { "erp@numih": [{ scope: "managed", installPath: root }] } }));
  put(home + "/.claude/remote-settings.json", JSON.stringify({ enabledPlugins: { "erp@numih": true } }));
  expect(Machine.skills(home, path.join(home, "work")).map((s) => s.name)).toEqual(["erp:criar-prd"]);
});

test("a file read brings the instructions now in force for it, once; its path stays for the next turns' block", async () => {
  const dev = { terms: new Map([["t", {}]]), skills: [], rules: [{ id: "u", title: "u", text: "Do usuário." }], proj: [], paths: [] as string[], shown: new Set(["u"]) };
  const tools = { devices: new Map([["notebook", dev]]), mem: {} } as unknown as Tools;
  const job = Tools.job;
  const open = Tools.open;
  const parts = [{ id: "u", title: "u", text: "Do usuário." }, { id: "/r/CLAUDE.md", title: "the project's (/r/CLAUDE.md)", text: "Do projeto." }];
  Tools.open = (() => dev) as unknown as typeof Tools.open;
  Tools.job = (async (_t: Tools, _d: string, j: { name: string; input: any }) => (j.name === "read" ? { text: "conteúdo", fail: false } : { text: JSON.stringify({ parts, at: ["/r/a.go"] }), fail: false })) as unknown as typeof Tools.job;
  try {
    const first = await Tools.call(tools, "main", "read", { device: "notebook", path: "/r/a.go" }, new AbortController().signal, "1");
    expect(first.text).toBe("conteúdo\n\nInstructions that now hold for /r/a.go (as Claude Code loads them on demand; follow them):\n\n## From the project's (/r/CLAUDE.md)\n\nDo projeto.");
    expect((await Tools.call(tools, "main", "read", { device: "notebook", path: "/r/a.go" }, new AbortController().signal, "2")).text).toBe("conteúdo");
    expect(dev.paths).toEqual(["/r/a.go"]);
  } finally {
    Tools.job = job;
    Tools.open = open;
  }
});

test("the device's instructions job runs through Machine.run, its hooks around it, and answers the parts", async () => {
  const { Machine } = await import("./Machine.ts");
  const work = fs.mkdtempSync(os.tmpdir() + "/unii-work-");
  try {
    const out = await Machine.run({ name: "instructions", input: {}, cwd: "main" }, work, new AbortController().signal);
    expect(out.fail).toBe(false);
    expect(Array.isArray(JSON.parse(out.text))).toBe(true);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
