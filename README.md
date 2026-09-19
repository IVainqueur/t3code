# T4 Code

> [!NOTE]
>
> ## This fork
>
> This is [IVainqueur](https://github.com/IVainqueur)'s personal fork of T4 Code (itself a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code)), shared with friends. Not affiliated with the upstream project — file bugs specific to this fork [here](https://github.com/IVainqueur/t3code/issues), not upstream.
>
> **What's new vs. upstream:**
>
> - Multi-window desktop support — open threads in separate app windows, drag threads between windows, per-window indicators
> - Thread reminders — get reminded about a thread after X minutes
> - System notifications for agent activity (desktop + web)
> - `last_activity` thread sort mode
> - Find-in-conversation (Cmd+F) in the web chat view
> - Rebrand from "T3 Code" to "T4 Code" throughout
>
> **Caveats / shortcomings:**
>
> - Installers are **unsigned** — macOS/Windows will show a one-time "unknown developer" warning (right-click → Open on Mac; "More info → Run anyway" on Windows)
> - **No auto-update.** Releases don't wire up an update feed, so the in-app updater won't find new versions
> - macOS builds are **Apple Silicon (arm64) only** — no Intel build, due to an upstream bug in the universal-build preflight check ([`lipo -version`](https://github.com/IVainqueur/t3code/blob/main/scripts/build-desktop-artifact.ts) isn't a real flag)
> - Linux (`.AppImage`) and Windows (`.exe`) builds are CI-verified only — not manually smoke-tested on those OSes before each release
> - Releases are cut manually and irregularly, not on any schedule
>
> **Installing / upgrading:**
>
> - Download the latest installer for your OS from [Releases](https://github.com/IVainqueur/t3code/releases)
> - To upgrade, just download the newer release and reinstall — on macOS, drag the new app over the old one in Applications; on Windows/Linux, rerun the new installer/AppImage over the old install
>
> Everything else below describes upstream T4 Code.

T4 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, T4 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T4 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> T4 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Try it out (install-free)

The easiest way to test T4 Code is to run the server in your terminal (requires Node.js 22.16+, 23.11+, or 24.10+):

```bash
npx t3@latest
```

This will launch T4 Code's backend on your machine as well as the local web app to control your agents.

Tip: Use `npx t3@latest --help` for the full CLI reference.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T4 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T4 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
