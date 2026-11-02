/**
 * `gradle` / `./gradlew` output: every `> Task :x UP-TO-DATE` line (and NO-SOURCE, FROM-CACHE,
 * SKIPPED, plain executed ones) becomes one counting line; failed tasks, compiler errors and
 * warnings, test failures and the `BUILD` result stay. The daemon, configuration-cache,
 * AGP-option and "Run with --scan" hints go; repeated `w:` / `WARNING:` lines are said once;
 * reported files (Kotlin, detekt, ktlint, javac) lose the directory they share; framework
 * stack frames fold.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { foldFrames } from "./logs.ts";
import { compactTree } from "./tree.ts";

const TASK = /^> Task (\S+)(?: ([A-Z-]+))?$/;
const NOISE = [
	/^Starting a Gradle Daemon/,
	/^Daemon will be stopped/,
	/^Calculating task graph/,
	/^(Reusing|Configuration) cache/,
	/^Configuration cache entry/,
	/^Isolated Projects is an incubating/,
	/^Consider enabling configuration cache/,
	/^> Run with --(stacktrace|info|debug|scan)/,
	/^> Get more help at/,
	/^> Configure project /,
	/^Deprecated Gradle features were used/,
	/^You can use '--warning-mode all'/,
	/^For more on this, please refer to/,
	/^OpenJDK 64-Bit Server VM warning: Sharing is only supported/,
	/^\[Incubating\] Problems report is available/,
	/^Type-safe project accessors is an incubating/,
	/^Configuration cache entry (stored|reused)/,
	// AGP's explanation under each `WARNING: The option setting …` line.
	/^The current default is '/,
	/^It will be removed in version [\d.]+ of the Android Gradle plugin/,
	/^Add android\.sync\.suppress\w+=/,
	/^Download https?:\/\//,
	/^={20,}$/,
	/^-{5,}$/,
	// `gradle dependencyUpdates`: the URL under each dependency.
	/^\s+https?:\/\/\S+$/,
];
/** A diagnostic that starts with an absolute path: Kotlin `w:`/`e:`, detekt, ktlint, javac. */
const LOCATED = /^(?:[we]: )?(?:file:\/\/)?(\/[^\s:]+):\d+/;
/** Lines said once are enough. */
const ONCE = /^(w: |e: |WARNING: )/;

export function compactGradle(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines.some((l) => TASK.test(l)) || !lines.some((l) => /^BUILD (SUCCESSFUL|FAILED)/.test(l))) return undefined;

	const states = new Map<string, number>();
	const ran: string[] = [];
	const kept: string[] = [];
	const said = new Set<string>();
	let tasks = 0;
	let tryBlock = false;
	for (const l of lines) {
		const t = TASK.exec(l);
		if (t) {
			tasks++;
			if (t[2] === "FAILED") kept.push(l);
			else if (t[2]) states.set(t[2], (states.get(t[2]) ?? 0) + 1);
			else (states.set("executed", (states.get("executed") ?? 0) + 1), ran.push(t[1]!));
			continue;
		}
		// `* Try:` and its `> Run with --scan` advice, up to the next blank line.
		if (l === "* Try:") tryBlock = true;
		if (tryBlock) {
			tryBlock = l.trim() !== "";
			continue;
		}
		if (NOISE.some((n) => n.test(l))) continue;
		if (ONCE.test(l)) {
			if (said.has(l)) continue;
			said.add(l);
		}
		kept.push(l);
	}

	// Write the directory every reported file shares once.
	const paths = kept.map((l) => LOCATED.exec(l)?.[1]).filter((p): p is string => !!p);
	if (paths.length > 1) {
		let prefix = paths[0]!.slice(0, paths[0]!.lastIndexOf("/") + 1);
		for (const p of paths) while (!p.startsWith(prefix)) prefix = prefix.slice(0, prefix.lastIndexOf("/", prefix.length - 2) + 1);
		if (prefix.length > 1) for (let i = 0; i < kept.length; i++) kept[i] = kept[i]!.replaceAll(`file://${prefix}`, "…/").replaceAll(prefix, "…/");
	}
	const { lines: folded, folded: didFold } = foldFrames(kept);

	// Blank lines only separate: never two in a row, never first.
	const body: string[] = [];
	for (const l of folded) {
		if (l === "" && (body.length === 0 || body.at(-1) === "")) continue;
		body.push(cutLine(l, limits.lineChars));
	}
	while (body.at(-1) === "") body.pop();

	const parts = [...states].map(([k, v]) => `${v} ${k.toLowerCase()}`);
	const head = `gradle: ${tasks} tasks (${parts.join(", ")})${ran.length ? ` ran: ${ran.slice(0, 12).join(" ")}${ran.length > 12 ? ` … +${ran.length - 12}` : ""}` : ""}`;
	const capped = capLines([head, ...body], limits.total);
	return { text: capped.text, truncated: capped.truncated || didFold };
}

/** `gradle dependencies`: the gradle clean-up, then the tree cut below its depth. */
export function compactGradleDeps(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const cleaned = compactGradle(output, limits);
	const tree = compactTree(cleaned?.text ?? output, limits);
	return tree ?? cleaned;
}
