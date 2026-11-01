/** Chooses the compactor for a bash command and applies the safety rules. */
import { hasFlag, parse } from "./command.ts";
import { DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { compactLsd } from "./lsd.ts";
import { compactPaths } from "./paths.ts";
import { compactRg } from "./rg.ts";

export type Kind = "search" | "paths" | "listing";

export type Result = { text: string; kind: Kind; truncated: boolean; before: number; after: number };

export type Options = {
	limits?: Limits;
	/** Output shorter than this is never touched. */
	minChars?: number;
	/** The result must be at most this share of the original, or the original is kept. */
	maxRatio?: number;
	/** Compactors that may run; a missing entry means on. */
	kinds?: Partial<Record<Kind, boolean>>;
};

const SEARCH = new Set(["rg", "grep", "egrep", "ugrep"]);
const PATHS = new Set(["fd", "fdfind", "find"]);
const LISTING = new Set(["lsd", "eza", "exa"]);

/** Flags after which the output is no longer plain `path:line:text` / one path per line. */
const NOT_PLAIN_SEARCH = { long: ["--json", "--count", "--files-with-matches", "--files-without-match", "--files", "--heading", "--stats", "--vimgrep", "--only-matching", "--null", "--passthru"], short: ["c", "l", "L", "o", "z"] };
const NOT_PLAIN_PATHS = { long: ["--exec", "--exec-batch", "--list-details", "--print0", "--format"], short: ["x", "X", "l", "0"] };

function plainFind(args: string[]): boolean {
	return !args.some((a) => ["-exec", "-execdir", "-ls", "-print0", "-printf", "-fprint", "-delete", "-ok"].includes(a));
}

function pick(command: string): { kind: Kind; run: (out: string, l: Limits) => Squeezed | undefined } | undefined {
	const inv = parse(command);
	if (!inv) return undefined;
	const { program, args } = inv;
	if (SEARCH.has(program)) {
		if (hasFlag(args, NOT_PLAIN_SEARCH.long, NOT_PLAIN_SEARCH.short)) return undefined;
		return { kind: "search", run: compactRg };
	}
	if (PATHS.has(program)) {
		if (program === "find" ? !plainFind(args) : hasFlag(args, NOT_PLAIN_PATHS.long, NOT_PLAIN_PATHS.short)) return undefined;
		return { kind: "paths", run: compactPaths };
	}
	if (LISTING.has(program)) {
		if (!hasFlag(args, ["--long"], ["l"])) return undefined;
		return { kind: "listing", run: compactLsd };
	}
	return undefined;
}

/** Compacts the output of `command`, or returns undefined to leave it exactly as it is. */
export function compact(command: string, output: string, opts: Options = {}): Result | undefined {
	const { limits = DEFAULT_LIMITS, minChars = 400, maxRatio = 0.9, kinds = {} } = opts;
	if (output.length < minChars) return undefined;
	const chosen = pick(command);
	if (!chosen || kinds[chosen.kind] === false) return undefined;
	const sq = chosen.run(output, limits);
	if (!sq) return undefined;
	if (sq.text.length > output.length * maxRatio) return undefined;
	return { text: sq.text, kind: chosen.kind, truncated: sq.truncated, before: output.length, after: sq.text.length };
}
