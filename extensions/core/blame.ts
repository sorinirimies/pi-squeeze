/**
 * `git blame` with one header per run of lines from the same commit:
 *
 *   bd6a3dd4 Sorin Albu-Irimies 2026-10-16
 *     1: # Dodai UI
 *     2:
 *
 * Strict: a line that is not in the default blame format returns undefined.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

const ROW = /^(\^?[0-9a-f]{6,40}) (?:\S+ +)?\((.+?) +(\d{4}-\d\d-\d\d) \d\d:\d\d:\d\d [+-]\d{4} +(\d+)\) ?(.*)$/;

export function compactBlame(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines.length) return undefined;
	const out: string[] = [];
	let last = "";
	for (const l of lines) {
		const m = ROW.exec(l);
		if (!m) return undefined;
		const [, hash, author, date, no, text] = m;
		const key = `${hash} ${author} ${date}`;
		if (key !== last) {
			out.push(key);
			last = key;
		}
		out.push(cutLine(`  ${no}: ${text}`, limits.lineChars));
	}
	return capLines(out, limits.total);
}
