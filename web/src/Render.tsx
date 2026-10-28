// The views as markup strings, for the tests that read what a view says
// (renderToStaticMarkup of the same components the page draws)
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as P from "../../Pipeline.ts";
import type { Task } from "../../Tasks.ts";
import type * as View from "../../View.ts";
import { Tabs } from "./Bars.tsx";
import { desk_parts, type DeskOpts } from "./Desk.tsx";
import { PipelineView } from "./Pipeline.tsx";
import { Row } from "./Rows.tsx";

const html = (el: ReactElement): string => renderToStaticMarkup(el);

export function desk_html(tasks: Task[], q: string, ref: string, sel: string | null, now = Date.now(), opts: DeskOpts = {}): { list: string[]; detail: string[]; ids: string[] } {
  const parts = desk_parts(tasks, q, ref, sel, now, opts);
  return { list: parts.list.map(html), detail: parts.detail.map(html), ids: parts.ids };
}

export function row_html(row: View.Row): string {
  return html(<Row row={row} />);
}

export function pipeline_html(panel: P.Panel | null, now = Date.now(), why = "", opened: Set<string> | null = null): string {
  return html(<PipelineView panel={panel} now={now} why={why} opened={opened} />);
}

export function tabs_html(tabs: View.Tab[]): string[] {
  return tabs.map((tab) => html(<Tabs tabs={[tab]} />));
}
