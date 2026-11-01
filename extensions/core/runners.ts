/**
 * Test runners other than cargo: `bun test` and `go test`. Passing tests are counted, not
 * listed; failures (with their source frame and message), skips and the totals stay.
 */
import { capLines, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

/** `(pass) name [1ms]` lines go, and a file header left with nothing under it goes too. */
export function compactBunTest(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines.some((l) => /^Ran \d+ tests? across \d+ files?\./.test(l))) return undefined;
	const kept: string[] = [];
	for (const l of lines) {
		if (/^\(pass\) /.test(l)) continue;
		// The file header (`path.test.ts:`) is only worth keeping when something stayed under it.
		if (l === "" && (kept.length === 0 || kept.at(-1) === "")) continue;
		kept.push(l);
	}
	const out: string[] = [];
	for (let i = 0; i < kept.length; i++) {
		const header = /^\S+\.(test|spec)\.\w+:$/.test(kept[i]!);
		const empty = kept[i + 1] === undefined || kept[i + 1] === "" || /^\S+\.(test|spec)\.\w+:$/.test(kept[i + 1]!);
		if (header && empty) continue;
		out.push(kept[i]!);
	}
	const tidy = out.filter((l, i) => !(l === "" && (i === 0 || out[i - 1] === "")));
	return capLines(tidy, limits.total);
}

/** `ok pkg 0.3s`, `? pkg [no test files]` and `PASS` collapse into one count line; `=== RUN` and `--- PASS` go. */
export function compactGoTest(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	let ok = 0;
	let failed = 0;
	let none = 0;
	const kept: string[] = [];
	for (const l of lines) {
		if (/^ok\s+\S+/.test(l)) ok++;
		else if (/^\?\s+\S+\s+\[no test files\]$/.test(l)) none++;
		else if (/^(FAIL)\s+\S+(\s|$)/.test(l) && /\s\d/.test(l)) {
			failed++;
			kept.push(l);
		} else if (/^(=== (RUN|PAUSE|CONT|NAME)|\s*--- PASS:|PASS$)/.test(l)) continue;
		else kept.push(l);
	}
	if (!ok && !failed && !none) return undefined;
	const parts = [`${ok} ok`, `${failed} failed`, ...(none ? [`${none} without tests`] : [])];
	return capLines([`go test: ${parts.join(", ")}`, ...kept], limits.total);
}
