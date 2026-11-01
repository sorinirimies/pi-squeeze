/**
 * `tsc` (plain, not `--pretty`) errors grouped by file:
 *
 *   a.ts (8)
 *     1:7 TS2322 Type 'string' is not assignable to type 'number'.
 *
 * Continuation lines (indented) stay with their error. The `Found N errors` footer stays.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

const ERROR = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
const FOOTER = /^Found \d+ errors?( in \d+ files?)?\.?$|^Errors +Files$|^ +\d+ +\S.*$/;

export function compactTsc(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	const files = new Map<string, string[]>();
	const tail: string[] = [];
	let current: string[] | undefined;
	let errors = 0;
	for (const l of lines) {
		const m = ERROR.exec(l);
		if (m) {
			errors++;
			current = files.get(m[1]!) ?? [];
			files.set(m[1]!, current);
			current.push(cutLine(`  ${m[2]}:${m[3]} ${m[4] === "warning" ? "warning " : ""}${m[5]} ${m[6]}`, limits.lineChars));
		} else if (/^\s+\S/.test(l) && current && !tail.length) current.push(cutLine(`    ${l.trim()}`, limits.lineChars));
		else if (l === "" || FOOTER.test(l)) {
			tail.push(l);
			current = undefined;
		} else return undefined;
	}
	if (!errors) return undefined;
	const out = [`tsc: ${errors} error${errors === 1 ? "" : "s"} in ${files.size} file${files.size === 1 ? "" : "s"}`];
	let cut = false;
	for (const [file, entries] of files) {
		out.push(`${file} (${entries.filter((e) => !e.startsWith("    ")).length})`);
		out.push(...entries.slice(0, limits.perGroup * 2));
		if (entries.length > limits.perGroup * 2) {
			out.push(`  … [+${entries.length - limits.perGroup * 2} more lines]`);
			cut = true;
		}
	}
	const footer = tail.filter((l) => l !== "");
	if (footer.length) out.push("", ...footer);
	const capped = capLines(out, limits.total);
	return { text: capped.text, truncated: cut || capped.truncated };
}
