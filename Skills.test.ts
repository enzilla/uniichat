// Skills.test
// ===========
// `bun test Skills.test.ts`: a device's skills (Machine.skills, .skill):
// the Agent Skills, and Claude Code's (its skills, commands and enabled
// plugins), on a home made in a temporary dir.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Machine } from "./Machine.ts";
import { Tools } from "./Tools.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-skills-");

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const md = (head: string, body = "Corpo.") => "---\n" + head + "\n---\n" + body + "\n";

// a home with an Agent Skill, Claude Code's skills and commands, an
// enabled plugin, a disabled one, and one installed only for a project;
// a project's own skills aren't read (an agent works in its scratch dir)
function home(): { home: string; dir: string } {
  const h = fs.mkdtempSync(ROOT + "/home-");
  const dir = h + "/work/main";
  put(h + "/.agents/skills/revisar/SKILL.md", md("name: revisar\ndescription: A dos agentes."));
  put(h + "/.claude/skills/revisar/SKILL.md", md("name: revisar\ndescription: A do Claude Code, repetida."));
  put(h + "/.claude/skills/sem-nome/SKILL.md", md("description: Nomeada pela pasta."));
  put(h + "/.claude/skills/Ruim Nome/SKILL.md", md("name: Ruim Nome\ndescription: Nome inválido."));
  put(h + "/.claude/skills/sem-descricao/SKILL.md", md("name: sem-descricao"));
  put(dir + "/.claude/skills/do-projeto/SKILL.md", md("name: do-projeto\ndescription: Do diretório de trabalho."));
  put(h + "/.claude/commands/speckit.plan.md", md("description: Planeja a feature."));
  put(h + "/.claude/commands/solto.md", "\n\nResume o diff em uma linha.\nMais texto.\n");
  const plugin = (name: string) => h + "/.claude/plugins/cache/" + name;
  put(plugin("pony") + "/skills/pony/SKILL.md", md("name: pony\ndescription: Do plugin."));
  put(plugin("pony") + "/commands/medir.md", md("description: Comando do plugin."));
  put(plugin("off") + "/skills/x/SKILL.md", md("name: x\ndescription: Desligado."));
  put(plugin("proj") + "/skills/y/SKILL.md", md("name: y\ndescription: Só de um projeto."));
  put(h + "/.claude/settings.json", JSON.stringify({ enabledPlugins: { "pony@market": true, "off@market": false, "proj@market": true } }));
  put(h + "/.claude/plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: {
    "pony@market": [{ scope: "user", installPath: plugin("pony") }],
    "off@market": [{ scope: "user", installPath: plugin("off") }],
    "proj@market": [{ scope: "project", projectPath: "/algum", installPath: plugin("proj") }],
  } }));
  return { home: h, dir };
}

test("Claude Code's skills, commands and enabled plugins join the Agent Skills; the first of a name wins", () => {
  const { home: h } = home();
  const found = Object.fromEntries(Machine.skills(h).map((s) => [s.name, s.description]));
  expect(found).toEqual({
    "revisar": "A dos agentes.",
    "sem-nome": "Nomeada pela pasta.",
    "speckit.plan": "Planeja a feature.",
    "solto": "Resume o diff em uma linha.",
    "pony:pony": "Do plugin.",
    "pony:medir": "Comando do plugin.",
  });
});

test("the skill tool reads a command's own file, a skill's SKILL.md", () => {
  const { home: h } = home();
  const cmd = Machine.skill(h, "pony:medir");
  expect(cmd.fail).toBe(false);
  expect(cmd.text).toContain("Comando do plugin.");
  expect(Machine.skill(h, "sem-nome").text).toContain("Nomeada pela pasta.");
  expect(Machine.skill(h, "x").fail).toBe(true);
});

test("without Claude Code, only the Agent Skills, as before", () => {
  const h = fs.mkdtempSync(ROOT + "/home-");
  put(h + "/.agents/skills/so/SKILL.md", md("name: so\ndescription: Só esta."));
  put(h + "/.agents/skills/pasta/SKILL.md", md("description: Sem nome não vale aqui."));
  expect(Machine.skills(h).map((s) => s.name)).toEqual(["so"]);
});

test("the standing instructions leave out the session start hooks' output, which comes apart (after the view: it changes as plugins write skills)", () => {
  const rules = [{ id: "user", title: "the user's", text: "Regra fixa." }, { id: "hook:/p:cmd", title: "a SessionStart hook's output (p plugin)", text: "Skills: 12 novas." }];
  const d = { terms: new Map([["t", {}]]), rules, proj: [] };
  const tools = { devices: new Map([["enzo", d]]) } as unknown as Parameters<typeof Tools.instructions>[0];
  const standing = Tools.instructions(tools).text;
  const hooks = Tools.instructions(tools, true).text;
  expect(standing).toContain("Regra fixa.");
  expect(standing).not.toContain("Skills: 12 novas.");
  expect(hooks).toContain("Skills: 12 novas.");
  expect(hooks).not.toContain("Regra fixa.");
});
