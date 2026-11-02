/** File checks for the compactors that need to know what is on disk. */
import { statSync } from "node:fs";
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
