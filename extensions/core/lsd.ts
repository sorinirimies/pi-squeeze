/**
 * `lsd -l` / `eza -l` style listings reduced to what a model uses: type, size, modified
 * time (no year or seconds) and name. Owner, group and permission bits are dropped.
 *
 *   d  Oct 24 16:40  command
 *   -  6.0KB  Oct 24 16:40  tokenburn.ts
 *
 * Strict: a single line that does not parse makes it return undefined.
 */
import { capLines, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

const ROW = /^([dl.\-bcps])[rwxsStT\-.+@]{9}\S*\s+\S+\s+\S+\s+([\d.,]+ ?[A-Za-z]*)\s+(\w{3}) (\w{3})\s+(\d+) (\d\d:\d\d):\d\d \d{4}\s+(.+)$/;

export function compactLsd(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (lines.length < 3) return undefined;
	const out: string[] = [];
	for (const l of lines) {
		const m = ROW.exec(l);
		if (!m) return undefined;
		const [, kind, size, , month, day, time, name] = m;
		if (name === "." || name === "..") continue;
		const type = kind === "d" ? "d" : kind === "l" ? "l" : "-";
		const meta = type === "d" ? "" : `${size!.replace(/\s+/g, "")}  `;
		out.push(`${type}  ${meta}${month} ${day} ${time}  ${name}`);
	}
	return capLines(out, limits.total);
}
