/**
 * `rg -n` / `grep -n` output (`path:line:text`, context lines `path-line-text`) grouped by
 * file, so each path is written once instead of on every match:
 *
 *   src/a.ts (3)
 *     12: const x = 1;
 *     13- context
 *
 * Without line numbers (`rg pattern dir`, `path:text`) the path cannot be told from text that
 * has a colon, so `compactRgPlain` only groups when every path is a file that exists.
 *
 * Strict: when any line is not in that format (`--heading`, `-c`, `-l`, `--json`) it returns
 * undefined and the output passes through unchanged.
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

/** At most this many distinct paths are looked up on disk. */
const MAX_LOOKUPS = 500;

/** `path:text` rows (no line numbers), or undefined unless every path is an existing file. */
export function parsePlainRows(output: string, isFile: (path: string) => boolean): Row[] | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines.length) return undefined;
	const known = new Map<string, boolean>();
	const rows: Row[] = [];
	for (const raw of lines) {
		const at = raw.indexOf(":");
		if (at <= 0) return undefined;
		const path = raw.slice(0, at);
		let ok = known.get(path);
		if (ok === undefined) {
			if (known.size >= MAX_LOOKUPS) return undefined;
			ok = isFile(path);
			known.set(path, ok);
		}
		if (!ok) return undefined;
		rows.push({ path, line: 0, sep: ":", text: raw.slice(at + 1) });
	}
	return rows;
}

export function compactRg(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const rows = parseRows(output);
	return rows && render(rows, limits);
}

export function compactRgPlain(output: string, limits: Limits, isFile: (path: string) => boolean): Squeezed | undefined {
	const rows = parsePlainRows(output, isFile);
	return rows && render(rows, limits);
}

function render(rows: Row[], limits: Limits): Squeezed {
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
			out.push(`  ${r.line ? `${r.line}${r.sep} ` : ""}${cutLine(r.text.trim(), limits.lineChars)}`);
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
