import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compactPackages } from "../extensions/core/adb.ts";
import { compact, handles, unpipe } from "../extensions/core/compact.ts";
import { compactDockerBuild } from "../extensions/core/docker.ts";
import { compactGradle, compactGradleDeps } from "../extensions/core/gradle.ts";
import { compactInstall } from "../extensions/core/install.ts";
import { compactJest } from "../extensions/core/jest.ts";
import { compactLint, compactLintSniffed, parseDart, parseLocated } from "../extensions/core/lint.ts";
import { compactLogs, foldFrames, shape } from "../extensions/core/logs.ts";
import { compactPytest } from "../extensions/core/pytest.ts";
import { compactTree } from "../extensions/core/tree.ts";
import { compactXcode } from "../extensions/core/xcode.ts";

const fx = (n: string) => readFileSync(join(import.meta.dir, "fixtures", n), "utf8");
const small = { minChars: 100 };
const ratio = (a: string, b: string) => a.length / b.length;

describe("package installs", () => {
	test("npm: deprecations become one list of names, funding and audit advice go, the result stays", () => {
		const r = compactInstall(fx("npm-install.txt"))!;
		expect(r.text.split("\n")[0]).toBe("npm warn deprecated (4): har-validator@5.1.5, uuid@3.4.0, left-pad@1.3.0, request@2.88.2");
		expect(r.text).toContain("added 49 packages, and audited 50 packages in 2s");
		expect(r.text).toContain("6 vulnerabilities (3 moderate, 1 high, 2 critical)");
		expect(r.text).not.toMatch(/funding|npm audit fix|different dependency/);
		expect(r.truncated).toBe(true);
	});

	test("pip: Collecting and download lines become one line; the installed list and errors stay", () => {
		const t = compactInstall(fx("pip-install.txt"))!.text;
		expect(t).toMatch(/^Collecting \(9\): requests==2\.31\.0, rich, /);
		expect(t).toContain("Successfully installed certifi-2026.10.23");
		expect(t).not.toMatch(/Downloading|Installing collected|pip version|consider upgrading/);
		expect(compactInstall(fx("pip-install-satisfied.txt"))!.text).toMatch(/^Requirement already satisfied \(5\): requests==2\.31\.0, /);
	});

	test("bun, uv, pnpm, pods and pub lines; long lists are cut; progress keeps its last frame", () => {
		expect(compactInstall(fx("bun-install.txt"))!.text).toBe("installed (3): zod@4.6.7, lodash@4.18.1, react@19.3.1\n\n3 packages installed [432.00ms]");
		const uv = ["Resolved 12 packages in 3ms", "Prepared 2 packages in 20ms", "Installed 2 packages in 4ms", " + idna==3.7", " + requests==2.32.3", " - urllib3==1.0", "Uninstalled 1 package in 1ms"].join("\n");
		expect(compactInstall(uv)!.text).toBe("Installed 2 packages in 4ms\n+ (2): idna==3.7, requests==2.32.3\n- (1): urllib3==1.0");
		const pnpm = ["Progress: resolved 10, reused 9, downloaded 1, added 10, done", " WARN  deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported", "Packages: +10", "++++++++++", "+ zod 3.23.8", "Done in 1.2s"].join("\n");
		expect(compactInstall(pnpm)!.text).toBe("pnpm WARN deprecated (1): glob@7.2.3\n+ (1): zod 3.23.8");
		const pods = ["Analyzing dependencies", "Downloading dependencies", "Installing Alamofire (5.9.1)", "Using SnapKit (5.7.1)", "Generating Pods project", "Pod installation complete! There are 2 dependencies from the Podfile and 2 total pods installed."].join("\n");
		expect(compactInstall(pods)!.text).toBe("Installing (1): Alamofire 5.9.1\nUsing (1): SnapKit 5.7.1\nPod installation complete! There are 2 dependencies from the Podfile and 2 total pods installed.");
		const bundler = ["Fetching gem metadata from https://rubygems.org/.", "Resolving dependencies...", "Using rake 13.0.6", "Fetching fastlane 2.220.0", "Installing fastlane 2.220.0", "Installing nokogiri 1.16.0 with native extensions", "Bundle complete! 2 Gemfile dependencies, 80 gems now installed."].join("\n");
		expect(compactInstall(bundler)!.text).toBe("Using (1): rake 13.0.6\nFetching (1): fastlane 2.220.0\nInstalling (2): fastlane 2.220.0, nokogiri 1.16.0\nBundle complete! 2 Gemfile dependencies, 80 gems now installed.");
		const pub = ["Resolving dependencies...", "Downloading packages...", "  async 2.11.0 (2.12.0 available)", "Got dependencies!"].join("\n");
		expect(compactInstall(pub)!.text).toBe("newer versions available (1): async 2.11.0→2.12.0");
		const many = Array.from({ length: 20 }, (_, i) => `Collecting p${i}`).join("\n");
		expect(compactInstall(many)!.text).toBe(`Collecting (20): ${Array.from({ length: 12 }, (_, i) => `p${i}`).join(", ")}, … +8`);
		expect(compactInstall("  Downloading x.whl (1 MB)\r  ━━━━ 1.0/1.0 MB 3 MB/s eta 0:00:00\r\nok")!.text).toBe("ok");
		expect(compactInstall("nothing to see\nhere")).toBeUndefined();
		const yarn = ["yarn install v1.22.22", "[1/4] Resolving packages...", "warning request > har-validator@5.1.5: this library is no longer supported, deprecated", "", "", "error Something broke"].join("\n");
		expect(compactInstall(yarn)!.text).toBe("yarn warning deprecated (1): request > har-validator@5.1.5\n\nerror Something broke");
	});
});

describe("pytest", () => {
	test("header, progress and PASSED lines go; failures, warnings and the summary stay", () => {
		const raw = fx("pytest-v.txt");
		const r = compactPytest(raw)!;
		expect(ratio(r.text, raw)).toBeLessThan(0.3);
		const lines = r.text.split("\n");
		expect(lines[0]).toBe("pytest: 2 failed, 32 passed, 1 skipped, 1 warning in 0.03s");
		expect(lines).toContain("test_a.py::test_fail FAILED");
		expect(lines).toContain("== FAILURES ==");
		expect(lines).toContain("__ test_fail __");
		expect(r.text).toContain("FAILED test_a.py::test_err - ValueError: boom");
		expect(r.text).not.toMatch(/PASSED|rootdir|platform darwin|collected/);
		expect(compactPytest(fx("pytest-fail.txt"))!.text).not.toContain("test_a.py ....");
	});

	test("no result line, no pytest", () => {
		expect(compactPytest("collected 3 items\ntest_a.py ...")).toBeUndefined();
	});
});

describe("jest and vitest", () => {
	test("vitest: passing tests go, skipped ones are counted, failures and totals stay", () => {
		const raw = fx("vitest-verbose.txt");
		const r = compactJest(raw)!;
		expect(ratio(r.text, raw)).toBeLessThan(0.7);
		expect(r.text).not.toContain("✓");
		expect(r.text).toContain("× src/m.test.js > math > fails");
		expect(r.text).toContain("⎯⎯ Failed Tests 2 ⎯⎯");
		expect(r.text).toContain("Tests  2 failed | 26 passed | 1 skipped (29)");
		expect(r.text.split("\n").at(-1)).toBe("(1 skipped not listed)");
	});

	test("jest: PASS lines and verbose ticks go", () => {
		const raw = ["PASS src/b.test.js", "  ✓ b ok (1 ms)", fx("jest-fail.txt"), "    ○ skipped later"].join("\n");
		const t = compactJest(raw)!.text;
		expect(t).not.toMatch(/PASS|✓|Snapshots|Ran all/);
		expect(t).toContain("● math › fails");
		expect(t).toContain("Tests:       1 failed, 1 skipped, 26 passed, 28 total");
		expect(compactJest("no totals here")).toBeUndefined();
	});
});

describe("linters", () => {
	test("eslint: grouped by rule and message, the shared directory said once", () => {
		const raw = fx("eslint.txt");
		const r = compactLint(raw)!;
		expect(ratio(r.text, raw)).toBeLessThan(0.45);
		const lines = r.text.split("\n");
		expect(lines[0]).toBe("eslint: 20 errors, 5 warnings in 5 files (under /private/tmp/sqfx/js/src/)");
		expect(lines).toContain("error eqeqeq: Expected '===' and instead saw '==' (5)");
		expect(lines).toContain("  m.js:2:46 m1.js:2:47 m2.js:2:47 m3.js:2:47 m4.js:2:47");
		expect(r.text).toContain("✖ 25 problems (20 errors, 5 warnings)");
		expect(r.truncated).toBe(false);
		expect(compactLintSniffed(raw)!.text).toBe(r.text);
	});

	test("biome and ruff: frames and fixes go, one entry per finding", () => {
		const biome = compactLint(fx("biome.txt"))!;
		expect(ratio(biome.text, fx("biome.txt"))).toBeLessThan(0.15);
		expect(biome.text).toContain("error lint/suspicious/noDebugger: This is an unexpected use of the debugger statement. (2)");
		expect(biome.text).toContain("Found 34 errors.");
		expect(biome.truncated).toBe(true);
		const ruff = compactLint(fx("ruff.txt"))!;
		expect(ruff.text.split("\n")[0]).toBe("ruff: 69 findings in 4 files");
		expect(ruff.text).toContain("D103: Missing docstring in public function (9)");
		expect(ruff.text).toContain("Found 69 errors.");
		const concise = compactLint(fx("ruff-concise.txt"))!;
		expect(concise.text.split("\n")[0]).toBe("lint: 69 findings in 4 files");
		expect(concise.text).toContain("F401: `os` imported but unused (2)");
	});

	test("one-line formats: mypy, pylint, ktlint, swiftlint, detekt", () => {
		const lines = [
			"************* Module a",
			"a.py:1:0: C0114: Missing module docstring (missing-module-docstring)",
			"a.py:3: error: Incompatible types in assignment  [assignment]",
			"/w/A.kt:1:1: Wildcard import (standard:no-wildcard-imports)",
			"/w/B.swift:2:5: warning: Line Length Violation: Line too long (line_length)",
			"x.kt:4:9: Private property `unused` is unused. [UnusedPrivateProperty]",
			"x.kt:5:1: something plain",
			"Summary error count (descending) by rule:",
			"  standard:no-wildcard-imports: 1",
			"Found 2 errors in 1 file (checked 3 source files)",
		];
		const p = parseLocated(lines)!;
		expect(p.diags.map((d) => d.rule)).toEqual(["C0114", "assignment", "standard:no-wildcard-imports", "line_length", "UnusedPrivateProperty", undefined]);
		expect(p.diags[3]!.severity).toBe("warning");
		expect(p.notes).toHaveLength(4);
		expect(parseLocated(["a.py:1:1: x", "something else"])).toBeUndefined();
		expect(parseLocated(["Found 0 errors"])).toBeUndefined();
	});

	test("flutter analyze; long location lists are wrapped and cut; the total is capped", () => {
		const dart = ["Analyzing app...", "  info • Prefer const • lib/a.dart:3:5 • prefer_const_constructors", "warning • Unused import • lib/b.dart:1:8 • unused_import", "2 issues found. (ran in 1.2s)"];
		expect(parseDart(dart)!.diags).toHaveLength(2);
		expect(parseDart(["a", "b", "c", "d", "e", "  info • x • a.dart:1:1 • r"])).toBeUndefined();
		const t = compactLint(dart.join("\n"))!.text;
		expect(t).toContain("info prefer_const_constructors: Prefer const");
		const many = Array.from({ length: 40 }, (_, i) => `src/file${i}.ts:${i}:1: warning: same thing [rule]`).join("\n");
		const r = compactLint(many, { lineChars: 60, perGroup: 15, total: 250 })!;
		expect(r.text).toContain("… +10");
		expect(r.text.split("\n").every((l) => l.length <= 75)).toBe(true);
		expect(r.truncated).toBe(true);
		expect(compactLint(many, { lineChars: 240, perGroup: 15, total: 2 })!.truncated).toBe(true);
		expect(compactLint("plain text\nnothing")).toBeUndefined();
		expect(compactLintSniffed("a.py:1:1: E1 x")).toBeUndefined();
	});
});

describe("logs", () => {
	const logcat = (t: string, rest: string) => `11-02 01:36:${t}  1947  2690 ${rest}`;
	test("runs of similar lines keep their ends; logcat loses date and thread; framework frames fold", () => {
		const raw = [
			logcat("28.503", "D InetDiagMessage: Destroyed 0 sockets, proto=IPPROTO_TCP"),
			...Array.from({ length: 6 }, (_, i) => logcat(`28.5${10 + i}`, `D InetDiagMessage: Destroyed live tcp sockets for uids={1019${i}} in ${i}ms`)),
			logcat("29.000", "E AndroidRuntime: FATAL EXCEPTION: main"),
			logcat("29.000", "E AndroidRuntime: java.lang.IllegalStateException: boom"),
			logcat("29.000", "E AndroidRuntime: \tat com.example.app.Main.onCreate(Main.kt:12)"),
			logcat("29.000", "E AndroidRuntime: \tat android.app.Activity.performCreate(Activity.java:8000)"),
			logcat("29.000", "E AndroidRuntime: \tat android.app.Instrumentation.callActivityOnCreate(Instrumentation.java:1300)"),
			logcat("29.000", "E AndroidRuntime: \tat java.lang.reflect.Method.invoke(Native Method)"),
		].join("\n");
		const r = compactLogs(raw)!;
		const lines = r.text.split("\n");
		expect(lines[0]).toBe("01:36:28.503 1947 D InetDiagMessage: Destroyed 0 sockets, proto=IPPROTO_TCP");
		expect(lines[1]).toContain("uids={10190}");
		expect(lines[2]).toBe("  … [4 similar]");
		expect(lines).toContain("01:36:29.000 1947 E AndroidRuntime: \tat com.example.app.Main.onCreate(Main.kt:12)");
		expect(lines.at(-1)).toBe("01:36:29.000 1947 E AndroidRuntime: \t… 3 framework frames");
		expect(r.truncated).toBe(true);
	});

	test("two dates keep the date; the end of a long log is kept, not the start", () => {
		const raw = [logcat("01.000", "I A: one"), `11-03 01:00:00.000  1  2 I B: two`, "x", "y"].join("\n");
		expect(compactLogs(raw)!.text.split("\n")[0]).toBe("11-02 01:36:01.000 1947 I A: one");
		const long = Array.from({ length: 30 }, (_, i) => `line ${"abc".repeat(i)}`).join("\n");
		const r = compactLogs(long, { lineChars: 40, perGroup: 15, total: 10 })!;
		expect(r.text.split("\n")[0]).toBe("… [first 20 lines left out]");
		expect(r.text).toContain("line abcabc");
		expect(r.truncated).toBe(true);
		expect(compactLogs("a\nb\nc\nd")!.truncated).toBe(false);
		expect(compactLogs("a\nb")).toBeUndefined();
	});

	test("shape ignores timestamps and numbers; one framework frame is not folded", () => {
		expect(shape("2026-11-02T01:00:00Z GET /x 200 3ms")).toBe(shape("2026-11-02T01:00:09Z GET /x 200 18ms"));
		expect(shape("Nov  2 01:00:00 host app[12]: hi")).toBe(shape("Nov  2 01:00:05 host app[99]: hi"));
		expect(shape("web-1  | [01:00:00] ok")).toBe(shape("web-1  | [01:00:01] ok"));
		expect(foldFrames(["  at java.lang.Thread.run(Thread.java:1)", "x"])).toEqual({ lines: ["  at java.lang.Thread.run(Thread.java:1)", "x"], folded: false });
	});
});

describe("docker build", () => {
	test("BuildKit bookkeeping goes; steps keep their header and output", () => {
		const raw = fx("docker-build.txt");
		const r = compactDockerBuild(raw)!;
		expect(ratio(r.text, raw)).toBeLessThan(0.55);
		const lines = r.text.split("\n");
		expect(lines[0]).toBe("docker build: 5 steps, 1 cached");
		expect(lines).toContain("#6 [2/5] WORKDIR /app (cached)");
		expect(lines).toContain("   added 312 packages, and audited 313 packages in 4s");
		expect(r.text).toContain("ERROR: failed to solve");
		expect(r.text).not.toMatch(/internal|sha256:1a2b|DONE \d|transferring/);
	});

	test("a step header said twice is kept once; an internal error stays; the classic builder", () => {
		const raw = ["#1 [internal] load build definition from Dockerfile", "#1 ERROR: failed to read dockerfile", "#2 [1/2] RUN a", "#3 [2/2] RUN b", "#2 1.0 out a", "#2 [1/2] RUN a", "#2 error: x", "#2 something else"].join("\n");
		expect(compactDockerBuild(raw)!.text).toBe("docker build: 2 steps\n#1 ERROR: failed to read dockerfile\n#2 [1/2] RUN a\n#3 [2/2] RUN b\n   out a\n#2 error: x\n#2 something else");
		const classic = ["Sending build context to Docker daemon  2.048kB", "Step 1/2 : FROM alpine", " ---> 1d34ffeaf190", "Step 2/2 : RUN echo hi", " ---> Running in 5b1c", "hi", "Removing intermediate container 5b1c", "Successfully built 9e2c3a4b5d6f", "Successfully tagged x:latest"].join("\n");
		expect(compactDockerBuild(classic)!.text).toBe("Step 1/2 : FROM alpine\nStep 2/2 : RUN echo hi\nhi\nSuccessfully tagged x:latest");
		expect(compactDockerBuild("hello")).toBeUndefined();
	});
});

describe("xcodebuild and swift", () => {
	test("xcodebuild build: steps counted, warnings grouped, the result stays", () => {
		const raw = fx("xcodebuild-build.txt");
		const r = compactXcode(raw)!;
		expect(ratio(r.text, raw)).toBeLessThan(0.03);
		const lines = r.text.split("\n");
		expect(lines[0]).toMatch(/^build: \d+ steps \(15 SwiftCompile, 11 CreateBuildDirectory, /);
		expect(lines).toContain("** BUILD SUCCEEDED **");
		expect(lines).toContain("warning variable 'k' was never mutated; consider changing to 'let' constant [#VariableNeverMutated] (6)");
		expect(r.text).not.toMatch(/builtin-|\{ platform:|appintentsmetadataprocessor/);
		expect(r.truncated).toBe(true);
	});

	test("xcodebuild test: passes counted, failures and the failing tests list stay", () => {
		const t = compactXcode(fx("xcodebuild-test.txt"))!.text;
		expect(t).toContain("tests: 3 passed (not listed)");
		expect(t).toContain("Test Case '-[DemoTests.OldTests testB]' failed (0.534 seconds).");
		expect(t).toContain("✘ Test fails() recorded an issue at DemoTests.swift:6:22: Expectation failed: add(1, 1) == 3");
		expect(t).toContain("** TEST FAILED **");
		expect(t).not.toMatch(/◇|Test Case '.*' started|Details: /);
		expect(t.match(/Executed 3 tests/g)).toHaveLength(1);
	});

	test("swift build and test: progress goes; errors keep frame and notes; the frontend command goes", () => {
		expect(compactXcode(fx("swift-build.txt"))!.text.split("\n")[0]).toBe("Build complete! (2,87 sec)");
		const test_ = compactXcode(fx("swift-test.txt"))!.text;
		expect(test_).toContain("Executed 3 tests, with 1 failure (0 unexpected) in 0.079 (0.088) seconds");
		const err = compactXcode(fx("swift-test-builderr.txt"))!.text;
		expect(err).toContain("error: use of 'add' refers to instance method rather than global function 'add' in module 'Demo'");
		expect(err).toContain(" 8 |     func testA() { XCTAssertEqual(add(1, 2), 3) }");
		expect(err).not.toContain("swift-frontend -frontend");
		expect(err).not.toMatch(/^\[\d+/m);
		const notes = compactXcode(["a.swift:1:1: error: bad", "a.swift:1:1: note: here", "b.swift:2:2: warning: meh", "  |  `- warning: meh", "b.swift:2:2: note: hidden", "** BUILD FAILED **"].join("\n"))!.text;
		expect(notes).toContain("a.swift:1:1: note: here");
		expect(notes).not.toContain("hidden");
		expect(compactXcode("just text")).toBeUndefined();
	});
});

describe("android", () => {
	test("gradle on an Android project: AGP option warnings once, test failures, detekt paths shortened", () => {
		const raw = fx("gradle-android.txt");
		const r = compactGradle(raw)!;
		expect(ratio(r.text, raw)).toBeLessThan(0.25);
		expect(r.text).toContain("SqueezeProbeTest > throws FAILED");
		expect(r.text).toContain("…/main/java/com/example/logger/SqueezeProbe.kt:4:9: Private property `unused` is unused. [UnusedPrivateProperty]");
		expect(r.text.match(/WARNING: The option setting 'android\.experimental\.lint\.reservedMemoryPerTask=2g'/g)).toHaveLength(1);
		expect(r.text).not.toMatch(/suppressAgpWarnings|The current default is|\* Try:|Run with --scan|={20}/);
	});

	test("test failures with a stack trace fold the framework frames; dependencyUpdates URLs go", () => {
		const raw = ["> Task :app:testDebugUnitTest FAILED", "ExampleTest > adds FAILED", "    java.lang.AssertionError: expected:<4> but was:<3>", "        at org.junit.Assert.fail(Assert.java:89)", "        at org.junit.Assert.failNotEquals(Assert.java:835)", "        at com.example.ExampleTest.adds(ExampleTest.kt:9)", " - com.squareup.okhttp3:okhttp [4.12.0 -> 5.0.0]", "     https://square.github.io/okhttp/", "BUILD FAILED in 2s"].join("\n");
		const r = compactGradle(raw)!;
		expect(r.text).toContain("        … 2 framework frames\n        at com.example.ExampleTest.adds(ExampleTest.kt:9)");
		expect(r.text).not.toContain("https://square");
		expect(r.truncated).toBe(true);
	});

	test("gradle dependencies: the gradle clean-up, then the tree cut", () => {
		const deep = (d: number) => `${"|    ".repeat(d)}+--- g:a${d}:1.0`;
		const raw = ["> Task :app:dependencies", "", "debugRuntimeClasspath - Runtime classpath.", deep(0), deep(1), deep(2), deep(3), deep(4), "\\--- g:last:1.0", "", "BUILD SUCCESSFUL in 1s"].join("\n");
		const r = compactGradleDeps(raw)!;
		expect(r.text).toContain("               … [+2 lines deeper]");
		expect(r.text).not.toContain("g:a3");
		expect(compactTree(raw)!.text).toContain("> Task :app:dependencies");
		expect(compactGradleDeps("> Task :x\nBUILD SUCCESSFUL in 1s")!.text).toContain("gradle: 1 tasks");
		expect(compactGradleDeps("nothing")).toBeUndefined();
	});

	test("adb pm list packages: grouped by the first two segments", () => {
		const raw = ["package:com.google.android.gms", "package:com.google.android.apps.messaging", "package:android", "package:org.example.app", "package:com.google.ar.core"].join("\n");
		expect(compactPackages(`${raw}\n`)!.text).toBe("5 packages\nandroid\ncom.google (3): android.apps.messaging android.gms ar.core\norg.example (1): app");
		const r = compactPackages(raw, { lineChars: 2, perGroup: 1, total: 250 })!;
		expect(r.truncated).toBe(true);
		expect(compactPackages("package:a\nnot a package")).toBeUndefined();
		expect(compactPackages("")).toBeUndefined();
	});
});

describe("router: installs, linters, runners, logs, docker, xcode, adb, pipes", () => {
	const kind = (cmd: string, out: string, opts = {}) => compact(cmd, out, { ...small, ...opts })?.kind;
	test("each command reaches its compactor, also through npx, uv run, python -m and xcrun", () => {
		expect(kind("npm install request", fx("npm-install.txt"))).toBe("install");
		expect(kind("pip install requests rich", fx("pip-install.txt"))).toBe("install");
		expect(kind("python3 -m pip install requests", fx("pip-install.txt"))).toBe("install");
		expect(kind("uv pip install requests", fx("pip-install.txt"))).toBe("install");
		expect(kind("uv sync", fx("pip-install.txt"))).toBe("install");
		expect(kind("yarn", fx("npm-install.txt"))).toBe("install");
		expect(kind("flutter pub get", fx("pip-install.txt"))).toBe("install");
		expect(kind("pytest -v", fx("pytest-v.txt"))).toBe("tests");
		expect(kind("uv run pytest", fx("pytest-v.txt"))).toBe("tests");
		expect(kind("npx vitest run --reporter=verbose", fx("vitest-verbose.txt"))).toBe("tests");
		expect(kind("pnpm exec jest", fx("vitest-verbose.txt"))).toBe("tests");
		expect(kind("npx eslint src", fx("eslint.txt"))).toBe("lint");
		expect(kind("bunx biome lint src", fx("biome.txt"))).toBe("lint");
		expect(kind("uvx ruff check .", fx("ruff.txt"))).toBe("lint");
		expect(kind("ruff --select ALL .", fx("ruff-concise.txt"))).toBe("lint");
		expect(kind("docker build .", fx("docker-build.txt"))).toBe("build");
		expect(kind("docker buildx build .", fx("docker-build.txt"))).toBe("build");
		expect(kind("xcodebuild -scheme Demo build", fx("xcodebuild-build.txt"))).toBe("build");
		expect(kind("xcrun xcodebuild -scheme Demo test", fx("xcodebuild-test.txt"))).toBe("tests");
		expect(kind("swift build", fx("swift-build.txt"))).toBe("build");
		expect(kind("swift test", fx("swift-test.txt"))).toBe("tests");
		expect(kind("./gradlew :app:dependencies", fx("cargo-tree.txt"))).toBe("tree");
		const log = Array.from({ length: 30 }, (_, i) => `2026-11-02T01:00:${String(i).padStart(2, "0")}Z GET /health 200`).join("\n");
		for (const c of ["docker logs web", "docker compose logs web", "docker-compose logs", "kubectl logs pod/x", "journalctl -u nginx", "adb logcat -d", "adb logcat -f x"]) expect(kind(c, log)).toBe("logs");
		const pm = Array.from({ length: 30 }, (_, i) => `package:com.example.app${i}`).join("\n");
		expect(kind("adb shell pm list packages", pm)).toBe("listing");
		expect(kind("ack -f", fx("fd.txt"))).toBe("paths");
		expect(kind("ack --kotlin import", fx("rg-flat.txt"))).toBe("search");
	});

	test("machine formats, follow mode, other subcommands and pipes elsewhere are left to the sniffers", () => {
		expect(handles("npx eslint -f json src")).toBe(false);
		expect(handles("ruff check --output-format=github")).toBe(false);
		expect(handles("biome format src")).toBe(false);
		expect(handles("docker logs -f web")).toBe(false);
		expect(handles("kubectl logs --follow x")).toBe(false);
		expect(handles("npm run lint")).toBe(false);
		expect(handles("ack -h x")).toBe(false);
		expect(handles("uv run")).toBe(false);
		expect(handles("swift package resolve")).toBe(false);
		expect(handles("adb shell dumpsys battery")).toBe(false);
		expect(handles("cargo test | tail -n 40")).toBe(true);
		expect(handles("cargo test | grep x")).toBe(false);
	});

	test("xcodebuild output is recognised by its result line only", () => {
		expect(kind("just ios", fx("xcodebuild-build.txt"))).toBe("build");
		expect(kind("make", fx("swift-build.txt"))).not.toBe("build");
	});

	test("a trailing tail or head is looked through", () => {
		expect(unpipe("cargo test 2>&1 | tail -50")).toBe("cargo test 2>&1");
		expect(unpipe("npm test | head -n 20")).toBe("npm test");
		expect(unpipe("x | tail --lines=5")).toBe("x");
		expect(unpipe("x | tail -f")).toBe("x | tail -f");
		expect(kind("pytest | tail -40", fx("pytest-v.txt"))).toBe("tests");
		expect(kind("npm run lint | tail -30", fx("eslint.txt"))).toBe("lint");
	});

	test("a failed run: lint and install output are compacted too, logs are not", () => {
		expect(kind("npx eslint src", fx("eslint.txt"), { failed: true })).toBe("lint");
		expect(kind("pip install x", fx("pip-install.txt"), { failed: true })).toBe("install");
		const log = Array.from({ length: 30 }, (_, i) => `2026-11-02T01:00:${String(i).padStart(2, "0")}Z GET /health 200`).join("\n");
		expect(kind("docker logs web", log, { failed: true })).toBeUndefined();
		expect(kind("npx eslint src", fx("eslint.txt"), { kinds: { lint: false } })).not.toBe("lint");
	});
});
