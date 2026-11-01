# pi-squeeze

[![npm](https://img.shields.io/npm/v/pi-squeeze.svg)](https://www.npmjs.com/package/pi-squeeze)
[![CI](https://github.com/sorinirimies/pi-squeeze/actions/workflows/ci.yml/badge.svg)](https://github.com/sorinirimies/pi-squeeze/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Squeezes tool output and steers commands to fast CLI tools, so the agent's context stays small: uses rtk when installed, native compactors otherwise.

A [pi](https://github.com/earendil-works/pi-coding-agent) extension.

## Install

```bash
pi install npm:pi-squeeze
```

## Use

`/squeeze <name>` says hello (sample command: replace it).

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
