/**
 * Maven (`mvn`, `./mvnw`, `mvnd`) output:
 *
 * * `Downloading from` / `Downloaded from` lines and their `Progress (1): …` frames become a
 *   count in the header;
 * * `[INFO]` lines go (banners, plugin headers, "Copying 1 resource", "Compiling 8 source
 *   files", "Running x.FooTest" …) except the result: `BUILD SUCCESS|FAILURE`, `Total time`,
 *   test totals, and the reactor summary lines of modules that did not succeed;
 * * a test class that passes takes what it printed with it (Spring banners, logs); a class
 *   that fails keeps it, with its failures;
 * * `[ERROR]` lines that repeat an earlier line go (Maven prints compiler errors twice), and
 *   so does the help footer (`-> [Help 1]`, "Re-run Maven using the -X switch" …);
 * * `[WARNING]` lines are said once, with a count; JVM chatter goes; framework stack frames
 *   fold; reported files lose the directory they share.
 *
 * `mvn dependency:tree` is the tree cut by depth (see tree.ts), once `[INFO] ` is gone.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { shortenPaths } from "./gradle.ts";
import { isJvmNoise } from "./jvm.ts";
import { foldFrames } from "./logs.ts";
import { compactTree } from "./tree.ts";

const RESULT = /^\[INFO\] BUILD (SUCCESS|FAILURE)$|^\[ERROR\] BUILD FAILURE$/;
/** Without `-B` the lines stand alone; with it (batch mode) they are `[INFO]` lines. */
const DOWNLOAD = /^(?:\[INFO\] )?(Downloading|Downloaded) from [\w.-]+: /;
/** `[INFO]` lines that stay. */
const INFO_KEPT = [
	/^\[INFO\] BUILD /,
	/^\[INFO\] Total time:/,
	// The totals, not a class's own line (`-- in x.FooTest`).
	/^\[INFO\] Tests run: (?!.* -- in ).*$/,
	/^\[INFO\] Reactor Summary/,
	/^\[INFO\] \S.* (?:FAILURE|SKIPPED)(?: \[|$)/,
	/^\[INFO\] \d+ (?:errors?|warnings?) ?$/,
];
const HELP = /^\[ERROR\] (?:-> \[Help \d+\]|To see the full stack trace|Re-run Maven using the -X|For more information about the errors|\[Help \d+\] https?:|See dump files|After correcting the problems, you can resume|\s*mvn <args> -rf|See .*surefire-reports for the individual test results)/;
/** The Spring Boot banner each `@SpringBootTest` prints. */
const BANNER = /^ {0,2}(?:\.   ____|\/\\\\ \/ ___'|\( \( \)\\___|\\\\\/  ___\)|'  \|____\||=+\|_\|=+)| :: Spring Boot :: /;
const CLASS_START = /^\[INFO\] Running (\S+)$/;
const CLASS_END = /^\[(INFO|ERROR|WARNING)\] Tests run: \d+, Failures: (\d+), Errors: (\d+), .* -- in (\S+)$/;

export function compactMaven(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	// Progress frames end in `\r`; what follows the last one is the line.
	const lines = output.split("\n").map((l) => l.slice(l.lastIndexOf("\r") + 1).trimEnd());
	if (!lines.some((l) => RESULT.test(l))) return undefined;

	const kept: string[] = [];
	const said = new Map<string, { at: number; n: number }>();
	const before = new Set<string>();
	let downloads = 0;
	let passed = 0;
	let dropped = false;
	/** What a test class printed, kept only if it fails. */
	let running: string[] | undefined;
	const keep = (l: string) => (running ? running.push(l) : kept.push(l));

	for (const l of lines) {
		const content = l.replace(/^\[(?:ERROR|WARNING|INFO)\] ?/, "").trim();
		const repeat = content.length >= 4 && before.has(content);
		before.add(content);
		const dl = DOWNLOAD.exec(l);
		if (dl || /^Progress \(\d+\):/.test(l)) {
			downloads += dl?.[1] === "Downloaded" ? 1 : 0;
			continue;
		}
		if (CLASS_START.test(l)) {
			running = [];
			continue;
		}
		const end = CLASS_END.exec(l);
		if (end) {
			if (end[2] === "0" && end[3] === "0") passed++;
			else kept.push(...running!, l);
			running = undefined;
			continue;
		}
		if (l.startsWith("[INFO]") && !INFO_KEPT.some((k) => k.test(l))) {
			dropped = true;
			continue;
		}
		// The indented paragraph of a dropped `[INFO]` line (annotation processing advice).
		if (/^ {2}\S/.test(l) && dropped) continue;
		dropped = false;
		if (BANNER.test(l) || isJvmNoise(l) || HELP.test(l) || /^\[(?:ERROR|WARNING)\]\s*$/.test(l)) continue;
		if (l.startsWith("[ERROR]") && repeat) continue;
		if (l.startsWith("[WARNING]")) {
			const seen = said.get(l);
			if (seen) {
				seen.n++;
				continue;
			}
			said.set(l, { at: kept.length, n: 1 });
		}
		keep(l);
	}
	if (running) kept.push(...running);
	for (const { at, n } of said.values()) if (n > 1) kept[at] += ` (×${n})`;
	shortenPaths(kept);
	const { lines: folded } = foldFrames(kept);

	const body: string[] = [];
	for (const l of folded) {
		if (l === "" && (body.length === 0 || body.at(-1) === "")) continue;
		body.push(cutLine(l, limits.lineChars));
	}
	while (body.at(-1) === "") body.pop();
	const parts = [downloads && `${downloads} downloads`, passed && `${passed} test classes passed`].filter(Boolean);
	const capped = capLines([...(parts.length ? [`maven: ${parts.join(", ")}`] : []), ...body], limits.total);
	// `[INFO]` lines and passing classes' output always go: the full output keeps them.
	return { text: capped.text, truncated: true };
}

/** `mvn dependency:tree`: the `[INFO] ` prefix goes, then the tree is cut by depth. */
export function compactMavenTree(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n").map((l) => l.slice(l.lastIndexOf("\r") + 1));
	if (!lines.some((l) => RESULT.test(l))) return undefined;
	const tree = lines.filter((l) => /^\[INFO\] (?:[|+\\ ]*[+\\]- |[\w.-]+:[\w.-]+:)/.test(l)).map((l) => l.slice(7));
	const cut = compactTree(tree.join("\n"), limits);
	const result = lines.filter((l) => RESULT.test(l) || /^\[ERROR\] (?!\s*$)/.test(l) && !HELP.test(l));
	return { text: [...(cut?.text ?? tree.join("\n")).split("\n"), ...result].join("\n"), truncated: true };
}
