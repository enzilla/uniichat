// Update
// ======
// Where this build of unii updates from: enzilla's fork's GitHub releases,
// not uniichat.com. Updating is manual: unii asks nothing of GitHub by
// itself. `unii update` pipes the newest release's install.sh to sh (on
// Windows, its install.ps1 to PowerShell), telling it to replace this
// very executable (UNII_BIN).

// this unii's version: each release ships one, a new one for every
// change to Term.ts or what it imports. The fork's release script reads
// it here and tags the release with it, as is ("20")
export const VERSION = "31-enzilla.1";

export const REPO        = "https://github.com/enzilla/uniichat";
export const INSTALL     = REPO + "/releases/latest/download/install.sh";
export const INSTALL_PS1 = REPO + "/releases/latest/download/install.ps1";

export function update_cmd(bin: string, win: boolean): string {
  if (win) {
    return "$env:UNII_BIN = '" + bin.replaceAll("'", "''") + "'; irm " + INSTALL_PS1 + " | iex";
  }
  return "curl -fsSL " + INSTALL + " | UNII_BIN='" + bin.replaceAll("'", "'\\''") + "' sh";
}
