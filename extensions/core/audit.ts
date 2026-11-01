/**
 * `cargo audit` advisories, one line each:
 *
 *   RUSTSEC-2025-0141 bincode 1.3.3 unmaintained: Bincode is unmaintained  (fix: upgrade to >=1.3.4)
 *
 * The dependency-tree dump under a vulnerability, the date and the URL go. Strict: a block
 * without an `ID:` line makes it return undefined.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

const FIELD = /^([A-Z][A-Za-z ]*?):\s+(.*)$/;

export function compactAudit(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	const head: string[] = [];
	const rows: string[] = [];
	const tail: string[] = [];
	let fields: Record<string, string> | undefined;
	let inTree = false;
	const finish = () => {
		if (!fields) return true;
		const f = fields;
		fields = undefined;
		if (!f.ID || !f.Crate) return false;
		const kind = f.Warning ?? (f.Severity ? `vulnerability (${f.Severity})` : "vulnerability");
		rows.push(cutLine(`${f.ID} ${f.Crate} ${f.Version ?? ""} ${kind}: ${f.Title ?? ""}${f.Solution ? `  (fix: ${f.Solution})` : ""}`, limits.lineChars));
		return true;
	};
	for (const l of lines) {
		if (l === "") {
			inTree = false;
			if (!finish()) return undefined;
			continue;
		}
		if (fields && l.startsWith("Dependency tree:")) {
			inTree = true;
			continue;
		}
		const m = FIELD.exec(l);
		if (m && m[1] === "Crate") {
			if (!finish()) return undefined;
			fields = { Crate: m[2]! };
		} else if (fields && m && !inTree) {
			fields[m[1]!] = m[2]!;
		} else if (fields) {
			if (!inTree) return undefined;
		} else if (rows.length || /^(warning|error): \d+ /.test(l)) tail.push(l);
		else head.push(l);
	}
	if (!finish() || !rows.length) return undefined;
	const scanned = head.find((l) => /^\s+Scanning /.test(l));
	return capLines([...(scanned ? [scanned.trim()] : []), `${rows.length} advisories`, ...rows, ...tail], limits.total);
}
