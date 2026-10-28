// The pipeline's page (/pipeline): /api/pipeline read and drawn
// (Pipeline.tsx); while the server reads PRs live (refreshing), read
// again in AGAIN, TRIES times at most. The fronts the user opened stay
// open: a details element keeps its own state between reads
import { useEffect, useState, type ReactNode } from "react";
import type * as P from "../../Pipeline.ts";
import { PipelineView } from "./Pipeline.tsx";

const AGAIN = 4000;
const TRIES = 5;

type Read = { panel: P.Panel | null; why: string } | null;

export function PipelinePage(): ReactNode {
  const [read, setRead] = useState<Read>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let live = true;
    let timer = 0;
    const get = async (tries: number) => {
      const got = await fetch("/api/pipeline").catch(() => null);
      const panel = got !== null && got.ok ? ((await got.json().catch(() => null)) as P.Panel | null) : null;
      if (!live) {
        return;
      }
      setRead({ panel, why: got === null ? "Sem conexão com o UniiChat." : "Não foi possível ler o painel (" + (got.status || "erro") + ")." });
      if (panel?.refreshing === true && tries < TRIES) {
        timer = setTimeout(() => void get(tries + 1), AGAIN) as unknown as number;
      }
    };
    void get(0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [asked]);
  return (
    <main id="account" className="pipe" onClick={(ev) => (ev.target as HTMLElement).closest(".pipe-reload") && setAsked(asked + 1)}>
      {read === null
        ? <><a className="back" href="/" data-go="/">← Voltar</a><h1>Pipeline</h1><p className="pipe-read">Lendo…</p></>
        : <PipelineView panel={read.panel} now={Date.now()} why={read.why} />}
    </main>
  );
}
