UniiChat (enzilla's fork)
=========================

A fork of [arteeh's fork](https://github.com/arteeh/uniichat), with
[morum's](https://github.com/morum/uniichat) pending list (tasks),
subagent labels and markdown, and what is listed under "What enzilla's
fork adds" below.

UniiChat is an AI agent with one chat that never ends. There is no "new
chat" button: you talk to the same agent for days, weeks, years, and it
remembers.

Based on [Victor Taelin's UniiChat source code](https://github.com/VictorTaelin/uniichat).

Features
--------

- **One chat, forever.** No new chats or sessions. Every tab, phone
  and terminal shows the same live chat.
- **A memory system that keeps everything.** Messages are summarized into a
  tree that the agent sees every turn: recent messages in detail, older
  ones more broadly. It can zoom into any line, down to the original
  message.
- **All your computers.** Run `unii device` on a machine and the agent
  can run commands and edit files there.
- **Subagents** do the grunt work in the background and report back.
- **Goals.** `/goal` keeps UniiChat working until something is done.
- **Don't start from scratch.** Import past conversations from either
  Claude Code, Codex or another UniiChat instance into your memory tree.
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
  No task closes without a concrete, documented solution: Unii closes
  one only with **evidence** the server checks (a Slack message sent,
  by channel and ts; a PR merged, read live with `gh`; a commit and its
  tests, the commit read live; a Terraform Cloud run applied; a file
  that exists; a reason in words only to drop one); the user's own
  resolution is its evidence. Each task says what makes it done
  (`done_when`); one of Unii's, its next step and when it's due
  (`next_step`, `next_due`), "prazo vencido" past it (in the views, in
  Unii's block, and one push, "Pendência P48 do Unii está parada além do
  prazo"; with no `next_due`, `task_stall` hours after it last moved, 4
  by default). A choice of Unii's (acts: unii) picked by the user is an
  **order received**: open, Unii's, closed only with evidence of the
  execution (the user may cancel it). A task may be **blocked** (why,
  what unblocks it) or **waiting for you** (in your Agora). One closed
  before this, without evidence, reads "sem evidência": Unii may prove
  it, or it's opened again; nothing is erased. A reply of Unii's that
  promises something for later with no task of its own gets a note.
  Terminal: `/mesa [projeto]`, `/p`, `/p P7`, `/ok P7 [opção] [campo=valor…] [comentário]`,
  `/ok!`, `/rascunho P7 campo=valor`, `/conversa P7 mensagem`,
  `/descartar`, `/reabrir`, `/avisar`.

What this fork adds:

- **Claude and ChatGPT plans** as vendors (`claude-sub`, `openai-sub`)
  beside API keys; profiles that fall back to the next model when one is
  out; auto-resume after hitting usage limits; a model per subagent.
- **Native Windows**: server, devices and terminal, with a one-line
  PowerShell install.
- **MCP servers** per device.
- **Skills** read from the ~/.agents/skills folder.
- **Scheduling tools** to give your agent future or repeating tasks.
- **Image and video viewing tools** to let it see images and video files.
- **Settings page** where you can customize the system prompt and compaction prompt.
- **Improved memory tree viewer** to browse what your agent knows.
- **Full markdown** as GitHub draws it, in the web app and the terminal.
- **Images, video, audio and HTML pages inline** for the agent to show you things,
  or for you to show the agent.
- **Conversation mode** for when you want a short continuous
  back-and-forth without the agent forgetting anything you said.
- **An installable web app (PWA)** on phones and desktops: icons, an
  offline shell, Web Push for replies, a nav bar that shows on Android;
  the composer stays above a phone's keyboard.
- **One owner per server**, no accounts, email, billing, or anything
  else exclusive to the uniichat.com version; `unii serve sessions`
  and `revoke` to sign a lost device out.
- **Background services** (`-d`, `stop`, `logs`) that updates restart.
- **Subagent improvements**: their own tab, a `stop` that ends one
  and its jobs, and a report when one hits a usage limit.
- **No telemetry or update checker**: `unii update` when you want it.
- **Better defaults**: Sonnet 5.5 medium does the compaction, seeing 4 KB
  of chat around each message (was Haiku 5.5 high with 32 KB), so
  summaries make up less.

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

Linux, macOS or WSL:

    curl -fsSL https://github.com/arteeh/uniichat/releases/latest/download/install.sh | sh

Windows (PowerShell, no admin needed):

    irm https://github.com/arteeh/uniichat/releases/latest/download/install.ps1 | iex

Either way you get one `unii` program (in `~/.local/bin`, or
`%LOCALAPPDATA%\Programs\unii` on Windows). `unii update` installs the
newest release and restarts the background services on it.

Set up
------

1. **Start the server** on the computer that keeps your chat:
   `unii serve -d`. It runs in the background from then on, at
   http://127.0.0.1:8788, with its data in `~/.unii`. To use it from
   other devices, put it behind HTTPS (see Q&A) and set `site` in
   Settings to that address.
2. **Sign in.** `unii serve link` on that computer prints a link that
   signs your browser in. Terminals and devices sign in with a link
   and a code you confirm in that browser.
3. **Pick a model.** In the web app, ☰ › Settings: add API keys. To use
   your Claude or ChatGPT plan instead, run `unii serve claude` or
   `unii serve chatgpt` on the server's computer, then pick `claude-sub`
   or `openai-sub`.
4. **Add your computers.** On each one Unii may work on:
   `unii device -d https://your-server`. Unii works in `~/.unii/work`
   there. Want it working on the server's computer too? Run a device
   there as well.

**MCP servers** belong to a device: list them in that device's
`~/.unii/config.json`, in the same shape as Claude's `mcpServers`:

    { "mcp": { "blender": { "command": "uvx", "args": ["blender-mcp"] } } }

Unii sees them from its next turn, no restart. Switch them on or off in
Settings.

**In the background**, `-d` runs the server or a device as a service of
your user (systemd on Linux, a Scheduled Task on Windows, a LaunchAgent
on macOS): it starts at login and restarts if it crashes.
`unii serve stop` / `unii device stop` removes it, `logs -f` follows its
output. On Linux, `loginctl enable-linger` keeps it running while you're
logged out.

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


**Settings** are mostly on the Settings page, including Unii's system
prompt and compaction prompt. They're kept in `~/.unii/config.json`,
where `UNII_<KEY>` environment variables override them. One lives only
there: `after`, a shell command to run after each turn.

Also there: `task_stall`, the hours a task of Unii's may stand still,
with no `next_due`, before it's overdue (4 by default; read at the start).

Use
---

- **Web:** open the server's address. Install it as an app from your
  browser to get notifications when Unii replies.
- **Terminal:** `unii [url]`. `/help` lists its commands; `/import`
  brings in this computer's Claude Code and Codex sessions.
- **Conversation mode:** the switch next to "fold all" (`/mode` in the
  terminal). From then on, your and Unii's messages stay word for word
  in Unii's memory, for a real discussion. It costs more per turn and
  turns itself off when the model's context window fills up.
- `unii help` lists every command.

From source (Bun): `bun install`, `bun run web`, `bun Cli.ts <command>`,
`bun run build` for a single `unii` program.

- **First day:** run `/import` in the terminal on each computer you used
  Claude Code or Codex on (it lists what it found; `/import go` sends it),
  so Unii starts out knowing your projects and past decisions. An import
  is summarized in the background; `/import pause` and `resume` hold it.


`bun test` runs every test on a fresh `/tmp/unii-test-*` data dir
(TestSetup.ts, preloaded by bunfig.toml), never on real data.

Uninstall
---------

Back up `~/.unii` first if you may want your chat back. Run
`unii device stop` and `unii serve stop` where you used `-d`, then:

- **Linux, macOS:** `rm ~/.local/bin/unii` and
  `rm -rf ~/.unii ~/.config/unii`.
- **Windows:** `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\unii", "$HOME\.unii", "$HOME\.config\unii"`,
  and take `%LOCALAPPDATA%\Programs\unii` out of your user Path.

Q&A
---

**Can Unii use my screen?**

Not by itself: ask Unii to add a computer-use MCP server, such as
[cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver),
to the device whose screen it should use.

**I don't trust its unlimited tool calling. Can I sandbox Unii?**

Yes, with [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/). Run
`unii device` inside the sandbox and on no other computer, pointed at
your server outside it (`http://host.docker.internal:8788` if it runs on
the same PC), and let the sandbox reach it:
`sbx policy allow network localhost:8788`. That device's MCP servers
run in the sandbox too.

**I don't trust its unlimited tool calling. Can I make it ask for permission on tool calls?**

You enjoy pressing enter?

**How can I reach UniiChat from outside my home network?**

With Tailscale: ask Unii to set up Tailscale Serve on HTTPS port 443,
pointing at `unii serve`. Only your own Tailscale devices can reach it,
not the whole internet.

**Can others use my server?**

No: a server has one owner. Anthropic and OpenAI don't allow sharing a
plan, either.

**Upgrading from arteeh.16 or older?**

Stop the server first (`systemctl --user stop unii-serve`), run the
installer, then start it again: it moves your data to the new layout.
The terminal no longer works on files itself: run `unii device` on each
computer Unii should work on.

License
-------

Apache-2.0 (LICENSE).
Copyright 2026 Higher Order Company.
Copyright 2026 Maarten de Jong.
