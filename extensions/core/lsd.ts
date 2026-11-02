/**
 * `lsd -l`, `eza -l` and `ls -l` listings reduced to what a model uses: type, size, modified
 * time (no year or seconds) and name. Owner, group and permission bits are dropped.
 *
 *   d  Oct 24 16:40  command
 *   -  6.0KB  Oct 24 16:40  tokenburn.ts
 *
 * Strict: a single line that does not parse makes it return undefined.
 */
import { capLines, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

type Row = { type: string; size: string; when: string; name: string };
type Parser = (line: string) => Row | undefined;

const kindOf = (k: string) => (k === "d" ? "d" : k === "l" ? "l" : "-");

/** lsd: `.rw-r--r-- user group 1.9 KB Sun Nov  1 23:14:32 2026 name` */
const LSD = /^([dl.\-bcps])[rwxsStT\-.+@]{9}\S*\s+\S+\s+\S+\s+([\d.,]+ ?[A-Za-z]*)\s+\w{3} (\w{3})\s+(\d+) (\d\d:\d\d):\d\d \d{4}\s+(.+)$/;
/** eza: `.rw-r--r--@ 1.9k user [group]  1 Nov 23:14 name` (a year instead of the time when old) */
const EZA = /^([dl.\-bcps])[rwxsStT\-.+@]{9}\S*\s+(-|[\d.,]+[kMGTPE]?)\s+\S+(?:\s+\S+)?\s+(\d{1,2}) (\w{3})\s+(\d\d:\d\d|\d{4})\s+(.+)$/;
/** ls: `-rw-r--r--@ 1 user group 1934 Nov  1 23:14 name` */
const LS = /^([dl\-bcps])[rwxsStT\-]{9}[@+.]?\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3})\s+(\d{1,2})\s+(\d\d:\d\d|\d{4})\s+(.+)$/;

/** Bytes as ls -lh would say them. */
export function human(bytes: number): string {
	const units = ["B", "K", "M", "G", "T"];
	let n = bytes;
	let u = 0;
	while (n >= 1024 && u < units.length - 1) (n /= 1024), u++;
	return u === 0 ? `${n}B` : `${n < 10 ? n.toFixed(1) : Math.round(n)}${units[u]}`;
}

const PARSERS: Parser[] = [
	(l: string) => {
		const m = LSD.exec(l);
		return m ? { type: kindOf(m[1]!), size: m[2]!.replace(/\s+/g, ""), when: `${m[3]} ${m[4]} ${m[5]}`, name: m[6]! } : undefined;
	},
	(l: string) => {
		const m = EZA.exec(l);
		return m ? { type: kindOf(m[1]!), size: m[2]!, when: `${m[4]} ${m[3]} ${m[5]}`, name: m[6]! } : undefined;
	},
	(l: string) => {
		const m = LS.exec(l);
		return m ? { type: kindOf(m[1]!), size: human(Number(m[2])), when: `${m[3]} ${m[4]} ${m[5]}`, name: m[6]! } : undefined;
	},
];

export function compactLsd(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (/^total \d+/.test(lines[0] ?? "")) lines.shift(); // ls -l
	if (lines.length < 3) return undefined;
	const parse = PARSERS.find((p) => p(lines[0]!));
	if (!parse) return undefined;
	const out: string[] = [];
	for (const l of lines) {
		const row = parse(l);
		if (!row) return undefined;
		if (row.name === "." || row.name === "..") continue;
		const meta = row.type === "d" ? "" : `${row.size}  `;
		out.push(`${row.type}  ${meta}${row.when}  ${row.name}`);
	}
	return capLines(out, limits.total);
}
