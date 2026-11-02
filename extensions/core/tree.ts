/**
 * Tree output (`cargo tree`, `tree`, `eza --tree`, `gradle dependencies`) cut below a depth, with a marker that says
 * how many lines were left out under each cut:
 *
 *   ├── ratatui v0.30.2
 *   │   ├── instability v0.3.14 (proc-macro)
 *   │   │   ├── darling v0.24.1
 *               … [+15 lines deeper]
 *
 * A cut of a single line is not worth a marker and is left in.
 */
import { cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

/** Box-drawing trees indent by 4; gradle's ASCII one (`+--- `, `|    `) by 5, Maven's by 3. */
const STYLES = [
	{ prefix: /^((?:│   |    )*)/, branch: /^(?:│   |    )*(?:├── |└── )/, unit: 4 },
	{ prefix: /^((?:\|    | {5})*)/, branch: /^(?:\|    | {5})*(?:\+--- |\\--- )/, unit: 5 },
	// Maven's `dependency:tree`: `+- `, `\- `, `|  `.
	{ prefix: /^((?:\|  | {3})*)/, branch: /^(?:\|  | {3})*(?:\+- |\\- )/, unit: 3 },
];

/** Levels kept below the root. */
const DEPTH = 3;

export function compactTree(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	const style = STYLES.find((s) => lines.some((l) => s.branch.test(l)));
	if (lines.length < 5 || !style) return undefined;
	const { prefix, branch, unit } = style;
	const out: string[] = [];
	let hidden: string[] = [];
	const flush = () => {
		if (hidden.length === 1) out.push(cutLine(hidden[0]!, limits.lineChars));
		else if (hidden.length) out.push(`${" ".repeat(DEPTH * unit)}… [+${hidden.length} lines deeper]`);
		hidden = [];
	};
	for (const l of lines) {
		const units = prefix.exec(l)![1]!.length / unit;
		const depth = branch.test(l) || units > 0 ? units + 1 : 0;
		if (depth > DEPTH) {
			hidden.push(l);
			continue;
		}
		flush();
		out.push(cutLine(l, limits.lineChars));
	}
	flush();
	if (out.length >= lines.length) return undefined;
	return { text: out.join("\n"), truncated: true };
}
