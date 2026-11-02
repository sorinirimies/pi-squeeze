---
name: pi-squeeze-rules
description: Rules for work in the pi-squeeze repository that the code can't show: constraints, ownership and must-keep behaviour. Use before changing, fixing, reviewing or extending code here, together with the typescript-in-projects skill.
---

# pi-squeeze: rules the code can't show

Hard constraints for this repository. The general conventions (orientation, tests,
scripting, releasing) are in the `typescript-in-projects` skill; this file holds only what is
specific to pi-squeeze.

* **Compaction only**, in `tool_result`, `bash` only. The optional rtk layer rewrites
  in `tool_call` and never touches file reads; native git compactors win over rtk
  (`handles()`).
* **`KINDS` is the single source of truth** for compactor names (settings, `/squeeze`,
  completions, README).
* **Content sniffers** (`SNIFFERS`) recognise output whatever command made it; a new
  compactor gets a sniffer when its output is unambiguous.
* **`rg` without `-n`** is grouped only when every `path:` prefix is a real file under
  `ctx.cwd` (`fileIn`), at most 500 distinct lookups; never after `cd`.
* **Output pi truncated** (`details.truncation`) is compacted from the full output pi
  saved (`details.fullOutputPath`, read back up to 16 MB), and the result must be
  shorter than the tail pi would show.
* **Failed runs** are compacted only for `tests`, `build`, `lint`, `install` and
  `logs` (a crash's stack trace); `FAILED_OK` holds the list.
* **Fixtures from private repos are anonymised** (paths to `/home/dev/…`, company
  packages and module names replaced); personal device output (logcat, getprop, ps)
  is reduced to system entries.
* New compactor ⇒ a fixture from the real tool, a router test, a fuzz entry in
  "compactors never throw" (or its Android/JVM sibling), a README table row.
