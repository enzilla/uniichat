// which rows a paint brought rise in (style.css .arrive): a row new to the
// screen, never one redrawn. The tail (the reply as it streams) is redrawn
// at each piece it gets, so there a row is new only past the rows it had.
// The body: a row past the last one the page showed (older history loads
// above it), and not the stream just kept (the tail shrank as it moved into
// the body). A page's first rows (its history, as it loads after a first
// paint that had none) rise in none, nor does a paint that brings a crowd

export type Paint = {
  shown: string;            // the page (main.ts shown_key)
  body: Array<number | null>; // each body row new to the DOM, its data-a
  tail: number[];           // each tail row new to the DOM, its place
  tail_was: number;         // the tail's rows before the paint
  tail_now: number;         // and after
  ids: number[];            // every body row's data-a on screen now
};

export type Rise = { body: number[]; tail: number[] }; // places in Paint.body, Paint.tail's places

// ponytail: a crowd is more than CROWD rows at once, a heuristic for history
// arriving; a turn that commits more at once just shows them without motion
const CROWD = 4;

export function arrivals(last: Map<string, number>, p: Paint): Rise {
  const had = last.get(p.shown);
  last.set(p.shown, Math.max(had ?? -1, ...p.ids));
  if (had === undefined || had < 0) {
    return { body: [], tail: [] };
  }
  const kept = p.tail_now < p.tail_was;
  const body = kept ? [] : p.body.flatMap((a, k) => (a !== null && a > had ? [k] : []));
  const tail = p.tail.filter((k) => k >= p.tail_was);
  return body.length + tail.length > CROWD ? { body: [], tail: [] } : { body, tail };
}
