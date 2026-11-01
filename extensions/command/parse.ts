/** `/squeeze ...`: parsing and argument completion. Pure: the handler in squeeze.ts acts on the result. */
import type { Kind } from "../core/compact.ts";

export type Command =
	| { kind: "status" }
	| { kind: "on" }
	| { kind: "off" }
	| { kind: "compactor"; compactor: Kind; on: boolean }
	| { kind: "rtk"; on: boolean }
	| { kind: "min"; chars: number }
	| { kind: "invalid"; message: string };

export const KINDS: Kind[] = ["search", "paths", "listing"];

export const USAGE = "Usage: /squeeze [status] · on · off · search|paths|listing|rtk <on|off> · min <chars>";

export function parseCommand(args: string | undefined): Command {
	const [cmd, p1] = (args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
	switch (cmd) {
		case undefined:
		case "status":
			return { kind: "status" };
		case "on":
		case "enable":
			return { kind: "on" };
		case "off":
		case "disable":
			return { kind: "off" };
		case "min": {
			const n = Number(p1);
			return Number.isInteger(n) && n >= 100 && n <= 1_000_000
				? { kind: "min", chars: n }
				: { kind: "invalid", message: "Usage: /squeeze min <chars> (100 to 1000000)" };
		}
		case "rtk":
			return p1 === "on" || p1 === "off" ? { kind: "rtk", on: p1 === "on" } : { kind: "invalid", message: "Usage: /squeeze rtk <on|off>" };
		default:
			if ((KINDS as string[]).includes(cmd)) {
				return p1 === "on" || p1 === "off"
					? { kind: "compactor", compactor: cmd as Kind, on: p1 === "on" }
					: { kind: "invalid", message: `Usage: /squeeze ${cmd} <on|off>` };
			}
			return { kind: "invalid", message: `Unknown option "${cmd}". ${USAGE}` };
	}
}

export interface CompletionItem {
	value: string;
	/** Required by pi: it calls `label.endsWith(...)` when applying a completion. */
	label: string;
	description?: string;
}

const TOP_LEVEL: CompletionItem[] = [
	{ value: "status", label: "status", description: "Show the settings and the savings" },
	{ value: "on", label: "on", description: "Turn pi-squeeze on" },
	{ value: "off", label: "off", description: "Turn it off (nothing is compacted)" },
	{ value: "search ", label: "search", description: "rg / grep results grouped by file (on or off)" },
	{ value: "paths ", label: "paths", description: "fd / find results grouped by directory (on or off)" },
	{ value: "listing ", label: "listing", description: "lsd / eza -l listings (on or off)" },
	{ value: "rtk ", label: "rtk", description: "Rewrite git, cargo, docker… through rtk, when installed (on or off)" },
	{ value: "min ", label: "min", description: "Smallest output to compact, in characters" },
];

/** `prefix` is the whole argument text typed so far (pi replaces it with `value`). */
export function completions(prefix: string): CompletionItem[] | null {
	const text = (prefix ?? "").toLowerCase().replace(/^\s+/, "");
	const kind = [...KINDS, "rtk"].find((k) => text.startsWith(`${k} `));
	const pool: CompletionItem[] = kind
		? [
				{ value: `${kind} on`, label: "on", description: kind === "rtk" ? "Rewrite commands through rtk" : `Compact ${kind} output` },
				{ value: `${kind} off`, label: "off", description: kind === "rtk" ? "Run commands as written" : `Leave ${kind} output alone` },
			]
		: TOP_LEVEL;
	const out = pool.filter((i) => i.value.startsWith(text));
	return out.length > 0 ? out : null;
}
