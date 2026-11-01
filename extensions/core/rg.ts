/**
 * `rg -n` / `grep -n` output (`path:line:text`, context lines `path-line-text`) grouped by
 * file, so each path is written once instead of on every match:
 *
 *   src/a.ts (3)
 *     12: const x = 1;
 *     13- context
 *
 * Strict: when any line is not in that format (`--heading`, `-c`, `-l`, `--json`, no
 * line numbers) it returns undefined and the output passes through unchanged.
 */
import { cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

type Row = { path: string; line: number; sep: ":" | "-"; text: string };

const MATCH = /^(.+?):(\d+):(.*)$/;

export function parseRows(output: string): Row[] | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines.length) return undefined;
	const rows: Row[] = [];
	const files = new Set<string>();
	const pending: { index: number; raw: string }[] = [];
	for (const raw of lines) {
		if (raw === "--") continue;
		const m = MATCH.exec(raw);
		if (m) {
			if (m[1]!.includes(":")) return undefined; // `12:foo:3:bar` is single-file output, not a path
			files.add(m[1]!);
			rows.push({ path: m[1]!, line: Number(m[2]), sep: ":", text: m[3]! });
		} else {
			pending.push({ index: rows.length, raw });
			rows.push(undefined as unknown as Row);
		}
	}
	if (!files.size) return undefined;
	// Context lines (`path-line-text`) only count for files that also had a real match.
	for (const { index, raw } of pending) {
		let row: Row | undefined;
		for (const path of files) {
			if (!raw.startsWith(`${path}-`)) continue;
			const m = /^(\d+)-(.*)$/.exec(raw.slice(path.length + 1));
			if (m) {
				row = { path, line: Number(m[1]), sep: "-", text: m[2]! };
				break;
			}
		}
		if (!row) return undefined;
		rows[index] = row;
	}
	return rows;
}

export function compactRg(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const rows = parseRows(output);
	if (!rows) return undefined;
	const groups = new Map<string, Row[]>();
	for (const r of rows) {
		const g = groups.get(r.path);
		if (g) g.push(r);
		else groups.set(r.path, [r]);
	}
	const matchCount = rows.filter((r) => r.sep === ":").length;
	const out: string[] = [`${matchCount} matches in ${groups.size} file${groups.size === 1 ? "" : "s"}`];
	let truncated = false;
	let hiddenFiles = 0;
	for (const [path, list] of groups) {
		if (out.length >= limits.total) {
			hiddenFiles++;
			truncated = true;
			continue;
		}
		const matches = list.filter((r) => r.sep === ":").length;
		out.push(`${path} (${matches})`);
		let shown = 0;
		for (const r of list) {
			if (shown >= limits.perGroup) break;
			out.push(`  ${r.line}${r.sep} ${cutLine(r.text.trim(), limits.lineChars)}`);
			shown++;
		}
		if (list.length > shown) {
			out.push(`  … [+${list.length - shown} more in this file]`);
			truncated = true;
		}
	}
	if (hiddenFiles) out.push(`… [+${hiddenFiles} more files]`);
	return { text: out.join("\n"), truncated };
}
