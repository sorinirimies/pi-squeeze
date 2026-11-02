/** Chooses the compactor for a bash command and applies the safety rules. */
import { hasFlag, type Invocation, parse } from "./command.ts";
import { DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { compactPackages } from "./adb.ts";
import { compactAudit } from "./audit.ts";
import { compactBlame } from "./blame.ts";
import { compactDiff } from "./diff.ts";
import { compactDockerBuild } from "./docker.ts";
import { compactDust } from "./dust.ts";
import { compactGradle, compactGradleDeps } from "./gradle.ts";
import { compactInstall } from "./install.ts";
import { compactJest } from "./jest.ts";
import { compactLint, compactLintSniffed } from "./lint.ts";
import { compactLogs } from "./logs.ts";
import { compactPytest } from "./pytest.ts";
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
import { compactXcode, compactXcodeSniffed } from "./xcode.ts";

export const KINDS = ["search", "paths", "listing", "diff", "tests", "git", "build", "lint", "install", "logs", "tree", "generic"] as const;
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
	/** The command failed: only test, build, lint and install output is worth compacting then (the errors are the point). */
	failed?: boolean;
	/** Is `path` (relative to the command's directory) an existing file? Lets search output without line numbers be grouped. */
	isFile?: (path: string) => boolean;
};


const SEARCH = new Set(["rg", "grep", "egrep", "ugrep", "ack"]);
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
	{ kind: "tests", run: compactPytest },
	{ kind: "tests", run: compactJest },
	{ kind: "build", run: compactGradle },
	{ kind: "build", run: compactXcodeSniffed },
	{ kind: "build", run: compactTsc },
	{ kind: "build", run: compactRustc },
	{ kind: "build", run: compactAudit },
	{ kind: "lint", run: compactLintSniffed },
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

/** `npx tool`, `uv run tool`, `python -m tool`, `xcrun tool`…: the tool is what prints. */
function unwrap({ program, args }: Invocation): Invocation {
	const next = (rest: string[]): Invocation | undefined => {
		const i = rest.findIndex((a) => !a.startsWith("-"));
		return i < 0 ? undefined : { program: rest[i]!.split("/").pop()!, args: rest.slice(i + 1) };
	};
	let inner: Invocation | undefined;
	if (["npx", "bunx", "pnpx", "uvx"].includes(program)) inner = next(args);
	else if (["uv", "poetry", "pipenv", "pdm", "hatch"].includes(program) && args[0] === "run") inner = next(args.slice(1));
	else if ((program === "pnpm" || program === "yarn") && (args[0] === "exec" || args[0] === "dlx")) inner = next(args.slice(1));
	else if (/^python[\d.]*$/.test(program) && args[0] === "-m" && args[1]) inner = { program: args[1], args: args.slice(2) };
	else if (program === "xcrun" && args[0] && !args[0].startsWith("-")) inner = { program: args[0], args: args.slice(1) };
	return inner ? unwrap(inner) : { program, args };
}

/** `cmd | tail -50` / `cmd | head -n 20`: still `cmd`'s format, only fewer lines of it. */
export function unpipe(command: string): string {
	return command.replace(/\s*\|\s*(?:tail|head)(?:\s+(?:-n\s*\d+|-\d+|--lines=\d+))?\s*$/, "");
}

const INSTALL: Record<string, string[]> = {
	npm: ["install", "i", "ci", "add", "update", "up"],
	pnpm: ["install", "i", "add", "update", "up"],
	yarn: ["install", "add", "upgrade"],
	bun: ["install", "i", "add", "update"],
	pip: ["install", "download"],
	pip3: ["install", "download"],
	pod: ["install", "update"],
	bundle: ["install", "update"],
	gem: ["install", "update"],
};

/** Linters whose output `compactLint` reads (with their subcommand where they have one). */
const LINTERS: Record<string, string[] | undefined> = {
	eslint: undefined,
	biome: ["lint", "check", "ci"],
	ruff: ["check"],
	flake8: undefined,
	mypy: undefined,
	pylint: undefined,
	ktlint: undefined,
	detekt: undefined,
	"detekt-cli": undefined,
	swiftlint: ["lint"],
	shellcheck: undefined,
	flutter: ["analyze"],
	dart: ["analyze"],
};

const LOG_COMMANDS = (program: string, args: string[]): boolean =>
	((program === "docker" || program === "podman") && (args[0] === "logs" || (args[0] === "compose" && args[1] === "logs"))) ||
	(program === "docker-compose" && args[0] === "logs") ||
	(program === "kubectl" && args[0] === "logs") ||
	(program === "adb" && args[0] === "logcat") ||
	["journalctl", "stern", "pidcat"].includes(program);

/** Package managers, linters, test runners, logs, docker and Xcode. */
function pickTool({ program, args }: Invocation): ReturnType<typeof pick> {
	const sub = args[0] ?? "";
	const machine = args.some((a) => /json|sarif|junit|checkstyle|xml|github|gitlab|codeclimate|teamcity|tap\b/i.test(a));
	if (machine) return undefined;
	if (INSTALL[program]?.includes(sub) || (program === "yarn" && !sub) || (program === "uv" && (["add", "sync"].includes(sub) || (sub === "pip" && ["install", "sync"].includes(args[1] ?? "")))) || ((program === "flutter" || program === "dart") && sub === "pub" && args[1] === "get"))
		return { kind: "install", run: compactInstall };
	if (program in LINTERS) {
		const subs = LINTERS[program];
		// `ruff .` is `ruff check .` in older versions.
		if (!subs || subs.includes(sub) || (program === "ruff" && sub.startsWith("-"))) return { kind: "lint", run: compactLint };
		return undefined;
	}
	if (program === "pytest" || program === "py.test") return { kind: "tests", run: compactPytest };
	if (program === "jest" || program === "vitest") return { kind: "tests", run: compactJest };
	if (LOG_COMMANDS(program, args)) return hasFlag(args, ["--follow"], ["f"]) && program !== "adb" ? undefined : { kind: "logs", run: compactLogs };
	if (program === "adb" && sub === "shell" && /^(pm|cmd package) list packages\b/.test(args.slice(1).join(" "))) return { kind: "listing", run: compactPackages };
	if (((program === "docker" || program === "podman") && (sub === "build" || (sub === "buildx" && args[1] === "build") || (sub === "compose" && args[1] === "build"))) || (program === "docker-compose" && sub === "build"))
		return { kind: "build", run: compactDockerBuild };
	if (program === "xcodebuild") return { kind: args.includes("test") ? "tests" : "build", run: compactXcode };
	if (program === "swift" && (sub === "build" || sub === "test")) return { kind: sub === "test" ? "tests" : "build", run: compactXcode };
	return undefined;
}

function pick(command: string, isFile?: (path: string) => boolean): { kind: Kind; run: (out: string, l: Limits) => Squeezed | undefined } | undefined {
	const parsed = parse(command);
	if (!parsed) return undefined;
	const inv = unwrap(parsed);
	// Relative paths in the output are relative to the `cd`, which the file check does not know.
	const local = /^\s*cd\s/.test(command) ? undefined : isFile;
	const { program, args } = inv;
	if (SEARCH.has(program)) {
		const files = hasFlag(args, LIST_ONLY.long, program === "rg" ? LIST_ONLY.short : [...LIST_ONLY.short, "L"]);
		if (files) return hasFlag(args, NOT_A_LIST.long, NOT_A_LIST.short) ? undefined : { kind: "paths", run: compactPaths };
		if (hasFlag(args, NOT_PLAIN_SEARCH.long, NOT_PLAIN_SEARCH.short)) return undefined;
		// ack: `-f` / `-g` list files; `-h` drops the path.
		if (program === "ack" && hasFlag(args, ["--no-filename"], ["f", "g", "h"])) return hasFlag(args, [], ["f", "g"]) ? { kind: "paths", run: compactPaths } : undefined;
		const plain = plainSearch(args, local);
		return plain ?? { kind: "search", run: compactRg };
	}
	if (PATHS.has(program)) {
		if (program === "find" ? !plainFind(args) : hasFlag(args, NOT_PLAIN_PATHS.long, NOT_PLAIN_PATHS.short)) return undefined;
		return { kind: "paths", run: compactPaths };
	}
	if (program === "git") return pickGit(args);
	if (program === "cargo") return pickCargo(args);
	if (program === "tsc") return { kind: "build", run: compactTsc };
	if (program === "gradle" || program === "gradlew") return args.some((a) => /(^|:)dependencies$/.test(a)) ? { kind: "tree", run: compactGradleDeps } : { kind: "build", run: compactGradle };
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
	return pickTool(inv);
}

/** True when a native compactor takes care of `command`'s output (whatever the switches say). */
export const handles = (command: string): boolean => pick(unpipe(command)) !== undefined;

/** Kinds whose output is worth compacting when the command failed: there the failures are the point. */
const FAILED_OK = new Set<Kind>(["tests", "build", "lint", "install"]);

/** Compacts the output of `command`, or returns undefined to leave it exactly as it is. */
export function compact(full: string, output: string, opts: Options = {}): Result | undefined {
	const command = unpipe(full);
	const { limits = DEFAULT_LIMITS, minChars = 400, maxRatio = 0.9, kinds = {}, failed = false, isFile } = opts;
	if (output.length < minChars) return undefined;
	const small = (sq: Squeezed | undefined): sq is Squeezed => sq !== undefined && sq.text.length <= output.length * maxRatio;
	const allowed = (kind: Kind) => kinds[kind] !== false && (!failed || FAILED_OK.has(kind));
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
