/** File checks for the compactors that need to know what is on disk. */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** A check whether `path`, relative to `cwd`, is an existing file. Without a cwd nothing is. */
export function fileIn(cwd: string | undefined): (path: string) => boolean {
	if (!cwd) return () => false;
	return (path) => {
		try {
			return statSync(resolve(cwd, path)).isFile();
		} catch {
			return false; // missing, not a directory on the way, a NUL byte, no permission
		}
	};
}

/** Full outputs larger than this are not read back: compacting them would cost more than it saves. */
export const FULL_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;

/** The full output pi saved for a bash run it truncated, or undefined when there is none to read. */
export function readFullOutput(path: unknown, maxBytes = FULL_OUTPUT_MAX_BYTES): string | undefined {
	if (typeof path !== "string") return undefined;
	try {
		if (statSync(path).size > maxBytes) return undefined;
		return readFileSync(path, "utf8");
	} catch {
		return undefined; // gone already, unreadable
	}
}
