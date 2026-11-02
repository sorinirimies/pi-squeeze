/**
 * `xcodebuild` and `swift build` / `swift test`:
 *
 * * build steps (`CompileSwift …`, `Ld …`, `CodeSign …` with their indented command lines)
 *   are counted, not listed; so are progress lines (`[12/40] Compiling …`);
 * * warnings are grouped by message, one location each, without their source frame;
 * * errors keep their frame and their notes;
 * * passing tests (XCTest and Swift Testing) are counted; failures, issues and totals stay;
 * * the `** BUILD SUCCEEDED **` / `** TEST FAILED **` result stays.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { stripAnsi } from "./generic.ts";
import { renderDiags, type Diag } from "./lint.ts";

const DIAG = /^(.+?):(\d+)(?::(\d+))?: (error|warning|note): (.*)$/;
/** `CompileSwift normal arm64 …`, `WriteAuxiliaryFile …`: a CamelCase verb, or a one-word one. */
const ACTION = /^(?:[A-Z][a-z]+[A-Z]\w*|Ld|Copy|Touch|Libtool|Strip|Lipo|Ditto|Validate)(?=[ \\]|$)/;
const DROP = [
	// `2026-11-02 01:38:45.358 xcodebuild[40118:44955631] …`: tool chatter.
	/^\d{4}-\d\d-\d\d [\d:.]+ [\w.-]+\[\d+:\d+\] /,
	/^(Details|Object|Method|Thread): {1,3}\S/,
	/^Please file a bug at https:\/\/feedbackassistant/,
	/^\{ platform:/,
	/^(Command line invocation|Resolved source packages):$/,
	/^(Resolve Package Graph|Prepare packages|Testing started)$/,
	/^Build description (signature|path): /,
	/^Building for (debugging|production)\.\.\.$/,
	/^\[Planning deferred tasks\]$/,
	// SwiftPM progress; the spaces are narrow no-break ones.
	/^\[\d+\s?\/\s?\d+\]/,
	/^(Fetching|Fetched|Computing version for|Computed|Creating working copy for|Working copy of|Updating|Updated) /,
	/^note: (Building targets|Target dependency graph|Run script build phase|Using codesigning|Removed stale)/,
	/^Test Case '.*' started\.$/,
	/^Test Suite '.*' (started|passed|failed) at /,
	/^◇ /,
	/^↳ (Testing Library Version|Target Platform): /,
	/^\[#[\w-]+\]: <https?:/,
];
/** A source frame line under a diagnostic. */
const FRAME = /^\s*(\d+ )?\|/;

export function compactXcode(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = stripAnsi(output).replace(/\u200b|XCTestOutputBarrier/g, "").split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines.some((l) => /^\*\* \w+ (SUCCEEDED|FAILED) \*\*$|^Build complete!|^error: (Build failed|fatalError)|^Test Suite '|^✘ Test run|^✔ Test run/.test(l))) return undefined;

	const actions = new Map<string, number>();
	const warnings: Diag[] = [];
	const seen = new Set<string>();
	const out: string[] = [];
	let executed: string | undefined;
	let passed = 0;
	let indented = false;
	let last: "error" | "warning" | "other" = "other";
	let skipNext = false;
	for (const l of lines) {
		if (skipNext) {
			skipNext = false;
			continue;
		}
		// Each suite repeats the totals; the last one (all tests) is the one that counts.
		if (/^\s+Executed \d+ tests?/.test(l)) {
			executed = l.trim();
			continue;
		}
		if (indented && /^\s+\S/.test(l)) continue;
		indented = false;
		const action = ACTION.exec(l);
		if (action) {
			actions.set(action[0], (actions.get(action[0]) ?? 0) + 1);
			indented = true;
			continue;
		}
		if (/^(Command line invocation|Resolved source packages):$|^error: .* Command line:/.test(l)) indented = true;
		if (DROP.some((d) => d.test(l))) {
			indented = true;
			continue;
		}
		if (/^Test Case '.*' passed \(/.test(l) || /^✔ Test /.test(l)) {
			passed++;
			continue;
		}
		const d = DIAG.exec(l);
		if (d) {
			const severity = d[4]!;
			if (severity === "warning") {
				const key = `${d[1]}:${d[2]}:${d[3]}:${d[5]}`;
				if (!seen.has(key)) warnings.push({ file: d[1]!, line: d[2]!, col: d[3], severity, message: d[5]! });
				seen.add(key);
				last = "warning";
				continue;
			}
			if (severity === "note" && last !== "error") continue;
			if (severity === "error") last = "error";
			out.push(cutLine(l, limits.lineChars));
			continue;
		}
		if (FRAME.test(l) || /^\s+`- /.test(l)) {
			if (last === "error") out.push(cutLine(l, limits.lineChars));
			continue;
		}
		last = "other";
		if (l === "Failed frontend command:") skipNext = true;
		if (l.trim() === "" && (out.length === 0 || out.at(-1) === "")) continue;
		out.push(cutLine(l.trim() === "" ? "" : l, limits.lineChars));
	}
	while (out.at(-1) === "") out.pop();
	if (executed) out.push(executed);

	const steps = [...actions].sort((a, b) => b[1] - a[1]);
	const total = steps.reduce((n, [, c]) => n + c, 0);
	const head: string[] = [];
	if (total) head.push(`build: ${total} steps (${steps.slice(0, 4).map(([k, v]) => `${v} ${k}`).join(", ")}${steps.length > 4 ? ", …" : ""})`);
	if (passed) head.push(`tests: ${passed} passed (not listed)`);
	const warned = warnings.length ? ["", ...renderDiags({ tool: "swift", diags: warnings, notes: [] }, limits).text.split("\n")] : [];
	const capped = capLines([...head, ...out, ...warned], limits.total);
	return { text: capped.text, truncated: capped.truncated || warnings.length > 0 };
}

/** For sniffing: only with xcodebuild's own `** BUILD SUCCEEDED **`-style result line. */
export function compactXcodeSniffed(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	return /^\*\* [A-Z ]+ (SUCCEEDED|FAILED) \*\*$/m.test(output) ? compactXcode(output, limits) : undefined;
}
