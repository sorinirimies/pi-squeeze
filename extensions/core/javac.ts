/**
 * `javac` output: each error keeps its source line, caret and `symbol:` / `location:` lines
 * (what fixing it needs); warnings are grouped by kind and message, each location once
 * (`warning [rawtypes]: found raw type: List (3)`), their source lines and "where E is a
 * type-variable" explanations go, as does the advice to recompile with -Xlint. Anything
 * that is not javac output passes the whole of it through.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { shortenPaths } from "./gradle.ts";
import { type Diag, renderDiags } from "./lint.ts";

const HEAD = /^(\S.*?\.java):(\d+): (error|warning): (?:\[([\w-]+)\] )?(.*)$/;
const TOTAL = /^\d+ (?:errors?|warnings?)$/;
const NOTE = /^Note: /;

export function compactJavac(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	const errors: string[] = [];
	const warnings: Diag[] = [];
	const totals: string[] = [];
	let current: "error" | "warning" | undefined;
	for (const l of lines) {
		const m = HEAD.exec(l);
		if (m) {
			current = m[3] as "error" | "warning";
			if (current === "error") errors.push(l);
			else warnings.push({ file: m[1]!, line: m[2]!, severity: "warning", rule: m[4], message: m[5]! });
		} else if (TOTAL.test(l)) totals.push(l);
		else if (NOTE.test(l)) {
			// "uses or overrides a deprecated API" says something; "Recompile with -Xlint" does not.
			if (!/Recompile with -Xlint/.test(l)) totals.push(l);
		} else if (!current) return undefined;
		// Under an error: the source line, the caret and symbol/location stay; type-variable notes go.
		else if (current === "error" && !/^\s+(?:where \w+ is a type-variable|\w+ extends \w+ declared in)/.test(l)) errors.push(l);
	}
	if (!errors.length && !warnings.length) return undefined;
	shortenPaths(errors);
	const out = errors.map((l) => cutLine(l, limits.lineChars));
	if (warnings.length) out.push(...renderDiags({ tool: "javac", diags: warnings, notes: [] }, { ...limits, total: Number.MAX_SAFE_INTEGER }).text.split("\n"));
	out.push(...totals);
	const capped = capLines(out, limits.total);
	return { text: capped.text, truncated: warnings.length > 0 || capped.truncated };
}
