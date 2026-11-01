/**
 * `git log` and `git show` in their default format, one line per commit:
 *
 *   0a845ae 2026-11-01 Sorin Albu-Irimies  docs(readme): add the badges
 *
 * The message body stays (indented, at most 8 lines per commit). Strict: anything that is
 * not the default format (`--stat`, `-p` and `--oneline` are handled elsewhere or skipped)
 * returns undefined.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { compactDiff } from "./diff.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BODY_LINES = 8;

type Commit = { hash: string; author: string; date: string; message: string[] };

/** Parses the commit blocks in `lines`; returns the commits and the index of the first line after them. */
function parseCommits(lines: string[]): { commits: Commit[]; next: number } | undefined {
	const commits: Commit[] = [];
	let i = 0;
	while (i < lines.length) {
		const m = /^commit ([0-9a-f]{7,64})(?: \(.*\))?$/.exec(lines[i]!);
		if (!m) break;
		i++;
		if (lines[i]?.startsWith("Merge: ")) i++;
		const a = /^Author: (.*?)(?: <[^>]*>)?$/.exec(lines[i++] ?? "");
		const d = /^Date: +\w{3} (\w{3}) +(\d+) [\d:]+ (\d{4}) [+-]\d{4}$/.exec(lines[i++] ?? "");
		if (!a || !d || lines[i++] !== "") return undefined;
		const month = MONTHS.indexOf(d[1]!) + 1;
		if (!month) return undefined;
		const message: string[] = [];
		for (; i < lines.length; i++) {
			if (lines[i]!.startsWith("    ")) message.push(lines[i]!.slice(4));
			else if (lines[i] === "" && lines.slice(i).find((l) => l !== "")?.startsWith("    ")) message.push("");
			else break;
		}
		if (lines[i] === "") i++;
		commits.push({ hash: m[1]!.slice(0, 7), author: a[1]!, date: `${d[3]}-${String(month).padStart(2, "0")}-${d[2]!.padStart(2, "0")}`, message });
	}
	return commits.length ? { commits, next: i } : undefined;
}

function render(commits: Commit[], limits: Limits): string[] {
	// One author for the whole list: say so once instead of on every line.
	const solo = commits.length > 1 && commits.every((c) => c.author === commits[0]!.author);
	const out: string[] = solo ? [`by ${commits[0]!.author}`] : [];
	for (const c of commits) {
		const [subject = "", ...rest] = c.message;
		out.push(cutLine(`${c.hash} ${c.date}${solo ? "" : ` ${c.author}`}  ${subject}`, limits.lineChars));
		const body = rest.filter((l, i) => !(l === "" && (i === 0 || rest[i - 1] === "")));
		for (const l of body.slice(0, BODY_LINES)) out.push(l ? cutLine(`  ${l}`, limits.lineChars) : "");
		if (body.length > BODY_LINES) out.push(`  … [+${body.length - BODY_LINES} more lines]`);
	}
	return out;
}

export function compactLog(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	const parsed = parseCommits(lines);
	if (!parsed || parsed.next !== lines.length) return undefined;
	return capLines(render(parsed.commits, limits), limits.total);
}

/** `git show` of a commit: the commit line above, then the (compacted) diff. */
export function compactShow(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	const at = lines.findIndex((l) => l.startsWith("diff --git "));
	if (at < 0) return compactLog(output, limits);
	const parsed = parseCommits(lines.slice(0, at));
	const diff = compactDiff(lines.slice(at).join("\n"), limits);
	if (!parsed || parsed.next !== at || !diff) return undefined;
	return { text: `${render(parsed.commits, limits).join("\n")}\n${diff.text}`, truncated: diff.truncated };
}
