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

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-skills-");

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const md = (head: string, body = "Corpo.") => "---\n" + head + "\n---\n" + body + "\n";

// a home with an Agent Skill, Claude Code's skills and commands, an
// enabled plugin, a disabled one, and one installed only for a project
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
  const { home: h, dir } = home();
  const found = Object.fromEntries(Machine.skills(h, dir).map((s) => [s.name, s.description]));
  expect(found).toEqual({
    "revisar": "A dos agentes.",
    "sem-nome": "Nomeada pela pasta.",
    "do-projeto": "Do diretório de trabalho.",
    "speckit.plan": "Planeja a feature.",
    "solto": "Resume o diff em uma linha.",
    "pony:pony": "Do plugin.",
    "pony:medir": "Comando do plugin.",
  });
});

test("the skill tool reads a command's own file, a skill's SKILL.md", () => {
  const { home: h, dir } = home();
  const cmd = Machine.skill(h, dir, "pony:medir");
  expect(cmd.fail).toBe(false);
  expect(cmd.text).toContain("Comando do plugin.");
  expect(Machine.skill(h, dir, "sem-nome").text).toContain("Nomeada pela pasta.");
  expect(Machine.skill(h, dir, "x").fail).toBe(true);
});

test("without Claude Code, only the Agent Skills, as before", () => {
  const h = fs.mkdtempSync(ROOT + "/home-");
  put(h + "/.agents/skills/so/SKILL.md", md("name: so\ndescription: Só esta."));
  put(h + "/.agents/skills/pasta/SKILL.md", md("description: Sem nome não vale aqui."));
  expect(Machine.skills(h, h + "/work").map((s) => s.name)).toEqual(["so"]);
});
