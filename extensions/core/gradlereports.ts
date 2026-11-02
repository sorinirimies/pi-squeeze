/**
 * Gradle's own reports, which list far more than anyone reads:
 *
 * * `gradle tasks [--all]`: per group, the task names on one line; the descriptions go.
 * * `gradle projects`: every project path (Gradle prints them twice, flat and as a tree)
 *   once, grouped by the first segment: `:api (60): analytics analytics:core …`.
 */
import { cutLine } from "./elide.ts";

type Rewritten = { lines: string[]; cut: boolean };

const TASKS_HEAD = /^Tasks runnable from (?:root )?project\b/;

export function squeezeTaskReport(lines: string[], width: number): Rewritten {
	const start = lines.findIndex((l) => TASKS_HEAD.test(l));
	if (start < 0) return { lines, cut: false };
	const out = lines.slice(0, start + 1);
	let cut = false;
	let i = start + 1;
	while (i < lines.length) {
		const l = lines[i]!;
		if (/^To see (?:all tasks|more detail about a task)/.test(l)) {
			i++;
			continue;
		}
		// A group: its title, then one task per line up to a blank line.
		const body: string[] = [];
		let j = i + 1;
		while (j < lines.length && lines[j] !== "") body.push(lines[j++]!);
		if (l === "" || !body.length || !/tasks$/i.test(l)) {
			out.push(l);
			i++;
			continue;
		}
		const line = `${l} (${body.length}): ${body.map((b) => b.split(" - ")[0]).join(" ")}`;
		// The descriptions go: the full output keeps them.
		cut = true;
		out.push(cutLine(line, width));
		i = j;
	}
	return { lines: out, cut };
}

const PROJECT = /^[|+\\ -]*[Pp]roject '(:[^']+)'/;

export function squeezeProjects(lines: string[], width: number): Rewritten {
	const paths = new Set<string>();
	let at = -1;
	const rest: string[] = [];
	const roots = new Set<string>();
	for (const l of lines) {
		const m = PROJECT.exec(l);
		if (m) {
			if (at < 0) at = rest.length;
			paths.add(m[1]!);
		} else if (/^Root project '/.test(l)) {
			if (!roots.has(l)) rest.push(l);
			roots.add(l);
		} else rest.push(l);
	}
	if (paths.size < 5) return { lines, cut: false };
	const groups = new Map<string, string[]>();
	for (const p of [...paths].sort()) {
		const [top, ...sub] = p.slice(1).split(":");
		const names = groups.get(top!) ?? [];
		if (sub.length) names.push(sub.join(":"));
		groups.set(top!, names);
	}
	let cut = false;
	const listed = [`${paths.size} projects`];
	for (const [top, names] of groups) {
		const line = names.length ? `:${top} (${names.length}): ${names.join(" ")}` : `:${top}`;
		cut ||= line.length > width;
		listed.push(cutLine(line, width));
	}
	rest.splice(at, 0, ...listed);
	return { lines: rest, cut };
}
