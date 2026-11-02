# Changelog

Generated from [Conventional Commits](https://www.conventionalcommits.org) by
[git-cliff](https://git-cliff.org). Do not edit by hand.

## [0.2.0](https://github.com/sorinirimies/pi-squeeze/releases/tag/v0.2.0) — 2026-11-02


### ✨ Features

- Compactors for package installs, pytest, jest/vitest, linters, logs, docker build, xcodebuild/swift and Android (gradle, adb); look through a trailing | tail / | head ([`3a1d262`](https://github.com/sorinirimies/pi-squeeze/commit/3a1d2626f37f632e5df19cafdd244aa63c1497f7))
- Android, Maven and JVM compactors: Android Lint, detekt, Kotlin/KSP warnings, R8, AAPT, gradle tasks/projects/insight reports, mvn, javac, stack traces, adb uiautomator/getprop/ps/top/dumpsys; compact pi-truncated output from its full log ([`9d11dff`](https://github.com/sorinirimies/pi-squeeze/commit/9d11dffe61c9aa1c431a025d67cd03fc0b354661))

### 🧪 Tests

- Anonymise the remaining fixtures ([`0b303d1`](https://github.com/sorinirimies/pi-squeeze/commit/0b303d1a5f8919f4e3fb7cdfa309939fa5ea640f))
## [0.1.0](https://github.com/sorinirimies/pi-squeeze/releases/tag/v0.1.0) — 2026-11-02


### ✨ Features

- Initial project scaffold ([`a3c3ae0`](https://github.com/sorinirimies/pi-squeeze/commit/a3c3ae074afe90539386bea1f38214674a229fd0))
- Compact rg, fd/find and lsd output ([`937f8c3`](https://github.com/sorinirimies/pi-squeeze/commit/937f8c3847ea03bd518d9ff751572d95a1d08628))
- Persisted settings, per-compactor switches, status line and README test ([`2bb0850`](https://github.com/sorinirimies/pi-squeeze/commit/2bb08506f0b4b2e767b950698d9dcbf14b3b512f))
- Optional rtk layer rewrites git, cargo, docker and friends through rtk ([`0f4a9be`](https://github.com/sorinirimies/pi-squeeze/commit/0f4a9bef2088ab7f5f1da0b87bdf2537ead6168a))
- Compact git diff and cargo test output, also for failed test runs ([`b575b33`](https://github.com/sorinirimies/pi-squeeze/commit/b575b336ecd39014e2e6a6f888f6fd2c34cbf917))
- Compact git status, log, show, blame, file lists, dust and generic noise ([`833457a`](https://github.com/sorinirimies/pi-squeeze/commit/833457a52a97709cac8e7565ae881c8148531e00))
- Compact cargo build/clippy/audit/tree, tsc, gradle, bun test, go test and tree output; recognise build and test output by content; compact failed builds ([`11ff42d`](https://github.com/sorinirimies/pi-squeeze/commit/11ff42d2ea9790a2c42fb9e4c2895c59bca148e1))
- Compact ls -l and eza -l listings; see through git -C/--no-pager, --color=never and cargo +toolchain ([`8533405`](https://github.com/sorinirimies/pi-squeeze/commit/8533405306f48b8b5b6f7567932a4f6ab2c23ce2))
- Group rg and grep -r output without line numbers when every path is a real file ([`cc6b18f`](https://github.com/sorinirimies/pi-squeeze/commit/cc6b18fbd745518dde6828aec5bb908dace3de3e))

### 🐛 Fixes

- **ci:** Quote the --json field list so gh gets one argument ([`8a8a5d5`](https://github.com/sorinirimies/pi-squeeze/commit/8a8a5d56c424284cd096603d8b848d2a3addef21))

### 📚 Docs

- **changelog:** Generate ([`acbb069`](https://github.com/sorinirimies/pi-squeeze/commit/acbb069a884e0dd58bbea5c5450758ff604950cb))
- **readme:** Add the Audit and Fuzz badges ([`57e031d`](https://github.com/sorinirimies/pi-squeeze/commit/57e031dfca063df67870d49e59bf9434d220f81a))
- **readme:** Keep every documented command valid ([`01a1cb8`](https://github.com/sorinirimies/pi-squeeze/commit/01a1cb8e2f34d090429f0295522b729919329790))
- Describe what pi-squeeze does in package.json and README ([`5ddd50e`](https://github.com/sorinirimies/pi-squeeze/commit/5ddd50ede5c7e2cd98e322c945ce526ed59f0b60))

### 🔧 Build & CI

- **deps:** Bump taiki-e/install-action from 2.87.32 to 2.88.0 (#1) ([`5f532f7`](https://github.com/sorinirimies/pi-squeeze/commit/5f532f747210109886ff6a3ba6d517cd3a0e8fca))
- Cut a release from the Release workflow (bump, changelog, tag, push, publish) ([`6715110`](https://github.com/sorinirimies/pi-squeeze/commit/6715110abf4afed025a36fa015af17ff15a02dec))

### 🧹 Chores

- Ignore .codegraph index ([`17f93a4`](https://github.com/sorinirimies/pi-squeeze/commit/17f93a4952891d09bfba69f11f9950cf218245ca))

### Style

- Keep package.json formatting ([`523f8d6`](https://github.com/sorinirimies/pi-squeeze/commit/523f8d6eb71c1f20360620e5d7ddfbe42ebc6a00))

