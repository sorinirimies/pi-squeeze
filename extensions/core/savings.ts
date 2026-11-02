/**
 * The savings log: one JSON line per compacted output in <agent dir>/squeeze-savings.jsonl, so usage
 * trackers (tokenburn, pi-tokenburn) can count what pi-squeeze saved over time. The model never sees
 * it. When rtk ran the command, rtk logs its own part; this logs only what pi-squeeze cut after it.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Kind } from "./compact.ts";
import { resolveAgentDir } from "./config.ts";

export const SAVINGS_LOG = "squeeze-savings.jsonl";

export const savingsLogPath = (env: Record<string, string | undefined> = process.env, home: string = homedir()): string =>
	join(resolveAgentDir(env, home), SAVINGS_LOG);

/** One line of the log. `tokens` is estimated from `chars` (4 characters per token). */
export interface SavingRecord {
	/** When the output was compacted (ISO 8601, UTC). */
	ts: string;
	session: string;
	cwd: string;
	/** Tokens kept out of the context. */
	tokens: number;
	/** Characters kept out of the context. */
	chars: number;
	/** The compactor that did it. */
	kind: Kind;
}

export const savingLine = (r: SavingRecord): string => JSON.stringify(r) + "\n";

/** Appends one record. Never throws: a log that cannot be written must not affect the session. */
export async function appendSaving(record: SavingRecord, path: string = savingsLogPath()): Promise<boolean> {
	try {
		await mkdir(dirname(path), { recursive: true });
		await appendFile(path, savingLine(record), "utf8");
		return true;
	} catch {
		return false;
	}
}
