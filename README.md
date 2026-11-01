# pi-squeeze

[![npm](https://img.shields.io/npm/v/pi-squeeze.svg)](https://www.npmjs.com/package/pi-squeeze)
[![CI](https://github.com/sorinirimies/pi-squeeze/actions/workflows/ci.yml/badge.svg)](https://github.com/sorinirimies/pi-squeeze/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Audit](https://github.com/sorinirimies/pi-squeeze/actions/workflows/security.yml/badge.svg)](https://github.com/sorinirimies/pi-squeeze/actions/workflows/security.yml)
[![Fuzz](https://github.com/sorinirimies/pi-squeeze/actions/workflows/fuzz.yml/badge.svg)](https://github.com/sorinirimies/pi-squeeze/actions/workflows/fuzz.yml)

Squeezes tool output and steers commands to fast CLI tools, so the agent's context stays small: uses rtk when installed, native compactors otherwise.

A [pi](https://github.com/earendil-works/pi-coding-agent) extension.

## Install

```bash
pi install npm:pi-squeeze
```

## What it does

After a `bash` command, pi-squeeze replaces its output with a shorter form with the same facts.
It only touches output it fully understands, and otherwise passes it through unchanged:

| Command | Becomes |
|---|---|
| `rg -n` / `grep -n` | totals line, then matches grouped by file (path written once, indent trimmed, long lines and busy files cut) |
| `fd`, `find` | paths grouped by directory |
| `lsd -l`, `eza -l` | type, size, short date and name (owner, group and permissions dropped) |
| `git diff` | one header line per file (`path (new, +12 −0)`), `index`/mode/`---`/`+++` lines dropped, every changed line kept, context trimmed to 1 line, long files cut |
| `cargo test` | totals line, then only warnings, failures, panics and result lines (build progress and passing tests dropped); also when the run failed |
| `git`, `cargo`, `docker`… | rewritten through [rtk](https://github.com/rtk-ai/rtk) when it is installed (switch: `/squeeze rtk off`) |

Safety rules:

* Pipes, redirects, chains and `--json`/`-c`/`-l`/`-x` style flags are never touched: the output is no longer the tool's own format.
* A line that does not parse makes the whole output pass through.
* The result must be clearly smaller (under 90%) and the output at least 400 characters.
* Every cut leaves a marker (`… [+12 more in this file]`), and the full original goes to a temp file whose path is in the output.
* `read`, `edit` and `write` are never changed.

## Commands

| Command | |
|---|---|
| `/squeeze` or `/squeeze status` | the settings and the tokens saved so far |
| `/squeeze [on\|off]` | switch everything |
| `/squeeze [search\|paths\|listing\|diff\|tests] [on\|off]` | switch one compactor |
| `/squeeze rtk [on\|off]` | rewrite git, cargo, docker… through [rtk](https://github.com/rtk-ai/rtk), when installed |
| `/squeeze min <chars>` | smallest output worth compacting (default 400) |

Settings are remembered in `<pi agent dir>/squeeze.json` (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`); it also holds
`lineChars`, `perGroup` and `total`, the limits of a compacted result. `PI_SQUEEZE=off` disables it at start.
The status line shows the tokens saved.

## Development

```bash
bun install
just check   # typecheck + tests (95% coverage gate) + pack check + nu script tests
just --list  # everything else: fuzz, audit, release, remotes
```

Layout:

| Path | What |
|---|---|
| `extensions/squeeze.ts` | the extension: pure functions plus a thin default export |
| `tests/` | `bun test`: `core` (pure logic), `extension` (hooks), `fuzz` (randomised properties) |
| `scripts/` | Nushell only, each with a test in `scripts/tests/` |
| `.github/`, `.gitea/` | CI, release, nightlies on both hosts |

Releases: `just release patch` bumps `package.json`, regenerates `CHANGELOG.md` with git-cliff, tags and
pushes; the Release workflow publishes to npm (secret `NPM_TOKEN`).

## License

MIT
