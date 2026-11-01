/** Shared limits and truncation helpers: every cut leaves a visible marker behind. */

export type Limits = {
	/** Longest line kept whole; longer ones are cut with a note. */
	lineChars: number;
	/** Lines kept per file or group. */
	perGroup: number;
	/** Lines in the whole result. */
	total: number;
};

export const DEFAULT_LIMITS: Limits = { lineChars: 240, perGroup: 15, total: 250 };

export type Squeezed = {
	text: string;
	/** True when content was left out (not merely reformatted): the full output is worth saving. */
	truncated: boolean;
};

export function cutLine(line: string, max: number): string {
	if (line.length <= max) return line;
	return `${line.slice(0, max)}… [+${line.length - max} chars]`;
}

/** Caps `lines` at `total`, replacing the rest with a one-line marker. */
export function capLines(lines: string[], total: number): Squeezed {
	if (lines.length <= total) return { text: lines.join("\n"), truncated: false };
	const kept = lines.slice(0, total);
	kept.push(`… [+${lines.length - total} more lines]`);
	return { text: kept.join("\n"), truncated: true };
}
