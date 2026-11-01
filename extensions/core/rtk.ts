/**
 * The optional rtk layer: commands that have no native compactor here (git, cargo, docker, …) are
 * rewritten to their `rtk` form, which prints a compact output itself.
 *
 * `rtk rewrite <command>` is the single source of truth for what rtk can take over. Exit 0 and 3
 * mean "rewritten" (3: the host should ask for approval, pi has no such step); 1 means no rewrite
 * and 2 a deny. Never rewritten: what a native compactor handles (its output format is ours to
 * parse) and file reads (`rtk read` may drop lines, and a read must stay exact).
 */
import { spawnSync } from "node:child_process";
import { handles } from "./compact.ts";

export type Run = (command: string) => { status: number | null; stdout: string; missing?: boolean };

const spawnRun: Run = (command) => {
	const r = spawnSync("rtk", ["rewrite", command], { encoding: "utf8", timeout: 2000 });
	return { status: r.status, stdout: r.stdout ?? "", missing: (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" };
};

let run: Run = spawnRun;
/** For tests: replace the process runner (no argument restores it). */
export const useRunner = (r: Run = spawnRun): void => {
	run = r;
};

const cache = new Map<string, string | undefined>();
const CACHE_MAX = 500;
let missing = false;

/** The command to run instead of `command`, or undefined to run it as written. */
export function rewrite(command: string): string | undefined {
	if (missing || command.trim() === "" || handles(command)) return undefined;
	if (cache.has(command)) return cache.get(command);
	const r = run(command);
	if (r.missing) {
		missing = true;
		return undefined;
	}
	const out = r.stdout.trim();
	const rewritten = (r.status === 0 || r.status === 3) && out !== "" && out !== command && !/^rtk read\b/.test(out) ? out : undefined;
	if (cache.size >= CACHE_MAX) cache.clear();
	cache.set(command, rewritten);
	return rewritten;
}

/** For tests: forget what was learned (the cache and a missing binary). */
export function resetRtk(): void {
	cache.clear();
	missing = false;
}
