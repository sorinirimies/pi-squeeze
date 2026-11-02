import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compactAudit } from "../extensions/core/audit.ts";
import { compact, handles } from "../extensions/core/compact.ts";
import { compactGradle } from "../extensions/core/gradle.ts";
import { compactBunTest, compactGoTest } from "../extensions/core/runners.ts";
import { compactRustc } from "../extensions/core/rustc.ts";
import { compactTree } from "../extensions/core/tree.ts";
import { compactTsc } from "../extensions/core/tsc.ts";

const fx = (n: string) => readFileSync(join(import.meta.dir, "fixtures", n), "utf8");
const small = { minChars: 100 };

describe("rustc diagnostics (cargo build / check / clippy)", () => {
	test("warnings shrink to one line each, grouped by lint; the summary stays", () => {
		const r = compactRustc(fx("cargo-clippy.txt"))!;
		expect(r.text.length).toBeLessThan(fx("cargo-clippy.txt").length * 0.3);
		const lines = r.text.split("\n");
		expect(lines[0]).toBe("0 errors, 9 warnings");
		expect(lines).toContain("clippy::needless_return (2)");
		expect(lines).toContain("  src/lib.rs:2:55 unneeded `return` statement");
		expect(r.text).toContain("→ try removing the `clone` call: `y`");
		expect(r.text).toContain("warning: `warn` (lib) generated 9 warnings");
		expect(r.text).not.toMatch(/Checking|Finished|^\s+\|/m);
	});

	test("errors keep their whole block, warnings follow", () => {
		const t = compactRustc(fx("cargo-build-err.txt"))!.text;
		expect(t.split("\n")[0]).toBe("2 errors, 2 warnings");
		expect(t).toContain("error[E0308]: mismatched types\n --> src/lib.rs:8:39\n  |\n8 | pub fn broken()");
		expect(t).toContain("error: could not compile `warn` (lib)");
		expect(t.indexOf("error[E0425]")).toBeLessThan(t.indexOf("unused_imports (1)"));
	});

	test("singular counts; a repeated warning (lib and test target) is listed once", () => {
		const w = ["warning: unused variable: `x`", " --> src/a.rs:1:1", "  |", "  = note: `#[warn(unused_variables)]` on by default"].join("\n");
		expect(compactRustc(`${w}\n\n${w}\n`)!.text).toBe("0 errors, 1 warning\nunused_variables (1)\n  src/a.rs:1:1 unused variable: `x`");
		const e = ["error: oops", " --> src/a.rs:2:2", "  |"].join("\n");
		expect(compactRustc(`${e}\n`)!.text).toBe("1 error, 0 warnings\n\nerror: oops\n --> src/a.rs:2:2\n  |");
	});

	test("an unnamed lint is `other`; deny and clippy index links are recognised", () => {
		const a = ["warning: something", " --> a.rs:1:1"].join("\n");
		const b = ["error: denied", " --> a.rs:2:2", "  = note: `#[deny(unsafe_code)]` on by default"].join("\n");
		expect(compactRustc(`${a}\n\n${b}\n`)!.text).toContain("other (1)");
	});

	test("a long error is cut, many warnings per lint are cut, long lines are cut", () => {
		const body = [`  | ${"z".repeat(100)}`, ...Array.from({ length: 59 }, (_, i) => `  | line ${i}`)];
		const e = ["error[E0001]: big", " --> a.rs:1:1", ...body].join("\n");
		const warns = Array.from({ length: 30 }, (_, i) => ["warning: dead", ` --> f${i}.rs:1:1`, "  = note: `#[warn(dead_code)]` on by default"].join("\n")).join("\n\n");
		const r = compactRustc(`${e}\n\n${warns}\n`, { lineChars: 40, perGroup: 5, total: 250 })!;
		expect(r.truncated).toBe(true);
		expect(r.text).toContain("… [+22 more lines]");
		expect(r.text).toContain("… [+25 more]");
		expect(r.text).toMatch(/… \[\+\d+ chars\]/);
	});

	test("no diagnostics means it is not a build log", () => {
		expect(compactRustc("")).toBeUndefined();
		expect(compactRustc("   Compiling a v1\n    Finished `dev` profile\n")).toBeUndefined();
	});

	test("the result total is capped", () => {
		const warns = Array.from({ length: 80 }, (_, i) => ["warning: w" + i, ` --> f${i}.rs:1:1`, `  = note: \`#[warn(lint${i})]\``].join("\n")).join("\n\n");
		expect(compactRustc(warns, { lineChars: 240, perGroup: 15, total: 20 })!.truncated).toBe(true);
	});
});

describe("tsc", () => {
	test("errors grouped by file with short positions", () => {
		const r = compactTsc(fx("tsc.txt"))!;
		const lines = r.text.split("\n");
		expect(lines[0]).toBe("tsc: 16 errors in 2 files");
		expect(lines[1]).toBe("a.ts (8)");
		expect(lines[2]).toBe("  1:7 TS2322 Type 'string' is not assignable to type 'number'.");
		expect(r.truncated).toBe(false);
	});

	test("continuation lines stay with their error; warnings and the Found footer", () => {
		const raw = ["src/a.ts(3,1): error TS2322: Type 'A' is not assignable to type 'B'.", "  Types of property 'x' are incompatible.", "    Type 'string' is not assignable to type 'number'.", "src/b.ts(1,1): warning TS6133: 'x' is declared but never used.", "", "Found 2 errors in 2 files.", ""].join("\n");
		expect(compactTsc(raw)!.text).toBe(["tsc: 2 errors in 2 files", "src/a.ts (1)", "  3:1 TS2322 Type 'A' is not assignable to type 'B'.", "    Types of property 'x' are incompatible.", "    Type 'string' is not assignable to type 'number'.", "src/b.ts (1)", "  1:1 warning TS6133 'x' is declared but never used.", "", "Found 2 errors in 2 files."].join("\n"));
		expect(compactTsc("a.ts(1,1): error TS1: x\n")!.text.startsWith("tsc: 1 error in 1 file")).toBe(true);
	});

	test("many errors in a file are cut; the pretty format and other text pass through", () => {
		const raw = Array.from({ length: 50 }, (_, i) => `a.ts(${i + 1},1): error TS1: e${i}`).join("\n");
		const r = compactTsc(raw, { lineChars: 240, perGroup: 5, total: 250 })!;
		expect(r.truncated).toBe(true);
		expect(r.text).toContain("… [+40 more lines]");
		expect(compactTsc("a.ts:1:1 - error TS1: x\n")).toBeUndefined();
		expect(compactTsc("")).toBeUndefined();
		expect(compactTsc("Found 1 error.\n")).toBeUndefined();
	});

	test("the total is capped", () => {
		const raw = Array.from({ length: 40 }, (_, i) => `f${i}.ts(1,1): error TS1: e`).join("\n");
		expect(compactTsc(raw, { lineChars: 240, perGroup: 15, total: 20 })!.truncated).toBe(true);
	});
});

describe("gradle", () => {
	test("task lines become counts", () => {
		expect(compactGradle(fx("gradle-ok.txt"))!.text).toBe("gradle: 11 tasks (5 executed, 4 no-source, 2 up-to-date) ran: :compileJava :classes :jar :assemble :build\nBUILD SUCCESSFUL in 2s\n2 actionable tasks: 2 executed");
		expect(compactGradle(fx("gradle-uptodate.txt"))!.text).toBe("gradle: 11 tasks (7 up-to-date, 4 no-source)\nBUILD SUCCESSFUL in 272ms\n2 actionable tasks: 2 up-to-date");
	});

	test("a failure keeps the failed task, the compiler error and the cause; hints go", () => {
		const t = compactGradle(fx("gradle-fail.txt"))!.text;
		expect(t).toContain("> Task :compileJava FAILED");
		expect(t).toContain("error: incompatible types: String cannot be converted to int");
		expect(t).toContain("* What went wrong:");
		expect(t).toContain("BUILD FAILED in 312ms");
		expect(t).not.toMatch(/--scan|Develocity/);
		expect(t.split("\n")[0]).toBe("gradle: 1 tasks ()");
	});

	test("daemon and configuration-cache noise goes; long lists of executed tasks are cut", () => {
		const tasks = Array.from({ length: 20 }, (_, i) => `> Task :m${i}:compile`);
		const raw = ["Starting a Gradle Daemon (subsequent builds will be faster)", "Calculating task graph as no cached configuration is available for tasks: build", "Configuration cache entry stored.", ...tasks, "", "BUILD SUCCESSFUL in 1s"].join("\n");
		const t = compactGradle(raw)!.text.split("\n");
		expect(t[0]).toContain("… +8");
		expect(t).toHaveLength(2);
	});

	test("Kotlin warnings are grouped by message; errors stay one per line and lose the shared directory", () => {
		const raw = ["> Task :app:compileKotlin", "w: file:///work/app/src/main/A.kt:3:5 Unused variable", "w: file:///work/app/src/main/b/B.kt:9:1 Unused variable", "w: [ksp] /work/app/src/main/b/D.kt:2: Deprecated", "e: file:///work/app/src/main/b/C.kt:1:1 Boom", "e: file:///work/app/src/main/E.kt:2:2 Bang", "BUILD FAILED in 1s", ""].join("\n");
		const t = compactGradle(raw)!.text.split("\n");
		expect(t).toContain("kotlin: 3 warnings in 3 files (under /work/app/src/main/)");
		expect(t).toContain("warning Unused variable (2)");
		expect(t).toContain("  A.kt:3:5 b/B.kt:9:1");
		expect(t).toContain("warning Deprecated  b/D.kt:2");
		expect(t).toContain("e: …/b/C.kt:1:1 Boom");
		expect(t).toContain("e: …/E.kt:2:2 Bang");
		const single = compactGradle("> Task :x\ne: /a/b/C.kt:1:1 one\nBUILD SUCCESSFUL in 1s")!.text;
		expect(single).toContain("e: /a/b/C.kt:1:1 one");
		const nodir = compactGradle("> Task :x\ne: /A.kt:1:1 one\ne: /B.kt:1:1 two\nBUILD SUCCESSFUL in 1s")!.text;
		expect(nodir).toContain("e: /A.kt:1:1 one");
		const url = compactGradle("> Task :x\ne: /a/b/C.kt:1:1 one\nsent to https://otlp.example.net:443/v1 ok\nBUILD SUCCESSFUL in 1s")!.text;
		expect(url).toContain("e: /a/b/C.kt:1:1 one");
	});

	test("long lines are cut, the total is capped, other text passes through", () => {
		const raw = ["> Task :x", ...Array.from({ length: 40 }, (_, i) => `line ${i} ${"y".repeat(100)}`), "BUILD FAILED in 1s"].join("\n");
		const r = compactGradle(raw, { lineChars: 30, perGroup: 15, total: 20 })!;
		expect(r.truncated).toBe(true);
		expect(compactGradle("")).toBeUndefined();
		expect(compactGradle("> Task :x\nno result line")).toBeUndefined();
	});
});

describe("bun test and go test", () => {
	test("bun: passing tests are not listed, failures are", () => {
		const ok = compactBunTest(fx("bun-test-ok.txt"))!.text;
		expect(ok).toBe("bun test v1.3.14 (0d9b296a)\n\n 60 pass\n 0 fail\n 60 expect() calls\nRan 60 tests across 2 files. [8.00ms]");
		const t = compactBunTest(fx("bun-test-fail.txt"))!.text;
		expect(t).toContain("(fail) math > fails one");
		expect(t).toContain("error: boom");
		expect(t).not.toContain("(pass)");
		expect(t).toContain("b.test.ts:");
		expect(compactBunTest("nothing")).toBeUndefined();
		expect(compactBunTest("")).toBeUndefined();
	});

	test("bun: a header with nothing under it goes, one with a failure stays", () => {
		const raw = ["a.test.ts:", "(pass) x", "", "b.test.ts:", "(pass) y", "(fail) z", "", "c.test.ts:", "(pass) q", "", "Ran 4 tests across 3 files."].join("\n");
		expect(compactBunTest(raw)!.text).toBe("b.test.ts:\n(fail) z\n\nRan 4 tests across 3 files.");
	});

	test("go: counts, failures kept; run/pass noise dropped", () => {
		const v = compactGoTest(fx("go-test-v.txt"))!.text;
		expect(v.split("\n")[0]).toBe("go test: 0 ok, 1 failed");
		expect(v).not.toMatch(/=== RUN|--- PASS/);
		expect(v).toContain("--- FAIL: TestB");
		const many = ["ok  \tp/a\t0.1s", "ok  \tp/b\t(cached)", "?   \tp/c\t[no test files]", "FAIL\tp/d [build failed]", "PASS"].join("\n");
		expect(compactGoTest(many)!.text).toBe("go test: 2 ok, 0 failed, 1 without tests\nFAIL\tp/d [build failed]".replace("0 failed", "0 failed"));
		expect(compactGoTest("ok  \tp/a\t0.1s\n")!.text).toBe("go test: 1 ok, 0 failed");
		expect(compactGoTest("FAIL\n")).toBeUndefined();
		expect(compactGoTest("")).toBeUndefined();
	});
});

describe("tree", () => {
	test("deep levels are cut with a marker", () => {
		const raw = fx("cargo-tree.txt");
		const r = compactTree(raw)!;
		expect(r.text.length).toBeLessThan(raw.length * 0.6);
		expect(r.truncated).toBe(true);
		expect(r.text).toMatch(/… \[\+\d+ lines? deeper\]/);
		expect(r.text.split("\n")[0]).toMatch(/^tui-spinner v/);
		expect(r.text).not.toContain("[build-dependencies]\n            …");
	});

	test("a shallow tree is left alone; a cut of one line is not worth a marker; long lines are cut", () => {
		const shallow = ["root", "├── a", "├── b", "├── c", "└── d"].join("\n");
		expect(compactTree(shallow)).toBeUndefined();
		const one = ["root", "├── a", "│   ├── b", "│   │   ├── c", "│   │   │   └── d", "└── e"].join("\n");
		expect(compactTree(one)).toBeUndefined();
		const deep = ["root", "├── a", "│   ├── b", "│   │   ├── c", "│   │   │   ├── d", "│   │   │   │   └── d2", "│   │   │   [build-dependencies]", "└── e"].join("\n");
		expect(compactTree(deep)!.text).toBe(["root", "├── a", "│   ├── b", "│   │   ├── c", "            … [+3 lines deeper]", "└── e"].join("\n"));
		const long = ["root", "├── " + "x".repeat(300), "├── b", "│   └── c", "│   │   └── d", "│   │   │   └── e", "│   │   │   └── " + "y".repeat(300), "│   │   │   │   └── z", "└── f"].join("\n");
		expect(compactTree(long, { lineChars: 40, perGroup: 15, total: 250 })!.text).toContain("[+264 chars]");
		const cutOne = ["root", "├── a", "│   ├── b", "│   │   ├── c", "│   │   │   └── " + "y".repeat(300), "├── e", "├── f"].join("\n");
		expect(compactTree(cutOne, { lineChars: 40, perGroup: 15, total: 250 })).toBeUndefined();
		expect(compactTree("a\nb")).toBeUndefined();
		expect(compactTree("a\nb\nc\nd\ne\nf")).toBeUndefined();
	});
});

describe("cargo audit", () => {
	test("one line per advisory", () => {
		const raw = fx("cargo-audit.txt");
		const r = compactAudit(raw)!;
		expect(r.text.length).toBeLessThan(raw.length * 0.5);
		const lines = r.text.split("\n");
		expect(lines[0]).toMatch(/^Scanning Cargo.lock/);
		expect(lines[1]).toBe("19 advisories");
		expect(lines[2]).toBe("RUSTSEC-2025-0052 async-std 1.13.2 unmaintained: async-std has been discontinued");
		expect(lines.at(-1)).toBe("warning: 19 allowed warnings found");
	});

	test("a vulnerability keeps its fix; the dependency tree is dropped", () => {
		const raw = ["Crate:     openssl", "Version:   0.10.1", "Title:     Bad", "Date:      2024-01-01", "ID:        RUSTSEC-2024-1", "URL:       https://x", "Severity:  7.5 (high)", "Solution:  Upgrade to >=0.10.2", "Dependency tree:", "openssl 0.10.1", "└── app 1.0.0", "", "error: 1 vulnerability found!", ""].join("\n");
		expect(compactAudit(raw)!.text).toBe("1 advisories\nRUSTSEC-2024-1 openssl 0.10.1 vulnerability (7.5 (high)): Bad  (fix: Upgrade to >=0.10.2)\nerror: 1 vulnerability found!");
		const plain = "Crate:     a\nID:        X-1\n\n";
		expect(compactAudit(plain)!.text).toBe("1 advisories\nX-1 a  vulnerability: ");
	});

	test("anything unexpected passes through", () => {
		expect(compactAudit("")).toBeUndefined();
		expect(compactAudit("just text\n")).toBeUndefined();
		expect(compactAudit("Crate:     a\nVersion:   1\n\n")).toBeUndefined(); // no ID
		expect(compactAudit("Crate:     a\nID: X\nweird line without a field\n")).toBeUndefined();
		expect(compactAudit("Crate:     a\nVersion: 1\nCrate:     b\nID: X\n")).toBeUndefined();
	});
});

describe("router: build, tests, tree, sniffing, failed runs", () => {
	test("commands pick their compactor", () => {
		expect(compact("cargo clippy --all-targets", fx("cargo-clippy.txt"), small)!.kind).toBe("build");
		expect(compact("cargo build", fx("cargo-build-err.txt"), small)!.kind).toBe("build");
		expect(compact("cargo audit", fx("cargo-audit.txt"), small)!.kind).toBe("build");
		expect(compact("cargo tree", fx("cargo-tree.txt"), small)!.kind).toBe("tree");
		expect(compact("cargo +nightly tree", fx("cargo-tree.txt"), small)!.kind).toBe("tree");
		expect(compact("cargo +nightly", fx("cargo-tree.txt"), small)?.kind).not.toBe("tree");
		expect(compact("tree -L 4", fx("cargo-tree.txt"), small)!.kind).toBe("tree");
		expect(compact("eza --tree", fx("cargo-tree.txt"), small)!.kind).toBe("tree");
		expect(compact("npx tsc --noEmit", fx("tsc.txt"), small)!.kind).toBe("build");
		expect(compact("tsc -p .", fx("tsc.txt"), small)!.kind).toBe("build");
		expect(compact("./gradlew build", fx("gradle-ok.txt"), small)!.kind).toBe("build");
		expect(compact("bun test", fx("bun-test-fail.txt"), small)!.kind).toBe("tests");
		expect(compact("go test ./...", fx("go-test-v.txt"), { minChars: 50, maxRatio: 1 })!.kind).toBe("tests");
		expect(compact("cargo tree", fx("cargo-tree.txt"), { ...small, kinds: { tree: false } })?.kind).not.toBe("tree");
	});

	test("flags that change the format are skipped", () => {
		for (const c of ["cargo build --message-format json", "cargo tree --prefix none", "cargo tree --format {p}", "eza --tree --json", "tree -J", "go test -json ./..."]) expect(compact(c, fx("cargo-tree.txt"), small)?.kind).not.toBe("tree");
		expect(compact("cargo fmt", fx("cargo-clippy.txt"), small)?.kind).toBe("build"); // recognised by its output instead
		expect(handles("cargo fmt")).toBe(false);
	});

	test("the output is recognised whatever ran it: pipes, just, npm, 2>&1", () => {
		expect(compact("just check", fx("tsc.txt"), small)!.kind).toBe("build");
		expect(compact("npm run typecheck 2>&1", fx("tsc.txt"), small)!.kind).toBe("build");
		expect(compact("bun run build", fx("gradle-ok.txt"), small)!.kind).toBe("build");
		expect(compact("make test", fx("bun-test-fail.txt"), small)!.kind).toBe("tests");
		expect(compact("make test", fx("go-test-v.txt"), { minChars: 50, maxRatio: 1 })!.kind).toBe("tests");
		expect(compact("just lint", fx("cargo-clippy.txt"), small)!.kind).toBe("build");
		expect(compact("cargo audit 2>&1", fx("cargo-audit.txt"), small)!.kind).toBe("build");
		expect(compact("just deny", fx("cargo-audit.txt"), { ...small, kinds: { build: false } })).toBeUndefined();
	});

	test("a failed run is compacted for build and test output only", () => {
		expect(compact("just check", fx("cargo-build-err.txt"), { ...small, failed: true })!.kind).toBe("build");
		expect(compact("cargo build", fx("cargo-build-err.txt"), { ...small, failed: true })!.kind).toBe("build");
		expect(compact("cat x", fx("cargo-build-err.txt"), { ...small, failed: true })).toBeUndefined();
		expect(compact("rg -n x", fx("rg-flat.txt"), { failed: true })).toBeUndefined();
	});
});
