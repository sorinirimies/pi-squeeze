# pi-squeeze

[![npm](https://img.shields.io/npm/v/pi-squeeze.svg)](https://www.npmjs.com/package/pi-squeeze)
[![CI](https://github.com/sorinirimies/pi-squeeze/actions/workflows/ci.yml/badge.svg)](https://github.com/sorinirimies/pi-squeeze/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Audit](https://github.com/sorinirimies/pi-squeeze/actions/workflows/security.yml/badge.svg)](https://github.com/sorinirimies/pi-squeeze/actions/workflows/security.yml)
[![Fuzz](https://github.com/sorinirimies/pi-squeeze/actions/workflows/fuzz.yml/badge.svg)](https://github.com/sorinirimies/pi-squeeze/actions/workflows/fuzz.yml)

Shrinks bash output before it reaches the agent's context: native compactors for git, cargo, rg, ls, test and build output, plus rtk when installed. Full output stays one temp file away.

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
| `rg -n` / `grep -rn` | totals line, then matches grouped by file (path written once, indent trimmed, long lines and busy files cut) |
| `rg pattern dir` / `grep -r` (no `-n`) | the same, but only when every `path:` prefix is a file that exists in the session's directory (a colon in the text is never taken for a path) |
| `fd`, `find` | paths grouped by directory |
| `lsd -l`, `eza -l`, `ls -l` | type, size, short date and name (owner, group, permissions and the `total` line dropped) |
| `git diff` | one header line per file (`path (new, +12 −0)`), `index`/mode/`---`/`+++` lines dropped, every changed line kept, context trimmed to 1 line, long files cut |
| `cargo test` | totals line, then only warnings, failures, panics and result lines (build progress and passing tests dropped); also when the run failed |
| `rg -l` / `rg --files` / `grep -l` / `git ls-files` / `git diff --name-only` | paths grouped by directory |
| `git status` | `## main...origin/main [ahead 2]`, then `staged:` / `unstaged:` / `untracked:` with `M`/`A`/`D`/`R` codes; the hints go |
| `git log` | one line per commit (short hash, date, author, subject); the body stays, capped at 8 lines; one author is said once |
| `git show` | that commit line, then the compacted diff |
| `git blame` | one header per run of lines from the same commit |
| `dust` | size, tree and share; the bar chart goes |
| `cargo build` / `check` / `clippy` / `doc` | errors keep their whole block; warnings become one line each, grouped by lint (`clippy::needless_return (2)`); `Compiling`/`Finished` lines go |
| `cargo audit` | one line per advisory (id, crate, version, kind, title, fix) |
| `cargo tree`, `tree`, `eza --tree` | cut below 3 levels, `… [+15 lines deeper]` under each cut |
| `tsc` | errors grouped by file (`a.ts (8)`, `1:7 TS2322 …`) |
| `gradle`, `./gradlew` | task lines counted (`11 tasks (5 executed, 4 no-source, 2 up-to-date)`); failures, compiler errors, test failures and the `BUILD` line stay; daemon and `--scan` hints go; Kotlin `w:`/`e:` paths lose their shared directory |
| `bun test`, `go test` | passing tests counted, not listed; failures and totals stay |
| anything else | colour codes dropped, progress bars (`\r`) keep their last frame, 4+ identical lines become `line  [×N]`, 3+ blank lines become one. Never for `cat`, `head`, `jq`, `curl`… (content commands) |
| `git`, `cargo`, `docker`… | rewritten through [rtk](https://github.com/rtk-ai/rtk) when it is installed (switch: `/squeeze rtk off`) |

Output with a marker of its own (a `tsc` error list, a gradle build, a `bun test` run, rustc diagnostics) is recognised whatever ran it: `just check`, `npm run build`, `make test`, `… 2>&1`.
A **failed** command is compacted too, but only for test and build output, where the errors are the point.
`git -C dir …`, `git --no-pager …`, `--color=never` and `cargo +nightly …` are read as the plain command.

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
| `/squeeze [search\|paths\|listing\|diff\|tests\|git\|build\|tree\|generic] [on\|off]` | switch one compactor |
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

Releases run in CI: **Actions → Release → Run workflow** with a bump (`patch`, `minor`, `major`, or
`current` for the version already in `package.json`), or `just release-ci patch`. The workflow runs the
quality gate, bumps `package.json`, regenerates `CHANGELOG.md` with git-cliff, commits, tags, pushes and
publishes to npm (secret `NPM_TOKEN`). Locally, `just release patch` does the same up to the tag push.

## License

MIT
