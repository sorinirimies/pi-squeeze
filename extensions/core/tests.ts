/**
 * `cargo test` output: the build progress, the `test … ok` lines and the `running N tests`
 * headers go; warnings, failures, panics, `Running …` and `test result` lines stay. A one-line
 * summary of the totals comes first.
 */
import { capLines, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

const PROGRESS = /^\s+(Compiling|Downloaded|Downloading|Updating|Locking|Fresh|Blocking|Adding|Packaging|Checking|Building|Finished) /;
const OK = /^test .* \.\.\. (ok|ignored)(, .*)?$/;
const RUNNING_N = /^running \d+ tests?$/;
const RESULT = /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;/;

export function compactTests(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	let passed = 0;
	let failed = 0;
	let ignored = 0;
	let binaries = 0;
	let sawProgress = false;
	let inFailures = false;
	const kept: string[] = [];
	for (const l of lines) {
		const r = RESULT.exec(l);
		if (r) {
			binaries++;
			passed += Number(r[2]);
			failed += Number(r[3]);
			ignored += Number(r[4]);
		}
		if (l === "failures:") inFailures = true;
		if (r) inFailures = false;
		if (PROGRESS.test(l)) {
			sawProgress = true;
			continue;
		}
		if (OK.test(l) || RUNNING_N.test(l)) continue;
		const run = /^(\s+Running .*?) \(target\/.*\)$/.exec(l);
		const text = run ? run[1]! : l;
		// Blank lines only separate blocks: they stay only inside the failure report, where they separate panics.
		if (text === "" && !inFailures) continue;
		kept.push(text);
	}
	if (binaries === 0 && !sawProgress) return undefined;
	const head = binaries ? [`cargo test: ${passed} passed, ${failed} failed, ${ignored} ignored (${binaries} test binar${binaries === 1 ? "y" : "ies"})`] : [];
	return capLines([...head, ...kept], limits.total);
}
