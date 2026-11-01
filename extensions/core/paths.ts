/**
 * `fd` / `find` output (one path per line) grouped by directory:
 *
 *   src/core/
 *     a.ts b.ts c.ts
 *
 * Names with spaces are quoted. A directory with a single entry keeps its full path.
 */
import { capLines, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

function split(path: string): [string, string] {
	const dir = path.endsWith("/");
	const body = dir ? path.slice(0, -1) : path;
	const i = body.lastIndexOf("/");
	if (i < 0) return ["", path];
	return [body.slice(0, i + 1), body.slice(i + 1) + (dir ? "/" : "")];
}

export function compactPaths(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (lines.length < 2 || lines.some((l) => l === "" || l.includes("\t"))) return undefined;

	const groups = new Map<string, string[]>();
	for (const l of lines) {
		const [dir, name] = split(l);
		const g = groups.get(dir);
		if (g) g.push(name);
		else groups.set(dir, [name]);
	}
	const out: string[] = [];
	for (const [dir, names] of groups) {
		if (names.length === 1) {
			out.push(`${dir}${names[0]}`);
			continue;
		}
		out.push(dir || "./");
		const quoted = names.map((n) => (/\s/.test(n) ? JSON.stringify(n) : n));
		let row = "  ";
		for (const n of quoted) {
			if (row.length + n.length > 100 && row.trim()) {
				out.push(row.trimEnd());
				row = "  ";
			}
			row += `${n} `;
		}
		if (row.trim()) out.push(row.trimEnd());
	}
	return capLines(out, limits.total);
}
