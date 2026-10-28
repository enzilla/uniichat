// Prints the next release tag, or "none" when this tree does not ship.
// The release workflow stamps that tag into Update.ts for the build and
// does not commit the stamp back: a commit would publish again.
//
// With JEV_API_KEY and the jev CLI (release.yml installs it), the
// shipping diff since the last tag is judged by Jev's release-impact
// preset, as vortex judges a pull request: whole up to CHUNK bytes,
// else in complete-file chunks and then one synthesis of them. Any
// failure, review or unsure answer falls back to the commits' rule
// (Release.ts); the reason is printed to stderr for the run's log.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Impact, jev_impact, next_version, ships } from "./Release.ts";

const CHUNK = 12000; // vortex's limit per request
// ponytail: past MAX_CHUNKS the tree goes by the commits' rule; raise it
// if big upstream merges keep falling back
const MAX_CHUNKS = 20;
// built from the sources by `bun run web`: Jev judges the sources, and the
// preset says generated output is not judged on its own; listed, not diffed
const BUILT = new Set(["web/app.js"]);

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
}

const listed = git(["tag", "-l", "v[0-9]*", "--sort=-version:refname"]);
const last = listed.split("\n").find((tag) => /^v\d+\.\d+\.\d+$/.test(tag)) ?? null;
if (last === null) {
  console.log(next_version(null, [], []));
  process.exit(0);
}

const paths = git(["diff", "--name-only", last + "..HEAD"]).split("\n").filter((path) => path !== "");
const raw = git(["log", "--format=%x1e%s%x1f%b", last + "..HEAD"]);
const commits = raw.split("\x1e").filter((row) => row !== "").map((row) => {
  const cut = row.indexOf("\x1f");
  return { subject: cut < 0 ? row : row.slice(0, cut), body: cut < 0 ? "" : row.slice(cut + 1) };
});
const judged = paths.some(ships) ? judge(last, paths.filter(ships), commits) : null;
console.log(next_version(last, paths, commits, judged) ?? "none");

function judge(last: string, shipping: string[], commits: { subject: string; body: string }[]): Impact | null {
  if (process.env.JEV_API_KEY === undefined || process.env.JEV_API_KEY === "") {
    return null;
  }
  try {
    const dir = mkdtempSync(join(tmpdir(), "jev-"));
    const ask = (name: string, pr: object): unknown => {
      const file = join(dir, name + ".json");
      writeFileSync(file, JSON.stringify(pr));
      return JSON.parse(execFileSync("jev", ["ask", "--preset", "release-impact", "--param", "pr=@" + file], { encoding: "utf8" })) as unknown;
    };
    const repo = process.env.GITHUB_REPOSITORY ?? "enzilla/uniichat";
    const base = {
      title: "Changes since " + last,
      body: commits.map((c) => "- " + c.subject + (c.body.trim() === "" ? "" : "\n  " + c.body.trim().replace(/\n/g, "\n  "))).join("\n").slice(0, 8000),
      url: "https://github.com/" + repo + "/compare/" + last + "..." + (process.env.GITHUB_SHA ?? "main"),
      labels: [],
      changed_files: shipping,
      diff_truncated: false,
    };
    const files = shipping.filter((path) => !BUILT.has(path)).map((path) => ({ path, diff: git(["diff", last + "..HEAD", "--", path]) }));
    const size = files.reduce((n, f) => n + Buffer.byteLength(f.diff), 0);
    let answer: unknown;
    if (size <= CHUNK) {
      answer = ask("whole", { ...base, diff: files.map((f) => f.diff).join("\n") });
    } else {
      const chunks = chunked(files);
      if (chunks === null) {
        console.error("jev: over " + MAX_CHUNKS + " chunks; going by the commits");
        return null;
      }
      const results = chunks.map((chunk, k) => ask("chunk-" + k, {
        ...base, diff: chunk.map((f) => f.diff).join("\n").slice(0, CHUNK), changed_files: chunk.map((f) => f.path),
        diff_truncated: chunk.some((f) => Buffer.byteLength(f.diff) > CHUNK),
        analysis_mode: "complete-file-chunk", chunk_index: k + 1, chunk_count: chunks.length,
      }));
      answer = ask("aggregate", {
        ...base, diff: "", analysis_mode: "chunk-aggregate",
        chunk_results: results.map((r) => (r as { answers?: unknown } | null)?.answers ?? r),
      });
    }
    const impact = jev_impact(answer);
    console.error("jev: " + (impact ?? "unsure or review, going by the commits") + " (" + size + " bytes)");
    return impact;
  } catch (err) {
    console.error("jev failed, going by the commits: " + String(err));
    return null;
  }
}

// the files packed in chunks of at most CHUNK bytes, whole files only; a
// file over it alone in its chunk, cut and marked truncated (Jev weighs it
// as partial and the synthesis decides); null when there'd be too many
function chunked(files: { path: string; diff: string }[]): { path: string; diff: string }[][] | null {
  const out: { path: string; diff: string }[][] = [[]];
  let used = 0;
  for (const f of files) {
    const n = Buffer.byteLength(f.diff);
    if (n > CHUNK) {
      out.push([f], []);
      used = 0;
      continue;
    }
    if (used + n > CHUNK) {
      out.push([]);
      used = 0;
    }
    out[out.length - 1].push(f);
    used += n;
  }
  const full = out.filter((chunk) => chunk.length > 0);
  return full.length > MAX_CHUNKS ? null : full;
}
