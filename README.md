# pi-squeeze

[![npm](https://img.shields.io/npm/v/pi-squeeze.svg)](https://www.npmjs.com/package/pi-squeeze)
[![CI](https://github.com/sorinirimies/pi-squeeze/actions/workflows/ci.yml/badge.svg)](https://github.com/sorinirimies/pi-squeeze/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Audit](https://github.com/sorinirimies/pi-squeeze/actions/workflows/security.yml/badge.svg)](https://github.com/sorinirimies/pi-squeeze/actions/workflows/security.yml)
[![Fuzz](https://github.com/sorinirimies/pi-squeeze/actions/workflows/fuzz.yml/badge.svg)](https://github.com/sorinirimies/pi-squeeze/actions/workflows/fuzz.yml)

Shrinks bash output before it reaches the agent's context: native compactors for git, search, listings, tests, builds (cargo, gradle, Maven, javac, Xcode, tsc, docker), Android (adb, lint, detekt), linters, package installs and logs, plus rtk when installed. Full output stays one temp file away.

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
| `rg -n` / `grep -rn` / `ack` | totals line, then matches grouped by file (path written once, indent trimmed, long lines and busy files cut) |
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
| `gradle`, `./gradlew` | task lines counted (`11 tasks (5 executed, 4 no-source, 2 up-to-date)`); failures, compiler errors, test failures and the `BUILD` line stay; daemon, configuration-cache, JVM and `--scan` chatter goes; reported files lose their shared directory |
| `bun test`, `go test` | passing tests counted, not listed; failures and totals stay |
| `pytest` | session header, progress dots and `PASSED` lines go; failures, warnings and the short summary stay; full-width `====` banners shrink |
| `jest`, `vitest` | passing tests and files go, skipped ones are counted; failures with their diff and frame, and the totals, stay |
| `xcodebuild`, `swift build` / `test` | build steps (`CompileSwift`, `Ld`, `CodeSign` and their command lines) and progress counted, not listed; warnings grouped by message; errors keep frame and notes; passing XCTest / Swift Testing tests counted; the `** BUILD SUCCEEDED **` line stays |
| `eslint`, `biome`, `ruff`, `flake8`, `mypy`, `pylint`, `ktlint`, `detekt`, `swiftlint`, `shellcheck`, `flutter analyze` | findings grouped by rule and message, each location once (`error eqeqeq: … (5)` then `m.js:2:46 m1.js:2:47 …`), the shared directory said once; frames and fix suggestions go |
| `npm` / `pnpm` / `yarn` / `bun install`, `pip install`, `uv sync`, `pod install`, `bundle install`, `flutter pub get` | download and progress lines go; per-package lines become one line (`Collecting (9): requests, rich, …`); deprecation warnings become one list of names; errors and the summary stay |
| `docker build` | `[internal]` steps, layer downloads, `CACHED` / `DONE` lines go; each step keeps its header and what it printed |
| `docker logs`, `docker compose logs`, `kubectl logs`, `journalctl`, `adb logcat` (not `-f` / `--follow`) | 3+ lines that differ only in timestamps and numbers keep the first and last; framework stack frames fold; logcat drops the date and thread id; past the limit the start goes, not the end |
| `gradle` on Android | also: Kotlin / KSP warnings, detekt / ktlint findings and Android Lint issues grouped by message with their locations (lint's source lines, explanations and baseline advice go); repeated warnings and `--warning-mode all` deprecations said once with a count, without the upgrade-guide links; R8 `Missing class` and `Duplicate class` lines become one list of classes; "Searched in the following locations" becomes a count; `A failure occurred while executing …` wrappers go and the failure summary does not repeat what was printed above it; framework frames fold |
| `gradle tasks`, `gradle projects`, `dependencyInsight`, `dependencies` | tasks: names per group, descriptions go; projects: every path once, grouped by the first segment (`:api (261): …`); insight: the attribute tables go; dependencies: cut like a tree |
| `mvn`, `./mvnw`, `mvnd` | `Downloading` / `Downloaded` lines and their progress counted; `[INFO]` lines go except the result, the test totals and modules that failed; a passing test class takes its output (Spring banners, logs) with it; errors said once, the `[Help 1]` footer goes; `dependency:tree` is cut like a tree |
| `javac` | errors keep their source line, caret and `symbol:` / `location:`; warnings grouped by kind (`warning rawtypes: found raw type: List (2)`); `Recompile with -Xlint` notes go |
| a JVM stack trace from anything (`java -jar`, a test JVM, a log) | framework frames (java., kotlin., android., org.junit., org.springframework.…) fold to `… N framework frames`; the exception, each `Caused by:`, your own frames and `... N more` stay; also when the command failed |
| `adb exec-out uiautomator dump /dev/tty` | one line per node that says something, indented by nesting, with where to tap: `TextView "Network & internet" #title @375,608`; empty wrappers and off-screen nodes go |
| `adb shell getprop`, `settings list …` | keys that share a prefix written once, every value kept: `aaudio: hw_burst_min_usec=2000 mmap_policy=2` |
| `adb shell ps -A`, `top -n 1` | kernel threads and idle processes counted, not listed; column padding goes |
| `adb shell dumpsys …` | lines deeper than an entry's own go with a count; 3+ lines of the same shape keep their ends |
| `adb shell pm list packages [-f]` | grouped by the first two name segments; with `-f`, name then path, hashed install directories elided |
| `adb logcat` (`threadtime`, `time`, `brief`) | as logs above; with `adb -s <serial>` too |
| `… \| tail -50`, `… \| head -n 20` | the command before the pipe picks the compactor |
| anything else | colour codes dropped, progress bars (`\r`) keep their last frame, 4+ identical lines become `line  [×N]`, 3+ blank lines become one. Never for `cat`, `head`, `jq`, `curl`… (content commands) |
| `git`, `cargo`, `docker`… | rewritten through [rtk](https://github.com/rtk-ai/rtk) when it is installed (switch: `/squeeze rtk off`) |
| `rtk rg …`, `rtk git diff`… | run plain again when a native compactor handles the command (typed by the model or rewritten by another extension), so the native compactor gets the output |

Output with a marker of its own (a `tsc` error list, a gradle or Maven build, `javac` errors, a JVM stack trace, a `uiautomator` dump, a `bun test` run, rustc diagnostics) is recognised whatever ran it: `just check`, `npm run build`, `make test`, `… 2>&1`.
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
| `/squeeze` or `/squeeze status` | the settings, this session's savings, and the all-time savings by compactor and command plus the biggest outputs no compactor took |
| `/squeeze [on\|off]` | switch everything |
| `/squeeze [search\|paths\|listing\|diff\|tests\|git\|build\|lint\|install\|logs\|tree\|generic] [on\|off]` | switch one compactor |
| `/squeeze rtk [on\|off]` | rewrite git, cargo, docker… through [rtk](https://github.com/rtk-ai/rtk), when installed |
| `/squeeze min <chars>` | smallest output worth compacting (default 400) |

Settings are remembered in `<pi agent dir>/squeeze.json` (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`); it also holds
`lineChars`, `perGroup` and `total`, the limits of a compacted result, `maxRatio` (a result is used only when at most this share
of the original, 0.5 to 1, default 0.9), and `logSavings`, `logMissed` and `missedChars` (below). `PI_SQUEEZE=off` disables it at start.
The status line shows the tokens saved.

## Savings log

Each compacted output adds one line to `<pi agent dir>/squeeze-savings.jsonl`, so the savings can be tracked
over time; the model never sees it:

```json
{"ts":"2026-01-02T09:15:00.000Z","session":"…","cwd":"/work/app","tokens":1840,"chars":7360,"kind":"build","cmd":"cargo build"}
```

`cmd` is the program and, for tools with subcommands, the subcommand: never arguments, paths or patterns.

[tokenburn](https://github.com/sorinirimies/tokenburn) and [pi-tokenburn](https://github.com/sorinirimies/pi-tokenburn)
read it as the "pi squeeze" saving. When rtk ran the command, rtk logs its own part; this log holds only what
pi-squeeze cut after it. `"logSavings": false` in `squeeze.json` turns it off.

Outputs of at least `missedChars` characters (default 2000) that no compactor shortened go to
`<pi agent dir>/squeeze-missed.jsonl` as `{"ts","session","cwd","cmd","chars"}`: the commands worth a compactor next.
Content commands (`cat`, `jq`, `head`…) are never logged. `"logMissed": false` turns it off.

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
