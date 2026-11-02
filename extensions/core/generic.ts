/**
 * Clean-up for any command output, without leaving anything out that a reader would miss:
 * ANSI colour codes go, progress bars redrawn with `\r` keep their last frame, a line
 * repeated 4+ times in a row becomes `line  [×N]`, and 3+ blank lines become one.
 *
 * Never used on commands that print file content (cat, head, jq, curl…): there, every
 * byte is the point.
 */
import type { Limits, Squeezed } from "./elide.ts";

// CSI sequences (colours, cursor moves) and OSC sequences (titles, hyperlinks).
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** Commands whose output is content, not a report. Checked anywhere in the command line. */
const CONTENT = /(?:^|[\s|;&(])(cat|head|tail|sed|awk|jq|yq|bat|less|more|curl|wget|base64|xxd|od|hexdump|tee|printf|echo|diff|cmp|sort|uniq|cut|tr|wc)(?=\s|$)/;

export const isContent = (command: string): boolean => CONTENT.test(command);

/** Colour codes and terminal hyperlinks out; the text they wrapped stays. */
export const stripAnsi = (text: string): string => text.replace(ANSI, "");

export function compactGeneric(output: string, _limits?: Limits): Squeezed | undefined {
	const lines = stripAnsi(output).split("\n").map((l) => {
		const frame = l.replace(/\r+$/, "");
		return (frame.includes("\r") ? frame.slice(frame.lastIndexOf("\r") + 1) : frame).trimEnd();
	});
	const out: string[] = [];
	for (let i = 0; i < lines.length; ) {
		let j = i;
		while (j < lines.length && lines[j] === lines[i]) j++;
		const run = j - i;
		if (lines[i] === "") {
			const keep = run >= 3 ? 1 : run;
			for (let k = 0; k < keep; k++) out.push("");
		} else if (run >= 4) out.push(`${lines[i]}  [×${run}]`);
		else for (let k = 0; k < run; k++) out.push(lines[i]!);
		i = j;
	}
	return { text: out.join("\n"), truncated: false };
}
