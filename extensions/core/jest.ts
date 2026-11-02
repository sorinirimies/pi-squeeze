/**
 * jest and vitest: passing tests (`✓`) and passing files go, skipped tests are counted;
 * failures with their diff and source frame, and the totals, stay.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { stripAnsi } from "./generic.ts";

const TOTALS = /^\s*(Tests|Test Files|Test Suites):?\s+\d+ (passed|failed|skipped|todo|total)/;
const PASS = [
	/^\s*[✓√] /,
	/^PASS /,
	/^ RUN {2}v[\d.]+/,
	/^\s+Start at {2}/,
	/^Snapshots: {3}0 total$/,
	/^Ran all test suites\.$/,
];
const SKIP = /^\s*[↓○] (skipped )?/;

export function compactJest(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = stripAnsi(output).split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines.some((l) => TOTALS.test(l))) return undefined;
	const kept: string[] = [];
	let skipped = 0;
	for (const l of lines) {
		if (PASS.some((p) => p.test(l))) continue;
		if (SKIP.test(l)) {
			skipped++;
			continue;
		}
		if (l.trim() === "" && (kept.length === 0 || kept.at(-1) === "")) continue;
		// vitest's full-width `⎯⎯⎯ Failed Tests 2 ⎯⎯⎯` rules keep two of their dashes.
		kept.push(cutLine(l.trim() === "" ? "" : l.replace(/⎯{3,}/g, "⎯⎯"), limits.lineChars));
	}
	while (kept.at(-1) === "") kept.pop();
	if (skipped) kept.push(`(${skipped} skipped not listed)`);
	return capLines(kept, limits.total);
}
