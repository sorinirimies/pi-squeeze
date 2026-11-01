/**
 * Reads a bash command line just far enough to know which program ran and with which
 * arguments. Anything that reshapes the output (pipes, redirects, chains, substitution)
 * makes it return undefined: the output is then not in the program's own format and
 * must pass through untouched.
 */

export type Invocation = { program: string; args: string[] };

const OPERATOR = /[|;&<>`]|\$\(/;

/** Split on whitespace, honouring single/double quotes and backslash escapes. */
export function tokenize(line: string): string[] | undefined {
	const out: string[] = [];
	let cur = "";
	let has = false;
	let quote: "'" | '"' | undefined;
	for (let i = 0; i < line.length; i++) {
		const c = line[i]!;
		if (quote) {
			if (c === quote) quote = undefined;
			else if (c === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i];
			else cur += c;
		} else if (c === "'" || c === '"') {
			quote = c;
			has = true;
		} else if (c === "\\" && i + 1 < line.length) {
			cur += line[++i];
			has = true;
		} else if (/\s/.test(c)) {
			if (has || cur) out.push(cur);
			cur = "";
			has = false;
		} else {
			cur += c;
			has = true;
		}
	}
	if (quote) return undefined;
	if (has || cur) out.push(cur);
	return out;
}

/** True when `text` contains a shell operator outside quotes. */
export function hasOperator(text: string): boolean {
	let quote: "'" | '"' | undefined;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (quote) {
			if (c === quote) quote = undefined;
			else if (c === "\\" && quote === '"') i++;
			else if (quote === '"' && (c === "`" || (c === "$" && text[i + 1] === "("))) return true;
		} else if (c === "'" || c === '"') quote = c;
		else if (c === "\\") i++;
		else if (OPERATOR.test(c === "$" ? text.slice(i, i + 2) : c)) return true;
	}
	return false;
}

/** Drop a leading `cd <dir> &&`, which only sets the working directory. */
export function stripCd(command: string): string {
	return command.replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*&&\s*/, "");
}

/** The single simple command a line runs, or undefined when it is anything more. */
export function parse(command: string): Invocation | undefined {
	const line = stripCd(command).trim();
	if (!line || hasOperator(line)) return undefined;
	const words = tokenize(line);
	if (!words) return undefined;
	while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) words.shift();
	const first = words.shift();
	if (!first) return undefined;
	return { program: first.split("/").pop()!, args: words };
}

/** Does a short or long flag appear in `args` (also inside combined short flags like -rn)? */
export function hasFlag(args: string[], long: string[], short: string[] = []): boolean {
	for (const a of args) {
		if (a === "--") return false;
		if (long.includes(a) || long.some((l) => a.startsWith(`${l}=`))) return true;
		if (/^-[A-Za-z]+$/.test(a) && short.some((s) => a.includes(s))) return true;
	}
	return false;
}
