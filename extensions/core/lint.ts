/**
 * Linter findings grouped by rule and message, each location listed once:
 *
 *   eslint: 20 errors, 5 warnings in 5 files
 *   error eqeqeq: Expected '===' and instead saw '==' (5)
 *     src/m.js:2:46  src/m1.js:2:47  …
 *
 * Source frames, help text and fix suggestions go (the location leads back to them). Formats:
 * ESLint stylish, Biome, Ruff (full and concise), `flutter analyze`, and the one-line
 * `path:line:col: message` shape that flake8, mypy, pylint, ktlint, detekt, swiftlint and
 * shellcheck share, and Android Lint's text report (its source lines and explanations go). Anything else in the output passes the whole of it through.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { stripAnsi } from "./generic.ts";

export type Diag = { file: string; line: string; col?: string; severity: string; rule?: string; message: string };
/** `lossy`: the format had more than the findings (frames, help, fixes), which the result leaves out. */
export type Parsed = { tool: string; diags: Diag[]; notes: string[]; lossy?: boolean };

/** ESLint's default `stylish` formatter. */
export function parseEslint(lines: string[]): Parsed | undefined {
	const diags: Diag[] = [];
	const notes: string[] = [];
	let file: string | undefined;
	for (const l of lines) {
		const m = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}(\S+))?$/.exec(l);
		if (m && file) diags.push({ file, line: m[1]!, col: m[2], severity: m[3]!, message: m[4]!, rule: m[5] });
		else if (/^✖ \d+ problems?/.test(l) || /^\s+\d+ errors? and \d+ warnings? potentially fixable/.test(l)) notes.push(l.trim());
		else if (/^\S/.test(l) && !/:\d+/.test(l)) file = l;
		else if (l.trim() !== "") return undefined;
	}
	return diags.length && notes.length ? { tool: "eslint", diags, notes } : undefined;
}

/** Biome: `path:line:col rule  FIXABLE  ━━━` headers, the message on the first `×`/`!`/`i` line. */
export function parseBiome(lines: string[]): Parsed | undefined {
	const diags: Diag[] = [];
	const notes: string[] = [];
	let open: Diag | undefined;
	let footer = false;
	for (const l of lines) {
		const h = /^(\S+?):(\d+):(\d+) (\S+)(?:\s+FIXABLE)?\s+━+$/.exec(l);
		if (h && !footer) {
			open = { file: h[1]!, line: h[2]!, col: h[3], rule: h[4], severity: "", message: "" };
			diags.push(open);
		} else if (/^(Checked \d+ files?|Found \d+ (errors?|warnings?|infos?)|The number of diagnostics exceeds|Skipped \d+ suggested)/.test(l)) {
			footer = true;
			notes.push(l);
		} else if (footer && /^\s+× /.test(l)) notes.push(l.trim());
		else if (open && !open.message) {
			const m = /^\s+([×!i]) (.*)$/.exec(l);
			if (m) {
				open.severity = m[1] === "×" ? "error" : m[1] === "!" ? "warning" : "info";
				open.message = m[2]!;
			}
		}
	}
	return diags.length && notes.length && diags.every((d) => d.message) ? { tool: "biome", diags, notes, lossy: true } : undefined;
}

/** Ruff's full format: `CODE [*] message` then ` --> path:line:col`, then a frame and help. */
export function parseRuff(lines: string[]): Parsed | undefined {
	const diags: Diag[] = [];
	const notes: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i]!;
		const h = /^([A-Z]+\d+) (?:\[\*\] )?(.*)$/.exec(l);
		const at = /^\s*--> (.+?):(\d+):(\d+)$/.exec(lines[i + 1] ?? "");
		if (h && at) {
			diags.push({ file: at[1]!, line: at[2]!, col: at[3], rule: h[1], severity: "", message: h[2]! });
			i++;
		} else if (/^(Found \d+ errors?|\[\*\] \d+ fixable|No fixes available|warning: )/.test(l)) notes.push(l);
	}
	return diags.length ? { tool: "ruff", diags, notes, lossy: true } : undefined;
}

/** `flutter analyze` / `dart analyze`: `  info • message • lib/a.dart:3:5 • rule`. */
export function parseDart(lines: string[]): Parsed | undefined {
	const diags: Diag[] = [];
	const notes: string[] = [];
	for (const l of lines) {
		const m = /^\s*(error|warning|info) • (.*) • (\S+?):(\d+):(\d+) • (\S+)$/.exec(l);
		if (m) diags.push({ severity: m[1]!, message: m[2]!, file: m[3]!, line: m[4]!, col: m[5], rule: m[6] });
		else if (l.trim() !== "") notes.push(l.trim());
	}
	return diags.length && notes.length <= 4 ? { tool: "analyze", diags, notes } : undefined;
}

const LOCATED = /^(\S.*?):(\d+)(?::(\d+))?:? (?:(error|warning|note|info|fatal|convention|refactor|style)\s*:?\s+)?(.+)$/;
/** Lines a one-line linter prints around its findings. */
const BANNER = /^(Found \d+|\[\*\] \d+ fixable|No fixes available|warning: |Success: |All checks passed|Your code has been rated|-{10,}|\*{5,} Module |Summary: |Done linting|Summary error count|\s+[\w:./-]+: \d+$|\d+ (problems?|errors?|warnings?|violations?|issues?)\b)/;

/** One finding per line: `path:line[:col]: [severity:] message [rule]`. */
export function parseLocated(lines: string[]): Parsed | undefined {
	const diags: Diag[] = [];
	const notes: string[] = [];
	for (const l of lines) {
		const m = LOCATED.exec(l);
		if (m && !/^\s/.test(l) && !BANNER.test(l)) {
			let message = m[5]!;
			let rule: string | undefined;
			const code = /^([A-Z]+\d+):? (?:\[\*\] )?(.*)$/.exec(message);
			const tail = /^(.*?)\s+[[(]([\w:./@-]+)[\])]$/.exec(message);
			if (code) [rule, message] = [code[1], code[2]!];
			else if (tail) [message, rule] = [tail[1]!, tail[2]];
			diags.push({ file: m[1]!, line: m[2]!, col: m[3], severity: m[4] ?? "", rule, message });
		} else if (BANNER.test(l)) notes.push(l);
		else if (l.trim() !== "") return undefined;
	}
	return diags.length ? { tool: "lint", diags, notes } : undefined;
}

/** Android Lint's text report: `path:12: Warning: message [IssueId]`, the source line, `~~~~`, explanations. */
const ANDROID_LINT = /^(\S.*?):(\d+): (Error|Warning|Information|Hint|Fatal): (.*) \[(\w+)\]$/;

export function parseAndroidLint(lines: string[]): Parsed | undefined {
	const diags: Diag[] = [];
	const notes: string[] = [];
	for (const l of lines) {
		const m = ANDROID_LINT.exec(l);
		if (m) diags.push({ file: m[1]!, line: m[2]!, severity: m[3]!.toLowerCase(), rule: m[5], message: m[4]! });
		// Source lines, underlines and explanations are indented; the summary is `3 errors, 1 warning`.
		else if (/^\d+ errors?(, \d+ warnings?)?$|^\d+ warnings?$|^No issues found/.test(l)) notes.push(l);
		else if (l.trim() !== "" && !/^\s/.test(l)) return undefined;
	}
	return diags.length ? { tool: "android lint", diags, notes, lossy: true } : undefined;
}

/** The directory every absolute path shares, to be written once. */
export function sharedDir(files: string[]): string {
	if (!files.length || !files.every((f) => f.startsWith("/"))) return "";
	let prefix = files[0]!.slice(0, files[0]!.lastIndexOf("/") + 1);
	for (const f of files) while (!f.startsWith(prefix)) prefix = prefix.slice(0, prefix.lastIndexOf("/", prefix.length - 2) + 1);
	return prefix.length > 1 ? prefix : "";
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Renders findings grouped by severity, rule and message. */
export function renderDiags({ tool, diags, notes, lossy = false }: Parsed, limits: Limits): Squeezed {
	const dir = sharedDir([...new Set(diags.map((d) => d.file))]);
	const groups = new Map<string, string[]>();
	for (const d of diags) {
		// A message that names its own file (detekt's license rule) groups with the others once the name goes.
		const message = d.message.replaceAll(d.file, "<file>");
		const key = `${d.severity ? `${d.severity} ` : ""}${d.rule ? `${d.rule}: ` : ""}${message}`;
		const at = `${d.file.slice(dir.length)}:${d.line}${d.col ? `:${d.col}` : ""}`;
		groups.set(key, [...(groups.get(key) ?? []), at]);
	}
	const by = (s: string) => diags.filter((d) => d.severity === s).length;
	const parts = [by("error") && count(by("error"), "error"), by("warning") && count(by("warning"), "warning")].filter(Boolean);
	const files = new Set(diags.map((d) => d.file)).size;
	const out = [`${tool}: ${parts.length ? parts.join(", ") : count(diags.length, "finding")} in ${count(files, "file")}${dir ? ` (under ${dir})` : ""}`];
	let cut = false;
	const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
	for (const [key, at] of sorted) {
		// A finding of its own is one line: message, then where.
		if (at.length === 1) {
			out.push(cutLine(`${key}  ${at[0]}`, limits.lineChars));
			continue;
		}
		out.push(cutLine(`${key} (${at.length})`, limits.lineChars));
		const shown = at.slice(0, limits.perGroup * 2);
		// Locations share lines, as many as fit.
		let line = " ";
		for (const a of shown) {
			if (line.length + a.length + 2 > limits.lineChars && line.trim()) (out.push(line), (line = " "));
			line += ` ${a}`;
		}
		if (at.length > shown.length) {
			line += `  … +${at.length - shown.length}`;
			cut = true;
		}
		out.push(line);
	}
	if (notes.length) out.push("", ...notes.map((n) => cutLine(n, limits.lineChars)));
	const capped = capLines(out, limits.total);
	return { text: capped.text, truncated: lossy || cut || capped.truncated };
}

const PARSERS = [parseEslint, parseBiome, parseRuff, parseDart, parseAndroidLint, parseLocated];

export function compactLint(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = stripAnsi(output).split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	for (const parse of PARSERS) {
		const p = parse(lines);
		if (p) return renderDiags(p, limits);
	}
	return undefined;
}

/** For sniffing: only formats with an unmistakable shape (a `path:line` line alone could be anything). */
export function compactLintSniffed(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = stripAnsi(output).split("\n");
	const android = lines.some((l) => /^\s+~+$/.test(l)) ? parseAndroidLint(lines) : undefined;
	const p = parseEslint(lines) ?? parseBiome(lines) ?? parseRuff(lines) ?? android;
	return p ? renderDiags(p, limits) : undefined;
}
