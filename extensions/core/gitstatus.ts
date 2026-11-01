/**
 * `git status` (long form) without the hints:
 *
 *   ## main...origin/main [ahead 2]
 *   staged:
 *     M src/a.ts
 *   untracked:
 *     notes.txt
 *
 * Strict: a line it does not know makes it return undefined.
 */
import { capLines, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

const SECTIONS: Record<string, string> = {
	"Changes to be committed:": "staged",
	"Changes not staged for commit:": "unstaged",
	"Untracked files:": "untracked",
	"Unmerged paths:": "unmerged",
	"Ignored files:": "ignored",
};
const CODES: Record<string, string> = { modified: "M", "new file": "A", deleted: "D", renamed: "R", copied: "C", "both modified": "UU", "both added": "AA", "deleted by us": "DU", "deleted by them": "UD", "added by us": "AU", "added by them": "UA", "both deleted": "DD", "typechange": "T" };
const FOOTER = /^(no changes added to commit|nothing added to commit|nothing to commit|nothing to commit, working tree clean)/;

export function compactStatus(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	let head = "";
	let track = "";
	const out: string[] = [];
	let section = "";
	for (const l of lines) {
		let m: RegExpExecArray | null;
		if ((m = /^On branch (.+)$/.exec(l))) head = m[1]!;
		else if ((m = /^HEAD detached (?:at|from) (.+)$/.exec(l))) head = `(detached ${m[1]})`;
		else if ((m = /^Your branch is up to date with '(.+)'\.$/.exec(l))) track = `...${m[1]}`;
		else if ((m = /^Your branch is (ahead of|behind) '(.+)' by (\d+) commits?(?:, and can be fast-forwarded)?\.$/.exec(l))) track = `...${m[2]} [${m[1]!.split(" ")[0]} ${m[3]}]`;
		else if ((m = /^Your branch and '(.+)' have diverged,$/.exec(l))) track = `...${m[1]} [diverged]`;
		else if ((m = /^and have (\d+) and (\d+) different commits each, respectively\.$/.exec(l))) track = track.replace("[diverged]", `[ahead ${m[1]}, behind ${m[2]}]`);
		else if (SECTIONS[l]) {
			section = SECTIONS[l]!;
			out.push(`${section}:`);
		} else if (/^\s+\(use "git .*\)$/.test(l) || l === "" || FOOTER.test(l) || /^\s*\(all conflicts fixed.*\)$/.test(l)) continue;
		else if ((m = /^\t([a-z ]+?):\s+(.+)$/.exec(l)) && CODES[m[1]!]) out.push(`  ${CODES[m[1]!]} ${m[2]}`);
		else if (section === "untracked" || section === "ignored") {
			if (!l.startsWith("\t")) return undefined;
			out.push(`  ${l.slice(1)}`);
		} else return undefined;
	}
	if (!head) return undefined;
	const clean = out.length === 0 ? [" clean"] : [];
	return capLines([`## ${head}${track}${clean[0] ?? ""}`, ...out], limits.total);
}
