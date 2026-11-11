/**
 * The savings log: one JSON line per compacted output in <agent dir>/squeeze-savings.jsonl, so usage
 * trackers (tokenburn, pi-tokenburn) can count what pi-squeeze saved over time. The model never sees
 * it. When rtk ran the command, rtk logs its own part; this logs only what pi-squeeze cut after it.
 *
 * Next to it, <agent dir>/squeeze-missed.jsonl lists large outputs no compactor took: the commands
 * worth a compactor next. Both are summed up by `/squeeze status`.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Kind } from "./compact.ts";
import { resolveAgentDir } from "./config.ts";

export const SAVINGS_LOG = "squeeze-savings.jsonl";
export const MISSED_LOG = "squeeze-missed.jsonl";

export const savingsLogPath = (env: Record<string, string | undefined> = process.env, home: string = homedir()): string =>
	join(resolveAgentDir(env, home), SAVINGS_LOG);

export const missedLogPath = (env: Record<string, string | undefined> = process.env, home: string = homedir()): string =>
	join(resolveAgentDir(env, home), MISSED_LOG);

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
	/** What ran: program and subcommand only (`git diff`), never its arguments. */
	cmd?: string;
}

/** One line of the missed log: a large output that went to the model as it was. */
export interface MissedRecord {
	ts: string;
	session: string;
	cwd: string;
	/** What ran: program and subcommand only. */
	cmd: string;
	/** Characters shown to the model. */
	chars: number;
}

export const savingLine = (r: SavingRecord | MissedRecord): string => JSON.stringify(r) + "\n";

/** Appends one record. Never throws: a log that cannot be written must not affect the session. */
export async function appendSaving(record: SavingRecord | MissedRecord, path: string = savingsLogPath()): Promise<boolean> {
	try {
		await mkdir(dirname(path), { recursive: true });
		await appendFile(path, savingLine(record), "utf8");
		return true;
	} catch {
		return false;
	}
}

/** The JSON lines of a log; a missing file or a broken line is skipped, never thrown. */
export async function readLog(path: string): Promise<Record<string, unknown>[]> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return [];
	}
	const out: Record<string, unknown>[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const v = JSON.parse(line);
			if (v && typeof v === "object" && !Array.isArray(v)) out.push(v);
		} catch {
			// a half-written line from a crash: skip it
		}
	}
	return out;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, fallback: string): string => (typeof v === "string" && v !== "" ? v : fallback);

type Tally = { name: string; n: number; total: number };

/** Groups records by `key`, summing `field`, largest first. */
export function tally(records: Record<string, unknown>[], key: string, field: string, top = 5): Tally[] {
	const m = new Map<string, Tally>();
	for (const r of records) {
		const name = str(r[key], "?");
		const t = m.get(name) ?? { name, n: 0, total: 0 };
		t.n++;
		t.total += num(r[field]);
		m.set(name, t);
	}
	return [...m.values()].sort((a, b) => b.total - a.total).slice(0, top);
}

/** The all-time report for `/squeeze status`: savings by compactor and command, and the biggest misses. */
export function report(saves: Record<string, unknown>[], misses: Record<string, unknown>[]): string {
	if (!saves.length && !misses.length) return "all time: nothing logged yet";
	const tokens = saves.reduce((s, r) => s + num(r.tokens), 0);
	const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
	const lines = [`all time: ${saves.length} outputs compacted, ~${k(tokens)} tokens saved`];
	if (saves.length) lines.push(`  by compactor: ${tally(saves, "kind", "tokens", 13).map((t) => `${t.name} ${t.n}× ~${k(t.total)}`).join(", ")}`);
	const byCmd = tally(saves.filter((r) => r.cmd), "cmd", "tokens");
	if (byCmd.length) lines.push(`  by command: ${byCmd.map((t) => `${t.name} ${t.n}× ~${k(t.total)}`).join(", ")}`);
	if (misses.length) lines.push(`  left as is (no compactor): ${tally(misses, "cmd", "chars").map((t) => `${t.name} ${t.n}× ~${k(Math.round(t.total / 4))}`).join(", ")}`);
	return lines.join("\n");
}
