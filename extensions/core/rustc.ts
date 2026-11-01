/**
 * `cargo build` / `check` / `clippy` output. Errors keep their full block (they are why you
 * ran the command); warnings shrink to one line each, grouped by lint:
 *
 *   clippy::needless_return (2)
 *     src/lib.rs:2:55 unneeded `return` statement
 *
 * Build progress (`Compiling`, `Checking`, `Finished`) goes, an identical warning reported
 * for several targets is listed once, and the summary lines stay.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

const PROGRESS = /^\s+(Compiling|Checking|Downloaded|Downloading|Updating|Locking|Fresh|Blocking|Adding|Building|Documenting|Finished|Fixed|Generated) /;
const HEAD = /^(warning|error)(?:\[(E\d+)\])?: (.*)$/;
const WHERE = /^\s*--> (.+?:\d+:\d+)$/;
const ERROR_LINES = 40;

type Diag = { level: "warning" | "error"; code: string; message: string; where: string; lint: string; help: string; block: string[] };

function lintOf(block: string[]): string {
	for (const l of block) {
		const a = /#\[(?:warn|deny|forbid)\(([\w:]+)\)\]/.exec(l);
		if (a) return a[1]!;
		const b = /rust-clippy\/[^#]*#(\w+)$/.exec(l);
		if (b) return `clippy::${b[1]}`;
	}
	return "other";
}

function parseBlock(block: string[]): Diag | undefined {
	const h = HEAD.exec(block[0] ?? "");
	const w = block.map((l) => WHERE.exec(l)).find(Boolean);
	if (!h || !w) return undefined;
	const help = block.map((l) => /\^+ help: (.*)$/.exec(l)).find(Boolean)?.[1] ?? "";
	return { level: h[1] as Diag["level"], code: h[2] ?? "", message: h[3]!, where: w[1]!, lint: lintOf(block), help, block };
}

export function compactRustc(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	const blocks: string[][] = [[]];
	for (const l of lines) {
		if (PROGRESS.test(l)) continue;
		if (l === "") blocks.push([]);
		else blocks.at(-1)!.push(l);
	}
	const diags: Diag[] = [];
	const other: string[] = [];
	let seen = false;
	const order: (Diag | string)[] = [];
	for (const b of blocks) {
		if (!b.length) continue;
		const d = parseBlock(b);
		if (d) {
			seen = true;
			diags.push(d);
			order.push(d);
		} else {
			other.push(...b);
			order.push(b.join("\n"));
		}
	}
	if (!seen) return undefined;

	const errors = diags.filter((d) => d.level === "error");
	const warnings = new Map<string, Map<string, string>>();
	for (const d of diags) {
		if (d.level !== "warning") continue;
		const group = warnings.get(d.lint) ?? new Map<string, string>();
		warnings.set(d.lint, group);
		group.set(`${d.where} ${d.message}`, cutLine(`  ${d.where} ${d.message}${d.help ? ` → ${d.help}` : ""}`, limits.lineChars));
	}
	const out: string[] = [];
	const count = [...warnings.values()].reduce((n, g) => n + g.size, 0);
	out.push(`${errors.length} error${errors.length === 1 ? "" : "s"}, ${count} warning${count === 1 ? "" : "s"}`);
	let cut = false;
	for (const e of errors) {
		out.push("", ...e.block.slice(0, ERROR_LINES).map((l) => cutLine(l, limits.lineChars)));
		if (e.block.length > ERROR_LINES) {
			out.push(`  … [+${e.block.length - ERROR_LINES} more lines]`);
			cut = true;
		}
	}
	if (errors.length && warnings.size) out.push("");
	for (const [lint, group] of warnings) {
		out.push(`${lint} (${group.size})`);
		const entries = [...group.values()];
		out.push(...entries.slice(0, limits.perGroup));
		if (entries.length > limits.perGroup) {
			out.push(`  … [+${entries.length - limits.perGroup} more]`);
			cut = true;
		}
	}
	// Whatever is not a diagnostic (summaries, `error: could not compile`, notes) stays as it was.
	const rest = other.filter((l) => l !== "");
	if (rest.length) out.push("", ...rest);
	const capped = capLines(out, limits.total);
	return { text: capped.text, truncated: cut || capped.truncated };
}
