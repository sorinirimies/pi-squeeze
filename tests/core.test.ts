import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasFlag, hasOperator, parse, stripCd, tokenize } from "../extensions/core/command.ts";
import { compact } from "../extensions/core/compact.ts";
import { capLines, cutLine } from "../extensions/core/elide.ts";
import { compactLsd } from "../extensions/core/lsd.ts";
import { compactPaths } from "../extensions/core/paths.ts";
import { compactRg, parseRows } from "../extensions/core/rg.ts";
import { emptyStats, record, summary, tokens } from "../extensions/core/stats.ts";

const fx = (n: string) => readFileSync(join(import.meta.dir, "fixtures", n), "utf8");

describe("command parsing", () => {
	test("tokenize honours quotes and escapes", () => {
		expect(tokenize(`rg -n "a b" 'c d' e\\ f`)).toEqual(["rg", "-n", "a b", "c d", "e f"]);
		expect(tokenize(`a "x\\"y"`)).toEqual(["a", `x"y`]);
		expect(tokenize(`echo ""`)).toEqual(["echo", ""]);
		expect(tokenize(`unterminated "quote`)).toBeUndefined();
		expect(tokenize("")).toEqual([]);
	});

	test("operators outside quotes are found, inside quotes ignored", () => {
		for (const bad of ["a | b", "a; b", "a && b", "a > f", "a < f", "a `b`", "a $(b)", `a "$(b)"`, "a &"]) expect(hasOperator(bad)).toBe(true);
		for (const ok of [`rg "a|b" src`, `rg 'x;y'`, "rg a\\|b", `rg "a>b"`, "rg $HOME"]) expect(hasOperator(ok)).toBe(false);
	});

	test("stripCd drops only a leading cd", () => {
		expect(stripCd("cd /x && rg a")).toBe("rg a");
		expect(stripCd(`cd "my dir" && rg a`)).toBe("rg a");
		expect(stripCd("rg a && cd x")).toBe("rg a && cd x");
	});

	test("parse returns the program and args of one simple command", () => {
		expect(parse("rg -n foo src")).toEqual({ program: "rg", args: ["-n", "foo", "src"] });
		expect(parse("cd /x && FOO=1 /usr/bin/rg foo")).toEqual({ program: "rg", args: ["foo"] });
		expect(parse("rg foo | head")).toBeUndefined();
		expect(parse("")).toBeUndefined();
		expect(parse("   ")).toBeUndefined();
		expect(parse('rg "open')).toBeUndefined();
		expect(parse("A=1")).toBeUndefined();
	});

	test("hasFlag sees long, long=value and combined short flags, but stops at --", () => {
		expect(hasFlag(["--count"], ["--count"])).toBe(true);
		expect(hasFlag(["--format=x"], ["--format"])).toBe(true);
		expect(hasFlag(["-rnc"], [], ["c"])).toBe(true);
		expect(hasFlag(["-n", "--", "-c"], ["--count"], ["c"])).toBe(false);
		expect(hasFlag(["foo"], ["--count"], ["c"])).toBe(false);
	});
});

describe("elide", () => {
	test("cutLine marks what it cut", () => {
		expect(cutLine("abc", 5)).toBe("abc");
		expect(cutLine("abcdefgh", 3)).toBe("abc… [+5 chars]");
	});

	test("capLines marks what it dropped", () => {
		expect(capLines(["a", "b"], 5)).toEqual({ text: "a\nb", truncated: false });
		expect(capLines(["a", "b", "c"], 2)).toEqual({ text: "a\nb\n… [+1 more lines]", truncated: true });
	});
});

describe("rg", () => {
	test("groups a real rg -n run by file and keeps every line number and text", () => {
		const raw = fx("rg-flat.txt");
		const r = compactRg(raw)!;
		expect(r.truncated).toBe(false);
		for (const row of parseRows(raw)!) {
			expect(r.text).toContain(`${row.line}: ${row.text.trim()}`);
		}
		const paths = new Set(parseRows(raw)!.map((x) => x.path));
		for (const p of paths) expect(r.text.split("\n").filter((l) => l.startsWith(`${p} (`)).length).toBe(1);
		expect(r.text.length).toBeLessThan(raw.length * 0.9);
	});

	test("starts with the totals, so a cut result still tells the full size", () => {
		const raw = fx("rg-flat.txt");
		const files = new Set(parseRows(raw)!.map((x) => x.path)).size;
		expect(compactRg(raw)!.text.split("\n")[0]).toBe(`60 matches in ${files} files`);
	});

	test("keeps context lines with a dash and counts only real matches", () => {
		const r = compactRg(fx("rg-context.txt"))!;
		expect(r.text).toContain("extensions/command/host.ts (");
		expect(r.text).toMatch(/\n {2}7- export interface Host/);
		expect(r.text).toMatch(/\n {2}8: ctx: ExtensionContext;/);
	});

	test("anything that is not path:line:text passes through", () => {
		expect(compactRg("src/a.ts\n  12: x")).toBeUndefined();
		expect(compactRg("a.ts:3\nb.ts:4")).toBeUndefined();
		expect(compactRg("")).toBeUndefined();
		expect(compactRg("12:foo:3:bar")).toBeUndefined();
		expect(compactRg("a.ts:1:x\nstray line")).toBeUndefined();
	});

	test("long lines and busy files are cut with markers", () => {
		const many = Array.from({ length: 30 }, (_, i) => `a.ts:${i + 1}:${"x".repeat(300)}`).join("\n");
		const r = compactRg(many, { lineChars: 50, perGroup: 5, total: 100 })!;
		expect(r.truncated).toBe(true);
		expect(r.text).toContain("… [+250 chars]");
		expect(r.text).toContain("… [+25 more in this file]");
		expect(r.text.startsWith("30 matches in 1 files")).toBe(true);
	});

	test("files beyond the total cap are counted, not silently dropped", () => {
		const many = Array.from({ length: 20 }, (_, i) => `f${i}.ts:1:x`).join("\n");
		const r = compactRg(many, { lineChars: 50, perGroup: 5, total: 6 })!;
		expect(r.truncated).toBe(true);
		expect(r.text).toMatch(/… \[\+\d+ more files\]$/);
	});

	test("a context line of a file without any match is rejected", () => {
		expect(compactRg("a.ts:1:x\nb.ts-2-y")).toBeUndefined();
	});

	test("a context line whose numbering is malformed is rejected", () => {
		expect(compactRg("a.ts:1:x\na.ts-zz-y")).toBeUndefined();
	});
});

describe("paths", () => {
	test("groups a real fd run by directory and loses no name", () => {
		const raw = fx("fd.txt");
		const r = compactPaths(raw)!;
		for (const line of raw.trim().split("\n")) {
			const name = line.replace(/\/$/, "").split("/").pop()!;
			expect(r.text).toContain(name);
		}
		expect(r.text.length).toBeLessThan(raw.length);
	});

	test("single entries keep their full path, names with spaces are quoted", () => {
		const r = compactPaths("a/b/only.ts\nc/x y.ts\nc/z.ts\n")!;
		expect(r.text).toBe('a/b/only.ts\nc/\n  "x y.ts" z.ts');
	});

	test("top-level names group under ./", () => {
		expect(compactPaths("a\nb\n")!.text).toBe("./\n  a b");
	});

	test("long directories wrap", () => {
		const names = Array.from({ length: 30 }, (_, i) => `d/file-number-${i}.ts`).join("\n");
		expect(compactPaths(names)!.text.split("\n").length).toBeGreaterThan(3);
	});

	test("one line, blank lines and tabbed output pass through", () => {
		expect(compactPaths("only\n")).toBeUndefined();
		expect(compactPaths("a\n\nb")).toBeUndefined();
		expect(compactPaths("a\tb\nc")).toBeUndefined();
	});

	test("caps the result", () => {
		const names = Array.from({ length: 50 }, (_, i) => `d${i}/f.ts`).join("\n");
		expect(compactPaths(names, { lineChars: 1, perGroup: 1, total: 10 })!.truncated).toBe(true);
	});
});

describe("lsd", () => {
	test("reduces a real lsd -la run and drops . and ..", () => {
		const raw = fx("lsd-la.txt");
		const r = compactLsd(raw)!;
		expect(r.text).not.toContain("EBEMXC4");
		expect(r.text).not.toMatch(/^\S+ +\.$/m);
		expect(r.text).toContain("package.json");
		expect(r.text).toMatch(/^d {2}\w{3} \d+ \d\d:\d\d {2}\.git$/m);
		expect(r.text).toMatch(/^- {2}\d+(\.\d+)?K?B {2}/m);
		expect(r.text.length).toBeLessThan(raw.length * 0.7);
	});

	test("a line that does not parse makes the whole thing pass through", () => {
		expect(compactLsd(`${fx("lsd-la.txt")}\nnot a listing`)).toBeUndefined();
		expect(compactLsd("a\nb")).toBeUndefined();
	});

	test("symlinks keep their target", () => {
		const raw = ["lrwxr-xr-x me staff 7 B Sat Oct 31 17:02:38 2026 ln -> x", "drwxr-xr-x me staff 7 B Sat Oct 31 17:02:38 2026 d", "-rw-r--r-- me staff 7 B Sat Oct 31 17:02:38 2026 f"].join("\n");
		expect(compactLsd(raw)!.text).toContain("l  7B  Oct 31 17:02  ln -> x");
	});
});

describe("compact router", () => {
	const raw = fx("rg-flat.txt");

	test("compacts rg output of a simple command", () => {
		const r = compact("rg -n import extensions", raw)!;
		expect(r.kind).toBe("search");
		expect(r.after).toBeLessThan(r.before);
	});

	test("leaves piped, short, unknown and flag-changed commands alone", () => {
		expect(compact("rg -n import | head", raw)).toBeUndefined();
		expect(compact("rg -n import", "a.ts:1:x")).toBeUndefined();
		expect(compact("cat file", raw)).toBeUndefined();
		expect(compact("rg -c import", raw)).toBeUndefined();
		expect(compact("rg --json import", raw)).toBeUndefined();
		expect(compact("rg -n import", "x".repeat(500))).toBeUndefined();
		expect(compact("", raw)).toBeUndefined();
	});

	test("keeps the original when the result is not clearly smaller", () => {
		expect(compact("rg -n import extensions", raw, { maxRatio: 0.01 })).toBeUndefined();
	});

	test("fd and find, but not fd -x or find -exec", () => {
		const fd = fx("fd.txt");
		expect(compact("fd . extensions", fd)!.kind).toBe("paths");
		expect(compact("find extensions -name '*.ts'", fd)!.kind).toBe("paths");
		expect(compact("fd -x echo", fd)).toBeUndefined();
		expect(compact("find . -exec echo {} ;", fd)).toBeUndefined();
	});

	test("lsd only in long form", () => {
		const ls = fx("lsd-la.txt");
		expect(compact("lsd -la", ls)!.kind).toBe("listing");
		expect(compact("lsd --long", ls)!.kind).toBe("listing");
		expect(compact("lsd", ls)).toBeUndefined();
	});
});

describe("stats", () => {
	test("empty then recorded", () => {
		const s = emptyStats();
		expect(summary(s)).toContain("nothing compacted");
		record(s, { text: "", kind: "search", truncated: false, before: 4000, after: 1000 });
		record(s, { text: "", kind: "paths", truncated: false, before: 400, after: 400 });
		expect(summary(s)).toBe("squeeze: 2 outputs compacted, ~750 tokens saved (68%): search 1× (~750 tokens), paths 1× (~0 tokens)");
		expect(tokens(10)).toBe(3);
	});
});
