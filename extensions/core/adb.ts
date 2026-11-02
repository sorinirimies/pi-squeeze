/**
 * `adb shell pm list packages`: the `package:` prefix goes and names are grouped by their
 * first two segments, each name still complete once its group is read:
 *
 *   com.google.android (3): apps.messaging gms gsf
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

export function compactPackages(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n").map((l) => l.trimEnd());
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines.length || !lines.every((l) => /^package:[\w.]+$/.test(l))) return undefined;
	const groups = new Map<string, string[]>();
	for (const l of lines.map((l) => l.slice("package:".length)).sort()) {
		const parts = l.split(".");
		const key = parts.length > 2 ? parts.slice(0, 2).join(".") : "";
		groups.set(key, [...(groups.get(key) ?? []), key ? parts.slice(2).join(".") : l]);
	}
	const out = [`${lines.length} packages`];
	// A group line may run long: it is still one line of names, cut only far past the usual width.
	const width = limits.lineChars * 8;
	let cut = false;
	for (const [key, names] of groups) {
		const line = key ? `${key} (${names.length}): ${names.join(" ")}` : names.join(" ");
		cut ||= line.length > width;
		out.push(cutLine(line, width));
	}
	const capped = capLines(out, limits.total);
	return { text: capped.text, truncated: cut || capped.truncated };
}
