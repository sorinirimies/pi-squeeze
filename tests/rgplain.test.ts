import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compact } from "../extensions/core/compact.ts";
import { DEFAULT_LIMITS } from "../extensions/core/elide.ts";
import { fileIn } from "../extensions/core/files.ts";
import { compactRgPlain, parsePlainRows } from "../extensions/core/rg.ts";
import { fakeCtx, load } from "./helpers.ts";

const plain = await Bun.file(join(import.meta.dir, "fixtures", "rg-plain.txt")).text();
// A copy of the tree the fixture was taken in, so the file checks do not depend on this repo's layout.
const root = mkdtempSync(join(tmpdir(), "sq-rgplain-"));
for (const path of new Set(plain.trim().split("\n").map((l) => l.slice(0, l.indexOf(":"))))) {
	mkdirSync(join(root, path, ".."), { recursive: true });
	writeFileSync(join(root, path), "");
}
writeFileSync(join(root, "package.json"), "{}");
writeFileSync(join(root, "README.md"), "");
const here = fileIn(root);

describe("fileIn", () => {
	test("true only for an existing file", () => {
		expect(here("package.json")).toBe(true);
		expect(here("extensions/core")).toBe(false);
		expect(here("nope.txt")).toBe(false);
		expect(here("package.json/x")).toBe(false);
		expect(here("a\0b")).toBe(false);
		expect(fileIn(undefined)("package.json")).toBe(false);
		expect(fileIn("")("package.json")).toBe(false);
	});
});

describe("rg without line numbers", () => {
	test("groups a real `rg import extensions` run by file", () => {
		const r = compactRgPlain(plain, DEFAULT_LIMITS, here)!;
		expect(r.text).toMatch(/^\d+ matches in \d+ files\n/);
		expect(r.text).toContain("extensions/squeeze.ts (");
		expect(r.text).toMatch(/^ {2}import /m);
		expect(r.text).not.toMatch(/^ {2}\d+: /m);
		expect(r.text.length).toBeLessThan(plain.length * 0.9);
	});

	test("a prefix that is not an existing file means it is not path:text: pass through", () => {
		expect(parsePlainRows(`${plain}not/a/file.ts:import x`, here)).toBeUndefined();
		expect(parsePlainRows(`${plain}no colon here`, here)).toBeUndefined();
		expect(parsePlainRows(`${plain}:starts with a colon`, here)).toBeUndefined();
		expect(parsePlainRows("", here)).toBeUndefined();
		expect(parsePlainRows("\n\n", here)).toBeUndefined();
	});

	test("each path is looked up once, and no more than 500 paths", () => {
		let calls = 0;
		const count = (p: string) => (calls++, here(p));
		parsePlainRows(plain, count);
		expect(calls).toBe(new Set(plain.trim().split("\n").map((l) => l.slice(0, l.indexOf(":")))).size);
		const many = Array.from({ length: 501 }, (_, i) => `f${i}:x`).join("\n");
		expect(parsePlainRows(many, () => true)).toBeUndefined();
		expect(parsePlainRows(many.split("\n").slice(0, 500).join("\n"), () => true)!.length).toBe(500);
	});

	test("the router uses it only when it can check files, and not for -n, context, cd or a single file", () => {
		const opts = { isFile: here };
		expect(compact("rg import extensions", plain, opts)!.kind).toBe("search");
		expect(compact("grep -r import extensions", plain, opts)!.kind).toBe("search");
		expect(compact("rg import extensions", plain)).toBeUndefined();
		expect(compact("rg -C2 import extensions", plain, opts)).toBeUndefined();
		expect(compact("rg -A 1 import extensions", plain, opts)).toBeUndefined();
		expect(compact("cd x && rg import extensions", plain, opts)).toBeUndefined();
		expect(compact("rg import package.json", plain, opts)).toBeUndefined();
		expect(compact("rg import package.json README.md", plain, opts)!.kind).toBe("search");
		expect(compact("rg -n import extensions", plain, opts)).toBeUndefined();
	});

	test("the extension checks paths in the session's directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sq-plain-"));
		mkdirSync(join(dir, "src", "components", "widgets"), { recursive: true });
		const lines: string[] = [];
		for (let f = 0; f < 6; f++) {
			writeFileSync(join(dir, "src", "components", "widgets", `f${f}.tsx`), "x");
			for (let i = 0; i < 8; i++) lines.push(`src/components/widgets/f${f}.tsx:import { thing${i} } from "./x";`);
		}
		const text = lines.join("\n");
		const { hooks } = load();
		const ev = { toolName: "bash", isError: false, input: { command: "rg import src" }, content: [{ type: "text", text }], details: undefined };
		const out = await hooks.tool_result!(ev, { ...fakeCtx(), cwd: dir });
		expect(out.content[0].text).toStartWith("48 matches in 6 files\nsrc/components/widgets/f0.tsx (8)\n  import { thing0 }");
		expect(await hooks.tool_result!(ev, { ...fakeCtx(), cwd: tmpdir() })).toBeUndefined();
	});
});
