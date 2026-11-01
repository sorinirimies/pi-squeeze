/**
 * `dust` without the bar chart: the size, the tree and the share stay, the 35 columns of
 * `█░` bars go.
 *
 *    26Mi   ┌── lib                14%
 *
 * Strict: a line without the bar column makes it return undefined.
 */
import { capLines, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

const ROW = /^(\s*\S+\s+.*?)\s*│[█▓▒░ ]+│\s*(\d+%)\s*$/;

export function compactDust(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n").map((l) => l.replace(/^\r\s*\r/, "").replace(/\r$/, ""));
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (lines.length < 3) return undefined;
	const out: string[] = [];
	for (const l of lines) {
		const m = ROW.exec(l);
		if (!m) return undefined;
		out.push(`${m[1]}  ${m[2]}`);
	}
	return capLines(out, limits.total);
}
