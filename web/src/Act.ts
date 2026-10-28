// an act a control does, as its data-act (main.tsx click reads it): the
// same JSON Html.ts wrote, so a test reads the act a button sends
import type * as View from "../../View.ts";

export function act_attr(act: View.Act): { "data-act": string } {
  return { "data-act": JSON.stringify(act) };
}
