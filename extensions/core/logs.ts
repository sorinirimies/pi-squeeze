/**
 * Logs (`docker logs`, `docker compose logs`, `kubectl logs`, `journalctl`, `adb logcat`):
 *
 * * a run of 3+ lines that differ only in timestamps and numbers keeps its first and last
 *   line, with `… [N similar]` between;
 * * stack frames of the runtime itself (java., android., kotlinx.coroutines., …) fold into
 *   `… N framework frames`;
 * * logcat's `MM-DD` date (when it is the same throughout) and thread id go;
 * * the end of a log is what matters: past the line limit the start goes, not the end.
 */
import { cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { stripAnsi } from "./generic.ts";

/** Leading timestamps in the common log formats (ISO 8601, syslog, logcat, bracketed clock). */
const STAMP = /^(?:\S+\s+\|\s+)?(?:\[?\d{4}-\d\d-\d\dT?\s?[\d:.,]+(?:Z|[+-]\d\d:?\d\d)?\]?|[A-Z][a-z]{2} [ \d]\d [\d:]{8}|\d\d-\d\d [\d:.]{12}|\[?[\d:]{8}(?:[.,]\d+)?\]?)\s*/;

/** Frames of runtimes and frameworks: never the code being debugged. */
const FRAMEWORK = /(?:^|:\s)\s*at (?:java\.|javax\.|jdk\.|sun\.|kotlin\.|kotlinx\.coroutines\.|android\.|androidx\.|com\.android\.|dalvik\.|libcore\.|org\.junit\.|junit\.|org\.gradle\.|worker\.org\.gradle\.|org\.robolectric\.|com\.intellij\.|io\.mockk\.|org\.mockito\.|node:internal|process\.processTicksAndRejections|new Promise \(<anonymous>\))/;

/** The shape of a line once what changes from one occurrence to the next is gone. */
export const shape = (line: string): string => line.replace(STAMP, "").replace(/0x[\da-f]+|\d+/gi, "#");

/** Folds runs of framework stack frames. */
export function foldFrames(lines: string[]): { lines: string[]; folded: boolean } {
	const out: string[] = [];
	let folded = false;
	for (let i = 0; i < lines.length; ) {
		let j = i;
		while (j < lines.length && FRAMEWORK.test(lines[j]!)) j++;
		if (j - i >= 2) {
			// Whatever stood before `at ` (indent, a logcat prefix) stays.
			const m = FRAMEWORK.exec(lines[i]!)!;
			out.push(`${lines[i]!.slice(0, m.index + m[0].indexOf("at "))}… ${j - i} framework frames`);
			folded = true;
			i = j;
		} else out.push(lines[i++]!);
	}
	return { lines: out, folded };
}

/** logcat `threadtime`: `11-02 01:36:28.503  1947  2690 D Tag: message`. */
const LOGCAT = /^(\d\d-\d\d) ([\d:.]{12}) +(\d+) +\d+ ([VDIWEFA]) (.*)$/;

function shortenLogcat(lines: string[]): string[] {
	const dates = new Set(lines.map((l) => LOGCAT.exec(l)?.[1]).filter(Boolean));
	if (!dates.size) return lines;
	const keepDate = dates.size > 1;
	return lines.map((l) => {
		const m = LOGCAT.exec(l);
		return m ? `${keepDate ? `${m[1]} ` : ""}${m[2]} ${m[3]} ${m[4]} ${m[5]}` : l;
	});
}

export function compactLogs(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const raw = stripAnsi(output).split("\n");
	while (raw.length && raw.at(-1) === "") raw.pop();
	if (raw.length < 4) return undefined;
	const logcat = raw.some((l) => LOGCAT.test(l));
	const lines = logcat ? shortenLogcat(raw) : raw;

	const runs: string[] = [];
	let similar = false;
	for (let i = 0; i < lines.length; ) {
		const s = shape(lines[i]!);
		let j = i + 1;
		while (j < lines.length && shape(lines[j]!) === s) j++;
		if (j - i >= 3) {
			runs.push(lines[i]!, `  … [${j - i - 2} similar]`, lines[j - 1]!);
			similar = true;
		} else runs.push(...lines.slice(i, j));
		i = j;
	}
	const { lines: folded, folded: didFold } = foldFrames(runs);
	const cut = folded.map((l) => cutLine(l, limits.lineChars));
	const dropped = Math.max(0, cut.length - limits.total);
	const text = [...(dropped ? [`… [first ${dropped} lines left out]`] : []), ...cut.slice(dropped)].join("\n");
	return { text, truncated: logcat || similar || didFold || dropped > 0 || cut.some((l, i) => l !== folded[i]) };
}
