import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compactTests } from "../extensions/core/tests.ts";

const fx = (n: string) => readFileSync(join(import.meta.dir, "fixtures", n), "utf8");

describe("compactTests", () => {
	test("a passing run shrinks to the totals and the result lines", () => {
		const raw = fx("cargo-test-ok.txt");
		const r = compactTests(raw)!;
		expect(r.text.length).toBeLessThan(raw.length * 0.1);
		const lines = r.text.split("\n");
		expect(lines[0]).toBe("cargo test: 226 passed, 0 failed, 0 ignored (4 test binaries)");
		expect(lines).toContain("     Running unittests src/lib.rs");
		expect(r.text).not.toMatch(/Compiling|\.\.\. ok|^running \d+ tests/m);
		expect(r.text).not.toContain("target/debug");
		expect(r.truncated).toBe(false);
	});

	test("a failing run keeps every failure, panic and the failure list, drops ok and ignored lines", () => {
		const raw = fx("cargo-test-fail.txt");
		const t = compactTests(raw)!.text;
		expect(t.split("\n")[0]).toBe("cargo test: 2 passed, 2 failed, 1 ignored (1 test binary)");
		for (const keep of ["test tests::broken ... FAILED", "---- tests::broken stdout ----", "assertion `left == right` failed: math is hard", "index out of bounds", "    tests::also_broken", "test result: FAILED. 2 passed; 2 failed", "error: test failed, to rerun pass `--lib`"]) expect(t).toContain(keep);
		expect(t).not.toMatch(/\.\.\. ok|ignored$|Compiling/m);
		// blank lines survive inside the failure report only
		expect(t).toContain("failures:\n\n---- tests::broken stdout ----\n\nthread");
	});

	test("a build that fails before any test ran loses only the progress lines", () => {
		const raw = "   Compiling a v0.1.0 (/x)\nerror[E0425]: cannot find value `x`\n --> src/lib.rs:1:1\n\nerror: could not compile `a` (lib) due to 1 previous error\n";
		const r = compactTests(raw)!;
		expect(r.text).toBe("error[E0425]: cannot find value `x`\n --> src/lib.rs:1:1\nerror: could not compile `a` (lib) due to 1 previous error");
	});

	test("ok lines with a trailing note (bench, should_panic) are dropped too", () => {
		const raw = "test a ... ok\ntest b ... ignored, reason\ntest result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out\n";
		expect(compactTests(raw)!.text.split("\n")).toEqual(["cargo test: 1 passed, 0 failed, 1 ignored (1 test binary)", "test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out"]);
	});

	test("anything else is not a cargo test run", () => {
		expect(compactTests("")).toBeUndefined();
		expect(compactTests("just some text\nmore text")).toBeUndefined();
	});

	test("a very long failure report is capped with a marker", () => {
		const raw = `test result: FAILED. 0 passed; 1 failed; 0 ignored;\nfailures:\n${Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n")}`;
		const r = compactTests(raw, { lineChars: 240, perGroup: 15, total: 50 })!;
		expect(r.truncated).toBe(true);
		expect(r.text.split("\n").at(-1)).toMatch(/^… \[\+\d+ more lines\]$/);
	});
});
