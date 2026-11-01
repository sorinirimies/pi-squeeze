import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compactDiff } from "../extensions/core/diff.ts";

const fixture = readFileSync(join(import.meta.dir, "fixtures", "git-diff.txt"), "utf8");

const change = (path: string, hunk: string[], head = ["index 111..222 100644", `--- a/${path}`, `+++ b/${path}`]) => [`diff --git a/${path} b/${path}`, ...head, ...hunk].join("\n");

describe("compactDiff", () => {
	test("a real diff gets much smaller: summary first, one header line per file, no index lines", () => {
		const r = compactDiff(fixture)!;
		expect(r.text.length).toBeLessThan(fixture.length * 0.6);
		expect(r.text.split("\n")[0]).toMatch(/^13 files changed, \+\d+ −\d+ \(context trimmed to 1 line\)$/);
		expect(r.text).toContain("extensions/command/parse.ts (new, +77 −0)");
		expect(r.text).not.toMatch(/^index |^--- |^\+\+\+ |^diff --git /m);
		expect(r.truncated).toBe(true); // new files are cut at 40 lines
		expect(r.text).toContain("more lines in extensions/command/parse.ts]");
	});

	test("all changed lines of a hunk are kept, context shrinks to one line each side", () => {
		const d = change("a.ts", ["@@ -1,9 +1,9 @@ fn", " c1", " c2", " c3", "-old", "+new", " c4", " c5", " c6", " c7", " c8"]);
		expect(compactDiff(d)!.text.split("\n").slice(1)).toEqual(["a.ts (+1 −1)", "@@ -1,9 +1,9 @@ fn", " c3", "-old", "+new", " c4"]);
	});

	test("an empty context line (stripped trailing space) counts as context", () => {
		const d = change("a.ts", ["@@ -1,3 +1,3 @@", " a", "", "-x", "+y"]);
		expect(compactDiff(d)!.text).toContain("\n\n-x\n+y");
	});

	test("new, deleted, renamed and binary files are named", () => {
		const d = [
			change("n.ts", ["@@ -0,0 +1 @@", "+hi"], ["new file mode 100644", "index 0..1", "--- /dev/null", "+++ b/n.ts"]),
			change("d.ts", ["@@ -1 +0,0 @@", "-bye"], ["deleted file mode 100644", "index 1..0", "--- a/d.ts", "+++ /dev/null"]),
			["diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts", "index 1..2 100644", "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-a", "+b"].join("\n"),
			["diff --git a/img.png b/img.png", "index 1..2 100644", "Binary files a/img.png and b/img.png differ"].join("\n"),
			["diff --git a/run.sh b/run.sh", "old mode 100644", "new mode 100755"].join("\n"),
		].join("\n");
		const t = compactDiff(d)!.text;
		expect(t).toContain("n.ts (new, +1 −0)");
		expect(t).toContain("d.ts (deleted, +0 −1)");
		expect(t).toContain("new.ts (renamed from old.ts, +1 −1)");
		expect(t).toContain("img.png (binary, +0 −0)");
		expect(t).toContain("run.sh (+0 −0)");
		expect(t.split("\n")[0]).toBe("5 files changed, +2 −2 (context trimmed to 1 line)");
	});

	test("a single file reads singular; the no-newline marker belongs to its change", () => {
		const d = change("a.ts", ["@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+b", "\\ No newline at end of file"]);
		const t = compactDiff(d)!.text;
		expect(t.startsWith("1 file changed")).toBe(true);
		expect(t).toContain("-a\n\\ No newline at end of file\n+b");
	});

	test("a hunk header without counts means one line", () => {
		expect(compactDiff(change("a.ts", ["@@ -3 +3 @@", "-a", "+b"]))!.text).toContain("-a\n+b");
	});

	test("a changed file is cut at 120 lines with a marker, a long line is cut", () => {
		const body = Array.from({ length: 200 }, (_, i) => `+line ${i}`);
		const ok = compactDiff(change("big.ts", ["@@ -1 +1,201 @@", "-x", ...body, `+${"y".repeat(100)}`]), { lineChars: 20, perGroup: 15, total: 1000 })!;
		expect(ok.text).toContain("… [+83 more lines in big.ts]");
		expect(ok.truncated).toBe(true);
		const long = compactDiff(change("w.ts", ["@@ -1 +1 @@", "-a", `+${"y".repeat(100)}`]), { lineChars: 20, perGroup: 15, total: 1000 })!;
		expect(long.text).toContain("… [+81 chars]");
	});

	test("the whole result is capped", () => {
		const files = Array.from({ length: 40 }, (_, i) => change(`f${i}.ts`, ["@@ -1 +1 @@", "-a", "+b"])).join("\n");
		const r = compactDiff(files, { lineChars: 240, perGroup: 15, total: 20 })!;
		expect(r.truncated).toBe(true);
		expect(r.text.split("\n").length).toBe(41);
		expect(r.text.split("\n").at(-1)).toMatch(/^… \[\+\d+ more lines\]$/);
	});

	test("anything that is not a clean unified diff passes through", () => {
		expect(compactDiff("")).toBeUndefined();
		expect(compactDiff("fatal: not a git repository")).toBeUndefined();
		expect(compactDiff("diff --git nonsense")).toBeUndefined();
		expect(compactDiff(`${change("a.ts", ["@@ -1 +1 @@", "-a", "+b"])}\nCommand exited with code 1`)).toBeUndefined();
		expect(compactDiff(change("a.ts", ["@@ -1 +1 @@", "-a"]))).toBeUndefined(); // hunk ends early
		expect(compactDiff(change("a.ts", ["@@ garbage"]))).toBeUndefined();
		expect(compactDiff(change("a.ts", ["@@ -1 +1 @@", "?x", "+b"]))).toBeUndefined();
		expect(compactDiff(change("a.ts", [], ["index 1..2", "surprise header"]))).toBeUndefined();
	});
});
