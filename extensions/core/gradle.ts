/**
 * `gradle` / `./gradlew` output:
 *
 * * every `> Task :x UP-TO-DATE` line (and NO-SOURCE, FROM-CACHE, SKIPPED, plain executed
 *   ones) becomes one counting line; failed tasks, errors, test failures and the `BUILD`
 *   result stay;
 * * daemon, configuration-cache, AGP-option, JVM and "Run with --scan" chatter goes, as do
 *   the wrappers around a failure (`A failure occurred while executing …`), the lint
 *   baseline advice and dependencyInsight's attribute tables;
 * * repeated warnings and `--warning-mode all` deprecations are said once, with a count,
 *   without the upgrade-guide links; the failure summary does not repeat what was printed
 *   above it;
 * * Kotlin / KSP warnings, detekt and ktlint findings and Android Lint issues are grouped by
 *   message, each location listed once (see `renderDiags`); errors stay one per line;
 * * R8 "Missing class" lines become one list of class names, "Duplicate class" lines one
 *   list per pair of modules; "Searched in the following locations" lists become a count;
 * * `tasks` and `projects` reports become names per group (see gradlereports.ts);
 * * reported files lose the directory they share; framework stack frames fold.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { squeezeProjects, squeezeTaskReport } from "./gradlereports.ts";
import { isJvmNoise } from "./jvm.ts";
import { type Diag, renderDiags } from "./lint.ts";
import { foldFrames } from "./logs.ts";
import { compactTree } from "./tree.ts";

const TASK = /^> Task (\S+)(?: ([A-Z-]+))?$/;
const NOISE = [
	/^Starting a Gradle Daemon/,
	/^Daemon will be stopped/,
	/^Calculating task graph/,
	/^(Reusing|Configuration) cache/,
	/^Reusing configuration cache\.$/,
	/^Configuration cache entry/,
	/^Isolated Projects is an incubating/,
	/^Consider enabling configuration cache/,
	/^> Run with --(stacktrace|info|debug|scan)/,
	/^> Get more help at/,
	/^> Configure project /,
	/^Deprecated Gradle features were used/,
	/^You can use '--warning-mode all'/,
	/^For more on this, please refer to/,
	/^\[Incubating\] Problems report is available/,
	/^Type-safe project accessors is an incubating/,
	// AGP's explanation under each `WARNING: The option setting …` line.
	/^The current default is '/,
	/^It will be removed in version [\d.]+ of the Android Gradle plugin/,
	/^Add android\.sync\.suppress\w+=/,
	/^Download https?:\/\//,
	/^={20,}$/,
	/^-{5,}$/,
	// `gradle dependencyUpdates`: the URL under each dependency.
	/^\s+https?:\/\/\S+$/,
	// Wrappers around the actual failure.
	/^\s*> A failure occurred while executing [\w.$]+$/,
	/^\s*> There was a failure while executing work items$/,
	/^\s*Go to the documentation to learn how to <a href=/,
	// dependencyInsight: attribute tables and the legend.
	/^\s+\|.*\|\s*$/,
	/^\(\*\) - Indicates repeated occurrences/,
	/^\([cn]\) - (?:A dependency constraint|A dependency or dependency configuration)/,
	/^A web-based, searchable dependency report is available/,
	// `gradle projects`.
	/^To see a list of the tasks of a project, run/,
	/^For example, try running gradlew/,
	/^Project locations:$/,
	// javac's advice to rerun with -Xlint.
	/^Note: (?:Recompile with -Xlint|Some input files use)/,
];
/** Blocks of advice, dropped from the first line to the last. */
const ADVICE = [{ start: /^\s*Fix the issues identified by lint, or create a baseline/, end: /^\s*For more details, see https:\/\/developer\.android\.com\/studio\/write\/lint/ }];
/** Lines said once are enough (their indented continuation goes with a repeat too). */
const ONCE = /^(w: |e: |WARNING: |Lint found \d+|The full lint text report is located at:)/;
/** `--warning-mode all` deprecations, said once and without the guide link. */
const DEPRECATION = /scheduled to be removed in Gradle \d+|will fail with an error in Gradle \d+|has been deprecated\./;
const GUIDE = /\s*(?:Consult the upgrading guide for further information|For more information, please refer to|Please refer to|See)\s*:?\s*https?:\/\/\S+.*$/;

/** Findings that group by message: Kotlin / KSP warnings, detekt / ktlint, Android Lint. */
const KOTLIN_W = /^w: (?:\[ksp\] )?(?:file:\/\/)?(\/\S+?):(\d+)(?::(\d+))?:? (.*)$/;
const LINT_ISSUE = /^(\/\S+?):(\d+): (Error|Warning|Information|Hint|Fatal): (.*) \[(\w+)\]$/;
const CHECKER = /^(\/\S+?):(\d+):(\d+): (.*?)(?: \[([\w:-]+)\])?$/;
/** R8 and AGP's duplicate-class check. */
const R8_MISSING = /^(?:ERROR: )?(?:R8: )?Missing class (\S+)(?: \(referenced from: .*\))?$/;
const DUPLICATE = /^\s*(?:> )?Duplicate class (\S+) found in modules? (.+)$/;

/** Every absolute file path followed by a line number, `:12` or Maven's `:[12,5]` (not a URL's host and port). */
const PATH_AT = /(?<![\w/:.])(?:file:\/\/)?(\/[^\s:'"()[\]]+\.[A-Za-z]\w*):(?:\d|\[\d)/g;

type Group = { tool: string; diags: Diag[] };
type Listed = { label: string; names: string[] };

export function compactGradle(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines.some((l) => TASK.test(l)) || !lines.some((l) => /^BUILD (SUCCESSFUL|FAILED)/.test(l))) return undefined;

	const s = scan(lines);
	shortenPaths(s.kept, s.slots);
	const width = limits.lineChars * 8;
	let cut = s.cut;
	const expanded = s.kept.flatMap((l, i) => {
		const key = s.slots.get(i);
		if (key === undefined) return [l];
		const g = s.groups.get(key);
		if (g) {
			const r = renderDiags({ tool: g.tool, diags: g.diags, notes: [] }, { ...limits, total: Number.MAX_SAFE_INTEGER });
			cut ||= r.truncated;
			return r.text.split("\n");
		}
		const { label, names } = s.listed.get(key)!;
		return [cutLine(`${label} (${names.length}): ${names.join(" ")}`, width)];
	});
	const tasksReport = squeezeTaskReport(expanded, width);
	const projects = squeezeProjects(tasksReport.lines, width);
	const { lines: folded, folded: didFold } = foldFrames(projects.lines);

	// Blank lines only separate: never two in a row, never first. Lists may run to `width`.
	const body: string[] = [];
	for (const l of folded) {
		const blank = l.trim() === "";
		if (blank && (body.length === 0 || body.at(-1) === "")) continue;
		body.push(blank ? "" : cutLine(l, LIST_LINE.test(l) ? width : limits.lineChars));
	}
	while (body.at(-1) === "") body.pop();

	const parts = [...s.states].map(([k, v]) => `${v} ${k.toLowerCase()}`);
	const head = `gradle: ${s.tasks} tasks (${parts.join(", ")})${s.ran.length ? ` ran: ${s.ran.slice(0, 12).join(" ")}${s.ran.length > 12 ? ` … +${s.ran.length - 12}` : ""}` : ""}`;
	const capped = capLines([head, ...body], limits.total);
	return { text: capped.text, truncated: capped.truncated || didFold || cut || tasksReport.cut || projects.cut };
}

/** `label (N): name name …`: one line of names, which may run long. */
const LIST_LINE = /^\S.* \(\d+\): /;

type Scan = {
	kept: string[];
	states: Map<string, number>;
	ran: string[];
	tasks: number;
	groups: Map<string, Group>;
	listed: Map<string, Listed>;
	/** Lines where a group of findings or a list of names goes once all of it is known. */
	slots: Map<number, string>;
	/** Something was left out that the text does not show: R8 / duplicate-class references. */
	cut: boolean;
};

/** Goes through the lines once: counts tasks, drops noise and repeats, collects findings. */
function scan(lines: string[]): Scan {
	const s: Scan = { kept: [], states: new Map(), ran: [], tasks: 0, groups: new Map(), listed: new Map(), slots: new Map(), cut: false };
	const { kept } = s;
	/** Where each said-once line went, and how often it came. */
	const said = new Map<string, { at: number; n: number }>();
	/** Trimmed lines printed before the failure summary, which repeats them. */
	const printed = new Set<string>();
	let skip: "try" | "repeat" | "issue" | RegExp | undefined;
	let summary = false;
	let searched: { at: number; n: number; indent: string } | undefined;

	const slot = (key: string) => s.slots.set(kept.push("") - 1, key);
	const group = (tool: string, d: Diag) => {
		const g = s.groups.get(tool) ?? { tool, diags: [] };
		if (!s.groups.has(tool)) slot(tool);
		if (!g.diags.some((x) => x.file === d.file && x.line === d.line && x.message === d.message)) g.diags.push(d);
		s.groups.set(tool, g);
	};
	const list = (key: string, label: string, name: string) => {
		const g = s.listed.get(key) ?? { label, names: [] };
		if (!s.listed.has(key)) slot(key);
		if (!g.names.includes(name)) g.names.push(name);
		s.listed.set(key, g);
		s.cut = true;
	};
	const endSearch = () => {
		kept[searched!.at] = `${searched!.indent}Searched in ${searched!.n} locations`;
		searched = undefined;
	};

	for (const raw of lines) {
		const l = DEPRECATION.test(raw) ? raw.replace(GUIDE, "") : raw;
		s.cut ||= l !== raw;
		if (/^(?:\* What went wrong:|FAILURE: )/.test(l)) summary = true;
		if (!summary) printed.add(l.trim());
		const t = TASK.exec(l);
		if (t) {
			s.tasks++;
			if (t[2] === "FAILED") kept.push(l);
			else if (t[2]) s.states.set(t[2], (s.states.get(t[2]) ?? 0) + 1);
			else (s.states.set("executed", (s.states.get("executed") ?? 0) + 1), s.ran.push(t[1]!));
			skip = undefined;
			continue;
		}
		if (searched) {
			if (/^\s+- \S+$/.test(l)) {
				searched.n++;
				s.cut = true;
				continue;
			}
			endSearch();
		}
		if (skip instanceof RegExp) {
			if (skip.test(l)) skip = undefined;
			continue;
		}
		if (skip) {
			// `* Try:` runs to a blank line; a repeat's and an issue's continuation is indented.
			const more = skip === "try" ? l.trim() !== "" : l === "" || /^\s/.test(l);
			if (more) continue;
			skip = undefined;
		}
		if (l === "* Try:") {
			skip = "try";
			continue;
		}
		const advice = ADVICE.find((a) => a.start.test(l));
		if (advice) {
			skip = advice.end;
			continue;
		}
		if (NOISE.some((n) => n.test(l)) || isJvmNoise(l)) continue;
		// The failure summary repeats lint's first issue, Kotlin's error and the like: once is enough.
		const trimmed = l.trim();
		if (summary && trimmed.length >= 4 && !trimmed.startsWith("* ") && printed.has(trimmed)) continue;

		const kw = KOTLIN_W.exec(l);
		const li = LINT_ISSUE.exec(l);
		const ck = CHECKER.exec(l);
		const r8 = R8_MISSING.exec(l);
		const dup = DUPLICATE.exec(l);
		if (kw) group("kotlin", { file: kw[1]!, line: kw[2]!, col: kw[3], severity: "warning", message: kw[4]! });
		else if (li) {
			group("android lint", { file: li[1]!, line: li[2]!, severity: li[3]!.toLowerCase(), rule: li[5], message: li[4]! });
			skip = "issue";
			s.cut = true;
		} else if (ck) group("detekt / ktlint", { file: ck[1]!, line: ck[2]!, col: ck[3], severity: "", rule: ck[5], message: ck[4]! });
		else if (r8) list("r8", "R8: missing classes", r8[1]!);
		else if (dup) list(`dup ${dup[2]}`, `Duplicate classes in ${dup[2]}`, dup[1]!);
		else if (ONCE.test(l) || DEPRECATION.test(l)) {
			const seen = said.get(l);
			if (seen) {
				seen.n++;
				skip = "repeat";
			} else said.set(l, { at: kept.push(l) - 1, n: 1 });
		} else {
			const sl = /^(\s*)Searched in the following locations:$/.exec(l);
			if (sl) searched = { at: kept.length, n: 0, indent: sl[1]! };
			kept.push(l);
		}
	}
	if (searched) endSearch();
	for (const { at, n } of said.values()) if (n > 1) kept[at] += ` (×${n})`;
	return s;
}

/** Writes the directory every reported file shares once (grouped findings do their own). */
export function shortenPaths(kept: string[], slots: Map<number, string> = new Map()) {
	const paths = kept.flatMap((l, i) => (slots.has(i) ? [] : [...l.matchAll(PATH_AT)].map((m) => m[1]!)));
	if (paths.length < 2) return;
	let prefix = paths[0]!.slice(0, paths[0]!.lastIndexOf("/") + 1);
	for (const p of paths) while (!p.startsWith(prefix)) prefix = prefix.slice(0, prefix.lastIndexOf("/", prefix.length - 2) + 1);
	if (prefix.length > 1) for (let i = 0; i < kept.length; i++) kept[i] = kept[i]!.replaceAll(`file://${prefix}`, "…/").replaceAll(prefix, "…/");
}

/** `gradle dependencies`: the gradle clean-up, then the tree cut below its depth. */
export function compactGradleDeps(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const cleaned = compactGradle(output, limits);
	const tree = compactTree(cleaned?.text ?? output, limits);
	return tree ?? cleaned;
}
