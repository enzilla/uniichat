UniiChat (enzilla's fork)
=========================

A fork of [arteeh's fork](https://github.com/arteeh/uniichat), with
[morum's](https://github.com/morum/uniichat) pending list (tasks),
subagent labels and markdown, and what is listed under "What enzilla's
fork adds" below.

UniiChat is an AI agent with one chat that never ends. There is no "new
chat" button: you talk to the same agent for days, weeks, years, and it
remembers. This fork runs it as your own server, for you alone. The
original is [VictorTaelin/uniichat](https://github.com/VictorTaelin/uniichat).

**This repo is vibe-coded.** AI agents wrote nearly all of it, and AI
agents reviewed it. Expect bugs.

Features
--------

- **One chat, a memory tree.** Every message is summarized into one line,
  and neighboring lines are merged in pairs, again and again. Each call
  sees the whole chat, recent messages in detail and older ones in
  broader lines, and can zoom into any line down to the original message.
- **Agents and devices.** Unii runs a shell, reads and edits files and
  views images and videos on your computers that run `unii device`. It
  spawns subagents, which work in the background and report back.
- **Schedules, goals, imports.** It can message itself on a schedule,
  keep working until a `/goal` is met, and take in your past Claude Code
  and Codex sessions (or the websites' exports).
- **Web, phone and terminal.** The server hosts the web app (installable,
  with push notifications); `unii` is the same chat in a terminal.
- **Pending list (pendências).** Unii keeps what it needs of you beside
  the chat: approvals, decisions, steps only you can do. A task may wait
  for others (shown once they're closed), ask several things at once
  (fields: one choice, many, a text, yes or no; each answer kept as a
  draft till you conclude), and have a thread: talk with Unii about it
  without resolving it (your message is a message of the chat, marked
  `[Pendência P7: …]`; it shows "aguardando o Unii", then "sua vez").
  On the web, the **Mesa** is the list as a screen of its own, beside
  the **Conversa** (the header's button, or `m`): tasks grouped by whose
  move it is (Agora, Aguardando o Unii, Em andamento, Aguardando outras
  pendências, Resolvidas recentemente), searched and filtered by project,
  the one picked whole at the right (on a phone, list and task one at a
  time); `j`/`k` or the arrows move, Enter opens, `/` searches, Esc goes
  back. A task of yours open over a day says how late ("atrasada há
  2 d", as the late push counts it); the GitHub PRs it links show as
  `repo#n` in its row and over its detail; once one is resolved, the
  next of Agora is a click away ("Próxima"); Concluir with a required
  field empty marks it and sends nothing. The site opens on the Mesa when a task is your move, else on the
  Conversa; a tab opened before the server restarted with a new site
  reloads itself.
  Terminal: `/mesa [projeto]`, `/p`, `/p P7`, `/ok P7 [opção] [campo=valor…] [comentário]`,
  `/ok!`, `/rascunho P7 campo=valor`, `/conversa P7 mensagem`,
  `/descartar`, `/reabrir`, `/avisar`.

What this fork adds:

- **One owner per server**, no accounts, email or billing; `unii serve
  sessions` and `revoke` to sign a lost device out.
- **Claude and ChatGPT plans** as vendors (`claude-sub`, `openai-sub`)
  beside API keys; profiles that fall back to the next model when one is
  out; usage limits waited out instead of failing; a model per subagent.
- **An installable web app (PWA)** on phones and desktops: icons, an
  offline shell, Web Push for replies, a nav bar that shows on Android;
  the composer stays above a phone's keyboard.
- **Native Windows**: server, devices and terminal, with a one-line
  PowerShell install.
- **MCP servers** (also run on a device), **skills**, **schedules** (once
  or by cron), image and video viewing.
- **A Settings page**, an editable user prompt and compaction prompt,
  and a memory tree browser.
- **Subagents**: their own tab, a `stop` that ends one and its jobs, and
  a report when one hits a usage limit.
- **No telemetry or update checker**: `unii update` when you want it.
- **Background services** (`-d`, `stop`, `logs`) that updates restart,
  and a **conversation mode**.

What enzilla's fork adds:

- **A full-screen terminal** (`unii`; `unii --classic` prints to the
  scrollback as before): the chat beside the pending list, which Ctrl+P
  focuses (arrows, space marks, 1-9 a choice, ! marks and tells Unii, d
  drops, c comments, a click on a box marks it); PageUp, PageDown and the
  wheel scroll the chat, keeping your place as lines come.
- **A menu of the commands** as a `/word` is typed (the devices' skills
  too), and **a chooser** for `/model`, `/effort`, `/speed`, `/mcp` and
  `/tab` given no value. Shift+Tab steps the effort, Alt+M the speed.
  Colors from the terminal's own palette.
- **Your Claude Code on the device**: `unii device` reads `~/.claude`'s
  skills, commands and enabled plugins (as `plugin:name`) and its MCP
  servers (stdio, from `~/.claude.json` and the plugins' `.mcp.json`),
  which run on that device, each off in a chat till `/mcp` turns it on;
  their commands and env never leave the device.
- **Skills in a steady block** before the memory, so the vendor's cache
  keeps it; `skills_search` finds one by words, and a message starting
  with `/name` loads that skill whole for its turn.

Install and set up
------------------

On Linux or macOS (or in WSL):

    curl -fsSL https://github.com/arteeh/uniichat/releases/latest/download/install.sh | sh

This installs `unii` to `~/.local/bin`. The installer also moves data
from older versions.

Windows: native, or WSL with the Linux installer. Natively, in
PowerShell:

    irm https://github.com/arteeh/uniichat/releases/latest/download/install.ps1 | iex

This installs `unii.exe` to `%LOCALAPPDATA%\Programs\unii` (set
`$env:UNII_BIN` first for another place) and adds its folder to your
user PATH (no admin).
The server, devices and the terminal all run on Windows as on Linux and
macOS, with the data in `%USERPROFILE%\.unii` (no older unii kept any
on Windows, so the installer moves nothing there). Nobody has run them on
real Windows yet, though: expect rough edges there. One known gap: the
`stop` tool kills a job's process tree while its shell runs, but can't
find a process that left the tree once its shell has ended (Linux and
macOS find those by a mark in their environment).

`unii update` installs the newest release and restarts the background
services `-d` made (below) on it. A server or device you run another
way keeps the old one till it restarts; on Windows the installer won't
run while one does: stop it first, update, start it again.

1. **Start the server** on the computer that keeps your chat: `unii
   serve -d` runs it in the background (below); `unii serve` in the
   foreground. It serves http://127.0.0.1:8788; its data is in `~/.unii`
   (`$UNII_DIR`). Put it behind HTTPS (e.g. `tailscale serve`) to reach
   it from elsewhere, and set `site` to that address.
2. **Sign in.** On the server's computer, `unii serve link` prints a link
   that signs a browser in. A terminal or a device signs in by a link and
   a code you confirm in that browser. `unii serve sessions` lists them;
   `unii serve revoke <n>` (or `--all`) signs one out.
3. **Pick a vendor.** In the web app, ☰ › Settings: vendors, models and
   API keys (kept in `~/.unii/keys.json`, readable by you alone: on
   Windows by your profile folder's permissions). For a plan instead of
   keys, run `unii serve claude` (Claude) or `unii serve chatgpt`
   (ChatGPT) on the server's computer, then pick `claude-sub` or
   `openai-sub`. Each takes `logout` or `status`.
4. **Add devices.** On each computer Unii may work on, run `unii device
   -d https://your-server`: it prints a link and a code to confirm in
   your browser, then runs in the background. Its work dir is
   `~/.unii/work`; its settings are in `~/.config/unii/device.json`.

**In the background**, `-d` runs the server or a device as a service of
your user (a systemd user service; on Windows a Scheduled Task, no
admin; on macOS a LaunchAgent), started at login and again if it
crashes. `-d` again restarts it, `stop` (`unii serve stop`, `unii device
stop`) stops and removes it, and `logs [-f]` shows (follows) its output:
the journal on Linux, `~/.unii/logs/` on Windows and macOS. On Linux,
`loginctl enable-linger` starts it at boot and keeps it up after you log
out. A service by its name (`unii-serve`, `unii-device`) that you made
yourself is left as it is: remove it to use `-d`.

   A shell call has a time limit: `timeout` seconds, 600 by default, 3600
   at most. Past it, its process group gets SIGTERM, then SIGKILL 5 s
   later, and the call answers its output so far, ending `(timed out
   after N s: killed)`. A process that left the group (`setsid`) lives on
   till a stop or the device ends, but can't keep the call waiting.
   `view_video` is cut at 300 s; `read`, `write` and `edit` refuse a
   FIFO, device or socket, which would block the device. The server ends
   a job on its own 30 s past a shell's or view_video's limit (120 s for
   `read`, `write`, `edit`, `skill`) and tells the device to kill it: so
   a device running an older unii, which keeps no limit, is covered too,
   though its output so far is lost.

The server's settings are in `~/.unii/config.json` (most are on the
Settings page). Each may also be set as `UNII_<KEY>`, which wins. Besides
`vendors`, `models`, `pick`, `compactor`, `agents`, `profiles` and `site`:

- `compactor_context` (also on the Settings page): how much of the chat,
  in KB (default 4), each summary sees beside its message. More lets the
  compactor copy in what the message doesn't say; Sonnet medium does
  that less than Haiku.
- `mcp`: MCP servers, in Claude's `mcpServers` shape (or a file path).
  Add `"device": "<name>"` to run one on a device.
- `after`: a shell command run after each turn (by sh; on Windows by
  PowerShell).
- `claude_sub`, `claude`, `chatgpt`: where the plans' sign-ins are kept.
- `apple`, `apns`: the iOS app's (ios/) App ID and push key id.

The prompts: `~/.unii/prompt.md` (every turn; subagents get it too)
and `~/.unii/compact.md` (every summary, nothing else) replace the
built-in `prompt.txt` and `compact.txt`. Edit them on the Settings page.

Use
---

- **Web:** the server's address. ☰ has Settings, the memory tree, Import
  History and the MCP servers on or off.
- **Terminal:** `unii [url]` (default: `$UNII_URL`, else the last server,
  else the local one). `/help` lists its commands; `/import` brings in
  this computer's Claude and Codex sessions.
- **Conversation mode:** the standard / conversation switch by "fold all"
  (`/mode` in the terminal) keeps your and Unii's messages word for word
  in Unii's view from then on, for a discussion; it costs more per turn.
  Its line fills as that space (96 KB, beside the summaries before it)
  does; full, it switches itself off.
- `unii help` lists every command. unii never checks for updates by
  itself: `unii update` installs the newest release.
- **First day:** run `/import` in the terminal on each computer you used
  Claude Code or Codex on (it lists what it found; `/import go` sends it),
  so Unii starts out knowing your projects and past decisions. An import
  is summarized in the background; `/import pause` and `resume` hold it.

From source (Bun): `bun install`, `bun run web` (rebuilds web/app.js),
`bun Cli.ts <command>`, `bun run build` (one `unii` executable).
`bun test` runs every test on a fresh `/tmp/unii-test-*` data dir
(TestSetup.ts, preloaded by bunfig.toml), never on real data.

Uninstall
---------

Back up the server's data (`~/.unii`) first if you may want your chat
again. The paths below are the defaults: if you set `UNII_BIN`,
`UNII_DIR` or `XDG_CONFIG_HOME`, remove those places instead.

First run `unii device stop` and `unii serve stop` where you used `-d`
(and stop any service you made yourself).

- **Linux, macOS:** `rm ~/.local/bin/unii` and `rm -rf ~/.unii
  ~/.config/unii`.
- **Windows:** quit any other `unii` you run, then `Remove-Item
  -Recurse -Force "$env:LOCALAPPDATA\Programs\unii", "$HOME\.unii",
  "$HOME\.config\unii"`, and take `%LOCALAPPDATA%\Programs\unii` out of
  your user Path (`rundll32 sysdm.cpl,EditEnvironmentVariables`).

Q&A
---

**Can Unii use my screen?** Not by itself: add a computer-use MCP server,
such as [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver),
run on that device:

    "mcp": { "screen": { "command": "cua-driver", "args": ["mcp"], "device": "my-mac",
             "env": { "CUA_DRIVER_RS_TELEMETRY_ENABLED": "0" } } }

**Can others use my server?** No: a server has one owner. Anthropic and
OpenAI don't allow sharing a plan, either.

**Upgrading from arteeh.16 or older?** Stop the server first (`systemctl
--user stop unii-serve`), run the installer, then start it: it moves your
data to the new layout and won't while a server runs. Your user prompt is
then fixed in `prompt.md` (empty it on the Settings page to get later
built-in changes). The terminal is no device any more: set up `unii
device` (above) on each computer Unii should work on.

License
-------

Apache-2.0 (LICENSE). Copyright 2026 Higher Order Company.
