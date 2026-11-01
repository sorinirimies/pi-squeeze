/**
 * The persisted settings: <agent dir>/squeeze.json.
 *
 * A hand-edited file can hold anything, so `sanitizeConfig` keeps valid values and defaults the
 * rest. A missing file is not a problem (defaults); a broken one is reported, never thrown.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Kind } from "./compact.ts";

export interface Config {
	/** Master switch: when false nothing is compacted. */
	enabled: boolean;
	/** Show the savings in the status line. */
	showStatus: boolean;
	/** Which compactors run. */
	kinds: Record<Kind, boolean>;
	/** Output shorter than this many characters is never touched. */
	minChars: number;
	/** Longest line kept whole in search results. */
	lineChars: number;
	/** Match lines kept per file. */
	perGroup: number;
	/** Lines in a whole compacted result. */
	total: number;
}

export const DEFAULT_CONFIG: Config = {
	enabled: true,
	showStatus: true,
	kinds: { search: true, paths: true, listing: true },
	minChars: 400,
	lineChars: 240,
	perGroup: 15,
	total: 250,
};

export const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
	typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

export function sanitizeConfig(raw: unknown): Config {
	const r = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
	const k = (typeof r.kinds === "object" && r.kinds !== null ? r.kinds : {}) as Record<string, unknown>;
	const d = DEFAULT_CONFIG;
	return {
		enabled: bool(r.enabled, d.enabled),
		showStatus: bool(r.showStatus, d.showStatus),
		kinds: { search: bool(k.search, d.kinds.search), paths: bool(k.paths, d.kinds.paths), listing: bool(k.listing, d.kinds.listing) },
		minChars: clampInt(r.minChars, 100, 1_000_000, d.minChars),
		lineChars: clampInt(r.lineChars, 40, 4000, d.lineChars),
		perGroup: clampInt(r.perGroup, 1, 500, d.perGroup),
		total: clampInt(r.total, 20, 5000, d.total),
	};
}

/** Where pi keeps its config: PI_CODING_AGENT_DIR, then $XDG_CONFIG_HOME/pi/agent, then ~/.pi/agent. */
export function resolveAgentDir(env: Record<string, string | undefined>, home: string): string {
	if (env.PI_CODING_AGENT_DIR) return env.PI_CODING_AGENT_DIR;
	if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "pi", "agent");
	return join(home, ".pi", "agent");
}

export const configPath = (env: Record<string, string | undefined> = process.env, home = homedir()): string =>
	join(resolveAgentDir(env, home), "squeeze.json");

/** The config, plus a `problem` when the file exists but cannot be used. */
export async function readConfig(path = configPath()): Promise<{ config: Config; problem?: string }> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (e) {
		const code = (e as { code?: string } | null)?.code;
		return code === "ENOENT" ? { config: sanitizeConfig({}) } : { config: sanitizeConfig({}), problem: `cannot read ${path} (${code ?? "error"})` };
	}
	try {
		return { config: sanitizeConfig(JSON.parse(raw)) };
	} catch {
		return { config: sanitizeConfig({}), problem: `${path} is not valid JSON` };
	}
}

export async function loadConfig(path = configPath()): Promise<Config> {
	return (await readConfig(path)).config;
}

/** Atomic: written to a temp file and renamed, so a crash or a second pi session never leaves half a file. */
export async function saveConfig(config: Config, path = configPath()): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		await rename(tmp, path);
	} catch (e) {
		await Promise.allSettled([rm(tmp, { force: true })]); // the original error matters more
		throw e;
	}
}

/** The compaction options this config stands for. */
export function optionsOf(c: Config) {
	return { limits: { lineChars: c.lineChars, perGroup: c.perGroup, total: c.total }, minChars: c.minChars, kinds: c.kinds };
}
