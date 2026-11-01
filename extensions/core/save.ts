import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Writes the untouched output to a temp file so a truncated result can be recovered. */
export function saveFull(text: string, dir = join(tmpdir(), "pi-squeeze")): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.txt`);
	writeFileSync(path, text);
	return path;
}
