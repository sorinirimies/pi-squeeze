/**
 * `gradle` / `./gradlew` output: every `> Task :x UP-TO-DATE` line (and NO-SOURCE, FROM-CACHE,
 * SKIPPED, plain executed ones) becomes one counting line; failed tasks, compiler errors and
 * warnings, test failures and the `BUILD` result stay. The daemon, configuration-cache and
 * "Run with --scan" hints go. Kotlin `w:` / `e:` lines lose their shared directory prefix.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";

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
];
const KOTLIN = /^([we]): (?:file:\/\/)?(\/\S+?):(\d+):(\d+)(.*)$/;

export function compactGradle(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (!lines.some((l) => TASK.test(l)) || !lines.some((l) => /^BUILD (SUCCESSFUL|FAILED)/.test(l))) return undefined;

	const states = new Map<string, number>();
	const ran: string[] = [];
	const kept: string[] = [];
	let tasks = 0;
	for (const l of lines) {
		const t = TASK.exec(l);
		if (t) {
			tasks++;
			if (t[2] === "FAILED") kept.push(l);
			else if (t[2]) states.set(t[2], (states.get(t[2]) ?? 0) + 1);
			else (states.set("executed", (states.get("executed") ?? 0) + 1), ran.push(t[1]!));
			continue;
		}
		if (NOISE.some((n) => n.test(l))) continue;
		kept.push(l);
	}

	// Kotlin diagnostics: strip the directory every file shares.
	const paths = kept.map((l) => KOTLIN.exec(l)?.[2]).filter((p): p is string => !!p);
	if (paths.length > 1) {
		const dirs = paths.map((p) => p.slice(0, p.lastIndexOf("/") + 1));
		let prefix = dirs[0]!;
		for (const d of dirs) while (!d.startsWith(prefix)) prefix = prefix.slice(0, prefix.lastIndexOf("/", prefix.length - 2) + 1);
		if (prefix.length > 1)
			for (let i = 0; i < kept.length; i++) {
				const m = KOTLIN.exec(kept[i]!);
				if (m) kept[i] = `${m[1]}: …/${m[2]!.slice(prefix.length)}:${m[3]}:${m[4]}${m[5]}`;
			}
	}

	// Blank lines only separate: never two in a row, never first.
	const body: string[] = [];
	for (const l of kept) {
		if (l === "" && (body.length === 0 || body.at(-1) === "")) continue;
		body.push(cutLine(l, limits.lineChars));
	}
	while (body.at(-1) === "") body.pop();

	const parts = [...states].map(([k, v]) => `${v} ${k.toLowerCase()}`);
	const head = `gradle: ${tasks} tasks (${parts.join(", ")})${ran.length ? ` ran: ${ran.slice(0, 12).join(" ")}${ran.length > 12 ? ` … +${ran.length - 12}` : ""}` : ""}`;
	return capLines([head, ...body], limits.total);
}
