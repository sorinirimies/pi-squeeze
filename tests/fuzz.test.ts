// Randomised robustness tests ("fuzzing" without extra dependencies).
//
// The generator is seeded, so a failure prints a seed that reproduces it exactly:
//
//   FUZZ_SEED=12345 bun test tests/fuzz.test.ts --config=bunfig.fuzz.toml
//   FUZZ_ITERS=200000 bun test tests/fuzz.test.ts --config=bunfig.fuzz.toml   (the nightly workflow)
//
// One property per parser or pure function: assert what must ALWAYS hold, not one example.
import { describe, expect, it } from "bun:test";
import { greet } from "../extensions/squeeze.ts";

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

describe("fuzz", () => {
	fuzz("greet never throws and always greets", (r) => {
		const out = greet(text(r));
		expect(out.startsWith("Hello")).toBe(true);
		expect(out.endsWith("!")).toBe(true);
	});
});
