#!/bin/sh
# Installs unii from enzilla's fork of UniiChat (github.com/enzilla/uniichat):
#   curl -fsSL https://github.com/enzilla/uniichat/releases/latest/download/install.sh | sh
# (or a release's own: .../releases/download/<tag>/install.sh)
#
# Downloads unii-<tag>-linux-<arch>.tar.gz from this release, checks its
# sha256 (written here as the release was made: .github/workflows/
# release.yml), and moves the executable to $UNII_BIN (default
# ~/.local/bin/unii). No sudo. `unii update` runs the newest release's
# copy with UNII_BIN set to the running unii, so it replaces itself. The
# unii-serve and unii-device systemd user services that run are restarted
# on the new unii; UNII_NO_RESTART=1 leaves them (a deploy restarts them
# itself).
set -eu

VER="@VER@"
BASE="https://github.com/enzilla/uniichat/releases/download/$VER"
BIN="${UNII_BIN:-$HOME/.local/bin/unii}"

fail() { printf 'unii: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || fail "$(uname -s): this fork ships Linux builds only."
case $(uname -m) in
  arm64|aarch64) arch=arm64; sum="@SUM_ARM64@";;
  x86_64|amd64) arch=x64; sum="@SUM_X64@";;
  *) fail "$(uname -m) is not supported: arm64 and x64 only.";;
esac
name="unii-$VER-linux-$arch.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "downloading $BASE/$name"
curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp/$name" "$BASE/$name" || fail "the download failed: $name"
echo "$sum  $tmp/$name" | sha256sum -c - >/dev/null 2>&1 || fail "$name does not match its sha256; not installed"
tar -xzf "$tmp/$name" -C "$tmp"
mkdir -p "$(dirname "$BIN")"
# copied beside $BIN, then renamed over it: a running unii keeps its file
cp "$tmp/unii" "$BIN.new.$$" && chmod 755 "$BIN.new.$$" && mv -f "$BIN.new.$$" "$BIN" || { rm -f "$BIN.new.$$"; fail "could not write $BIN"; }
echo "unii $VER is installed at $BIN."
[ "${UNII_NO_RESTART:-}" = 1 ] && exit 0
command -v systemctl >/dev/null 2>&1 || exit 0
for s in unii-device unii-serve; do
  if systemctl --user is-active -q "$s" 2>/dev/null; then
    echo "restarting $s"
    systemctl --user restart --no-block "$s" || echo "could not restart $s: restart it yourself."
  fi
done
