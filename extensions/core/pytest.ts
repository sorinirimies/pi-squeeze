/**
 * pytest: the session header, progress dots and PASSED lines go; failures, errors, the
 * warnings summary, the short test summary and the result line stay.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { stripAnsi } from "./generic.ts";

const RESULT = /^=+ .*\b(passed|failed|errors?|skipped|deselected|no tests ran)\b.* in [\d.]+s.* =+$/;
const DROP = [
	/^=+ test session starts =+$/,
	/^platform \S+ -- Python /,
	/^(rootdir|cachedir|plugins|configfile|testpaths|cov|hypothesis profile|benchmark|asyncio|django|metadata): /,
	/^collect(ing|ed) \d+ items?/,
	/^collecting \.\.\./,
	/^-- Docs: https:\/\/docs\.pytest\.org/,
	// `test_a.py ..F.s   [ 50%]`: the failures are listed again below.
	/^\S+\.py [.sSxXfFE]+\s*(\[\s*\d+%\])?$/,
	/ PASSED\s*(\[\s*\d+%\])?$/,
];

export function compactPytest(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = stripAnsi(output).split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	const result = lines.findLast((l) => RESULT.test(l));
	if (!result) return undefined;
	const kept: string[] = [];
	for (const l of lines) {
		if (RESULT.test(l) || DROP.some((d) => d.test(l))) continue;
		if (l === "" && (kept.length === 0 || kept.at(-1) === "")) continue;
		// `-v`: `test_a.py::test_x FAILED [ 50%]` keeps its verdict, loses the percentage;
		// a full-width `==== FAILURES ====` / `____ test_x ____` banner keeps two of each.
		const line = l.replace(/\s+\[\s*\d+%\]$/, "").replace(/^([=_])\1{2,} (.*?) \1{3,}$/, "$1$1 $2 $1$1");
		kept.push(cutLine(line, limits.lineChars));
	}
	while (kept.at(-1) === "") kept.pop();
	return capLines([`pytest: ${result.replace(/^=+ | =+$/g, "")}`, ...kept], limits.total);
}
