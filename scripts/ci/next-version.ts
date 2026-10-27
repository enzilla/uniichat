// Prints the next release tag, or "none" when this tree does not ship.
// The release workflow stamps that tag into Update.ts for the build and
// does not commit the stamp back: a commit would publish again.

import { execFileSync } from "node:child_process";
import { next_version } from "./Release.ts";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
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
const next = next_version(last, paths, commits);
console.log(next ?? "none");
