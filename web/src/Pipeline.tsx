// The pipeline's panel (R6)
// =========================
// The page /pipeline: each front (a task's ref) where it is and since
// when, its cycles of verification, the notes still open, its PRs live,
// its metrics (Pipeline.ts reads them; View.ts says them). panel null:
// not read (why says so); opened: the fronts shown open (null: those with
// the user or stalled, as the page opens). Html.ts's pipeline_html
import { Fragment, type ReactNode } from "react";
import type * as P from "../../Pipeline.ts";
import * as View from "../../View.ts";

export function PipelineView({ panel, now = Date.now(), why = "", opened = null }: { panel: P.Panel | null; now?: number; why?: string; opened?: Set<string> | null }): ReactNode {
  const head = <><a className="back" href="/" data-go="/">← Voltar</a><h1>Pipeline</h1></>;
  if (panel === null) {
    return <>{head}<p className="pipe-none">{why || "Não foi possível ler o painel."}</p><button type="button" className="chip pipe-reload">Tentar de novo</button></>;
  }
  const t = View.pipeline_totals(panel.fronts);
  const card = (n: string, what: string, note = "") => <div className="pipe-total"><b>{n}</b><span>{what}</span>{note === "" ? null : <small>{note}</small>}</div>;
  const active = panel.fronts.filter((f) => f.stage !== "closed");
  const closed = panel.fronts.filter((f) => f.stage === "closed");
  return (
    <>
      {head}
      <p className="pipe-read">Lido às {View.when_said(panel.at).slice(6)}{panel.refreshing ? " · lendo o estado dos PRs no GitHub…" : ""} · <button type="button" className="link pipe-reload">Atualizar</button></p>
      <section className="pipe-totals" aria-label="Resumo">
        {card(String(t.active), t.active === 1 ? "frente ativa" : "frentes ativas")}
        {card(String(t.user), "com você")}
        {card(String(t.stalled), t.stalled === 1 ? "parada com o Unii" : "paradas com o Unii")}
        {card(t.cycles === null ? "sem dados" : num_said(t.cycles), "ciclos por PR", "mediana")}
        {card(t.decide === null ? "sem dados" : View.took_said(t.decide), "até a sua decisão", t.decided === 0 ? "nenhuma decisão registrada" : "mediana de " + t.decided + (t.decided === 1 ? " decisão" : " decisões"))}
        {card(View.span_said(t.idle), "tempo parado", "frentes ativas, sem agente e sem você")}
      </section>
      {active.length === 0 ? <p className="pipe-none">Nenhuma frente ativa.</p> : <ol className="pipe-fronts">{active.map((f) => <li key={f.ref}><Front f={f} now={now} open={opened === null ? f.stage === "user" || f.stage === "stalled" : opened.has(f.ref)} /></li>)}</ol>}
      {closed.length === 0 ? null : <details className="pipe-closed"><summary>Encerradas ({closed.length})</summary><ol className="pipe-fronts">{closed.map((f) => <li key={f.ref}><Front f={f} now={now} open={opened !== null && opened.has(f.ref)} /></li>)}</ol></details>}
    </>
  );
}

// a number said in pt-BR: "2", "2,5"
function num_said(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace(".", ",");
}

function Front({ f, now, open }: { f: P.Front; now: number; open: boolean }): ReactNode {
  const since = View.span_said(now - Date.parse(f.since));
  const notes = f.stage === "closed" ? "" : f.fixing ? " · ressalvas em correção" : " · ressalvas abertas: " + View.sevs_said(f.open);
  const working = f.runs.filter((r) => r.state === "working");
  const decide = f.decide.length === 0 ? "nenhuma decisão sua registrada" : "mediana " + View.took_said(View.median_of(f.decide)!) + ", máximo " + View.took_said(Math.max(...f.decide)) + " (" + f.decide.length + (f.decide.length === 1 ? " decisão" : " decisões") + ")";
  const verified = f.prs.filter((p) => p.cycles > 0);
  const per = verified.length === 0 ? "nenhum PR verificado" : verified.map((p) => p.key + ": " + p.cycles).join(" · ");
  return (
    <details className="pipe-front" data-ref={f.ref} open={open || undefined}>
      <summary><b className="pipe-ref">{f.ref}</b> <span className={"pipe-stage " + f.stage}>{View.STAGE_SAID[f.stage]}</span> <span className="pipe-meta">{f.stage === "closed" ? "desde " + View.when_said(f.since) : "há " + since} · {f.cycles.length} {f.cycles.length === 1 ? "ciclo" : "ciclos"}{notes}</span></summary>
      <div className="pipe-body">
        {f.tasks.length === 0 ? null : <><h3>Pendências abertas</h3><ul className="pipe-tasks">{f.tasks.map((t) => <li key={t.id}><button type="button" className="link" data-desk={t.id}>{t.id}</button> <span className="pipe-who">{t.assignee === "user" ? "sua" : "do Unii"}</span> {t.title}</li>)}</ul></>}
        {working.length === 0 ? null : <><h3>Agentes trabalhando</h3><ul className="pipe-runs">{working.map((r, k) => <li key={k}><Run r={r} /> · desde {View.when_said(r.start)}</li>)}</ul></>}
        {f.prs.length === 0 ? null : <><h3>PRs</h3><ul className="pipe-prs">{f.prs.map((p) => <Pr key={p.key} p={p} />)}</ul></>}
        {f.cycles.length === 0 ? <p className="pipe-none">Nenhuma verificação registrada.</p> : <><h3>Ciclos de verificação</h3><ol className="pipe-cycles">{f.cycles.map((c) => <Cycle key={c.n} c={c} />)}</ol></>}
        <h3>Métricas</h3>
        <dl className="pipe-metrics">
          <dt>Tempo parado</dt><dd>{View.span_said(f.idle)} <small>sem agente trabalhando e sem pendência sua, desde {View.when_said(f.first)}</small></dd>
          <dt>Até a sua decisão</dt><dd>{decide}</dd>
          <dt>Ciclos por PR</dt><dd>{per}</dd>
        </dl>
      </div>
    </details>
  );
}

function Run({ r }: { r: P.Run }): ReactNode {
  return <><span className="pipe-agent">{r.name}</span>{r.label === null ? null : <> <small className="pipe-label">{r.label}</small></>}</>;
}

function Pr({ p }: { p: P.FrontPr }): ReactNode {
  const head = View.pr_head_said(p);
  return (
    <li>
      {p.url === null ? <span className="pipe-pr">{p.key}</span> : <a className="pipe-pr" href={p.url} target="_blank" rel="noopener noreferrer">{p.key}</a>}{" "}
      {p.live === null
        ? <span className="pipe-tag">{p.url === null ? "sem link: estado desconhecido" : "estado não lido"}</span>
        : <><span className={"pipe-tag " + p.live.state.toLowerCase()}>{View.PR_STATE_SAID[p.live.state]}</span>{p.live.state === "OPEN" ? <> <span className={"pipe-tag ci-" + p.live.ci}>{View.CI_SAID[p.live.ci]}</span></> : null}</>}
      {head === null ? (p.head === null ? null : " · verificado em " + p.head.slice(0, 7)) : <> · <span className={head.same ? undefined : "pipe-warn"}>{head.text}</span></>}
      {" · "}{p.cycles} {p.cycles === 1 ? "ciclo" : "ciclos"}{p.verdict === null ? null : " · " + View.VERDICT_SAID[p.verdict]}
    </li>
  );
}

function Cycle({ c }: { c: P.Cycle }): ReactNode {
  const r = c.run;
  const verdict = r.state === "working" ? "verificando" : r.state === "cut" ? "interrompida sem veredito" : r.verdict === null ? "veredito não lido do relato" : View.VERDICT_SAID[r.verdict];
  const notes = r.verdict === null || r.verdict === "approved" ? "" : r.noted ? " · ressalvas: " + View.sevs_said(r.notes) : " · ressalvas sem gravidade no relato";
  const prs = r.prs.length === 0 ? "" : " · " + r.prs.map((k) => k + (r.heads[k] === undefined ? "" : " em " + r.heads[k].slice(0, 7))).join(", ");
  const dur = r.state === "working" ? "" : " · " + View.took_said(Date.parse(r.end) - Date.parse(r.start));
  const cls = r.verdict === "rejected" ? "rejected" : r.verdict === "approved_with_notes" ? "notes" : r.verdict === "approved" ? "approved" : undefined;
  return (
    <li className={cls}>
      <span className="pipe-n">Ciclo {c.n}</span> {View.when_said(r.start)}{dur} · <Run r={r} /> · <b className="pipe-verdict">{verdict}</b>{notes}{prs}
      {c.after.length === 0 ? null : <small className="pipe-work">verificou o trabalho de {c.after.map((w, k) => <Fragment key={k}>{k > 0 ? ", " : ""}{w.name}{w.label === null ? "" : " (" + w.label + ")"}</Fragment>)}</small>}
    </li>
  );
}
