// Rank
// ====
// Texts ranked by how well they fit a query, by BM25 over their words:
// lowercase, accents dropped, split at what is no letter or digit (so a
// skill's "revisar-diff" or "plugin:nome" counts by its parts), words of
// one letter and the most common ones of Portuguese and English (STOP)
// left out: in a long description they outweigh what it is about. Local
// and cheap: the skills_search tool (Tools.skills_fit). Words only: a query in one
// language misses a description in another (the names, listed whole,
// and skills_search make up for it).

// BM25's term saturation and length normalization, as usual
const K1 = 1.2;
const B  = 0.75;

const STOP = new Set((
  "de do da dos das um uma uns umas no na nos nas em para pra por com que se ao aos ou mas como mais menos seu sua seus suas meu minha " +
  "isso isto este esta esse essa ele ela eles elas eu voce nao sim ja quando onde qual quais muito tambem entre sobre ate sem sob depois antes " +
  "the an and or of to in on for with is are be was were use used when this that these those it its as at by from you your not but if then into"
).split(" "));

// a text's words
export function words(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w));
}

// the indexes of the texts that fit the query, best first, at most n;
// those that share no word with it left out
export function rank(texts: string[], query: string, n: number): number[] {
  const docs = texts.map(words);
  const avg  = docs.reduce((k, d) => k + d.length, 0) / Math.max(1, docs.length);
  const asks = [...new Set(words(query))];
  const df   = new Map(asks.map((w) => [w, docs.filter((d) => d.includes(w)).length]));
  const score = (d: string[]) => asks.reduce((sum, w) => {
    const tf = d.filter((x) => x === w).length;
    const idf = Math.log(1 + (docs.length - df.get(w)! + 0.5) / (df.get(w)! + 0.5));
    return sum + (tf === 0 ? 0 : idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * d.length / Math.max(1, avg))));
  }, 0);
  return docs.map((d, k): [number, number] => [k, score(d)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}
