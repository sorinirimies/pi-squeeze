/**
 * `docker build` (BuildKit plain progress and the classic builder): bookkeeping steps
 * (`[internal]` loads, context transfer, CACHED, DONE, layer pushes, image export) go;
 * each build step keeps its header and what its command printed, without the `#N 0.123`
 * prefix. Errors stay whole.
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { stripAnsi } from "./generic.ts";

const STEP = /^#(\d+) (.*)$/;
/** BuildKit lines with nothing to say once the build is over. */
const QUIET = /^(building with |DONE [\d.]+s|CACHED|transferring |resolve |sha256:[\da-f]+ |extracting sha256:|exporting |writing image |naming to |unpacking to |preparing layers|load build definition|load \.dockerignore|load metadata for |\[auth\] )/;
/** Classic builder bookkeeping. */
const CLASSIC = /^( ---> |Removing intermediate container |Sending build context to Docker daemon|Successfully built [\da-f]+$)/;

export function compactDockerBuild(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = stripAnsi(output).split("\n");
	while (lines.length && lines.at(-1) === "") lines.pop();
	const buildkit = lines.some((l) => /^#\d+ \[/.test(l));
	const classic = lines.some((l) => /^Step \d+\/\d+ : /.test(l));
	if (!buildkit && !classic) return undefined;
	const internal = new Set<string>();
	const cached = new Set<string>();
	/** Where each step's header went, to mark it CACHED. */
	const steps = new Map<string, number>();
	const out: string[] = [];
	for (const l of lines) {
		const m = STEP.exec(l);
		if (!m) {
			if (CLASSIC.test(l) || (l === "" && (out.length === 0 || out.at(-1) === ""))) continue;
			out.push(cutLine(l, limits.lineChars));
			continue;
		}
		const [, id, rest] = m as unknown as [string, string, string];
		if (/^\[internal\]/.test(rest) || internal.has(id)) {
			internal.add(id);
			if (/^ERROR/.test(rest)) out.push(l);
			continue;
		}
		if (rest === "CACHED" && steps.has(id)) {
			cached.add(id);
			out[steps.get(id)!] += " (cached)";
		}
		if (/^\[/.test(rest)) {
			// BuildKit repeats a step's header when its output resumes after another step's.
			if (!steps.has(id)) steps.set(id, out.push(cutLine(`#${id} ${rest}`, limits.lineChars)) - 1);
		} else if (/^ERROR|^error/.test(rest)) out.push(cutLine(l, limits.lineChars));
		else if (!QUIET.test(rest)) {
			// `#7 0.512 npm warn …`: the command's own output.
			const printed = /^[\d.]+(?: (.*))?$/.exec(rest);
			if (printed && !printed[1]?.trim()) continue;
			out.push(cutLine(printed ? `   ${printed[1]}` : `#${id} ${rest}`, limits.lineChars));
		}
	}
	const head = buildkit ? [`docker build: ${steps.size} steps${cached.size ? `, ${cached.size} cached` : ""}`] : [];
	const capped = capLines([...head, ...out], limits.total);
	return { text: capped.text, truncated: capped.truncated };
}
