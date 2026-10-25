// Pipeline.test
// =============
// `bun test Pipeline.test.ts`: the pipeline's panel (R6, Pipeline.ts):
// the agents' runs as their logs say them (role, front, verdict, notes,
// PRs, heads), the fronts (stage, cycles, PRs live, metrics), the panel
// drawn (Html.pipeline_html) and AGENTES.md as the serve writes it (the
// table vigia.ts reads). The acceptance (uniichat-ux-r1.md §6, R6): the
// panel reproduces NUM-2337 on 23 and 24/10 with its 5 cycles of `svc:`
// visible, from a chat dir made as those agents' logs were.

import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as Pipeline from "./Pipeline.ts";
import * as Tasks from "./Tasks.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

const ROOT = fs.mkdtempSync("/tmp/unii-pipeline-");
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));
beforeEach(() => Pipeline.live_clear());

let dirs = 0;
function dir_new(): string {
  const d = ROOT + "/chat" + ++dirs;
  fs.mkdirSync(d + "/docs/agent", { recursive: true });
  return d;
}

// an agent's log as Memory.ts writes it: its note, its task, its report
// (none: cut), each line dated
type Fake = { name: string; label: string | null; model?: string; start: string; end: string; task: string; report: string | null };
function agent_write(dir: string, a: Fake): void {
  const note = "subagent" + (a.model === undefined ? "" : " on " + a.model) + (a.label === null ? "" : ", labeled " + a.label);
  const lines = [
    { kind: "note", text: note, i: 0, size: 1, date: a.start },
    { kind: "user", text: a.task, i: 1, size: 1, date: a.start },
    a.report === null ? { kind: "tool", text: "shell …", i: 2, size: 1, date: a.end } : { kind: "unii", text: a.report, i: 2, size: 1, date: a.end },
  ];
  fs.writeFileSync(dir + "/docs/agent/" + a.name + ".jsonl", lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

// a list of a chat's dir, with its refs and tasks as given
function store_write(dir: string, refs: string[], tasks: object[]): Tasks.Store {
  fs.writeFileSync(dir + "/tasks.json", JSON.stringify({ next: 100, rev: 1, refs, tasks }));
  return Tasks.tasks_load(dir);
}

const task = (x: object) => ({ title: "t", detail: "", state: "open", assignee: "unii", origin: "chat", by: "main", choices: [], answer: null, note: null, ref: null, made: "2026-10-23T12:00:00.000Z", changed: "2026-10-23T12:00:00.000Z", closed: null, told: true, rev: 1, after: [], ...x });

// Reading the logs
// ----------------

test("verdict_of: the verdict from the first lines; notes by severity, from a list or each item", () => {
  // a heading gives its severity to its items (SpikyOwl, 24/10)
  const spiky = "**Veredito: APROVADO com ressalvas baixas.** Nada foi commitado.\n\n- **dp-bk-http#41 (d4f86ad):**\n  - O head está na branch.\n- **Testes:** ok.\n\n**Ressalvas baixas:**\n1. Sem teste da recusa.\n2. Caixa.\n3. Trocar a pseudo-versão.";
  expect(Pipeline.verdict_of(spiky)).toEqual({ verdict: "approved_with_notes", notes: { high: 0, medium: 0, low: 3 }, noted: true });
  // items that open with their severity, outside any list of notes (LemonPig, 23/10)
  const lemon = "**REPROVADO.** Há uma ressalva ALTA que bloqueia o merge.\n\n- **A1 (ALTA, bloqueante, #41 e #17).** A assinatura…\n  - o auth renova;\n- **A2 (MÉDIA, R1 confirmada).** O RenewIdentity…\n- **A3 (baixa).** Nome.";
  expect(Pipeline.verdict_of(lemon)).toEqual({ verdict: "rejected", notes: { high: 1, medium: 1, low: 1 }, noted: true });
  // a list under a heading with no severity, each item its own (WhiteRaven, 25/10)
  const raven = "**Veredito: aprovado com ressalvas. Há uma ressalva MÉDIA.**\n\n**O que passou**\n- `bun test` deu 210 passes.\n\n**Ressalvas**\n1. **MÉDIA (Tasks.ts:1315):** burlável.\n   Correção sugerida: recusar.\n2. Baixa: PR_LINK.\n3. Baixa: isenção.\n\n**Não testado:**\n- iPhone, alta prioridade.";
  expect(Pipeline.verdict_of(raven)).toEqual({ verdict: "approved_with_notes", notes: { high: 0, medium: 1, low: 2 }, noted: true });
  // approved, none: none listed either (NeatOrca B2, 25/10)
  expect(Pipeline.verdict_of("**APROVADO sem ressalvas.** Tudo certo.\n- baixa coisa")).toEqual({ verdict: "approved", notes: { high: 0, medium: 0, low: 0 }, noted: false });
  expect(Pipeline.verdict_of("Aprovou o #18 com ressalvas: uma baixa.").verdict).toBe("approved_with_notes");
  // no verdict said: none read
  expect(Pipeline.verdict_of("Implementei a R6 no commit abc1234.")).toEqual({ verdict: null, notes: { high: 0, medium: 0, low: 0 }, noted: false });
});

test("verdict_of: the verdict said first, or on the line 'Veredito:'; not a rejection it cites (HappyFish, 25/10)", () => {
  expect(Pipeline.verdict_of("Aprovado. Nenhuma ressalva; o PR anterior foi reprovado e corrigido.").verdict).toBe("approved");
  expect(Pipeline.verdict_of("APROVADO com ressalvas: o #17 foi rejeitado antes.").verdict).toBe("approved_with_notes");
  expect(Pipeline.verdict_of("Reprovado: aprovado só depois de corrigir A1.").verdict).toBe("rejected");
  expect(Pipeline.verdict_of("Não aprovado: falta teste.").verdict).toBe("rejected");
  // the line "Veredito:" wins over what comes before it
  const happy = "## Verificação\n\n**Contexto:** o ciclo 5 foi reprovado (LemonPig).\n\n**Veredito: APROVADO com ressalvas (nenhuma alta; 1 média, 4 baixas).**\n\n### O que foi conferido\n- Baixa latência: ok.\n\n### Ressalvas\n1. **MÉDIA** verdict_of.\n2. **BAIXA** md_row.\n3. **BAIXA** md_merge.\n4. **BAIXA** heurística.\n5. **BAIXA** PR_REF.\n\n### Não testado\n- Alta carga.";
  expect(Pipeline.verdict_of(happy)).toEqual({ verdict: "approved_with_notes", notes: { high: 0, medium: 1, low: 4 }, noted: true });
  // the verdict's line spread: the next line that says one
  expect(Pipeline.verdict_of("**Veredito:**\nREPROVADO, uma alta.\n- A1 (ALTA): x")).toEqual({ verdict: "rejected", notes: { high: 1, medium: 0, low: 0 }, noted: true });
});

test("verdict_of: only a line labeled 'Veredito' decides; the word cited in the body doesn't (NeatOrca B1, 25/10)", () => {
  // no label: the first line, by the word said first
  expect(Pipeline.verdict_of("Aprovado. O veredito do anterior foi reprovado.").verdict).toBe("approved");
  expect(Pipeline.verdict_of("Aprovado.\nO veredito do anterior foi reprovado.").verdict).toBe("approved");
  expect(Pipeline.verdict_of("Reprovado. O veredito anterior foi aprovado.").verdict).toBe("rejected");
  // a label decides, even after a line that says another
  expect(Pipeline.verdict_of("O ciclo anterior foi aprovado.\n\nVeredito: reprovado (1 alta).").verdict).toBe("rejected");
  expect(Pipeline.verdict_of("O veredito do anterior foi reprovado.\n**Veredito (P66): aprovado.**").verdict).toBe("approved");
  expect(Pipeline.verdict_of("Contexto: reprovado antes.\nVeredito final — aprovado com ressalvas.\n- Baixa: x")).toEqual({ verdict: "approved_with_notes", notes: { high: 0, medium: 0, low: 1 }, noted: true });
  expect(Pipeline.verdict_of("O PR anterior foi reprovado.\n\n## Veredito\n\nAprovado.").verdict).toBe("approved");
  expect(Pipeline.verdict_of("Verdict: rejected. It was approved before.").verdict).toBe("rejected");
});

test("verdict_of: 'Veredito: Aprovado sem ressalvas' lists none (NeatOrca B2, 25/10)", () => {
  expect(Pipeline.verdict_of("Veredito: Aprovado sem ressalvas")).toEqual({ verdict: "approved", notes: { high: 0, medium: 0, low: 0 }, noted: false });
  expect(Pipeline.verdict_of("**Veredito: APROVADO sem ressalvas.**\n\n**Não testado:**\n- Alta: iPhone.")).toEqual({ verdict: "approved", notes: { high: 0, medium: 0, low: 0 }, noted: false });
  // with notes, still noted
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n- Baixa: x").noted).toBe(true);
});

test("verdict_of: 'sem ressalvas bloqueantes' or 'novas' qualifies which: its list counts (LunarWhale, 25/10)", () => {
  const low4 = "\n\n**Observações baixas, que não bloqueiam:**\n1. Link de PR.\n2. Desempate.\n3. Lembrete.\n4. Inglês.";
  const four = { verdict: "approved", notes: { high: 0, medium: 0, low: 4 }, noted: true };
  // GoldenJay (#17), StormyPony (#13)
  expect(Pipeline.verdict_of("**Veredito: APROVADO, sem ressalvas bloqueantes.** Verifiquei o #17." + low4)).toEqual(four);
  expect(Pipeline.verdict_of("Veredito: aprovado, sem ressalvas novas." + low4)).toEqual(four);
  expect(Pipeline.verdict_of("Veredito: aprovado sem ressalvas de merge.\n- Baixa: x").notes.low).toBe(1);
  expect(Pipeline.verdict_of("Veredito: aprovado sem ressalvas altas ou médias.\n- Ressalva baixa: x").notes.low).toBe(1);
  expect(Pipeline.verdict_of("Veredito: aprovado sem ressalvas impeditivas.\n- Ressalva baixa: x").notes.low).toBe(1);
  // 'sem ressalvas novas' listing the old ones fixed, no severity said: none (RubyTrout, KindSloth)
  expect(Pipeline.verdict_of("**Veredito: aprovado, sem ressalvas novas.**\n\n- **Ressalva 1:** corrigida.\n- **Ressalva 2:** corrigida.")).toEqual({ verdict: "approved", notes: { high: 0, medium: 0, low: 0 }, noted: false });
  // unqualified: none, whatever its list
  expect(Pipeline.verdict_of("Veredito: Aprovado sem ressalvas" + low4)).toEqual({ verdict: "approved", notes: { high: 0, medium: 0, low: 0 }, noted: false });
  expect(Pipeline.verdict_of("Veredito: aprovado, sem ressalvas. Alta cobertura.\n- Ressalva baixa: x").noted).toBe(false);
  expect(Pipeline.verdict_of("Veredito: aprovado sem ressalvas, alta confiança.\n- Ressalva baixa: x").noted).toBe(false);
  expect(Pipeline.verdict_of("Veredito: aprovado sem nenhuma ressalva.\n- Ressalva baixa: x").noted).toBe(false);
});

test("verdict_of: 'sem ressalvas pendentes' is of all of them: none, whatever its list (NuttyOyster 1, 25/10)", () => {
  const none = { verdict: "approved", notes: { high: 0, medium: 0, low: 0 }, noted: false };
  expect(Pipeline.verdict_of("Veredito: aprovado, sem ressalvas pendentes.\n- Ressalva baixa: x\n- Ressalva média: y")).toEqual(none);
  expect(Pipeline.verdict_of("**Veredito: aprovado sem ressalvas pendentes.**\n\n**Ressalvas baixas:**\n1. x\n2. y")).toEqual(none);
  // qualifiers still count the list
  expect(Pipeline.verdict_of("Veredito: aprovado sem ressalvas bloqueantes.\n- Ressalva baixa: x").notes.low).toBe(1);
  expect(Pipeline.verdict_of("Veredito: aprovado sem ressalvas novas.\n- Ressalva baixa: x").notes.low).toBe(1);
  expect(Pipeline.verdict_of("Veredito: aprovado sem ressalvas de merge.\n- Ressalva baixa: x").notes.low).toBe(1);
});

test("verdict_of: a note in a paragraph counts; 'aprovei' approves (NuttyOyster 2: LunarWhale, SmoothPretzel, 25/10)", () => {
  // LunarWhale: 'aprovado com ressalva baixa', the note a paragraph
  const lunar = "**Veredito: aprovado com ressalva baixa.** Não achei nenhuma ressalva alta ou média nova.\n\n**O que conferi:**\n- **Testes:** 238 passam.\n- **B2:** dá noted=false.\n\n**Ressalva baixa (o problema do GoldenJay, confirmado):** em `verdict_of`, o atalho zera as notas.\n\n**Conserto proposto:** exigir…";
  expect(Pipeline.verdict_of(lunar)).toEqual({ verdict: "approved_with_notes", notes: { high: 0, medium: 0, low: 1 }, noted: true });
  // SmoothPretzel: 'aprovei', the note a paragraph; 'sem ressalvas média ou alta' qualifies
  const smooth = "**Veredito: aprovei o morum/uniichat#18 no head 6178ccf, sem ressalvas média ou alta.** Gravei o veredito.\n\nConferi em worktree temporário:\n- **Testes:** 217 passando.\n\n**Ressalva baixa:** não rodei Safari 15.x nem 16.4 de verdade.\n\n**Não testado:**\n- iPhone.";
  expect(Pipeline.verdict_of(smooth)).toEqual({ verdict: "approved", notes: { high: 0, medium: 0, low: 1 }, noted: true });
  // PolarKoala: 'aprovado, com uma ressalva baixa'
  expect(Pipeline.verdict_of("**Veredito: aprovado, com uma ressalva baixa.**\n\n**Ressalva baixa:** em `Tools.ts`, a descrição.")).toEqual({ verdict: "approved_with_notes", notes: { high: 0, medium: 0, low: 1 }, noted: true });
  expect(Pipeline.verdict_of("Observação média: o cache não expira.\nVeredito: aprovei.").verdict).toBe("approved");
  expect(Pipeline.verdict_of("Veredito: aprovei.\n\nObservação média: o cache não expira.").notes.medium).toBe(1);
  // first person rejections
  expect(Pipeline.verdict_of("Veredito: reprovei o #19.").verdict).toBe("rejected");
  expect(Pipeline.verdict_of("Veredito: não aprovei o #19.").verdict).toBe("rejected");
  // not a note: no severity in the label, or a heading with no text after it
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\n**Ressalva 1:** corrigida.").noted).toBe(false);
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n**Ressalvas baixas:**\n1. x\n2. y").notes.low).toBe(2);
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\nA ressalva baixa do anterior: corrigida.").noted).toBe(false);
});

test("verdict_of: a note its label says fixed isn't open (WhitePelican 1, 25/10)", () => {
  const none = { verdict: "approved", notes: { high: 0, medium: 0, low: 0 }, noted: false };
  // a paragraph labeled fixed: corrigida, resolvida, sanada
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\nRessalva baixa (corrigida): ok")).toEqual(none);
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\n**Ressalva média (resolvida):** o cache.")).toEqual(none);
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\n**Observação alta sanada:** x")).toEqual(none);
  // an item labeled fixed: not counted; the open ones are
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n- **Ressalva média (resolvida):** x\n- Ressalva baixa: y").notes).toEqual({ high: 0, medium: 0, low: 1 });
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n**Ressalvas:**\n1. Média (corrigida em abc1234): x\n2. Baixa: y").notes).toEqual({ high: 0, medium: 0, low: 1 });
  // a heading on fixed notes: its items aren't open
  const both = "Veredito: aprovado com ressalvas.\n\n**Ressalvas corrigidas:**\n1. Média: x\n2. Baixa: y\n\n**Ressalvas:**\n1. Baixa: z";
  expect(Pipeline.verdict_of(both).notes).toEqual({ high: 0, medium: 0, low: 1 });
  // a '#' heading on fixed notes, with no ':' (WarmParrot, 25/10): its whole title is its label
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\n### Ressalvas corrigidas\n1. **MÉDIA** a")).toEqual(none);
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\n## Ressalvas (corrigidas)\n1. **MÉDIA** a\n2. Baixa: b")).toEqual(none);
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n### Ressalvas corrigidas\n1. **MÉDIA** a\n\n### Ressalvas\n1. **BAIXA** b").notes).toEqual({ high: 0, medium: 0, low: 1 });
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n## Ressalvas (corrigidas)\n1. **MÉDIA** a\n\n## Ressalvas abertas\n1. **BAIXA** b").notes).toEqual({ high: 0, medium: 0, low: 1 });
  // one note said on its line: its items are its details, not notes (WarmParrot's own report)
  expect(Pipeline.verdict_of("Veredito: aprovado com 1 ressalva baixa.\n\n**Ressalva baixa:** um título sem dois pontos.\n- `### Ressalvas corrigidas` com `1. **MÉDIA** a` conta 1 média.\n- `## Ressalvas (corrigidas)` também conta 1 média.\n- Correção sugerida: usar o título inteiro.").notes).toEqual({ high: 0, medium: 0, low: 1 });
  // a list under a plural label still counts its items
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n**Ressalvas baixas:**\n- a\n- b").notes.low).toBe(2);
  // a heading that says them open still counts them
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n### Ressalvas\n1. **MÉDIA** a").notes.medium).toBe(1);
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n### Ressalvas não corrigidas\n1. **MÉDIA** a").notes.medium).toBe(1);
  // not fixed: "não corrigida" in the label, or "corrigida" said of the text
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n- **Ressalva média (não corrigida):** x").notes.medium).toBe(1);
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n- **Ressalva média (ainda não resolvida):** x").notes.medium).toBe(1);
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n- Baixa: corrigida só em parte.").notes.low).toBe(1);
  // a note that cites a fixed label in quotes is still a note (WhitePelican's own report)
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n**Ressalvas baixas:**\n1. \"Ressalva baixa (corrigida): ok\" conta 1 nota.\n2. Outra.").notes.low).toBe(2);
});

test("verdict_of: 'com ressalvas' with none found counts the ones its line says, at least one (WhitePelican 2, 25/10)", () => {
  const one = { verdict: "approved_with_notes", notes: { high: 0, medium: 0, low: 1 }, noted: true };
  expect(Pipeline.verdict_of("Veredito: aprovado, com uma ressalva")).toEqual(one);
  expect(Pipeline.verdict_of("Aprovado com ressalvas.")).toEqual(one);
  // GreenWasp, ShinyZebra: the severity on the verdict's line
  expect(Pipeline.verdict_of("**Veredito: APROVADO com ressalvas baixas** para o PR #16.\n\n**O que rodei**\n- bun test.")).toEqual(one);
  expect(Pipeline.verdict_of("A NUM-3308 foi **aprovada com ressalvas, todas baixas**.")).toEqual(one);
  expect(Pipeline.verdict_of("Veredito: aprovado com duas ressalvas médias.").notes).toEqual({ high: 0, medium: 2, low: 0 });
  expect(Pipeline.verdict_of("Veredito: aprovado com 3 ressalvas.").notes).toEqual({ high: 0, medium: 0, low: 3 });
  // a severity it denies isn't theirs
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas (nenhuma alta).").notes).toEqual({ high: 0, medium: 0, low: 1 });
  // found ones win over the line's count
  expect(Pipeline.verdict_of("Veredito: aprovado com 2 ressalvas.\n- Ressalva média: x").notes).toEqual({ high: 0, medium: 1, low: 0 });
  // a rejection or an approval without notes gains none
  expect(Pipeline.verdict_of("Veredito: REPROVADO, por um único bloqueio.").noted).toBe(false);
  expect(Pipeline.verdict_of("Veredito: aprovado.").noted).toBe(false);
});

test("verdict_of: under another heading, an item that only cites notes isn't one (WhitePelican, HappyFish, NuttyOyster)", () => {
  const cites = "**Veredito: aprovado, com 2 ressalvas baixas.**\n\n**O que conferi:**\n- **Relatos:**\n  - Mudaram:\n    - PolarKoala foi de aprovado para aprovado com ressalvas, com 1 baixa.\n\n**Ressalvas baixas:**\n1. a\n2. b";
  expect(Pipeline.verdict_of(cites).notes).toEqual({ high: 0, medium: 0, low: 2 });
  // one that opens with its label still counts there
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\n**O que conferi:**\n- **Ressalva média:** o cache.").notes.medium).toBe(1);
});

test("verdict_of: an item under 'Não testado' never a note; '1. A: baixa' under the verdict's line one (HappyFish, 25/10)", () => {
  // a severity that's a word of the sentence, under another heading: none
  const untested = "**Veredito: aprovado com ressalvas.**\n\n**Ressalvas**\n1. Média: x.\n\n**Não testado:**\n- Baixa cobertura de iPhone.\n- Alta: carga real.";
  expect(Pipeline.verdict_of(untested).notes).toEqual({ high: 0, medium: 1, low: 0 });
  // outside any heading, "- Baixa cobertura" isn't a severity said first
  expect(Pipeline.verdict_of("Aprovado com ressalvas.\n- Baixa cobertura de iPhone.\n- Baixa: o nome.").notes).toEqual({ high: 0, medium: 0, low: 1 });
  // items right under the verdict's line, a letter before the severity
  const letters = "Aprovado com ressalvas baixas.\n1. A: baixa\n2. B: baixa — o link.\n3. C (média): o merge.";
  expect(Pipeline.verdict_of(letters)).toEqual({ verdict: "approved_with_notes", notes: { high: 0, medium: 1, low: 2 }, noted: true });
  // an item heading its list by a severity: each of its items one (LemonPig, 23/10); a list after it, not
  const grouped = "**REPROVADO.** Uma ALTA.\n\n- **A1 (ALTA, bloqueante).** x\n  - o auth renova;\n- **Baixas e informativas:**\n  - **A3:** aviso.\n  - **A4:** HMAC.\n  - **Info:** escopos.\n- **Conferido OK:**\n  - pedaços íntegros.\n  - build ok.";
  expect(Pipeline.verdict_of(grouped)).toEqual({ verdict: "rejected", notes: { high: 1, medium: 0, low: 2 }, noted: true });
});

test("verdict_of: a heading 'Ressalvas: …' is fixed only if its text says all are (ProudCougar 1, 25/10)", () => {
  const notes = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n" + s + "\n1. **MÉDIA** a\n2. Baixa: b").notes;
  // partly fixed, or not said fixed: its items are open
  expect(notes("### Ressalvas: corrigida só a primeira")).toEqual({ high: 0, medium: 1, low: 1 });
  expect(notes("### Ressalvas: corrigidas, exceto a 2")).toEqual({ high: 0, medium: 1, low: 1 });
  expect(notes("## Ressalvas: parte corrigida")).toEqual({ high: 0, medium: 1, low: 1 });
  expect(notes("### Ressalvas: abertas")).toEqual({ high: 0, medium: 1, low: 1 });
  expect(notes("### Ressalvas: não corrigidas")).toEqual({ high: 0, medium: 1, low: 1 });
  // all said fixed: none open (the verdict's floor, 1 low)
  for (const h of ["### Ressalvas: todas corrigidas", "### Ressalvas: corrigidas em abc123", "## Ressalvas: ambas resolvidas", "### Ressalvas: as duas foram corrigidas.", "### Ressalvas corrigidas: 2", "### Ressalvas corrigidas"]) {
    expect(notes(h)).toEqual({ high: 0, medium: 0, low: 1 });
  }
});

test("verdict_of: numbered notes, each with its severity, in lines or paragraphs apart (ProudCougar 2a, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n" + s).notes;
  const both = { high: 0, medium: 1, low: 1 };
  expect(of("Ressalva 1 (média): x\nRessalva 2 (baixa): y")).toEqual(both);
  expect(of("Ressalva 1 (média): x\n\nRessalva 2 (baixa): y")).toEqual(both);
  expect(of("**Ressalva 1 (média):** x\n\n**Ressalva 2 (baixa):** y")).toEqual(both);
  // the text on the next line; a heading, its items its details
  expect(of("**Ressalva 1 (média)**\nTexto x.\n\n**Ressalva 2 (baixa)**\nTexto y.")).toEqual(both);
  expect(of("### Ressalva 1 — média\n- detalhe a\n- detalhe b\n\n### Ressalva 2 — baixa\nTexto.")).toEqual(both);
  expect(of("Ressalva A1 (alta): x\nObservação 2 — baixa: y")).toEqual({ high: 1, medium: 0, low: 1 });
  // one fixed: only the other
  expect(of("**Ressalva 1 (média, corrigida):** x\n\n**Ressalva 2 (baixa):** y")).toEqual({ high: 0, medium: 0, low: 1 });
  expect(of("**Ressalva 1 (alta)** corrigida em abc1234.\n**Ressalva 2 (média):** y")).toEqual({ high: 0, medium: 1, low: 0 });
  // as items, as before
  expect(of("- Ressalva 1 (média): x\n- Ressalva 2 (baixa): y")).toEqual(both);
});

test("verdict_of: under a list given a severity, an item has its own only if it opens with it; an item's items are its details (LemonRobin 1: ProudCougar, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n" + s).notes;
  // a severity the item only cites is the list's
  expect(of("**Ressalvas baixas**\n1. O relato perde a média dos itens.\n2. Outra.")).toEqual({ high: 0, medium: 0, low: 2 });
  // one it opens with, or its note label gives, is its own
  expect(of("**Ressalvas baixas:**\n1. **MÉDIA:** a\n2. b")).toEqual({ high: 0, medium: 1, low: 1 });
  expect(of("**Ressalvas baixas:**\n- **Ressalva média:** a\n- b")).toEqual({ high: 0, medium: 1, low: 1 });
  // the items under a note are its details, even when they cite one (ProudCougar's (a) and (b))
  expect(of("**Ressalvas baixas:**\n1. **Erro.** a\n2. **Pré-existentes:**\n   - (a) `Ressalva 1 (média)` e `Ressalva 2 (baixa)` dão 1 baixa.\n   - (b) YellowHare.")).toEqual({ high: 0, medium: 0, low: 2 });
  expect(of("**Ressalvas:**\n1. Média: a\n   - detalhe com ressalva baixa\n2. Baixa: b")).toEqual({ high: 0, medium: 1, low: 1 });
  // a note's label in code is cited, not said: none under another heading
  expect(of("**O que conferi:**\n- `Ressalva 1 (média)` e `Ressalva 2 (baixa)` somam.\n\n**Ressalvas baixas:**\n1. a\n2. b")).toEqual({ high: 0, medium: 0, low: 2 });
  // a ':' in code isn't the item's label: "corrigida" there doesn't fix it
  expect(of("**Ressalvas baixas:**\n1. **Borda.** `**Ressalva 1 (média)** — corrigida` (sem `:`) anula.\n2. b")).toEqual({ high: 0, medium: 0, low: 2 });
});

test("verdict_of: a note whose text says it fixed isn't open, with ':' or not (LemonRobin 2, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n" + s + "\n**Ressalva 2 (baixa):** y").notes;
  const low = { high: 0, medium: 0, low: 1 };
  for (const fixed of ["**Ressalva 1 (média)** — corrigida em abc1234", "**Ressalva 1 (média):** corrigida em abc1234", "**Ressalva 1 (média)**: corrigida em abc1234", "Ressalva 1 (média) — corrigida em `abc1234`.", "Ressalva 1 (média): resolvida.", "**Ressalva média:** resolvida.", "- **Ressalva 1 (média):** corrigida em abc1234"]) {
    expect(of(fixed)).toEqual(low);
  }
  // a text that says more, or not fixed, or "corrigido" of something else: open
  const both = { high: 0, medium: 1, low: 1 };
  for (const open of ["**Ressalva 1 (média):** corrigida só em parte", "**Ressalva 1 (média)** — o teste corrigido não cobre x", "**Ressalva 1 (média):** a correção foi corrigida, mas falta y", "**Ressalva 1 (média):** não corrigida", "**Ressalva 1 (média)** — não corrigida", "- **Ressalva 1 (média):** corrigida só em parte"]) {
    expect(of(open)).toEqual(both);
  }
});

test("verdict_of: code is cited, never said, even in a top-level item under no heading (SilverNoodle 1, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n" + s).notes;
  const low = { high: 0, medium: 0, low: 1 };
  // a note's label in code, cited by an item under no heading: not a note
  expect(of("- `Ressalva 1 (média)` e `Ressalva 2` somam\n- **Ressalva baixa:** real")).toEqual(low);
  expect(of("1. `Ressalva alta` vira `alta` no painel\n2. **Ressalva baixa:** real")).toEqual(low);
  // nor a severity in code: the item's is the one it says outside it
  expect(of("- **Ressalva baixa:** o `MÉDIA` do título conta\n- texto `alta` solto")).toEqual(low);
  // (an item that opens with it, then ":", says it: SleepyMoose 1, below)
  // under a list of notes given a severity, an item citing code is still the list's
  expect(of("**Ressalvas baixas:**\n- `Ressalva 1 (média)` e `Ressalva 2` somam")).toEqual(low);
  // said outside code, it counts
  expect(of("- Ressalva 1 (média) e `Ressalva 2` somam\n- **Ressalva baixa:** real")).toEqual({ high: 0, medium: 1, low: 1 });
});

test("verdict_of: 'corrigida e testada' is fixed; what says more stays open (SilverNoodle 2, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n" + s + "\n**Ressalva 2 (baixa):** y").notes;
  const low = { high: 0, medium: 0, low: 1 };
  for (const fixed of ["**Ressalva 1 (média):** corrigida e testada", "**Ressalva 1 (média):** corrigida e testada.", "**Ressalva 1 (média)** — corrigida e testada", "- **Ressalva 1 (média):** corrigida e testada", "**Ressalva 1 (média):** resolvida e verificada em abc1234", "**Ressalva 1 (média):** corrigida em abc1234 e testada em def5678"]) {
    expect(of(fixed)).toEqual(low);
  }
  const both = { high: 0, medium: 1, low: 1 };
  for (const open of ["**Ressalva 1 (média):** corrigida só em parte", "**Ressalva 1 (média):** não corrigida", "**Ressalva 1 (média):** ainda não corrigida", "**Ressalva 1 (média):** parcialmente corrigida", "**Ressalva 1 (média)** — o teste corrigido não cobre x", "**Ressalva 1 (média):** corrigida em abc1234, mas ainda falha em y", "**Ressalva 1 (média):** corrigida e testada, mas falha em y", "**Ressalva 1 (média):** corrigida e testada; falta o iPhone", "**Ressalva 1 (média):** corrigida e testada só no Chromium", "**Ressalva 1 (média):** não corrigida e testada"]) {
    expect(of(open)).toEqual(both);
  }
});

test("verdict_of: an item that opens with its severity or label in code, then ':' or a dash, says it (SleepyMoose 1, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n" + s).notes;
  const both = { high: 0, medium: 1, low: 1 };
  expect(of("1. `MÉDIA`: falha em x\n2. Baixa: b")).toEqual(both);
  expect(of("- `MÉDIA`: a\n- Baixa: b")).toEqual(both);
  expect(of("- `Ressalva 1 (média)`: Pipeline.ts:10 falha\n- **Ressalva baixa:** real")).toEqual(both);
  expect(of("- **`Ressalva 1 (média)`:** falha\n- **Ressalva baixa:** real")).toEqual(both);
  expect(of("- `MÉDIA` — falha em x\n- Baixa: b")).toEqual(both);
  expect(of("**Ressalvas:**\n1. `MÉDIA`: a\n2. `baixa`: b")).toEqual(both);
  // opening with code that's no label, or that goes on: cited
  const low = { high: 0, medium: 0, low: 1 };
  expect(of("- `Ressalva 1 (média)` e `Ressalva 2` somam\n- **Ressalva baixa:** real")).toEqual(low);
  expect(of("- `MÉDIA` vira baixa no painel\n- **Ressalva baixa:** real")).toEqual(low);
  expect(of("- `verdict_of`: a média some\n- **Ressalva baixa:** real")).toEqual(low);
  expect(of("- **Ressalva baixa:** o `MÉDIA`: do título")).toEqual(low);
});

test("verdict_of: a fix with a caveat in a parenthesis or its complement stays open (SleepyMoose 2 and 3, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n**Ressalva 1 (média):** " + s + "\n**Ressalva 2 (baixa):** y").notes;
  const low = { high: 0, medium: 0, low: 1 };
  const both = { high: 0, medium: 1, low: 1 };
  for (const open of ["corrigida e testada (mas não no iOS)", "corrigida e verificada em abc1234 (iOS não testado)", "corrigida (falta o Safari)", "corrigida (só no Chromium)", "corrigida e testada em parte", "corrigida e testada no Chromium apenas", "corrigida em parte e testada", "corrigida em abc1234 e testada em parte", "corrigida e testada no Chromium somente", "corrigida e testada (parcialmente)", "corrigida em abc1234 (ainda sem teste)"]) {
    expect(of(open)).toEqual(both);
  }
  for (const fixed of ["corrigida e testada", "resolvida e verificada em abc1234", "corrigida em abc1234 e testada em def5678", "corrigida (commit abc1234)", "corrigida e testada (bun 251/0)", "corrigida em abc1234 (Pipeline.ts) e testada em def5678"]) {
    expect(of(fixed)).toEqual(low);
  }
  // as a heading's text: the same
  const h = (t: string) => Pipeline.verdict_of("Veredito: aprovado.\n\n### Ressalvas: " + t + "\n1. **MÉDIA** a").notes;
  expect(h("corrigida e testada (mas não no iOS)")).toEqual({ high: 0, medium: 1, low: 0 });
  expect(h("corrigidas e testadas em parte")).toEqual({ high: 0, medium: 1, low: 0 });
  expect(h("todas corrigidas e testadas em abc1234")).toEqual({ high: 0, medium: 0, low: 0 });
});

test("verdict_of: a fix is only said with references after it; any other word keeps the note open (NeatWombat, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n**Ressalva 1 (média):** " + s + "\n**Ressalva 2 (baixa):** y").notes;
  const h = (t: string) => Pipeline.verdict_of("Veredito: aprovado.\n\n### Ressalvas: " + t + "\n1. **MÉDIA** a").notes;
  const low = { high: 0, medium: 0, low: 1 };
  const both = { high: 0, medium: 1, low: 1 };
  // what the report named, and what said more before: open, inline and as a heading's text
  const open = [
    "corrigida e testada em abc1234 (iOS desconhecido)", "corrigida e testada (a confirmar no iOS)", "corrigida e testada (por confirmar)", "corrigida e testada (em aberto no iOS)",
    "corrigida e testada (incompleto)", "corrigida e testada (a metade)", "corrigida e testada em metade", "corrigida e testada (limitado ao Chromium)", "corrigida e testada restando o iOS",
    "corrigida e testada (mas não no iOS)", "corrigida e testada em parte", "corrigida e testada no Chromium apenas", "corrigida em abc1234 (iOS não testado)",
    "corrigida em abc1234 sem regressões", "corrigida (pendente o Safari)", "corrigida e testada em 50%",
  ];
  for (const t of open) {
    expect(of(t)).toEqual(both);
    expect(h(t)).toEqual({ high: 0, medium: 1, low: 0 });
  }
  // a fix with only references after it: hash, PR, commit, file, a count
  const fixed = [
    "corrigida e testada", "corrigida e testada.", "resolvida e verificada em abc1234", "corrigida em abc1234 e testada em def5678", "corrigida (commit abc1234)", "corrigida e testada (bun 251/0)",
    "corrigida em abc1234 (Pipeline.ts) e testada em def5678", "corrigida em a29e956", "corrigida no PR #19", "corrigida pelo commit 52375d7", "corrigida em `abc1234`.", "corrigida e testada no CI",
    "corrigida, testada", "corrigida e testada com bun test 253/0", "corrigida em morum/uniichat#19",
    // where it was tested is a reference too (LongCow, 25/10)
    "corrigida e testada no Chromium",
  ];
  for (const t of fixed) {
    expect(of(t)).toEqual(low);
    expect(h(t)).toEqual({ high: 0, medium: 0, low: 0 });
  }
  // a label that says fixed: the same, from its fixed word to its parenthesis' end
  const l = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n**Ressalvas:**\n1. " + s + "\n2. Baixa: y").notes;
  for (const t of ["Média (corrigida em abc1234): x", "**Ressalva 1 (média, corrigida):** x", "**Ressalva média (resolvida):** x", "**Ressalva 1 (média, corrigida no PR #19):** x"]) {
    expect(l(t)).toEqual(low);
  }
  for (const t of ["Média (corrigida só em parte): x", "Média (corrigida, iOS desconhecido): x", "**Ressalva 1 (média, corrigida em parte):** x", "**Ressalva média (corrigida; falta iOS):** x"]) {
    expect(l(t)).toEqual(both);
  }
});

test("verdict_of: a hash has 7 to 40 hex digits with a digit, a fraction isn't a reference; where it was tested or an item's number is (LongCow 1 and 2, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n**Ressalva 1 (média):** " + s + "\n**Ressalva 2 (baixa):** y").notes;
  const h = (t: string) => Pipeline.verdict_of("Veredito: aprovado.\n\n### Ressalvas: " + t + "\n1. **MÉDIA** a").notes;
  const low = { high: 0, medium: 0, low: 1 };
  const both = { high: 0, medium: 1, low: 1 };
  // 1: not a hash (short, or letters only), a fraction, a token with only "/": open
  const open = [
    "corrigida em 1/2", "corrigida em 1/2.", "corrigida em a/b", "corrigida em cafe", "corrigida em face", "corrigida em decade", "corrigida em abc", "corrigida em abc.", "corrigida em `abc`.",
    "corrigida e testada em 1/2", "corrigida (1/2)",
    // and what limits where it was tested stays open
    "corrigida e testada no Chromium apenas", "corrigida e testada (mas não no iOS)", "corrigida e testada em parte", "corrigida e testada (iOS desconhecido)",
    "corrigida e testada (a confirmar)", "corrigida e testada (incompleto)", "corrigida e testada (limitado ao Chromium)", "corrigida e testada no iPhone, mas não no Safari 15",
    "corrigida no iPhone (a confirmar)", "corrigida e testada no iPhone somente",
  ];
  for (const t of open) {
    expect([t, of(t)]).toEqual([t, both]);
    expect([t, h(t)]).toEqual([t, { high: 0, medium: 1, low: 0 }]);
  }
  // 2: a hash with a digit, a count after its noun, where it was tested, an item's number: fixed
  const fixed = [
    "corrigida em a29e956", "corrigida em abc1234", "corrigida em 1234567", "corrigida e testada (bun 251/0)", "corrigida e testada com bun test 253/0",
    "corrigida e testada no iPhone", "corrigida e testada no Safari", "corrigida e testada no Safari 17", "corrigida e testada localmente", "corrigida e testada no iPhone e no Safari",
    "corrigida e testada em 12 casos", "corrigida (item 2)", "corrigida (ver 3)", "corrigida (itens 1 e 2)", "corrigida no item 2", "corrigida (ressalva 2)",
  ];
  for (const t of fixed) {
    expect([t, of(t)]).toEqual([t, low]);
    expect([t, h(t)]).toEqual([t, { high: 0, medium: 0, low: 0 }]);
  }
});

test("verdict_of: a label alone of one note and its severity heads its details, not a list (LongCow 3: NeatWombat, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado, com 1 ressalva baixa.\n\n" + s).notes;
  const one = { high: 0, medium: 0, low: 1 };
  const details = "\n- **Frases que ainda anulam:** x\n- **Efeito:** y\n- **Correção possível:** z\n- **Lado oposto (aceitável):** w\n\n**Não testei:** gh";
  expect(of("**Ressalva baixa**" + details)).toEqual(one);
  expect(of("### Ressalva baixa" + details)).toEqual(one);
  expect(of("**Ressalva baixa:**" + details)).toEqual(one);
  expect(of("**Observação média**" + details)).toEqual({ high: 0, medium: 1, low: 0 });
  // fixed: none
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\n**Ressalva baixa (corrigida)**" + details).notes).toEqual({ high: 0, medium: 0, low: 0 });
  // plural, a list: each item
  expect(of("**Ressalvas baixas**\n- a\n- b")).toEqual({ high: 0, medium: 0, low: 2 });
  // a sentence in bold that says "corrigida" isn't a label: the item is a note (LongCow's own report)
  expect(of("**Ressalvas, todas baixas:**\n1. **Anula nota.** x\n2. **Mantém aberta uma nota que já estava corrigida.** y\n3. **NeatWombat.** z")).toEqual({ high: 0, medium: 0, low: 3 });
  // a label that names the note still says it fixed
  expect(of("**Ressalvas:**\n1. **MÉDIA (corrigida)** x\n2. Baixa: y")).toEqual(one);
});

test("verdict_of: 'corrigida' is a label's state only after a note's name, number and severity; a title that says more keeps the note (SweetSheep 1, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n**Ressalvas, todas baixas:**\n" + s + "\n2. Baixa: y").notes;
  const two = { high: 0, medium: 0, low: 2 };
  const one = { high: 0, medium: 0, low: 1 };
  // a descriptive title in bold, with ':' or not: a note
  for (const t of [
    "1. **Baixa cobertura da nota corrigida.** x", "1. **Mantém alta a nota corrigida.** x", "1. **Observação sobre ressalva corrigida.** x",
    "1. **Baixa cobertura da nota corrigida:** x", "1. **Ressalva sobre o teste corrigido.** x",
  ]) {
    expect([t, of(t)]).toEqual([t, two]);
  }
  // its severity said first counts it so, still open
  expect(of("1. **Média: texto da nota corrigida** x")).toEqual({ high: 0, medium: 1, low: 1 });
  // the label's state: fixed
  for (const t of [
    "1. **MÉDIA (corrigida)** x", "1. **Ressalva média (resolvida):** x", "1. **Ressalva 1 (média, corrigida):** x", "1. **A1 (ALTA, corrigida)** x",
    "1. Média — corrigida: x", "1. **Ressalva B2 — baixa, corrigida em abc1234** x", "1. **Ressalvas 1 e 2 (baixas, corrigidas)** x",
  ]) {
    expect([t, of(t)]).toEqual([t, one]);
  }
  // as a paragraph's title: its items are notes, not fixed ones
  const p = (s: string) => Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n" + s + "\n- Baixa: a\n- Baixa: b").notes;
  expect(p("**Observação sobre ressalva corrigida:**")).toEqual(two);
  expect(p("**Ressalvas já corrigidas:**")).toEqual(one);
  expect(p("### Ressalvas corrigidas")).toEqual(one);
  expect(p("### Todas as ressalvas foram corrigidas")).toEqual(one);
});

test("verdict_of: a parenthesis right after a note's severity is its label's, with no bold nor ':' (SweetSheep 2, 25/10)", () => {
  const of = (s: string) => Pipeline.verdict_of("Veredito: aprovado.\n\n" + s + "\n- **Efeito:** y\n\n**Ressalva média**\nTexto").notes;
  const medium = { high: 0, medium: 1, low: 0 };
  for (const t of [
    "**Ressalva baixa (corrigida em abc1234)**", "**Ressalva baixa (corrigida)**", "### Ressalva baixa (corrigida em abc1234)", "### Ressalva baixa (corrigida)",
    "Ressalva baixa (corrigida em abc1234)", "> Ressalva baixa (corrigida)", "### Ressalva 1 (baixa) (corrigida em abc1234)", "**Ressalva baixa** (corrigida em abc1234)",
    "**Ressalva baixa** (corrigida)", "1. **Ressalva baixa (corrigida em abc1234)**", "- Ressalva baixa (corrigida em abc1234)",
  ]) {
    expect([t, of(t)]).toEqual([t, medium]);
  }
  // what says more stays open
  for (const t of [
    "### Ressalva baixa (corrigida em parte)", "Ressalva baixa (corrigida, iOS desconhecido)", "**Ressalva baixa** (corrigida só no Chromium apenas)", "### Ressalva baixa (não corrigida)",
    "**Ressalva baixa**", "### Ressalva baixa (aberta)",
  ]) {
    expect([t, of(t)]).toEqual([t, { high: 0, medium: 1, low: 1 }]);
  }
});

// JuicyTuna's forms (verification 14, 25/10): a case as a list's item, by
// an open low note, and as a paragraph, by an open medium one
const juicy_list = (t: string) => Pipeline.verdict_of(`**Veredito: APROVADO com ressalvas.**\n\nRessalvas:\n1. ${t}\n2. **Baixa: outra coisa aberta no parser.**\n`).notes;
const juicy_para = (t: string) => Pipeline.verdict_of(`**Veredito: APROVADO com ressalvas.**\n\n${t}\n\n**Ressalva média: outra coisa aberta.**\n`).notes;

test("verdict_of: a note's number may end in '.' or ')' before its fixed severity (JuicyTuna 1, 25/10)", () => {
  for (const t of ["**1. Média corrigida.** x", "**1. Média, corrigida.** x", "**1) Média corrigida** x", "**1 — Média corrigida** x", "**A1. Alta, resolvida.** x"]) {
    expect([t, juicy_list(t)]).toEqual([t, { high: 0, medium: 0, low: 1 }]);
  }
  // a title that says more still keeps it (SweetSheep 1)
  expect(juicy_list("**1. Média cobertura da nota corrigida.** x")).toEqual({ high: 0, medium: 1, low: 1 });
});

test("verdict_of: what qualifies a fixed state after it keeps the note open (JuicyTuna 2, 25/10)", () => {
  for (const t of [
    "### Ressalva baixa (corrigida em abc1234) e falta teste", "**Ressalva baixa** (corrigida em abc1234), mas ainda falha",
    "**Ressalva baixa** (corrigida em abc1234) (aberta)", "**Ressalva baixa** (corrigida em abc1234) (testada no iPhone)",
    "**Ressalva baixa** (corrigida em abc1234) — mas o Safari falha", "### Ressalva baixa (corrigida em abc1234) (aberta)",
    "### Ressalva baixa (corrigida em abc1234) — mas o Safari falha", "**Ressalva baixa (corrigida em abc1234) (aberta)**",
    "**Ressalva baixa (corrigida em abc1234)** mas ainda falha no Safari", "**Ressalva baixa (corrigida em abc1234)** — falta teste no iPhone",
    "**Ressalva baixa (corrigida)** e outra coisa", "**Ressalva baixa** — corrigida em abc1234, mas falta iPhone",
  ]) {
    expect([t, juicy_list(t), juicy_para(t)]).toEqual([t, { high: 0, medium: 0, low: 2 }, { high: 0, medium: 1, low: 1 }]);
  }
  // text that only describes the note, or follows a ':', doesn't
  for (const t of [
    "**Ressalva baixa (corrigida em abc1234)**", "**Ressalva baixa** (corrigida em abc1234)", "### Ressalva baixa (corrigida em abc1234)",
    "**Ressalva baixa (corrigida em abc1234)**. O parser lia mal", "**Ressalva baixa (corrigida em abc1234):** o parser lia mal",
    "**Ressalva 1 (média, corrigida):** só o título mudava", "**MÉDIA (corrigida)** o parser",
  ]) {
    expect([t, juicy_list(t), juicy_para(t)]).toEqual([t, { high: 0, medium: 0, low: 1 }, { high: 0, medium: 1, low: 0 }]);
  }
});

test("verdict_of: a label of only a severity is fixed by its parenthesis too (JuicyTuna 3, 25/10)", () => {
  for (const t of ["**Média** (corrigida em abc1234)", "**Média** (corrigida em abc1234) x", "**Baixa** (corrigida)", "**Média, resolvida em abc1234**"]) {
    expect([t, juicy_list(t)]).toEqual([t, { high: 0, medium: 0, low: 1 }]);
  }
  for (const t of ["**Média** (corrigida em parte)", "**Média** (corrigida em abc1234), mas falta o iPhone", "**Média, não resolvida**"]) {
    expect([t, juicy_list(t)]).toEqual([t, { high: 0, medium: 1, low: 1 }]);
  }
  // its text says it of the text, not of the label: a note still
  expect(juicy_list("Baixa: corrigida em abc1234")).toEqual({ high: 0, medium: 0, low: 2 });
});

test("verdict_of: a title without severity under a list without one isn't a note; nested and severity-led paragraphs are (JuicyTuna 4, 25/10)", () => {
  // no severity, none given by the list: not counted (as before)
  expect(juicy_list("**Observação sobre ressalva corrigida.** x")).toEqual({ high: 0, medium: 0, low: 1 });
  // a list that gives one counts it (SweetSheep 1)
  expect(Pipeline.verdict_of("Veredito: aprovado com ressalvas.\n\n**Ressalvas, todas baixas:**\n1. **Observação sobre ressalva corrigida.** x").notes).toEqual({ high: 0, medium: 0, low: 1 });
  const open = { high: 0, medium: 1, low: 1 };
  for (const t of ["**Ressalva baixa** (aberta (corrigida em abc1234))", "**Ressalva baixa (aberta (corrigida em abc1234))**", "**Baixa: texto corrigida no hash**", "**Ressalva média sobre bug corrigido.**"]) {
    const n = juicy_para(t);
    expect([t, n.high + n.medium + n.low]).toEqual([t, 2]);
  }
  expect(juicy_para("**Baixa: texto corrigida no hash**")).toEqual(open);
  expect(juicy_list("**Baixa: texto corrigida no hash**")).toEqual({ high: 0, medium: 0, low: 2 });
  // a bold severity with its text is a note; alone, a heading, none
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\n**Média:** x\n\n**Baixa:** y").notes).toEqual(open);
  expect(Pipeline.verdict_of("Veredito: aprovado.\n\n**Baixa:**\n\n**Baixas:**\n").notes).toEqual({ high: 0, medium: 0, low: 0 });
});

test("verdict_of: 'aprovo' approves, 'reprovo' rejects (ProudCougar 2b: YellowHare, 25/10)", () => {
  expect(Pipeline.verdict_of("Veredito: aprovo o PR #18.")).toEqual({ verdict: "approved", notes: { high: 0, medium: 0, low: 0 }, noted: false });
  expect(Pipeline.verdict_of("Veredito: aprovo o PR morum/uniichat#18 com ressalvas.\n- Baixa: x").verdict).toBe("approved_with_notes");
  expect(Pipeline.verdict_of("Veredito: reprovo o PR #18.").verdict).toBe("rejected");
  expect(Pipeline.verdict_of("Veredito: não aprovo o PR #18.").verdict).toBe("rejected");
  expect(Pipeline.verdict_of("Veredito: aprovação adiada.").verdict).toBe(null);
  // YellowHare: 'sem ressalvas de severidade média ou alta' qualifies which; its low counts
  const yellow = "**Veredito: aprovo o PR morum/uniichat#18 no head 72175c4, sem ressalvas de severidade média ou alta.** Há uma observação baixa.\n\n- **1 (MÉDIA), corrigida:**\n  - recusa.\n\n**Observação baixa:** lookbehind no Safari.";
  expect(Pipeline.verdict_of(yellow)).toEqual({ verdict: "approved", notes: { high: 0, medium: 0, low: 1 }, noted: true });
});

test("prs_named: links, owner/repo#n and repo#n; the head near each; not P48 nor 'PR #3'", () => {
  const got = Pipeline.prs_named("Verifique Numih/auth#307 commit 33236f0 e Numih/dp-bk-messaging#17 commit da32786, sobre 27a4065. Também https://github.com/morum/uniichat/pull/18 (head 6178ccf) e o PR #3, P48, uniichat#18.");
  expect(got.prs).toEqual(["auth#307", "dp-bk-messaging#17", "uniichat#18"]);
  expect(got.heads).toEqual({ "auth#307": "33236f0", "dp-bk-messaging#17": "da32786", "uniichat#18": "6178ccf" });
  expect(got.links["auth#307"]).toBe("https://github.com/Numih/auth/pull/307");
  expect(got.links["uniichat#18"]).toBe("https://github.com/morum/uniichat/pull/18");
  // an owner GitHub can't have (a dot, a host): no PR, no link made up (HappyFish, 25/10)
  const evil = Pipeline.prs_named("Veja evil.com/x#4 e foo.bar/baz#9; o certo é Numih-x/auth#5.");
  expect(evil.prs).toEqual(["auth#5"]);
  expect(Object.values(evil.links)).toEqual(["https://github.com/Numih-x/auth/pull/5"]);
  // an owner with "-" at its start or end, as GitHub refuses: no link (NeatOrca B3, 25/10)
  for (const bad of ["Numih-/foo#4", "-Numih/foo#4", "a-/b#1"]) {
    expect(Object.keys(Pipeline.prs_named("Veja " + bad + ".").links)).toEqual([]);
  }
  expect(Pipeline.prs_named("Veja Numih-/foo#4.").prs).toEqual([]);
  expect(Pipeline.prs_named("Veja a/b#1, a-b/c#2 e " + "x".repeat(39) + "/d#3.").links).toEqual({ "b#1": "https://github.com/a/b/pull/1", "c#2": "https://github.com/a-b/c/pull/2", "d#3": "https://github.com/" + "x".repeat(39) + "/d/pull/3" });
  expect(Object.keys(Pipeline.prs_named("Veja " + "x".repeat(40) + "/d#3.").links)).toEqual([]);
  expect(Pipeline.pr_same("messaging#17", "dp-bk-messaging#17")).toBe(true);
  expect(Pipeline.pr_same("auth#307", "oauth#307")).toBe(false);
  expect(Pipeline.pr_same("auth#307", "auth#306")).toBe(false);
});

test("role, front and theme of a label; of an unlabeled agent, from its task", () => {
  const refs = ["num-2337", "uniichat", "uniichat-ux"];
  expect(Pipeline.role_of("num-2337-svc-homoglifos-verif")).toBe("verif");
  expect(Pipeline.role_of("num-3182-verificador-codex-graphql18")).toBe("verif");
  expect(Pipeline.role_of("uniichat-ux-r5-ressalvas2-impl")).toBe("impl");
  expect(Pipeline.role_of("num-2337-levantamento")).toBe("survey");
  expect(Pipeline.ref_of("uniichat-ux-r6-impl", refs)).toBe("uniichat-ux");
  expect(Pipeline.ref_of("uniichat-mesa-fase1-impl", refs)).toBe("uniichat");
  expect(Pipeline.ref_of("num-3307-ressalva-impl", refs)).toBe("num-3307");
  expect(Pipeline.ref_in("Você é verificador da NUM-2337 (P48)…", refs)).toBe("num-2337");
  expect(Pipeline.ref_in("Revise o uniichat-ux, rodada 2", refs)).toBe("uniichat-ux");
  expect(Pipeline.ref_in("Faça algo", refs)).toBe(Pipeline.NO_REF);
  expect(Pipeline.role_in("Você é verificador independente do PR")).toBe("verif");
  expect(Pipeline.theme_of("num-2337-svc-normalizacao-verif")).toBe("num-2337-svc-normalizacao");
  expect(Pipeline.theme_of("num-2337-verificador-71df78c")).toBe("num-2337");
  expect(Pipeline.theme_of("uniichat-ux-r5-verif3")).toBe("uniichat-ux-r5");
  expect(Pipeline.theme_of("num-3182-verificador-5")).toBe("num-3182");
});

test("idle_ms: the time none of the spans covers", () => {
  expect(Pipeline.idle_ms(0, 100, [])).toBe(100);
  expect(Pipeline.idle_ms(0, 100, [[10, 20], [15, 30], [50, 60]])).toBe(100 - 20 - 10);
  expect(Pipeline.idle_ms(0, 100, [[-50, 200]])).toBe(0);
  expect(Pipeline.idle_ms(100, 50, [])).toBe(0);
});

test("live_of: gh's answer; checks failed, running, ok or none", () => {
  expect(Pipeline.live_of({ state: "OPEN", headRefOid: "ABC1234", statusCheckRollup: [] })).toEqual({ state: "OPEN", head: "abc1234", ci: "none" });
  expect(Pipeline.live_of({ state: "OPEN", headRefOid: "a", statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }] })!.ci).toBe("failed");
  expect(Pipeline.live_of({ state: "OPEN", headRefOid: "a", statusCheckRollup: [{ conclusion: "SUCCESS" }, { status: "IN_PROGRESS", conclusion: "" }] })!.ci).toBe("running");
  expect(Pipeline.live_of({ state: "MERGED", headRefOid: "a", statusCheckRollup: [{ conclusion: "SUCCESS" }, { state: "SUCCESS" }] })!.ci).toBe("ok");
  expect(Pipeline.live_of({ state: "weird" })).toBeNull();
  expect(Pipeline.live_of(null)).toBeNull();
});

// NUM-2337, 23 and 24/10 (the acceptance)
// ---------------------------------------
// The agents of the front as their logs were (names, labels, models,
// start and end, the PRs and heads of their tasks), each report cut to
// its verdict and notes. The 5 cycles of `svc:` (uniichat-ux-r1.md §5)
// are cycles 6 to 10: rebase, auth#307, messaging#17, normalização and
// homóglifos, each approved with low notes

const R = (verdict: string, notes: string[] = []) => "**Veredito: " + verdict + ".** Nada foi mesclado.\n\n" + (notes.length === 0 ? "" : "**Ressalvas:**\n" + notes.map((n, k) => (k + 1) + ". " + n).join("\n"));
const NUM_2337: Fake[] = [
  { name: "SolarCamel", label: "num-2337-lib-impl", model: "opus-5.5", start: "2026-10-23T19:54:43Z", end: "2026-10-23T20:07:06Z", task: "Implemente a lib (PR draft Numih/dp-bk-messaging#16).", report: "PR draft dp-bk-messaging#16 em 71df78c." },
  { name: "FunnyHyena", label: "num-2337-levantamento", start: "2026-10-23T19:54:43Z", end: "2026-10-23T20:03:44Z", task: "Levante os serviços sem credencial.", report: "Sem credencial: financeiro, contratos." },
  { name: "SlowSnail", label: "num-2337-verificador-71df78c", model: "sonnet-5.5", start: "2026-10-23T20:07:24Z", end: "2026-10-23T20:13:42Z", task: "Verifique Numih/dp-bk-messaging#16 head 71df78c.", report: R("aprovado com ressalvas", ["MÉDIA: TrustPushWithoutOIDC.", "MÉDIA: boot sem OIDC.", "Baixa: 403.", "Baixa: 2º mint."]) },
  { name: "MintyJaguar", label: "num-2337-ressalvas-impl", model: "opus-5.5", start: "2026-10-23T20:14:09Z", end: "2026-10-23T20:22:55Z", task: "Corrija as ressalvas em dp-bk-messaging#16.", report: "Corrigido em 1063ef0." },
  { name: "StormyHippo", label: "num-2337-verificador-1063ef0", model: "sonnet-5.5", start: "2026-10-23T20:23:25Z", end: "2026-10-23T20:29:00Z", task: "Verifique dp-bk-messaging#16 head 1063ef0.", report: R("aprovado com ressalvas", ["Baixa: log.", "Baixa: nome.", "Baixa: doc."]) },
  { name: "RoughDolphin", label: "num-2337-infra-impl", model: "opus-5.5", start: "2026-10-23T20:23:26Z", end: "2026-10-23T20:29:58Z", task: "Abra Numih/infra-tf-numih#1127 e #1128.", report: "Abertos." },
  { name: "WindySquirrel", label: "num-2337-portas-impl", model: "opus-5.5", start: "2026-10-23T20:23:27Z", end: "2026-10-23T21:17:27Z", task: "Portas: Numih/auth#306, Numih/hospitalar#649.", report: "auth#306 e hospitalar#649 abertos." },
  { name: "SwiftDonkey", label: "num-2337-infra-verificador", model: "sonnet-5.5", start: "2026-10-23T20:30:17Z", end: "2026-10-23T20:37:35Z", task: "Verifique Numih/infra-tf-numih#1127.", report: R("aprovado com ressalvas", ["MÉDIA: avaliacoes sem segredo.", "Baixa: ordem."]) },
  { name: "SoftMule", label: "num-2337-renovacao-impl", model: "opus-5.5", start: "2026-10-23T21:03:01Z", end: "2026-10-24T00:04:54Z", task: "Renovação: Numih/dp-bk-http#41, Numih/auth#307, Numih/dp-bk-messaging#17.", report: "Rascunhos abertos." },
  { name: "GentleSquid", label: "num-2337-portas-verif", model: "sonnet-5.5", start: "2026-10-23T21:18:48Z", end: "2026-10-23T21:24:46Z", task: "Verifique auth#306 e hospitalar#649.", report: R("aprovado com ressalvas", ["MÉDIA: x-tenant-id sem HMAC.", "Baixa: a."]) },
  { name: "LemonPig", label: "num-2337-renovacao-verif", model: "sonnet-5.5", start: "2026-10-23T21:24:46Z", end: "2026-10-23T23:36:28Z", task: "Verifique dp-bk-http#41, auth#307, dp-bk-messaging#17.", report: "**REPROVADO.** Há uma ressalva ALTA.\n\n- **A1 (ALTA, bloqueante).** Envelope.\n- **A2 (MÉDIA).** svc:." },
  { name: "MistyPancake", label: "num-2337-rebase-impl", model: "opus-5.5", start: "2026-10-24T14:19:38Z", end: "2026-10-24T14:22:38Z", task: "Rebase de Numih/dp-bk-http#41 (P48).", report: "d4f86ad." },
  { name: "SpikyOwl", label: "num-2337-rebase-verif", model: "sonnet-5.5", start: "2026-10-24T14:22:52Z", end: "2026-10-24T14:24:02Z", task: "Verifique dp-bk-http#41 head d4f86ad, auth#307 e dp-bk-messaging#17.", report: "**Veredito: APROVADO com ressalvas baixas.**\n\n**Ressalvas baixas:**\n1. svc: sem teste.\n2. Caixa.\n3. Pseudo-versão." },
  { name: "GrandMango", label: "num-2337-svc-ressalvas-impl", model: "opus-5.5", start: "2026-10-24T14:24:12Z", end: "2026-10-24T14:25:50Z", task: "Corrija em Numih/auth#307 (P48).", report: "4256c2a." },
  { name: "SleepyHare", label: "num-2337-auth307-verif", model: "sonnet-5.5", start: "2026-10-24T14:26:00Z", end: "2026-10-24T14:27:00Z", task: "Verifique Numih/auth#307, head 4256c2a.", report: "**Veredito: APROVADO com ressalvas baixas** para Numih/auth#307.\n\n- **Ressalvas baixas:** homóglifos." },
  { name: "JollyRaven", label: "num-2337-messaging17-svc-impl", model: "sonnet-5.5", start: "2026-10-24T14:26:00Z", end: "2026-10-24T14:26:04Z", task: "Corrija Numih/dp-bk-messaging#17 (P48).", report: null },
  { name: "SpikyToad", label: "num-2337-messaging17-svc-impl", model: "opus-5.5", start: "2026-10-24T14:26:08Z", end: "2026-10-24T14:27:58Z", task: "Corrija Numih/dp-bk-messaging#17 (P48).", report: "5c44019." },
  { name: "FluffyLamb", label: "num-2337-messaging17-svc-verif", model: "sonnet-5.5", start: "2026-10-24T14:28:23Z", end: "2026-10-24T14:28:52Z", task: "Verifique Numih/dp-bk-messaging#17, commit 5c44019.", report: "**APROVADO com ressalvas baixas** — dp-bk-messaging#17.\n\n**Ressalvas baixas:**\n- Homóglifos.\n- Invisível.\n- EqualFold." },
  { name: "LivelyJaguar", label: "num-2337-svc-normalizacao-impl", model: "opus-5.5", start: "2026-10-24T14:29:05Z", end: "2026-10-24T14:31:15Z", task: "NFKC em Numih/auth#307 e Numih/dp-bk-messaging#17 (P48).", report: "27a4065 e ccad8f1." },
  { name: "SaltySquirrel", label: "num-2337-svc-normalizacao-verif", model: "sonnet-5.5", start: "2026-10-24T14:31:28Z", end: "2026-10-24T14:32:37Z", task: "Verifique Numih/auth#307 commit 27a4065 e Numih/dp-bk-messaging#17 commit ccad8f1.", report: "**Veredito: aprovado com ressalvas baixas.**\n\n**Ressalvas baixas:**\n1. Cirílico.\n2. Combinante.\n3. Postgres." },
  { name: "BlackBear", label: "num-2337-svc-homoglifos-impl", model: "opus-5.5", start: "2026-10-24T14:32:59Z", end: "2026-10-24T14:37:34Z", task: "Homóglifos em Numih/auth#307 e Numih/dp-bk-messaging#17 (P48).", report: "33236f0 e da32786." },
  { name: "PurpleTaco", label: "num-2337-svc-homoglifos-verif", model: "sonnet-5.5", start: "2026-10-24T14:38:01Z", end: "2026-10-24T14:40:01Z", task: "Verifique Numih/auth#307 commit 33236f0 e Numih/dp-bk-messaging#17 commit da32786.", report: "**Veredito (NUM-2337, P48): aprovado com ressalvas baixas.**\n\n**Ressalvas, por gravidade**\n1. Baixa: falso positivo.\n2. Baixa: regra copiada." },
  { name: "SaltyMouse", label: "num-2337-troca-pseudo-impl", model: "opus-5.5", start: "2026-10-24T14:40:46Z", end: "2026-10-24T14:42:05Z", task: "Troque a pseudo-versão em Numih/auth#307 e Numih/dp-bk-messaging#17 (P48).", report: "b717fd3 e e5f15ac." },
  { name: "WoodenTurtle", label: "num-2337-troca-pseudo-verif", model: "sonnet-5.5", start: "2026-10-24T14:42:23Z", end: "2026-10-24T14:43:32Z", task: "Verifique Numih/auth#307 commit b717fd3 e Numih/dp-bk-messaging#17 commit e5f15ac.", report: "**Veredito: APROVADO sem ressalvas.**" },
];
const NOW = Date.parse("2026-10-25T12:00:00Z");

function num_2337(): { dir: string; s: Tasks.Store } {
  const dir = dir_new();
  NUM_2337.forEach((a) => agent_write(dir, a));
  const s = store_write(dir, ["num-2337", "uniichat-ux"], [
    task({ id: "P45", title: "Mesclar dp-bk-messaging#16", assignee: "user", ref: "num-2337", state: "dropped", made: "2026-10-23T20:40:00Z", ready: "2026-10-23T20:40:00Z", closed: "2026-10-23T22:00:00Z", closed_by: "user", changed: "2026-10-23T22:00:00Z" }),
    task({ id: "P48", title: "NUM-2337: renovação e portas", assignee: "unii", ref: "num-2337", made: "2026-10-23T21:00:00Z", changed: "2026-10-24T14:44:00Z", moved: "2026-10-24T14:44:00Z" }),
  ]);
  return { dir, s };
}

test("NUM-2337 (acceptance): the front reproduces 23-24/10, its 11 cycles, the 5 of svc: among them", () => {
  const { dir, s } = num_2337();
  const runs = Pipeline.runs_read(dir, new Set(), s.refs, s.tasks);
  expect(runs.length).toBe(NUM_2337.length);
  const f = Pipeline.fronts(s, runs, new Map(), NOW).find((x) => x.ref === "num-2337")!;
  expect(f.stage).toBe("stalled");
  expect(f.since).toBe("2026-10-24T14:44:00.000Z");
  expect(f.tasks.map((t) => t.id)).toEqual(["P48"]);
  expect(f.cycles.length).toBe(11);
  // the 5 cycles of svc:, each approved with low notes only
  const svc = f.cycles.slice(5, 10);
  expect(svc.map((c) => c.run.name)).toEqual(["SpikyOwl", "SleepyHare", "FluffyLamb", "SaltySquirrel", "PurpleTaco"]);
  for (const c of svc) {
    expect(c.run.verdict).toBe("approved_with_notes");
    expect(c.run.notes.high + c.run.notes.medium).toBe(0);
    expect(c.run.notes.low).toBeGreaterThan(0);
  }
  expect(svc.map((c) => c.run.notes.low)).toEqual([3, 1, 3, 3, 2]);
  // each cycle the work it verified, of its theme
  expect(svc.map((c) => c.after.map((r) => r.name))).toEqual([["MistyPancake"], ["GrandMango"], ["JollyRaven", "SpikyToad"], ["LivelyJaguar"], ["BlackBear"]]);
  expect(f.cycles[3].after.map((r) => r.name)).toEqual(["WindySquirrel"]);
  expect(f.cycles[4].run.verdict).toBe("rejected");
  expect(f.cycles[4].run.notes).toEqual({ high: 1, medium: 1, low: 0 });
  expect(f.cycles[4].after.map((r) => r.name)).toEqual(["SoftMule"]);
  expect(f.cycles[10].run.verdict).toBe("approved");
  // the PRs: auth#307 and dp-bk-messaging#17 (also named messaging#17) each 6 cycles
  const pr = (k: string) => f.prs.find((p) => p.key === k)!;
  expect(pr("auth#307").cycles).toBe(6);
  expect(pr("dp-bk-messaging#17").cycles).toBe(6);
  expect(pr("auth#307").head).toBe("b717fd3");
  expect(pr("auth#307").url).toBe("https://github.com/Numih/auth/pull/307");
  expect(pr("dp-bk-messaging#16").cycles).toBe(2);
  // nothing open: the last cycle approved; none at work since 14:43
  expect(f.open).toEqual({ high: 0, medium: 0, low: 0 });
  expect(f.fixing).toBe(false);
  expect(f.idle).toBeGreaterThan(0);
  expect(f.decide).toEqual([Date.parse("2026-10-23T22:00:00Z") - Date.parse("2026-10-23T20:40:00Z")]);
});

test("NUM-2337 drawn: the 5 cycles of svc: on the page, each with its verdict and notes", () => {
  const { dir, s } = num_2337();
  const panel: Pipeline.Panel = { at: new Date(NOW).toISOString(), fronts: Pipeline.fronts(s, Pipeline.runs_read(dir, new Set(), s.refs, s.tasks), new Map(), NOW), refreshing: false };
  const html = Html.pipeline_html(JSON.parse(JSON.stringify(panel)), NOW);
  expect(html).toContain(`data-ref="num-2337" open`);
  expect(html).toContain("parada com o Unii");
  expect(html).toContain("11 ciclos");
  for (const n of [6, 7, 8, 9, 10]) {
    expect(html).toContain(`<span class="pipe-n">Ciclo ${n}</span>`);
  }
  expect(html).toContain("SaltySquirrel</span> <small class=\"pipe-label\">num-2337-svc-normalizacao-verif</small> · <b class=\"pipe-verdict\">aprovado com ressalvas</b> · ressalvas: 3 baixas");
  expect(html).toContain("reprovado</b> · ressalvas: 1 alta e 1 média");
  expect(html).toContain("auth#307: 6");
  expect(html).toContain("dp-bk-messaging#17: 6");
  expect(html).toContain("verificou o trabalho de JollyRaven (num-2337-messaging17-svc-impl), SpikyToad (num-2337-messaging17-svc-impl)");
  // the user's task opens in the Mesa
  expect(html).toContain(`data-desk="P48"`);
});

// Stages, live PRs, notes from a task's prs
// -----------------------------------------

test("stage: verifying, implementing, with the user, with others, stalled, closed", () => {
  const dir = dir_new();
  agent_write(dir, { name: "ImplOne", label: "a-x-impl", start: "2026-10-25T10:00:00Z", end: "2026-10-25T10:10:00Z", task: "x", report: null });
  agent_write(dir, { name: "VerOne", label: "b-x-verif", start: "2026-10-25T10:00:00Z", end: "2026-10-25T10:10:00Z", task: "x", report: null });
  const s = store_write(dir, ["a", "b", "c", "d", "e", "f"], [
    task({ id: "P1", ref: "c", assignee: "user", made: "2026-10-25T09:00:00Z", ready: "2026-10-25T09:30:00Z" }),
    task({ id: "P2", ref: "d", assignee: "unii", waits_for: "CI do #42" }),
    task({ id: "P3", ref: "e", assignee: "unii", moved: "2026-10-25T08:00:00Z" }),
    task({ id: "P4", ref: "f", state: "done", closed: "2026-10-25T07:00:00Z", closed_by: "user" }),
    // the user's, but waiting for something outside: the others' move
    task({ id: "P5", ref: "d", assignee: "user", kind: "test", waits_for: "reinício do serve" }),
  ]);
  const fr = Pipeline.fronts(s, Pipeline.runs_read(dir, new Set(["ImplOne", "VerOne"]), s.refs, s.tasks), new Map(), NOW);
  const by = Object.fromEntries(fr.map((f) => [f.ref, f]));
  expect([by.a.stage, by.b.stage, by.c.stage, by.d.stage, by.e.stage, by.f.stage]).toEqual(["impl", "verif", "user", "others", "stalled", "closed"]);
  expect(by.c.since).toBe("2026-10-25T09:30:00.000Z");
  expect(by.e.since).toBe("2026-10-25T08:00:00.000Z");
  // the order: with the user, stalled, verifying, implementing, others, closed
  expect(fr.map((f) => f.ref)).toEqual(["c", "e", "b", "a", "d", "f"]);
  // the same agents, at work no more: cut (no report)
  const cut = Pipeline.runs_read(dir, new Set(), s.refs, s.tasks);
  expect(cut.map((r) => r.state)).toEqual(["cut", "cut"]);
});

test("a task's prs (R5) gives the verdict, notes and head; the PR's head live against it", () => {
  const dir = dir_new();
  agent_write(dir, { name: "VerTwo", label: "uniichat-ux-r9-verif", start: "2026-10-25T10:00:00Z", end: "2026-10-25T10:20:00Z", task: "Verifique morum/uniichat#30 head 1111111.", report: "**Veredito: aprovado.**" });
  const url = "https://github.com/morum/uniichat/pull/30";
  const s = store_write(dir, ["uniichat-ux"], [
    task({ id: "P9", ref: "uniichat-ux", assignee: "user", kind: "pr", title: "Aprovar o PR", prs: [{ url, head: "2222222", verdict: "approved_with_notes", verifier: "VerTwo", notes: [{ sev: "medium", text: "m" }, { sev: "low", text: "l" }], untested: [] }] }),
  ]);
  const runs = Pipeline.runs_read(dir, new Set(), s.refs, s.tasks);
  const live = new Map<string, Pipeline.Live>([[url, { state: "OPEN", head: "3333333aaaa", ci: "failed" }]]);
  const f = Pipeline.fronts(s, runs, live, NOW)[0];
  expect(f.cycles[0].run.verdict).toBe("approved_with_notes");
  expect(f.cycles[0].run.notes).toEqual({ high: 0, medium: 1, low: 1 });
  expect(f.open).toEqual({ high: 0, medium: 1, low: 1 });
  const p = f.prs[0];
  expect(p).toMatchObject({ key: "uniichat#30", url, cycles: 1, head: "2222222", verdict: "approved_with_notes" });
  expect(View.pr_head_said(p)).toEqual({ text: "head mudou: verificado 2222222, agora 3333333", same: false });
  expect(View.pr_head_said({ ...p, live: { state: "OPEN", head: "2222222ffff", ci: "ok" } })!.same).toBe(true);
  const html = Html.pipeline_html({ at: new Date(NOW).toISOString(), fronts: [f], refreshing: true }, NOW);
  expect(html).toContain(`<a class="pipe-pr" href="${url}" target="_blank" rel="noopener noreferrer">uniichat#30</a>`);
  expect(html).toContain("CI falhou");
  expect(html).toContain(`<span class="pipe-warn">head mudou: verificado 2222222, agora 3333333</span>`);
  expect(html).toContain("lendo o estado dos PRs no GitHub");
  expect(html).toContain("ressalvas abertas: 1 média e 1 baixa");
});

test("the panel reads PRs live in the background, at most a few at once, and keeps them", async () => {
  const dir = dir_new();
  agent_write(dir, { name: "VerThree", label: "x-verif", start: "2026-10-25T10:00:00Z", end: "2026-10-25T10:20:00Z", task: "Verifique morum/uniichat#1, morum/uniichat#2, morum/uniichat#3, morum/uniichat#4 e morum/uniichat#5.", report: "**Veredito: aprovado.**" });
  const s = store_write(dir, ["x"], [task({ id: "P1", ref: "x" })]);
  const asked: string[] = [];
  let at_once = 0;
  let most = 0;
  Pipeline.GH.read = async (url) => {
    asked.push(url);
    most = Math.max(most, ++at_once);
    await Bun.sleep(5);
    at_once -= 1;
    return { state: url.endsWith("/1") ? "MERGED" : "OPEN", head: "abc", ci: "ok" };
  };
  const first = Pipeline.panel(s, dir, new Set(), Date.now());
  expect(first.refreshing).toBe(true);
  expect(first.fronts[0].prs.every((p) => p.live === null)).toBe(true);
  for (let k = 0; k < 100 && asked.length < 5; k++) {
    await Bun.sleep(5);
  }
  await Bun.sleep(20);
  expect(asked.length).toBe(5);
  expect(most).toBeLessThanOrEqual(3);
  const next = Pipeline.panel(s, dir, new Set(), Date.now());
  expect(next.refreshing).toBe(false);
  expect(next.fronts[0].prs.map((p) => p.live?.state)).toEqual(["MERGED", "OPEN", "OPEN", "OPEN", "OPEN"]);
  expect(asked.length).toBe(5);
  // past LIVE_OPEN the open ones are read again, the merged one not
  Pipeline.panel(s, dir, new Set(), Date.now() + Pipeline.LIVE_OPEN + 1);
  await Bun.sleep(40);
  expect(asked.length).toBe(9);
});

// AGENTES.md
// ----------

// vigia.ts's reading of a row (its ativos and marcados)
const ativos = (md: string) => md.split("\n").filter((l) => l.startsWith("|")).map((l) => l.split("|").slice(1, -1).map((x) => x.trim())).filter((c) => c.length >= 6 && /^em andamento/i.test(c[c.length - 1]));

test("AGENTES.md: the serve's table, in the chat's dir; an agent at work 'em andamento' with its tasks marked", () => {
  const { dir, s } = num_2337();
  agent_write(dir, { name: "BusyBee", label: "num-2337-portas-impl", model: "opus-5.5", start: "2026-10-25T11:00:00Z", end: "2026-10-25T11:05:00Z", task: "Portas em Numih/auth#306 (P48, P66).", report: null });
  Pipeline.agents_md(s, dir, new Set(["BusyBee"]));
  const md = fs.readFileSync(dir + "/AGENTES.md", "utf8");
  expect(md.startsWith(Pipeline.MD_START)).toBe(true);
  expect(md.trimEnd().endsWith(Pipeline.MD_END)).toBe(true);
  const rows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Nome"));
  expect(rows.length).toBe(NUM_2337.length + 1);
  const busy = ativos(md);
  expect(busy.length).toBe(1);
  expect(busy[0][0]).toBe("num-2337-portas-impl");
  expect(busy[0][1]).toBe("BusyBee");
  expect(busy[0][3]).toBe("implementação auth#306 (P48, P66)");
  expect(md).toContain("| num-2337-svc-homoglifos-verif | PurpleTaco | num-2337 | verificação auth#307, dp-bk-messaging#17 | sonnet-5.5 | concluído: aprovado com ressalvas (ressalvas: 2 baixas), ");
  expect(md).toContain("| num-2337-messaging17-svc-impl | JollyRaven | num-2337 | implementação dp-bk-messaging#17 (P48) | sonnet-5.5 | interrompido (sem relato), ");
  // it ended: written again, nothing at work
  Pipeline.agents_md(s, dir, new Set());
  expect(ativos(fs.readFileSync(dir + "/AGENTES.md", "utf8")).length).toBe(0);
});

test("AGENTES.md written by hand keeps what it had: the serve's part appended, then replaced between its marks", () => {
  const dir = dir_new();
  agent_write(dir, { name: "OneAgent", label: "a-impl", start: "2026-10-25T10:00:00Z", end: "2026-10-25T10:20:00Z", task: "x | y", report: "feito" });
  const s = store_write(dir, ["a"], []);
  const file = ROOT + "/AGENTES-" + dirs + ".md";
  const hand = "# Agentes\n| Nome de papel | Nome técnico | Projeto | Papel | Modelo | Estado |\n|---|---|---|---|---|---|\n| velho | Old | x | y | z | concluído |\n";
  fs.writeFileSync(file, hand);
  const was = process.env.UNII_AGENTES;
  process.env.UNII_AGENTES = file;
  try {
    expect(Pipeline.md_file(dir)).toBe(file);
    Pipeline.agents_md(s, dir, new Set());
    const once = fs.readFileSync(file, "utf8");
    expect(once.startsWith(hand)).toBe(true);
    expect(once).toContain("| a-impl | OneAgent | a | implementação | padrão | concluído, ");
    agent_write(dir, { name: "TwoAgent", label: "a-verif", start: "2026-10-25T11:00:00Z", end: "2026-10-25T11:20:00Z", task: "x", report: "**Aprovado.**" });
    Pipeline.agents_md(s, dir, new Set());
    const twice = fs.readFileSync(file, "utf8");
    expect(twice.startsWith(hand)).toBe(true);
    expect(twice.split(Pipeline.MD_START).length).toBe(2);
    expect(twice).toContain("| a-verif | TwoAgent | a | verificação | padrão | concluído: aprovado, ");
    // a pipe in a cell is a "/", never a new column, as vigia.ts splits a
    // row (by every "|"): an agent at work labeled "a|b-verif" stays read
    const row = Pipeline.md_row({ ...Pipeline.runs_read(dir, new Set(), s.refs)[0], label: "a|b-verif", state: "working", tasks: ["P66"] });
    const cells = row.split("|").slice(1, -1).map((x) => x.trim());
    expect(cells.length).toBe(6);
    expect(cells[0]).toBe("a/b-verif");
    expect(cells[1]).toBe("OneAgent");
    expect(cells[3]).toContain("(P66)");
    expect(cells[5]).toMatch(/^em andamento/);
  } finally {
    if (was === undefined) {
      delete process.env.UNII_AGENTES;
    } else {
      process.env.UNII_AGENTES = was;
    }
  }
});

test("md_merge: marks out of order or alone never leave two parts", () => {
  const block = Pipeline.md_block([]);
  const parts = (s: string) => s.split(Pipeline.MD_START).length - 1;
  // an end before its start (HappyFish, 25/10): one part, the hand text kept
  const swapped = "# Mão\n" + Pipeline.MD_END + "\nmeio\n" + Pipeline.MD_START + "\nvelho\n";
  const once = Pipeline.md_merge(swapped, block);
  expect(parts(once)).toBe(1);
  expect(once.split(Pipeline.MD_END).length - 1).toBe(1);
  expect(once).toContain("# Mão\n");
  expect(once).toContain("meio\n");
  expect(Pipeline.md_merge(once, block)).toBe(once);
  // two parts (an older write): the first's place, the second out
  const two = "a\n" + Pipeline.MD_START + "\n1\n" + Pipeline.MD_END + "\nb\n" + Pipeline.MD_START + "\n2\n" + Pipeline.MD_END + "\nc\n";
  const merged = Pipeline.md_merge(two, block);
  expect(merged).toBe("a\n" + block + "\nb\nc\n");
  // a stray start before a whole part: the part is replaced, the stray out, the text between kept
  const stray = "a\n" + Pipeline.MD_START + "\nentre\n" + Pipeline.MD_START + "\n1\n" + Pipeline.MD_END + "\nz\n";
  expect(Pipeline.md_merge(stray, block)).toBe("a\nentre\n" + block + "\nz\n");
  // the usual: between its marks, nothing else touched
  const usual = "a\n" + Pipeline.MD_START + "\nx\n" + Pipeline.MD_END + "\nz\n";
  expect(Pipeline.md_merge(usual, block)).toBe("a\n" + block + "\nz\n");
  expect(Pipeline.md_merge("", block)).toBe(block + "\n");
});

test("totals and what the views say: medians, spans, severities", () => {
  expect(View.span_said(30e3)).toBe("agora");
  expect(View.span_said(5 * 60e3)).toBe("5 min");
  expect(View.span_said(5 * 3600e3)).toBe("5 h");
  expect(View.span_said(72 * 3600e3)).toBe("3 d");
  expect(View.took_said(30e3)).toBe("menos de 1 min");
  expect(View.took_said(5 * 60e3)).toBe("5 min");
  expect(View.sevs_said({ high: 0, medium: 0, low: 0 })).toBe("nenhuma");
  expect(View.sevs_said({ high: 1, medium: 0, low: 2 })).toBe("1 alta e 2 baixas");
  expect(View.median_of([])).toBeNull();
  expect(View.median_of([3, 1, 2])).toBe(2);
  expect(View.median_of([1, 2, 3, 4])).toBe(2.5);
  const { dir, s } = num_2337();
  const t = View.pipeline_totals(Pipeline.fronts(s, Pipeline.runs_read(dir, new Set(), s.refs, s.tasks), new Map(), NOW));
  expect(t.active).toBe(1);
  expect(t.stalled).toBe(1);
  expect(t.user).toBe(0);
  expect(t.decided).toBe(1);
});

test("the page escapes what it shows (a label, a title, a ref)", () => {
  const f: Pipeline.Front = { ref: "<b>x</b>", stage: "user", since: new Date(NOW).toISOString(), tasks: [{ id: "P1", title: "<img src=x onerror=alert(1)>", assignee: "user", state: "open" }], runs: [], cycles: [], prs: [{ key: "a#1", url: null, cycles: 0, head: null, verdict: null, live: null }], open: { high: 0, medium: 0, low: 0 }, fixing: false, idle: 0, decide: [], first: new Date(NOW).toISOString() };
  const html = Html.pipeline_html({ at: new Date(NOW).toISOString(), fronts: [f], refreshing: false }, NOW);
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<b>x</b>");
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  expect(html).toContain("sem link: estado desconhecido");
  expect(Html.pipeline_html(null, NOW, "Sem conexão.")).toContain("Sem conexão.");
});
