/** Chooses the compactor for a bash command and applies the safety rules. */
import { hasFlag, parse } from "./command.ts";
import { DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { compactAudit } from "./audit.ts";
import { compactBlame } from "./blame.ts";
import { compactDiff } from "./diff.ts";
import { compactDust } from "./dust.ts";
import { compactGradle } from "./gradle.ts";
import { compactGeneric, isContent } from "./generic.ts";
import { compactLog, compactShow } from "./gitlog.ts";
import { compactStatus } from "./gitstatus.ts";
import { compactLsd } from "./lsd.ts";
import { compactPaths } from "./paths.ts";
import { compactRg, compactRgPlain } from "./rg.ts";
import { compactRustc } from "./rustc.ts";
import { compactBunTest, compactGoTest } from "./runners.ts";
import { compactTests } from "./tests.ts";
import { compactTree } from "./tree.ts";
import { compactTsc } from "./tsc.ts";

export const KINDS = ["search", "paths", "listing", "diff", "tests", "git", "build", "tree", "generic"] as const;
export type Kind = (typeof KINDS)[number];

export type Result = { text: string; kind: Kind; truncated: boolean; before: number; after: number };

export type Options = {
	limits?: Limits;
	/** Output shorter than this is never touched. */
	minChars?: number;
	/** The result must be at most this share of the original, or the original is kept. */
	maxRatio?: number;
	/** Compactors that may run; a missing entry means on. */
	kinds?: Partial<Record<Kind, boolean>>;
	/** The command failed: only test and build output is worth compacting then (the errors are the point). */
	failed?: boolean;
	/** Is `path` (relative to the command's directory) an existing file? Lets search output without line numbers be grouped. */
	isFile?: (path: string) => boolean;
};


const SEARCH = new Set(["rg", "grep", "egrep", "ugrep"]);
const PATHS = new Set(["fd", "fdfind", "find"]);
const LISTING = new Set(["lsd", "eza", "exa", "ls"]);
const LIST_ONLY = { long: ["--files", "--files-with-matches", "--files-without-match"], short: ["l"] };
const NOT_A_LIST = { long: ["--json", "--count", "--null", "--print0", "--stats", "--vimgrep"], short: ["c", "0", "z"] };

/** Flags after which the output is no longer plain `path:line:text` / one path per line. */
const NOT_PLAIN_SEARCH = { long: ["--json", "--count", "--files-with-matches", "--files-without-match", "--files", "--heading", "--stats", "--vimgrep", "--only-matching", "--null", "--passthru"], short: ["c", "l", "L", "o", "z"] };
const NOT_PLAIN_PATHS = { long: ["--exec", "--exec-batch", "--list-details", "--print0", "--format"], short: ["x", "X", "l", "0"] };

/** Flags of `git log`, `show`, `blame` and `status` that leave the default format. */
const GIT_FORMAT = ["--oneline", "--pretty", "--stat", "--shortstat", "--numstat", "--name-only", "--name-status", "--raw", "--graph", "--patch", "--color-words", "--word-diff", "--porcelain", "--line-porcelain", "--incremental", "--short", "--branch", "--stage", "--eol", "--debug", "--format", "--null", "--color"];
const GIT_FORMAT_SHORT = ["p", "s", "z", "b", "e", "t", "v"];

/** `git diff` flags that change the output format away from a unified diff. */
const NOT_PLAIN_DIFF = {
	long: ["--stat", "--numstat", "--shortstat", "--dirstat", "--summary", "--name-only", "--name-status", "--raw", "--check", "--patch-with-stat", "--patch-with-raw", "--word-diff", "--color-words", "--color", "--compact-summary", "--submodule", "--no-index", "--output"],
	short: ["s", "z"],
};

function plainFind(args: string[]): boolean {
	return !args.some((a) => ["-exec", "-execdir", "-ls", "-print0", "-printf", "-fprint", "-delete", "-ok"].includes(a));
}

function pickCargo(all: string[]): ReturnType<typeof pick> {
	// `cargo +nightly build`: the toolchain does not change the output.
	const [sub, ...rest] = all[0]?.startsWith("+") ? all.slice(1) : all;
	if (hasFlag(rest, ["--format", "--message-format", "--prefix", "--charset", "--timings"])) return undefined;
	switch (sub) {
		case "test":
			return { kind: "tests", run: compactTests };
		case "build":
		case "check":
		case "clippy":
		case "doc":
		case "bench":
			return { kind: "build", run: compactRustc };
		case "audit":
			return { kind: "build", run: compactAudit };
		case "tree":
			return { kind: "tree", run: compactTree };
		default:
			return undefined;
	}
}

/** Output with a strong marker of its own is recognised whatever command produced it (`just check`, `npm run build`, pipes). */
const SNIFFERS: { kind: Kind; run: (out: string, l: Limits) => Squeezed | undefined }[] = [
	{ kind: "tests", run: compactBunTest },
	{ kind: "tests", run: compactGoTest },
	{ kind: "build", run: compactGradle },
	{ kind: "build", run: compactTsc },
	{ kind: "build", run: compactRustc },
	{ kind: "build", run: compactAudit },
];

/** `git` options before the subcommand that do not change its output: `-C dir`, `-c k=v`, `--no-pager`, ... */
function gitSubcommand(args: string[]): string[] {
	let i = 0;
	while (i < args.length) {
		const a = args[i]!;
		if (a === "-C" || a === "-c") i += 2;
		else if (["--no-pager", "-P", "--no-optional-locks", "--literal-pathspecs"].includes(a) || /^--(git-dir|work-tree)=/.test(a)) i++;
		else break;
	}
	return args.slice(i);
}

/** `--color=never` and `--no-color` leave the output as it is without them. */
const noColor = (args: string[]) => args.filter((a) => a !== "--color=never" && a !== "--no-color");

function pickGit(all: string[]): ReturnType<typeof pick> {
	const [sub, ...rest] = noColor(gitSubcommand(all));
	switch (sub) {
		case "diff":
			if (hasFlag(rest, ["--name-only"]) && !hasFlag(rest, ["--null"], ["z"])) return { kind: "paths", run: compactPaths };
			return hasFlag(rest, NOT_PLAIN_DIFF.long, NOT_PLAIN_DIFF.short) ? undefined : { kind: "diff", run: compactDiff };
		case "ls-files":
			return hasFlag(rest, ["--stage", "--eol", "--debug", "--format", "--deleted", "--others"], ["s", "z", "t", "v"]) ? undefined : { kind: "paths", run: compactPaths };
		case "status":
			return hasFlag(rest, GIT_FORMAT, GIT_FORMAT_SHORT) ? undefined : { kind: "git", run: compactStatus };
		case "log":
			return hasFlag(rest, GIT_FORMAT, GIT_FORMAT_SHORT) ? undefined : { kind: "git", run: compactLog };
		case "show":
			return hasFlag(rest, GIT_FORMAT, GIT_FORMAT_SHORT) ? undefined : { kind: "git", run: compactShow };
		case "blame":
			return hasFlag(rest, GIT_FORMAT, GIT_FORMAT_SHORT) ? undefined : { kind: "git", run: compactBlame };
		default:
			return undefined;
	}
}

/** Flags that print context lines (`path-text`, which cannot be told apart from a path with a dash). */
const CONTEXT = { long: ["--context", "--after-context", "--before-context"], short: /^-[A-Za-z]*[ABC]/ };

/**
 * `rg pattern dir` without -n: grouped only when the paths can be checked on disk, and not when the
 * only path searched is itself a file (then there is no path prefix, and a colon in the text would pass for one).
 */
function plainSearch(args: string[], isFile: ((path: string) => boolean) | undefined): ReturnType<typeof pick> {
	if (hasFlag(args, ["--line-number"], ["n"]) || hasFlag(args, CONTEXT.long) || args.some((a) => CONTEXT.short.test(a)) || !isFile) return undefined;
	const operands = args.filter((a) => !a.startsWith("-")).slice(1);
	if (operands.length === 1 && isFile(operands[0]!)) return undefined;
	return { kind: "search", run: (out, l) => compactRgPlain(out, l, isFile) };
}

function pick(command: string, isFile?: (path: string) => boolean): { kind: Kind; run: (out: string, l: Limits) => Squeezed | undefined } | undefined {
	const inv = parse(command);
	if (!inv) return undefined;
	// Relative paths in the output are relative to the `cd`, which the file check does not know.
	const local = /^\s*cd\s/.test(command) ? undefined : isFile;
	const { program, args } = inv;
	if (SEARCH.has(program)) {
		const files = hasFlag(args, LIST_ONLY.long, program === "rg" ? LIST_ONLY.short : [...LIST_ONLY.short, "L"]);
		if (files) return hasFlag(args, NOT_A_LIST.long, NOT_A_LIST.short) ? undefined : { kind: "paths", run: compactPaths };
		if (hasFlag(args, NOT_PLAIN_SEARCH.long, NOT_PLAIN_SEARCH.short)) return undefined;
		const plain = plainSearch(args, local);
		return plain ?? { kind: "search", run: compactRg };
	}
	if (PATHS.has(program)) {
		if (program === "find" ? !plainFind(args) : hasFlag(args, NOT_PLAIN_PATHS.long, NOT_PLAIN_PATHS.short)) return undefined;
		return { kind: "paths", run: compactPaths };
	}
	if (program === "git") return pickGit(args);
	if (program === "cargo") return pickCargo(args);
	if (program === "tsc" || ((program === "npx" || program === "bunx") && args[0] === "tsc")) return { kind: "build", run: compactTsc };
	if (program === "gradle" || program === "gradlew") return { kind: "build", run: compactGradle };
	if (program === "go" && args[0] === "test") return hasFlag(args, ["-json", "--json"]) ? undefined : { kind: "tests", run: compactGoTest };
	if (program === "bun" && args[0] === "test") return { kind: "tests", run: compactBunTest };
	if (program === "tree" || ((program === "eza" || program === "exa" || program === "lsd") && hasFlag(args, ["--tree"], ["T"]))) return hasFlag(args, ["-J", "--json", "-H", "--html"]) ? undefined : { kind: "tree", run: compactTree };
	if (program === "dust") return hasFlag(args, ["--output-json"], ["j"]) ? undefined : { kind: "listing", run: compactDust };
	if (LISTING.has(program)) {
		if (!hasFlag(args, ["--long"], ["l"])) return undefined;
		// Other column sets (inode, blocks, group only, full time, numeric ids, octal) do not parse.
		if (hasFlag(args, ["--inode", "--blocks", "--size", "--full-time", "--time-style", "--numeric-uid-gid", "--git", "--header", "--octal-permissions", "--total-size", "--context"], ["i", "s", "n", "g", "o", "H", "Z"])) return undefined;
		return { kind: "listing", run: compactLsd };
	}
	return undefined;
}

/** True when a native compactor takes care of `command`'s output (whatever the switches say). */
export const handles = (command: string): boolean => pick(command) !== undefined;

/** Compacts the output of `command`, or returns undefined to leave it exactly as it is. */
export function compact(command: string, output: string, opts: Options = {}): Result | undefined {
	const { limits = DEFAULT_LIMITS, minChars = 400, maxRatio = 0.9, kinds = {}, failed = false, isFile } = opts;
	if (output.length < minChars) return undefined;
	const small = (sq: Squeezed | undefined): sq is Squeezed => sq !== undefined && sq.text.length <= output.length * maxRatio;
	const allowed = (kind: Kind) => kinds[kind] !== false && (!failed || kind === "tests" || kind === "build");
	const done = (sq: Squeezed, kind: Kind): Result => ({ text: sq.text, kind, truncated: sq.truncated, before: output.length, after: sq.text.length });

	const chosen = pick(command, isFile);
	if (chosen && allowed(chosen.kind)) {
		const sq = chosen.run(output, limits);
		if (small(sq)) return done(sq, chosen.kind);
	}
	if (isContent(command)) return undefined;
	for (const s of SNIFFERS) {
		if (!allowed(s.kind)) continue;
		const sq = s.run(output, limits);
		if (small(sq)) return done(sq, s.kind);
	}
	// Nothing specific fits: still drop colour codes, progress frames and repeated lines.
	if (failed || kinds.generic === false) return undefined;
	const sq = compactGeneric(output);
	return small(sq) ? done(sq, "generic") : undefined;
}
