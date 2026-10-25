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
  // approved, none
  expect(Pipeline.verdict_of("**APROVADO sem ressalvas.** Tudo certo.\n- baixa coisa")).toEqual({ verdict: "approved", notes: { high: 0, medium: 0, low: 0 }, noted: true });
  expect(Pipeline.verdict_of("Aprovou o #18 com ressalvas: uma baixa.").verdict).toBe("approved_with_notes");
  // no verdict said: none read
  expect(Pipeline.verdict_of("Implementei a R6 no commit abc1234.")).toEqual({ verdict: null, notes: { high: 0, medium: 0, low: 0 }, noted: false });
});

test("prs_named: links, owner/repo#n and repo#n; the head near each; not P48 nor 'PR #3'", () => {
  const got = Pipeline.prs_named("Verifique Numih/auth#307 commit 33236f0 e Numih/dp-bk-messaging#17 commit da32786, sobre 27a4065. Também https://github.com/morum/uniichat/pull/18 (head 6178ccf) e o PR #3, P48, uniichat#18.");
  expect(got.prs).toEqual(["auth#307", "dp-bk-messaging#17", "uniichat#18"]);
  expect(got.heads).toEqual({ "auth#307": "33236f0", "dp-bk-messaging#17": "da32786", "uniichat#18": "6178ccf" });
  expect(got.links["auth#307"]).toBe("https://github.com/Numih/auth/pull/307");
  expect(got.links["uniichat#18"]).toBe("https://github.com/morum/uniichat/pull/18");
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
    // a pipe in a cell is escaped, never a new column
    expect(Pipeline.md_row({ ...Pipeline.runs_read(dir, new Set(), s.refs)[0], label: "a|b" }).split(" | ").length).toBe(6);
  } finally {
    if (was === undefined) {
      delete process.env.UNII_AGENTES;
    } else {
      process.env.UNII_AGENTES = was;
    }
  }
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
