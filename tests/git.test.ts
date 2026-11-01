import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compactBlame } from "../extensions/core/blame.ts";
import { compactDust } from "../extensions/core/dust.ts";
import { compactGeneric, isContent } from "../extensions/core/generic.ts";
import { compactLog, compactShow } from "../extensions/core/gitlog.ts";
import { compactStatus } from "../extensions/core/gitstatus.ts";

const fx = (n: string) => readFileSync(join(import.meta.dir, "fixtures", n), "utf8");

const commit = (hash: string, author: string, msg: string[], extra: string[] = []) =>
	[`commit ${hash}`, ...extra, `Author: ${author} <a@b.c>`, "Date:   Sun Nov 1 22:45:36 2026 +0100", "", ...msg.map((m) => (m ? `    ${m}` : "")), ""].join("\n");
const H1 = "0a845ae4dbd621a955bd4f5cc58f56d6ed5d8fc9";
const H2 = "f3bfbf7816a7e0e82b69822e49327a4016e34e68";

describe("git status", () => {
	test("hints go, entries get short codes grouped by section", () => {
		expect(compactStatus(fx("git-status.txt"))!.text).toBe(["## main", "staged:", "  R d/y -> d/z", "  M f1.txt", "  D f3.txt", "unstaged:", "  M f1.txt", "  M f2.txt", "untracked:", "  new1", "  new2", "  newdir/"].join("\n"));
	});

	test("branch tracking: up to date, ahead, behind, diverged, detached, clean", () => {
		const t = (...l: string[]) => compactStatus(`${l.join("\n")}\n\nnothing to commit, working tree clean\n`)!.text;
		expect(t("On branch main", "Your branch is up to date with 'origin/main'.")).toBe("## main...origin/main clean");
		expect(t("On branch main", "Your branch is ahead of 'origin/main' by 2 commits.", '  (use "git push" to publish your local commits)')).toBe("## main...origin/main [ahead 2] clean");
		expect(t("On branch main", "Your branch is behind 'origin/main' by 1 commit, and can be fast-forwarded.")).toBe("## main...origin/main [behind 1] clean");
		expect(t("On branch main", "Your branch and 'origin/main' have diverged,", "and have 1 and 2 different commits each, respectively.")).toBe("## main...origin/main [ahead 1, behind 2] clean");
		expect(t("HEAD detached at abc1234")).toBe("## (detached abc1234) clean");
	});

	test("conflicts and ignored files", () => {
		const raw = ["On branch x", "Unmerged paths:", '  (use "git add <file>..." to mark resolution)', "\tboth modified:   a.ts", "\tdeleted by us:   b.ts", "", "Ignored files:", "\ttarget/", ""].join("\n");
		expect(compactStatus(raw)!.text).toBe("## x\nunmerged:\n  UU a.ts\n  DU b.ts\nignored:\n  target/");
	});

	test("unknown text passes through", () => {
		expect(compactStatus("")).toBeUndefined();
		expect(compactStatus("fatal: not a git repository")).toBeUndefined();
		expect(compactStatus("On branch x\nsurprise line\n")).toBeUndefined();
		expect(compactStatus("On branch x\nUntracked files:\nnot indented\n")).toBeUndefined();
	});
});

describe("git log and show", () => {
	test("one line per commit; one author is said once", () => {
		const t = compactLog(fx("git-log.txt"))!.text.split("\n");
		expect(t[0]).toBe("by Sorin Albu-Irimies");
		expect(t[1]).toBe("0a845ae 2026-11-01  docs(readme): add the Audit and Fuzz badges");
		expect(t).toHaveLength(13);
	});

	test("different authors stay on the line; merge and decoration lines parse; body is kept and capped", () => {
		const body = ["subject", "", ...Array.from({ length: 12 }, (_, i) => `body ${i}`)];
		const raw = [commit(H1, "Ann", body, []), commit(H2, "Bob", ["merge it"], ["Merge: abc def"]).replace(`commit ${H2}`, `commit ${H2} (HEAD -> main, origin/main)`)].join("\n");
		const t = compactLog(raw)!.text.split("\n");
		expect(t[0]).toBe("0a845ae 2026-11-01 Ann  subject");
		expect(t[1]).toBe("  body 0");
		expect(t).toContain("  … [+4 more lines]");
		expect(t.at(-1)).toBe("f3bfbf7 2026-11-01 Bob  merge it");
	});

	test("a blank line inside the body stays, two in a row do not; long subjects are cut", () => {
		const raw = commit(H1, "Ann", ["s".repeat(300), "", "para one", "", "", "para two"]);
		const t = compactLog(raw, { lineChars: 60, perGroup: 15, total: 250 })!.text.split("\n");
		expect(t[0]).toMatch(/… \[\+\d+ chars\]$/);
		expect(t.slice(1)).toEqual(["  para one", "", "  para two"]);
	});

	test("the list is capped", () => {
		const raw = Array.from({ length: 30 }, (_, i) => commit(H1, `A${i}`, [`m${i}`])).join("\n");
		const r = compactLog(raw, { lineChars: 240, perGroup: 15, total: 20 })!;
		expect(r.truncated).toBe(true);
	});

	test("show: the commit line, then the compacted diff", () => {
		const r = compactShow(fx("git-show.txt"))!;
		expect(r.text.startsWith("b575b33 2026-11-01 Sorin Albu-Irimies  feat: compact git diff")).toBe(true);
		expect(r.text).toContain("files changed");
		expect(r.text).not.toContain("diff --git");
		expect(compactShow(commit(H1, "Ann", ["only a message"]))!.text).toBe("0a845ae 2026-11-01 Ann  only a message");
	});

	test("anything else passes through", () => {
		expect(compactLog("")).toBeUndefined();
		expect(compactLog("fatal: bad revision")).toBeUndefined();
		expect(compactLog(`${commit(H1, "Ann", ["x"])}\n trailing junk`)).toBeUndefined();
		expect(compactLog(commit(H1, "Ann", ["x"]).replace("Sun Nov 1", "Sun Foo 1"))).toBeUndefined();
		expect(compactLog(commit(H1, "Ann", ["x"]).replace("+0100\n\n", "+0100\nX\n"))).toBeUndefined();
		expect(compactShow(`${commit(H1, "Ann", ["x"])}\ndiff --git a/x b/x\nnot a diff`)).toBeUndefined();
		expect(compactShow(`junk\ndiff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b`)).toBeUndefined();
	});
});

describe("git blame", () => {
	test("a header per run of lines from one commit", () => {
		const raw = fx("git-blame.txt");
		const r = compactBlame(raw)!;
		expect(r.text.length).toBeLessThan(raw.length * 0.8);
		expect(r.text.split("\n").slice(0, 2)).toEqual(["bd6a3dd4 Sorin Albu-Irimies 2026-10-16", "  1: # Dodai UI"]);
		expect(r.text).not.toContain("+0200");
	});

	test("a file name column (--show-name) and an empty line are fine; garbage is not", () => {
		const row = (n: number, t: string) => `abc12345 x.ts (Ann 2026-10-16 19:53:55 +0200 ${n})${t}`;
		expect(compactBlame([row(1, " a"), row(2, "")].join("\n"))!.text).toBe("abc12345 Ann 2026-10-16\n  1: a\n  2: ");
		expect(compactBlame("")).toBeUndefined();
		expect(compactBlame("fatal: no such path")).toBeUndefined();
	});

	test("long lines are cut", () => {
		const raw = `abc12345 (Ann 2026-10-16 19:53:55 +0200 1) ${"z".repeat(300)}`;
		expect(compactBlame(raw, { lineChars: 40, perGroup: 15, total: 250 })!.text).toContain("… [+");
	});
});

describe("dust", () => {
	test("the bar column goes, size, tree and share stay", () => {
		const r = compactDust(fx("dust.txt"))!;
		expect(r.text.length).toBeLessThan(fx("dust.txt").length * 0.5);
		expect(r.text.split("\n").at(-1)).toBe("190Mi ┌─┴ .  100%");
		expect(r.text).not.toMatch(/[█░]/);
	});

	test("a progress prefix is dropped; other output passes through", () => {
		const bar = "│█░░ │";
		expect(compactDust(`\r  \r 1Mi ┌── a ${bar}  1%\n 2Mi ┌── b ${bar}  2%\n 3Mi ┌── c ${bar}  3%`)!.text.split("\n")[0]).toBe(" 1Mi ┌── a  1%");
		expect(compactDust("a\nb")).toBeUndefined();
		expect(compactDust("no\nbars\nhere")).toBeUndefined();
	});
});

describe("generic", () => {
	test("colour codes, progress frames, repeats and blank runs", () => {
		const raw = ["\u001b[32mgreen\u001b[0m", "\u001b]8;;http://x\u0007link\u001b]8;;\u0007", "10%\r50%\r100%", "same", "same", "same", "same", "twice", "twice", "", "", "", "", "end   ", ""].join("\n");
		expect(compactGeneric(raw)!.text).toBe(["green", "link", "100%", "same  [×4]", "twice", "twice", "", "end", ""].join("\n"));
	});

	test("two or three blank lines in a row: two stay, three become one", () => {
		expect(compactGeneric("a\n\n\nb\n\n\n\nc")!.text).toBe("a\n\n\nb\n\nc");
	});

	test("content commands are never touched", () => {
		for (const c of ["cat x", "head -5 f", "git log | head", "jq . f", "curl -s u", "echo hi", "cd d && sed -n 1p f"]) expect(isContent(c)).toBe(true);
		for (const c of ["bun install", "npm run build", "rg x", "docker build ."]) expect(isContent(c)).toBe(false);
	});
});
