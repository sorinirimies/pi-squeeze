import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compactDumpsys, compactPackagePaths, compactProcesses, compactProperties, compactUiDump } from "../extensions/core/adb.ts";
import { compact, handles } from "../extensions/core/compact.ts";
import { compactGradle } from "../extensions/core/gradle.ts";
import { squeezeProjects, squeezeTaskReport } from "../extensions/core/gradlereports.ts";
import { compactJavac } from "../extensions/core/javac.ts";
import { compactLint, compactLintSniffed, parseAndroidLint } from "../extensions/core/lint.ts";
import { compactLogs, compactTrace } from "../extensions/core/logs.ts";
import { compactMaven, compactMavenTree } from "../extensions/core/maven.ts";

const fx = (n: string) => readFileSync(join(import.meta.dir, "fixtures", n), "utf8");
const lines = (t: string) => t.split("\n");
const ratio = (a: string, b: string) => a.length / b.length;
const gradle = (...body: string[]) => ["> Task :app:x", ...body, "BUILD FAILED in 1s"].join("\n");

describe("gradle on Android: reports", () => {
	test("tasks: names per group, descriptions and hints go", () => {
		const r = compactGradle(fx("gradle-tasks.txt"))!;
		expect(ratio(r.text, fx("gradle-tasks.txt"))).toBeLessThan(0.25);
		expect(lines(r.text)).toContain("Help tasks (12): artifactTransforms buildEnvironment dependencies dependencyInsight help javaToolchains kotlinDslAccessorsReport outgoingVariants projects properties resolvableConfigurations tasks");
		expect(r.text).not.toMatch(/Displays the|To see all tasks|-{10}/);
		expect(r.truncated).toBe(true);
	});

	test("projects: each path once, grouped by the first segment", () => {
		const r = compactGradle(fx("gradle-projects.txt"))!;
		expect(ratio(r.text, fx("gradle-projects.txt"))).toBeLessThan(0.1);
		const t = lines(r.text);
		expect(t).toContain("1032 projects");
		expect(t.filter((l) => l === "Root project 'app'")).toHaveLength(1);
		expect(t.find((l) => l.startsWith(":apps (7): "))).toBe(":apps (7): m238 m238:m239 m238:m240 m238:m241 m242 m242:m239 m243");
		expect(r.text).not.toMatch(/Project ':|project ':|To see a list of the tasks|Project locations/);
	});

	test("the report helpers leave other output alone", () => {
		expect(squeezeTaskReport(["a", "b"], 100)).toEqual({ lines: ["a", "b"], cut: false });
		expect(squeezeProjects(["project ':a'", "x"], 100)).toEqual({ lines: ["project ':a'", "x"], cut: false });
		const odd = squeezeTaskReport(["Tasks runnable from project ':a'", "", "Rules", "Pattern: clean<TaskName>: Cleans", "", "Build tasks", "assemble - Assembles", "", "lonely"], 100);
		expect(odd.lines).toEqual(["Tasks runnable from project ':a'", "", "Rules", "Pattern: clean<TaskName>: Cleans", "", "Build tasks (1): assemble", "", "lonely"]);
	});

	test("dependencyInsight: the attribute table and legend go, the paths stay", () => {
		const t = compactGradle(fx("gradle-insight.txt"))!.text;
		expect(t).toContain("org.jetbrains.kotlin:kotlin-stdlib:2.3.21 -> 2.4.21");
		expect(t).toContain("   Selection reasons:");
		expect(t).not.toMatch(/\| Attribute Name|Indicates repeated|web-based, searchable/);
	});

	test("--warning-mode all: deprecations once, without the guide; multi-line warnings once", () => {
		const r = compactGradle(fx("gradle-warnmode.txt"))!;
		expect(r.text).toContain("The Configuration.setVisible(boolean) method has been deprecated. This is scheduled to be removed in Gradle 11.\n");
		expect(r.text).not.toContain("Consult the upgrading guide");
		expect(r.truncated).toBe(true);
		const fused = compactGradle(fx("gradle-insight.txt"))!.text;
		expect(fused).toContain("WARNING: Fused Library Plugin is using Publication Only Mode. (×3)");
		expect(fused.match(/Depending on Fused Library projects/g)).toHaveLength(1);
		const dep = compactGradle(gradle("x has been deprecated. See https://docs.gradle.org/a", "x has been deprecated. See https://docs.gradle.org/a"))!.text;
		expect(dep).toContain("x has been deprecated. (×2)");
	});
});

describe("gradle on Android: findings", () => {
	test("detekt findings grouped by rule; Kotlin's error stays; the failure summary does not repeat it", () => {
		const r = compactGradle(fx("gradle-detekt.txt"))!;
		const t = lines(r.text);
		expect(t).toContain("detekt / ktlint: 9 findings in 1 file (under /home/dev/app/core/logger/src/main/java/com/example/logger/)");
		expect(t).toContain("UnusedPrivateProperty: Private property `unused` is unused.  Probe.kt:14:17");
		expect(t).toContain("e: …/Probe.kt:20:27 'fun String.toUpperCase(): String' is deprecated. Use uppercase() instead.");
		expect(t).toContain("         Location: …/Probe.kt:20");
		expect(r.text).not.toMatch(/A failure occurred while executing/);
	});

	test("lint: Kotlin warnings and lint issues grouped; snippets, baseline advice and the summary's repeat go", () => {
		const r = compactGradle(fx("gradle-lint.txt"))!;
		const t = lines(r.text);
		expect(t).toContain("kotlin: 6 warnings in 1 file (under /home/dev/app/core/logger/src/main/java/com/example/logger/)");
		expect(t).toContain("warning 'fun oldApi(x: Int): Int' is deprecated. use newer. (4)");
		expect(t).toContain("  Probe.kt:16:43 Probe.kt:17:49 Probe.kt:18:35 Probe.kt:20:29");
		expect(t).toContain("Lint found 3 errors. First failure: (×2)");
		expect(t).toContain("error DefaultLocale: Implicitly using the default locale is a common source of bugs: Use String.format(Locale, ...) instead  Probe.kt:16");
		expect(r.text).not.toMatch(/~~~~|create a baseline|lint-baseline\.xml|fun a\(\)/);
		expect(r.truncated).toBe(true);
	});

	test("Android Lint's text report on its own: one line per issue, explanations go", () => {
		const r = compactLint(fx("android-lint.txt"))!;
		expect(lines(r.text)).toEqual([
			"android lint: 3 errors in 1 file (under /home/dev/app/core/cat-logger/src/main/java/com/example/logger/)",
			"error DefaultLocale: Implicitly using the default locale is a common source of bugs: Use String.format(Locale, ...) instead (2)",
			"  SqueezeProbe.kt:16 SqueezeProbe.kt:17",
			"error SimpleDateFormat: To get local formatting use getDateInstance(), getDateTimeInstance(), or getTimeInstance(), or use new SimpleDateFormat(String template, Locale locale) with for example Locale.US for ASCII dates.  SqueezeProbe.kt:19",
			"",
			"3 errors",
		]);
		expect(compactLintSniffed(fx("android-lint.txt"))!.text).toBe(r.text);
		expect(parseAndroidLint(["a.kt:1: Warning: x [Id]", "garbage"])).toBeUndefined();
		expect(parseAndroidLint(["No issues found."])).toBeUndefined();
	});

	test("dependency resolution: the searched URLs become a count", () => {
		const r = compactGradle(fx("gradle-resolve.txt"))!;
		expect(r.text).toContain("   > Could not find com.example.squeeze:nope:1.0.\n     Searched in 3 locations\n     Required by:");
		expect(r.text).not.toContain("https://jitpack.io");
		expect(r.truncated).toBe(true);
		const atEnd = compactGradle(["> Task :x", "BUILD FAILED in 1s", "   > Could not find a:b:1.", "     Searched in the following locations:", "       - https://repo/a"].join("\n"))!.text;
		expect(atEnd).toContain("     Searched in 1 locations");
	});

	test("AAPT: the wrappers go, the errors stay with short paths", () => {
		const t = compactGradle(fx("gradle-aapt.txt"))!.text;
		expect(t).toContain("     ERROR: …/probe.xml:1: AAPT: error: attribute android:bogus not found.");
		expect(t).not.toMatch(/A failure occurred|There was a failure/);
	});

	test("R8 missing classes and duplicate classes become lists; manifest merger errors stay", () => {
		const r8 = gradle(
			"ERROR: Missing classes detected while running R8. Please add the missing classes or apply additional keep rules that are generated in /w/app/build/outputs/mapping/release/missing_rules.txt.",
			"ERROR: R8: Missing class com.google.errorprone.annotations.Immutable (referenced from: com.google.crypto.tink.Key and 3 other contexts)",
			"Missing class javax.annotation.Nullable (referenced from: okhttp3.Call)",
			"Missing class javax.annotation.Nullable (referenced from: okhttp3.Response)",
			"   > Duplicate class com.google.common.util.concurrent.ListenableFuture found in modules guava-31.1-android.jar -> guava-31.1-android (com.google.guava:guava:31.1-android) and listenablefuture-1.0.jar -> listenablefuture-1.0 (com.google.guava:listenablefuture:1.0)",
			"     Duplicate class com.google.common.util.concurrent.Futures found in modules guava-31.1-android.jar -> guava-31.1-android (com.google.guava:guava:31.1-android) and listenablefuture-1.0.jar -> listenablefuture-1.0 (com.google.guava:listenablefuture:1.0)",
			"     Go to the documentation to learn how to <a href=\"d.android.com/r/tools/classpath-sync-errors\">Fix dependency resolution errors</a>.",
			"Manifest merger failed : Attribute application@allowBackup value=(false) from AndroidManifest.xml:12:9-36",
			"\tis also present at [com.lib:x:1.0] AndroidManifest.xml:9:18-44 value=(true).",
		);
		const r = compactGradle(r8)!;
		const t = lines(r.text);
		expect(t).toContain("R8: missing classes (2): com.google.errorprone.annotations.Immutable javax.annotation.Nullable");
		expect(t).toContain("Duplicate classes in guava-31.1-android.jar -> guava-31.1-android (com.google.guava:guava:31.1-android) and listenablefuture-1.0.jar -> listenablefuture-1.0 (com.google.guava:listenablefuture:1.0) (2): com.google.common.util.concurrent.ListenableFuture com.google.common.util.concurrent.Futures");
		expect(t).toContain("Manifest merger failed : Attribute application@allowBackup value=(false) from AndroidManifest.xml:12:9-36");
		expect(r.text).not.toMatch(/referenced from|Go to the documentation/);
		expect(r.truncated).toBe(true);
		const many = gradle(...Array.from({ length: 300 }, (_, i) => `Missing class a.b.C${i}`));
		expect(compactGradle(many)!.text).toContain("… [+");
	});

	test("an issue's indented lines go with it, up to the next unindented line", () => {
		const t = compactGradle(gradle("/w/a/A.kt:3: Warning: Bad [Id]", "    code()", "    ~~~~", "", "   Explanation", "next line"))!.text;
		expect(lines(t)).toEqual(["gradle: 1 tasks (1 executed) ran: :app:x", "android lint: 1 warning in 1 file (under /w/a/)", "warning Id: Bad  A.kt:3", "next line", "BUILD FAILED in 1s"]);
	});
});

describe("maven", () => {
	test("a fresh build: downloads counted, [INFO] gone, passing classes counted", () => {
		const raw = fx("maven-fresh.txt");
		const r = compactMaven(raw)!;
		expect(lines(r.text)).toEqual(["maven: 8 downloads, 4 test classes passed", "[INFO] Tests run: 4, Failures: 0, Errors: 0, Skipped: 0", "[INFO] BUILD SUCCESS", "[INFO] Total time:  18.643 s"]);
		expect(r.truncated).toBe(true);
	});

	test("a compile error is said once, with symbol and location; the help footer goes", () => {
		const t = lines(compactMaven(fx("maven-compile-err.txt"))!.text);
		expect(t).toContain("[ERROR] …/RuntimeHealthIndicator.java:[25,34] cannot find symbol");
		expect(t).toContain("  symbol:   variable undefinedThing");
		expect(t.filter((l) => l.includes("cannot find symbol"))).toHaveLength(2);
		expect(t.join("\n")).not.toMatch(/Help 1|Re-run Maven|Annotation processing|on the class path/);
	});

	test("a failing test class keeps its output and failures; passing classes and banners go", () => {
		const t = compactMaven(fx("maven-test-fail.txt"))!.text;
		expect(t).toContain("maven: 3 test classes passed");
		expect(t).toContain("[ERROR] com.example.demo.webapp.DemoResourceTest.throwsDeep -- Time elapsed: 0.080 s <<< ERROR!");
		expect(t).toContain("Caused by: java.lang.NumberFormatException: For input string: \"x\"\n\t… 3 framework frames");
		expect(t).toContain("[ERROR] Tests run: 5, Failures: 1, Errors: 1, Skipped: 0");
		expect(t).not.toMatch(/Spring Boot ::|Mockito is currently|Running com\.example/);
	});

	test("warnings are said once; a class still running at the end keeps its output; no result, no maven", () => {
		const raw = ["[WARNING] old api", "[WARNING] old api", "[INFO] Running a.ATest", "boom", "[ERROR] BUILD FAILURE"].join("\n");
		expect(compactMaven(raw)!.text).toBe("[WARNING] old api (×2)\nboom\n[ERROR] BUILD FAILURE");
		expect(compactMaven("[INFO] hello")).toBeUndefined();
		const batch = ["[INFO] Downloading from central: https://repo/a.pom", "[INFO] Downloaded from central: https://repo/a.pom (1 kB at 9 kB/s)", "[INFO] BUILD SUCCESS"].join("\n");
		expect(compactMaven(batch)!.text).toBe("maven: 1 downloads\n[INFO] BUILD SUCCESS");
	});

	test("dependency:tree: the prefix goes and the tree is cut by depth", () => {
		const r = compactMavenTree(fx("maven-deptree.txt"))!;
		expect(ratio(r.text, fx("maven-deptree.txt"))).toBeLessThan(0.2);
		expect(r.text).toContain("com.example:demo-api:jar:0.0.1-SNAPSHOT");
		expect(r.text).toContain("… [+");
		expect(r.text.split("\n").at(-1)).toBe("[INFO] BUILD SUCCESS");
		expect(compactMavenTree("[INFO] x")).toBeUndefined();
		expect(compactMavenTree("[INFO] a:b:jar:1\n[INFO] \\- c:d:jar:1\n[INFO] BUILD SUCCESS")!.text).toBe("a:b:jar:1\n\\- c:d:jar:1\n[INFO] BUILD SUCCESS");
	});
});

describe("javac and stack traces", () => {
	test("javac: errors keep their source line and symbol; warnings are grouped", () => {
		const r = compactJavac(fx("javac.txt"))!;
		const t = lines(r.text);
		expect(t.slice(0, 5)).toEqual(["src/com/example/app/Main.java:12: error: cannot find symbol", "        String s = undefinedName;", "                   ^", "  symbol:   variable undefinedName", "  location: class Main"]);
		expect(t).toContain("warning rawtypes: found raw type: ArrayList (2)");
		expect(r.text).not.toMatch(/type-variable|missing type arguments/);
		expect(t.slice(-2)).toEqual(["5 errors", "8 warnings"]);
	});

	test("javac: notes, warnings only, absolute paths, and anything else", () => {
		const notes = compactJavac(["/w/src/A.java:1: error: x", "/w/src/b/B.java:2: error: y", "Note: /w/src/A.java uses or overrides a deprecated API.", "Note: Recompile with -Xlint:deprecation for details.", "2 errors"].join("\n"))!;
		expect(lines(notes.text)).toEqual(["…/A.java:1: error: x", "…/b/B.java:2: error: y", "Note: /w/src/A.java uses or overrides a deprecated API.", "2 errors"]);
		expect(notes.truncated).toBe(false);
		expect(compactJavac("A.java:1: warning: [cast] redundant cast\n        (int) x\n1 warning")!.text).toBe("javac: 1 warning in 1 file\nwarning cast: redundant cast  A.java:1\n1 warning");
		expect(compactJavac("hello\nA.java:1: error: x")).toBeUndefined();
		expect(compactJavac("1 error")).toBeUndefined();
	});

	test("a JVM stack trace anywhere: framework frames fold, causes and own frames stay", () => {
		const r = compactTrace(fx("java-trace.txt"))!;
		expect(lines(r.text)).toEqual([
			'Exception in thread "main" java.util.concurrent.ExecutionException: java.lang.IllegalStateException: could not load config',
			"\t… 2 framework frames",
			"\tat com.example.Crash.main(Crash.java:18)",
			"Caused by: java.lang.IllegalStateException: could not load config",
			"\tat com.example.Crash.load(Crash.java:12)",
			"\tat com.example.Crash.lambda$main$0(Crash.java:16)",
			"\t… 5 framework frames",
			'Caused by: java.lang.NumberFormatException: For input string: "x"',
			"\t… 3 framework frames",
			"\tat com.example.Crash.parse(Crash.java:7)",
			"\t… 7 framework frames",
			"\tat com.example.Crash.load(Crash.java:10)",
			"\t... 6 more",
			"",
		]);
		expect(compactTrace("Exception\n\tat a.B.c(B.java:1)\n\tat a.B.d(B.java:2)\n\tat a.B.e(B.java:3)")).toBeUndefined();
		expect(compactTrace("no trace here")).toBeUndefined();
	});
});

describe("adb", () => {
	test("uiautomator dump: one line per meaningful node, with where to tap", () => {
		const r = compactUiDump(fx("adb-ui.txt"))!;
		expect(ratio(r.text, fx("adb-ui.txt"))).toBeLessThan(0.15);
		const t = lines(r.text);
		expect(t[0]).toBe("ui: 43 of 76 nodes (com.android.settings)");
		expect(t).toContain("    TextView \"Network & internet\" #title @375,608");
		expect(t).toContain("  LinearLayout click @504,635");
		expect(r.text).not.toContain("hierchary");
	});

	test("uiautomator dump: flags, descriptions, hints, off-screen nodes", () => {
		const xml = `<?xml version='1.0' ?><hierarchy rotation="0"><node class="a.B" text="" content-desc="Back" clickable="true" long-clickable="true" bounds="[0,0][10,10]"><node class="a.Check" text="Wi&#8209;Fi" checkable="true" checked="true" selected="true" focused="true" enabled="false" bounds="[0,0][4,4]" /><node class="a.Edit" hint="Name" password="true" scrollable="true" checkable="true" checked="false" bounds="[0,0][2,2]"/><node class="a.Gone" text="hidden" bounds="[5,5][5,9]" /><node class="a.Odd" text="x" bounds="nope" /></node></hierarchy>`;
		expect(lines(compactUiDump(xml)!.text)).toEqual([
			"ui: 3 of 5 nodes",
			'B desc="Back" click long-click @5,5',
			'  Check "Wi‑Fi" checked selected focused disabled @2,2',
			'  Edit hint="Name" scroll unchecked password @1,1',
		]);
		expect(compactUiDump("<hierarchy></hierarchy>")).toBeUndefined();
		expect(compactUiDump("plain")).toBeUndefined();
	});

	test("getprop and settings: shared prefixes once, every value kept", () => {
		const r = compactProperties(fx("adb-getprop.txt"))!;
		expect(ratio(r.text, fx("adb-getprop.txt"))).toBeLessThan(0.7);
		expect(r.text).toMatch(/^aaudio: hw_burst_min_usec=2000 mmap_exclusive_policy=2 mmap_policy=2$/m);
		expect(r.text).toMatch(/^ro\.build: version\.\S+=/m);
		const settings = compactProperties(fx("adb-settings.txt"))!;
		expect(settings.text).toMatch(/^SYSTEM: AUDIT=null BOOT=null/m);
		const multi = compactProperties(["[a.b.c]: [1]", "[a.b.d]: [two", "lines]", "[e]: []", "[f.g]: [has space]", "[h.i]: [x]"].join("\n"))!.text;
		expect(lines(multi)).toEqual(["a.b: c=1 d=two\\nlines", 'e=""', 'f.g="has space"', "h.i=x"]);
		const wide = compactProperties(Array.from({ length: 40 }, (_, i) => `[p.q.k${i}]: [${"v".repeat(i === 0 ? 300 : 20)}]`).join("\n"))!;
		expect(wide.truncated).toBe(true);
		expect(lines(wide.text).length).toBeGreaterThan(2);
		expect(compactProperties("a=1\nb=2")).toBeUndefined();
		expect(compactProperties("a=1\nb=2\nc=3\nd=4\nnot a pair")).toBeUndefined();
	});

	test("ps and top: kernel threads and idle rows counted, padding gone", () => {
		const ps = compactProcesses(fx("adb-ps.txt"))!;
		expect(lines(ps.text)[0]).toBe("USER PID PPID VSZ RSS WCHAN ADDR S NAME");
		expect(ps.text).toMatch(/… \d+ kernel threads not listed$/);
		expect(ps.text).not.toContain("[kthreadd]");
		const top = compactProcesses(fx("adb-top.txt"))!;
		expect(ratio(top.text, fx("adb-top.txt"))).toBeLessThan(0.15);
		expect(lines(top.text)[0]).toMatch(/^Tasks: \d+ total, /);
		expect(top.text).toMatch(/… \d+ idle processes not listed$/);
		expect(compactProcesses("USER PID PPID VSZ\nroot 1 0 5")).toBeUndefined();
		const busy = compactProcesses(["PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ ARGS", ...Array.from({ length: 6 }, (_, i) => `${i} root 20 0 1G 1M 1M S 1.0 0.0 0:01 p${i}`)].join("\n"))!;
		expect(busy.truncated).toBe(false);
	});

	test("pm list packages -f: name first, hashed install dirs elided", () => {
		const r = compactPackagePaths(fx("adb-pm-f.txt"))!;
		expect(lines(r.text)[0]).toBe("120 packages");
		expect(r.text).toMatch(/^com\.android\.shell {2}\/system\/priv-app\/Shell\/Shell\.apk$/m);
		expect(r.text).toMatch(/^com\.android\.vending {2}\/data\/app\/…\/base\.apk$/m);
		expect(r.text).not.toMatch(/~~/);
		expect(compactPackagePaths("package:/a.apk=x\nnot")).toBeUndefined();
		expect(compactPackagePaths("")).toBeUndefined();
	});

	test("dumpsys: deep lines counted, similar runs kept at their ends", () => {
		const r = compactDumpsys(fx("adb-dumpsys-package.txt"))!;
		expect(ratio(r.text, fx("adb-dumpsys-package.txt"))).toBeLessThan(0.5);
		expect(r.text).toContain("Activity Resolver Table:");
		expect(r.text).toMatch(/ {10}… \[\+\d+ deeper lines\]/);
		const runs = compactDumpsys(Array.from({ length: 30 }, (_, i) => `  Proc #${i}: fg pid=${100 + i}`).join("\n"))!.text;
		expect(lines(runs)).toEqual(["  Proc #0: fg pid=100", "  … [28 similar]", "  Proc #29: fg pid=129"]);
		expect(compactDumpsys("short\nreport")).toBeUndefined();
	});

	test("logcat -v time and -v brief lose padding and the date that never changes", () => {
		const time = ["11-02 02:21:02.091 I/Mdns( 1947): one", "11-02 02:21:02.363 W/Nearby(23349): two", "11-02 02:21:03.000 E/AndroidRuntime( 9517): \tat android.app.A.b(A.java:1)", "11-02 02:21:03.000 E/AndroidRuntime( 9517): \tat android.app.A.c(A.java:2)"].join("\n");
		expect(lines(compactLogs(time)!.text)).toEqual(["02:21:02.091 1947 I Mdns: one", "02:21:02.363 23349 W Nearby: two", "02:21:03.000 9517 E AndroidRuntime: \t… 2 framework frames"]);
		const brief = ["D/Tag  ( 12): a", "I/Other( 13): b", "x", "y"].join("\n");
		expect(lines(compactLogs(brief)!.text)).toEqual(["12 D Tag: a", "13 I Other: b", "x", "y"]);
	});
});

describe("router: Android, Maven, javac", () => {
	const kind = (cmd: string, out: string, opts = {}) => compact(cmd, out, { minChars: 100, ...opts })?.kind;
	test("adb subcommands, also with a device chosen", () => {
		expect(kind("adb exec-out uiautomator dump /dev/tty", fx("adb-ui.txt"))).toBe("tree");
		expect(kind("adb -s emulator-5554 shell getprop", fx("adb-getprop.txt"))).toBe("listing");
		expect(kind("adb -d shell settings list global", fx("adb-settings.txt"))).toBe("listing");
		expect(kind("adb shell ps -A", fx("adb-ps.txt"))).toBe("listing");
		expect(kind("adb shell top -n 1 -b", fx("adb-top.txt"))).toBe("listing");
		expect(kind("adb shell pm list packages -f", fx("adb-pm-f.txt"))).toBe("listing");
		expect(kind(`adb shell "dumpsys package com.google.android.youtube"`, fx("adb-dumpsys-package.txt"))).toBe("tree");
		expect(handles("adb install app.apk")).toBe(false);
		expect(handles("adb shell getprop ro.build.version.sdk")).toBe(false);
		expect(handles("adb -t 3 shell ls")).toBe(false);
	});

	test("mvn, mvnw and mvnd; javac; a stack trace or a UI dump from anything", () => {
		expect(kind("mvn test", fx("maven-test-fail.txt"))).toBe("tests");
		expect(kind("./mvnw -B package", fx("maven-fresh.txt"))).toBe("build");
		expect(kind("mvnd dependency:tree", fx("maven-deptree.txt"))).toBe("tree");
		expect(kind("javac -d out src/*.java", fx("javac.txt"))).toBe("build");
		expect(kind("just verify", fx("maven-compile-err.txt"))).toBe("build");
		expect(kind("java -jar app.jar", fx("java-trace.txt"), { failed: true })).toBe("logs");
		expect(kind("./scripts/dump.sh", fx("adb-ui.txt"))).toBe("tree");
		expect(kind("make", fx("javac.txt"))).toBe("build");
	});
});
