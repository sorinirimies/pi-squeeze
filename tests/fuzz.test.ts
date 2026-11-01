// Randomised robustness tests ("fuzzing" without extra dependencies).
//
// The generator is seeded, so a failure prints a seed that reproduces it exactly:
//
//   FUZZ_SEED=12345 bun test tests/fuzz.test.ts --config=bunfig.fuzz.toml
//   FUZZ_ITERS=200000 bun test tests/fuzz.test.ts --config=bunfig.fuzz.toml   (the nightly workflow)
//
// One property per parser or pure function: assert what must ALWAYS hold, not one example.
import { describe, expect, it } from "bun:test";
import { compact } from "../extensions/core/compact.ts";
import { parse, tokenize } from "../extensions/core/command.ts";
import { compactDiff } from "../extensions/core/diff.ts";
import { compactTests } from "../extensions/core/tests.ts";
import { compactLsd } from "../extensions/core/lsd.ts";
import { compactPaths } from "../extensions/core/paths.ts";
import { compactRg } from "../extensions/core/rg.ts";

const ITERS = Number(process.env.FUZZ_ITERS ?? 400);
const SEED = Number(process.env.FUZZ_SEED ?? Math.floor(Math.random() * 2 ** 31));

/** mulberry32: small, fast, seedable. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Printable ASCII, mostly; sometimes control characters and lone surrogates. */
function text(r: () => number, max = 24): string {
	const len = Math.floor(r() * max);
	let s = "";
	for (let i = 0; i < len; i++) s += String.fromCharCode(r() < 0.8 ? 32 + Math.floor(r() * 95) : Math.floor(r() * 0xd800));
	return s;
}

/** Run `fn` ITERS times; on failure say which iteration and how to reproduce it. */
function fuzz(name: string, fn: (r: () => number) => void, iters = ITERS) {
	it(`${name} (seed ${SEED}, ${iters} runs)`, () => {
		const r = rng(SEED);
		for (let i = 0; i < iters; i++) {
			try {
				fn(r);
			} catch (e) {
				throw new Error(`iteration ${i}, reproduce with FUZZ_SEED=${SEED}: ${(e as Error).message}`);
			}
		}
	});
}

const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;

/** A line that sometimes looks like rg output and sometimes like noise. */
function line(r: () => number): string {
	switch (Math.floor(r() * 5)) {
		case 0: return `${pick(r, ["a.ts", "src/b.ts", "x y/c.ts"])}:${Math.floor(r() * 99)}:${text(r)}`;
		case 1: return `${pick(r, ["a.ts", "src/b.ts"])}-${Math.floor(r() * 99)}-${text(r)}`;
		case 2: return "--";
		case 3: return `${pick(r, ["src/", "a/b/", ""])}${text(r, 8)}`;
		default: return text(r);
	}
}

const doc = (r: () => number) => Array.from({ length: Math.floor(r() * 60) }, () => line(r)).join("\n");

describe("fuzz", () => {
	fuzz("compactors never throw, whatever the input", (r) => {
		const d = doc(r);
		compactRg(d);
		compactPaths(d);
		compactLsd(d);
		compactDiff(d);
		compactDiff(`diff --git a/x b/x\n${d}`);
		compactTests(d);
	});

	fuzz("a compacted diff keeps every changed line of every hunk", (r) => {
		const files = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, f) => {
			const body = Array.from({ length: 1 + Math.floor(r() * 12) }, () => pick(r, [" ctx", "+add", "-del"]).replace(/$/, text(r, 6).replace(/\n/g, " ")));
			const old = body.filter((l) => l[0] !== "+").length;
			const neu = body.filter((l) => l[0] !== "-").length;
			return { path: `f${f}.ts`, body, text: [`diff --git a/f${f}.ts b/f${f}.ts`, "index 1..2 100644", `--- a/f${f}.ts`, `+++ b/f${f}.ts`, `@@ -1,${old} +1,${neu} @@`, ...body].join("\n") };
		});
		const out = compactDiff(files.map((f) => f.text).join("\n"));
		expect(out).toBeDefined();
		const kept = out!.text.split("\n");
		for (const f of files) for (const l of f.body) if (l[0] !== " ") expect(kept).toContain(l);
	});

	fuzz("a compacted test run keeps every failing test and every result line", (r) => {
		const names = Array.from({ length: 1 + Math.floor(r() * 30) }, (_, i) => ({ n: `t::case_${i}`, ok: r() < 0.7 }));
		const raw = ["   Compiling x v0.1.0", `running ${names.length} tests`, ...names.map((t) => `test ${t.n} ... ${t.ok ? "ok" : "FAILED"}`), `test result: ${names.every((t) => t.ok) ? "ok" : "FAILED"}. 1 passed; 1 failed; 0 ignored; 0 measured`].join("\n");
		const out = compactTests(raw)!.text.split("\n");
		for (const t of names) if (!t.ok) expect(out).toContain(`test ${t.n} ... FAILED`);
		expect(out.some((l) => l.startsWith("test result:"))).toBe(true);
	});

	fuzz("a compacted search keeps every match's text and loses no file", (r) => {
		const d = Array.from({ length: 1 + Math.floor(r() * 40) }, () => `${pick(r, ["a.ts", "b/c.ts", "d.ts"])}:${1 + Math.floor(r() * 99)}:${text(r, 20).replace(/\n/g, " ")}`).join("\n");
		const out = compactRg(d, { lineChars: 1000, perGroup: 1000, total: 1000 });
		if (!out) return;
		expect(out.truncated).toBe(false);
		for (const l of d.split("\n")) {
			const m = /^(.+?):(\d+):(.*)$/.exec(l)!;
			expect(out.text).toContain(`${m[2]}: ${m[3]!.trim()}`);
			expect(out.text).toContain(`${m[1]} (`);
		}
	});

	fuzz("compact output never exceeds the cap by more than the marker", (r) => {
		const out = compactPaths(Array.from({ length: 5 + Math.floor(r() * 80) }, (_, i) => `d${i % 7}/f${i}.ts`).join("\n"), { lineChars: 10, perGroup: 5, total: 12 });
		expect(out!.text.split("\n").length).toBeLessThanOrEqual(13);
	});

	fuzz("compact() only ever returns something smaller", (r) => {
		const d = doc(r);
		const res = compact(pick(r, ["rg -n x", "fd .", "lsd -l", "grep -rn x", "cat f", "rg x | wc -l"]), d, { minChars: 0 });
		if (res) expect(res.text.length).toBeLessThanOrEqual(d.length);
	});

	fuzz("tokenize and parse never throw", (r) => {
		const s = text(r, 40);
		tokenize(s);
		parse(s);
	});
});
