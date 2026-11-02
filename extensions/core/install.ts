/**
 * Package installs (npm, pnpm, yarn, bun, pip, uv, CocoaPods, Bundler, pub): download and progress lines
 * go, per-package lines collapse into one line each (`Collecting (9): requests, rich, …`),
 * deprecation warnings become one list of names. Errors, the summary and anything not
 * recognised stay where they were.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { stripAnsi } from "./generic.ts";

type Rule = { re: RegExp; label: string; item: (m: RegExpExecArray) => string };

/** Lines that say nothing once the install is over. */
const DROP: RegExp[] = [
	// npm
	/^\d+ packages? (are|is) looking for funding$/,
	/^ {2}run `npm fund` for details$/,
	/^To address (all|issues that do not require attention|all issues possible)/,
	/^ {2}npm audit fix/,
	/^Some issues need review, and may require choosing$/,
	/^a different dependency\.$/,
	/^npm notice/,
	/^(up to date|changed \d+ packages?), audited/,
	// pip
	/^ {2}Downloading \S+/,
	/^ {2}Using cached \S+/,
	/^ {2}Preparing metadata/,
	/^ {2}(Installing|Getting requirements to) build/,
	/^ {2}(Building|Created|Stored in directory)/,
	/^Building wheels? for /,
	/^Installing collected packages: /,
	/^ {2}Attempting uninstall: /,
	/^ {4}(Found existing installation|Uninstalling) /,
	/^ {6}Successfully uninstalled /,
	/^WARNING: You are using pip version/,
	/^You should consider upgrading via/,
	/^\[notice\] /,
	/^\s*[━╸╺\-]+ [\d.]+\/[\d.]+ [kMG]?B /,
	// bun, uv, pnpm, yarn
	/^bun (add|install|update|remove) v[\d.]+/,
	/^Resolving dependencies$/,
	/^Resolved, downloaded and extracted/,
	/^Saved lockfile$/,
	/^(Resolved|Prepared|Audited|Uninstalled) \d+ packages? in /,
	/^Progress: resolved \d+/,
	/^Packages: [+-]\d+/,
	/^[+-]+$/,
	/^\[\d\/\d\] /,
	/^(yarn (install|add) v|info (No lockfile|Lockfile|fsevents)|success Saved lockfile|Done in [\d.]+s)/,
	// CocoaPods, pub
	/^(Analyzing|Downloading) dependencies$/,
	/^Fetching gem metadata from /,
	/^(Generating Pods project|Integrating client project|Resolving dependencies\.\.\.|Downloading packages\.\.\.|Got dependencies!?)$/,
];

/** Lines that become one counted line, at the place of the first one. */
const COLLECT: Rule[] = [
	{ re: /^npm warn deprecated (\S+): /, label: "npm warn deprecated", item: (m) => m[1]! },
	{ re: /^\s*WARN\s+deprecated (\S+): /, label: "pnpm WARN deprecated", item: (m) => m[1]! },
	{ re: /^warning (\S+(?: > \S+)*): .*deprecated/, label: "yarn warning deprecated", item: (m) => m[1]! },
	{ re: /^Collecting (\S+)/, label: "Collecting", item: (m) => m[1]! },
	{ re: /^Requirement already satisfied: (\S+)/, label: "Requirement already satisfied", item: (m) => m[1]! },
	{ re: /^installed (\S+)/, label: "installed", item: (m) => m[1]! },
	{ re: /^ ?\+ (\S+)(?: (\S+))?$/, label: "+", item: (m) => (m[2] ? `${m[1]} ${m[2]}` : m[1]!) },
	{ re: /^ - (\S+)(?: (\S+))?$/, label: "-", item: (m) => (m[2] ? `${m[1]} ${m[2]}` : m[1]!) },
	{ re: /^Installing (\S+) \(([^)]+)\)$/, label: "Installing", item: (m) => `${m[1]} ${m[2]}` },
	{ re: /^Using (\S+) \(([^)]+)\)$/, label: "Using", item: (m) => `${m[1]} ${m[2]}` },
	// Bundler: `Using rake 13.0.6`, `Installing nokogiri 1.16.0 with native extensions`.
	{ re: /^Using (\S+) ([\w.]+)$/, label: "Using", item: (m) => `${m[1]} ${m[2]}` },
	{ re: /^Installing (\S+) ([\w.]+)(?: with native extensions)?$/, label: "Installing", item: (m) => `${m[1]} ${m[2]}` },
	{ re: /^Fetching (\S+) ([\w.]+)$/, label: "Fetching", item: (m) => `${m[1]} ${m[2]}` },
	{ re: /^ {2}(\S+) ([\w.+-]+) \(([\w.+-]+) available\)$/, label: "newer versions available", item: (m) => `${m[1]} ${m[2]}→${m[3]}` },
];

/** Names shown per collected line before `… +N`. */
const SHOWN = 12;

export function compactInstall(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = stripAnsi(output)
		.split("\n")
		.map((l) => {
			// A progress bar redrawn with `\r`: only its last frame counts.
			const frame = l.replace(/\r+$/, "");
			return frame.slice(frame.lastIndexOf("\r") + 1);
		});
	while (lines.length && lines.at(-1) === "") lines.pop();
	const out: (string | { label: string; items: string[] })[] = [];
	const groups = new Map<string, { label: string; items: string[] }>();
	let touched = 0;
	for (const l of lines) {
		if (DROP.some((d) => d.test(l))) {
			touched++;
			continue;
		}
		const rule = COLLECT.find((r) => r.re.test(l));
		if (rule) {
			touched++;
			const label = rule.label;
			let g = groups.get(label);
			if (!g) {
				g = { label, items: [] };
				groups.set(label, g);
				out.push(g);
			}
			g.items.push(rule.item(rule.re.exec(l)!));
			continue;
		}
		if (l === "" && (out.length === 0 || out.at(-1) === "")) continue;
		out.push(l);
	}
	if (!touched) return undefined;
	// A collected line keeps the names, not the rest of each line (paths, deprecation notes).
	let cut = false;
	const text = out.map((o) => {
		if (typeof o === "string") return cutLine(o, limits.lineChars);
		const shown = o.items.slice(0, SHOWN).join(", ");
		if (o.items.length > SHOWN) cut = true;
		return `${o.label} (${o.items.length}): ${shown}${o.items.length > SHOWN ? `, … +${o.items.length - SHOWN}` : ""}`;
	});
	while (text.at(-1) === "") text.pop();
	const capped = capLines(text, limits.total);
	return { text: capped.text, truncated: cut || capped.truncated || groups.size > 0 };
}
