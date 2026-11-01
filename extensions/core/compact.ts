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
import { compactRg } from "./rg.ts";
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
};

const SEARCH = new Set(["rg", "grep", "egrep", "ugrep"]);
const PATHS = new Set(["fd", "fdfind", "find"]);
const LISTING = new Set(["lsd", "eza", "exa"]);
const LIST_ONLY = { long: ["--files", "--files-with-matches", "--files-without-match"], short: ["l"] };
const NOT_A_LIST = { long: ["--json", "--count", "--null", "--print0", "--stats", "--vimgrep"], short: ["c", "0", "z"] };

/** Flags after which the output is no longer plain `path:line:text` / one path per line. */
const NOT_PLAIN_SEARCH = { long: ["--json", "--count", "--files-with-matches", "--files-without-match", "--files", "--heading", "--stats", "--vimgrep", "--only-matching", "--null", "--passthru"], short: ["c", "l", "L", "o", "z"] };
const NOT_PLAIN_PATHS = { long: ["--exec", "--exec-batch", "--list-details", "--print0", "--format"], short: ["x", "X", "l", "0"] };

/** Flags of `git log`, `show`, `blame` and `status` that leave the default format. */
const GIT_FORMAT = ["--oneline", "--pretty", "--format", "--stat", "--shortstat", "--numstat", "--name-only", "--name-status", "--raw", "--graph", "--patch", "--color-words", "--word-diff", "--porcelain", "--line-porcelain", "--incremental", "--short", "--branch", "--stage", "--eol", "--debug", "--format", "--null"];
const GIT_FORMAT_SHORT = ["p", "s", "z", "b", "e", "t", "v"];

/** `git diff` flags that change the output format away from a unified diff. */
const NOT_PLAIN_DIFF = {
	long: ["--stat", "--numstat", "--shortstat", "--dirstat", "--summary", "--name-only", "--name-status", "--raw", "--check", "--patch-with-stat", "--patch-with-raw", "--word-diff", "--color-words", "--color", "--compact-summary", "--submodule", "--no-index", "--output"],
	short: ["s", "z"],
};

function plainFind(args: string[]): boolean {
	return !args.some((a) => ["-exec", "-execdir", "-ls", "-print0", "-printf", "-fprint", "-delete", "-ok"].includes(a));
}

function pickCargo(args: string[]): ReturnType<typeof pick> {
	const [sub, ...rest] = args;
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

function pickGit(args: string[]): ReturnType<typeof pick> {
	const [sub, ...rest] = args;
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

function pick(command: string): { kind: Kind; run: (out: string, l: Limits) => Squeezed | undefined } | undefined {
	const inv = parse(command);
	if (!inv) return undefined;
	const { program, args } = inv;
	if (SEARCH.has(program)) {
		const files = hasFlag(args, LIST_ONLY.long, program === "rg" ? LIST_ONLY.short : [...LIST_ONLY.short, "L"]);
		if (files) return hasFlag(args, NOT_A_LIST.long, NOT_A_LIST.short) ? undefined : { kind: "paths", run: compactPaths };
		if (hasFlag(args, NOT_PLAIN_SEARCH.long, NOT_PLAIN_SEARCH.short)) return undefined;
		return { kind: "search", run: compactRg };
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
		return { kind: "listing", run: compactLsd };
	}
	return undefined;
}

/** True when a native compactor takes care of `command`'s output (whatever the switches say). */
export const handles = (command: string): boolean => pick(command) !== undefined;

/** Compacts the output of `command`, or returns undefined to leave it exactly as it is. */
export function compact(command: string, output: string, opts: Options = {}): Result | undefined {
	const { limits = DEFAULT_LIMITS, minChars = 400, maxRatio = 0.9, kinds = {}, failed = false } = opts;
	if (output.length < minChars) return undefined;
	const small = (sq: Squeezed | undefined): sq is Squeezed => sq !== undefined && sq.text.length <= output.length * maxRatio;
	const allowed = (kind: Kind) => kinds[kind] !== false && (!failed || kind === "tests" || kind === "build");
	const done = (sq: Squeezed, kind: Kind): Result => ({ text: sq.text, kind, truncated: sq.truncated, before: output.length, after: sq.text.length });

	const chosen = pick(command);
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
