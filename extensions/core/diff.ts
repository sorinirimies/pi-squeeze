/**
 * `git diff` output: the file headers shrink to one line each (`path (new, +12 −0)`), the
 * `index` / mode / `---` / `+++` lines go, and every hunk keeps all of its changed lines but
 * only one line of context on each side of a change. Long files are cut with a marker.
 *
 * The parse is exact: hunk lengths come from the `@@` headers, so any line that does not fit
 * the unified-diff grammar makes the whole output pass through untouched.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

/** Lines kept per file: a new file is mostly boilerplate to the reader, a change is not. */
const NEW_FILE_LINES = 40;
const FILE_LINES = 120;

const HEADER = /^(index |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/;
const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

type File = { path: string; status: string; added: number; removed: number; body: string[]; binary: boolean };

function parseFile(lines: string[], start: number): { file: File; next: number } | undefined {
	const m = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[start]!);
	if (!m) return undefined;
	const file: File = { path: m[2]!, status: "", added: 0, removed: 0, body: [], binary: false };
	let i = start + 1;
	for (; i < lines.length; i++) {
		const l = lines[i]!;
		if (l.startsWith("diff --git ") || l.startsWith("@@")) break;
		if (l.startsWith("--- ") || l.startsWith("+++ ")) continue;
		if (l.startsWith("new file mode")) file.status = "new";
		else if (l.startsWith("deleted file mode")) file.status = "deleted";
		else if (l.startsWith("rename to ")) file.status = `renamed from ${m[1]}`;
		else if (/^Binary files .* differ$/.test(l)) file.binary = true;
		else if (!HEADER.test(l)) return undefined;
	}
	while (i < lines.length && lines[i]!.startsWith("@@")) {
		const h = HUNK.exec(lines[i]!);
		if (!h) return undefined;
		let old = h[1] === undefined ? 1 : Number(h[1]);
		let neu = h[2] === undefined ? 1 : Number(h[2]);
		const hunk = [lines[i]!];
		i++;
		while (old > 0 || neu > 0 || lines[i]?.startsWith("\\")) {
			const l = lines[i];
			if (l === undefined) return undefined;
			if (l.startsWith("\\")) hunk.push(l);
			else if (l.startsWith("+")) (neu--, file.added++, hunk.push(l));
			else if (l.startsWith("-")) (old--, file.removed++, hunk.push(l));
			else if (l.startsWith(" ") || l === "") (old--, neu--, hunk.push(l));
			else return undefined;
			i++;
		}
		file.body.push(...trimContext(hunk));
	}
	return { file, next: i };
}

/** One context line on each side of a change; the `@@` header stays. */
function trimContext(hunk: string[]): string[] {
	const isChange = (l: string) => l.startsWith("+") || l.startsWith("-") || l.startsWith("\\");
	const keep = hunk.map((l, i) => i === 0 || isChange(l) || (i > 1 && isChange(hunk[i - 1]!)) || (i + 1 < hunk.length && isChange(hunk[i + 1]!)));
	return hunk.filter((_, i) => keep[i]);
}

export function compactDiff(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines[0]?.startsWith("diff --git ")) return undefined;

	const files: File[] = [];
	for (let i = 0; i < lines.length; ) {
		const r = parseFile(lines, i);
		if (!r) return undefined;
		files.push(r.file);
		i = r.next;
	}

	const added = files.reduce((n, f) => n + f.added, 0);
	const removed = files.reduce((n, f) => n + f.removed, 0);
	const out = [`${files.length} file${files.length === 1 ? "" : "s"} changed, +${added} −${removed} (context trimmed to 1 line)`];
	let cut = false;
	for (const f of files) {
		const tag = f.binary ? "binary" : f.status;
		out.push(`${f.path} (${tag ? `${tag}, ` : ""}+${f.added} −${f.removed})`);
		const max = f.status === "new" ? NEW_FILE_LINES : FILE_LINES;
		for (const l of f.body.slice(0, max)) out.push(cutLine(l, limits.lineChars));
		if (f.body.length > max) {
			out.push(`… [+${f.body.length - max} more lines in ${f.path}]`);
			cut = true;
		}
	}
	const capped = capLines(out, limits.total * 2);
	return { text: capped.text, truncated: cut || capped.truncated };
}
