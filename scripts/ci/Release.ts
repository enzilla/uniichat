// Release
// =======
// The next tag, taken from vortex's intelligent-release.sh without Jev
// and without the merge queue. Vortex classifies each merged pull
// request. This fork lands commits on main, so the unit is the tree
// since the last strict vX.Y.Z tag.
//
// A tree that is only release automation, tests, docs or lockfiles
// does not ship (prepare-release-diff.py's path policy) and publishes
// nothing. Anything else ships: a breaking commit is major, a feat is
// minor, a fix or perf is patch, and a subject with no conventional
// type is patch.
//
// With Jev (JEV_API_KEY, next-version.ts), as vortex: the shipping diff
// goes to its release-impact preset, and a sure answer (choice not
// review, at MIN_CONFIDENCE or more) decides, the commits' types its
// floor; its none publishes nothing. Unsure, failed, or no key: the
// rule above, so a release never waits on it.
//
// Vortex refuses to invent the first tag. The line it replaces is
// 31-enzilla.1.N, so the first vX.Y.Z continues it as v31.1.0.

export const BASELINE = "v31.1.0";

const TEST = /(^|\/)(__tests__|tests?|testdata|testes|__mocks__|__screenshots__|__snapshots__)\/|(^|\/)[^/]+([._-](test|spec))\.[^/]+$|(^|\/)[^/]+_test\.[^/]+$/i;
const DOC_DIR = /(^|\/)(docs?|documentation|examples?|guides?)\//i;
const DOC_NAME = /(^|\/)(readme|contributing|changelog|changes|authors|license)(\.|$)/i;
const DOC_EXT = /\.(md|mdx|rst|adoc|txt)$/i;
const LOCK = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|uv\.lock|Podfile\.lock|pubspec\.lock)$/i;
const TYPE = /^(feat|fix|perf|revert|chore|docs|style|refactor|test|ci|build)(\([^)]+\))?(!)?:/;

export type Impact = "major" | "minor" | "patch" | "none";

// vortex's intelligent-release.sh threshold
export const MIN_CONFIDENCE = 0.7;

export function ships(path: string): boolean {
  if (path.startsWith(".github/workflows/") || path.startsWith("scripts/ci/") || path.startsWith(".jev/")) return false;
  if (TEST.test(path) || LOCK.test(path) || DOC_DIR.test(path) || DOC_NAME.test(path) || DOC_EXT.test(path)) return false;
  return true;
}

export function subject_impact(subject: string, body: string): Impact {
  if (body.includes("BREAKING CHANGE")) return "major";
  const match = TYPE.exec(subject);
  if (match === null) return "none";
  if (match[3] === "!") return "major";
  if (match[1] === "feat") return "minor";
  if (match[1] === "fix" || match[1] === "perf" || match[1] === "revert") return "patch";
  return "none";
}

export function highest(impacts: Impact[]): Impact {
  if (impacts.includes("major")) return "major";
  if (impacts.includes("minor")) return "minor";
  if (impacts.includes("patch")) return "patch";
  return "none";
}

function bump(last: string, impact: Impact): string {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(last);
  if (match === null) throw new Error("tag is not vX.Y.Z: " + last);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (impact === "major") return "v" + String(major + 1) + ".0.0";
  if (impact === "minor") return "v" + String(major) + "." + String(minor + 1) + ".0";
  return "v" + String(major) + "." + String(minor) + "." + String(patch + 1);
}

// Jev's answer ({answers: {impact: {choice, probabilities}}}) as an
// impact, or null when it isn't a sure one
export function jev_impact(answer: unknown): Impact | null {
  const impact = (answer as { answers?: { impact?: { choice?: unknown; probabilities?: Record<string, unknown> } } } | null)?.answers?.impact;
  const choice = impact?.choice;
  if (choice !== "major" && choice !== "minor" && choice !== "patch" && choice !== "none") return null;
  const sure = impact?.probabilities?.[choice];
  return typeof sure === "number" && sure >= MIN_CONFIDENCE ? choice : null;
}

// null: do not publish. last null: the one baseline, whatever the tree is.
// judged: Jev's sure impact for the tree, or null to go by the commits
export function next_version(last: string | null, paths: string[], commits: { subject: string; body: string }[], judged: Impact | null = null): string | null {
  if (last === null) return BASELINE;
  if (!paths.some(ships)) return null;
  const typed = highest(commits.map((commit) => subject_impact(commit.subject, commit.body)));
  if (judged !== null) {
    const impact = highest([judged, typed]);
    return impact === "none" ? null : bump(last, impact);
  }
  return bump(last, typed === "none" ? "patch" : typed);
}
