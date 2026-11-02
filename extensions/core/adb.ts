/**
 * `adb shell pm list packages`: the `package:` prefix goes and names are grouped by their
 * first two segments, each name still complete once its group is read:
 *
 *   com.google.android (3): apps.messaging gms gsf
 */
import { capLines, cutLine, DEFAULT_LIMITS, type Limits, type Squeezed } from "./elide.ts";
import { shape } from "./logs.ts";

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

/** `adb shell pm list packages -f`: `package:/path/base.apk=name` → `name  /path`, hashed install dirs elided. */
export function compactPackagePaths(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n").map((l) => l.trimEnd());
	while (lines.length && lines.at(-1) === "") lines.pop();
	const rows = lines.map((l) => /^package:(\/\S+)=([\w.]+)$/.exec(l));
	if (!rows.length || rows.some((r) => !r)) return undefined;
	const out = rows
		.map((r) => `${r![2]}  ${r![1]!.replace(/\/~~[^/]+==\/[\w.]+-[^/]+==\//, "/…/")}`)
		.sort()
		.map((l) => cutLine(l, limits.lineChars));
	const capped = capLines([`${rows.length} packages`, ...out], limits.total);
	return { text: capped.text, truncated: capped.truncated };
}

/** A value as `key=value` shows it: quoted when empty or holding spaces. */
const shown = (v: string) => (v === "" || /\s/.test(v) ? JSON.stringify(v) : v);

/**
 * Properties and settings (`adb shell getprop`, `settings list global|secure|system`):
 * keys that share a prefix are written once, values all kept:
 *
 *   ro.build: version.release=16 version.sdk=36 type=user
 */
export function compactProperties(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const raw = output.split("\n").map((l) => l.trimEnd());
	while (raw.length && raw.at(-1) === "") raw.pop();
	// A getprop value may span lines: they belong to the `[key]: [` line above.
	const lines: string[] = [];
	for (const l of raw) {
		if (lines.length && /^\[[^\]]+\]: \[/.test(lines.at(-1)!) && !/\]$/.test(lines.at(-1)!)) lines[lines.length - 1] += `\\n${l}`;
		else lines.push(l);
	}
	if (lines.length < 5) return undefined;
	const getprop = lines.every((l) => /^\[[^\]]+\]: \[.*\]$/.test(l));
	const pairs = lines.map((l) => (getprop ? /^\[([^\]]+)\]: \[(.*)\]$/.exec(l) : /^([\w.:-]+)=(.*)$/.exec(l)));
	if (pairs.some((p) => !p)) return undefined;
	const sep = getprop ? "." : "_";
	const groups = new Map<string, string[]>();
	for (const p of pairs) {
		const key = p![1]!;
		// getprop keys group by their first two segments (`ro.build`), settings by the first word.
		const parts = key.split(sep);
		const n = Math.min(getprop ? 2 : 1, parts.length - 1);
		const [head, tail] = n > 0 && parts[0] ? [parts.slice(0, n).join(sep), parts.slice(n).join(sep)] : ["", key];
		groups.set(head, [...(groups.get(head) ?? []), `${tail}=${shown(p![2]!)}`]);
	}
	let cut = false;
	const out: string[] = [];
	const item = (i: string) => {
		cut ||= i.length > limits.lineChars;
		return cutLine(i, limits.lineChars);
	};
	for (const [head, items] of groups) {
		if (!head || items.length === 1) {
			out.push(...items.map((i) => item(head ? `${head}${sep}${i}` : i)));
			continue;
		}
		// Long groups wrap rather than lose values: a new line repeats the prefix.
		let line = `${head}:`;
		for (const i of items.map(item)) {
			if (line.length + i.length + 1 > limits.lineChars * 2 && line !== `${head}:`) (out.push(line), (line = `${head}:`));
			line += ` ${i}`;
		}
		out.push(line);
	}
	const capped = capLines(out, limits.total);
	return { text: capped.text, truncated: cut || capped.truncated };
}

/**
 * Process lists (`adb shell ps -A`, `adb shell top -n 1`): kernel threads (no memory of their
 * own) and idle rows of `top` are counted, not listed; column padding goes.
 */
export function compactProcesses(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n").map((l) => l.trimEnd());
	while (lines.length && lines.at(-1) === "") lines.pop();
	const header = lines.findIndex((l) => /^\s*(?:USER\s+PID\s+PPID|PID\s+USER\s+PR\s+NI)\b/.test(l));
	if (header < 0 || lines.length - header < 5) return undefined;
	const cols = lines[header]!.trim().split(/\s+/);
	const ps = cols[0] === "USER";
	const vsz = cols.indexOf("VSZ");
	const cpu = cols.findIndex((c) => /%CPU/.test(c));
	let hidden = 0;
	const rows: string[] = [];
	for (const l of lines.slice(header + 1)) {
		const f = l.trim().split(/\s+/);
		// ps: kernel threads have no virtual memory; top: rows that used no CPU.
		const idle = ps ? f[vsz] === "0" : Number(f[cpu + (cols[cpu] === "S[%CPU]" ? 1 : 0)]) === 0;
		if (idle) hidden++;
		else rows.push(cutLine(f.join(" "), limits.lineChars));
	}
	const squeeze = (l: string) => l.trim().replace(/\s{2,}/g, " ");
	const out = [...lines.slice(0, header).map(squeeze), squeeze(lines[header]!), ...rows];
	if (hidden) out.push(`… ${hidden} ${ps ? "kernel threads" : "idle processes"} not listed`);
	const capped = capLines(out, limits.total);
	return { text: capped.text, truncated: hidden > 0 || capped.truncated };
}

/** Indent deeper than this goes in a dumpsys report (sections, then their entries, stay). */
const DUMPSYS_DEPTH = 8;

/**
 * `adb shell dumpsys …`: lines indented deeper than an entry's own line go (with a count),
 * runs of 3+ lines of the same shape keep their ends, and long reports are capped.
 */
export function compactDumpsys(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	const lines = output.split("\n").map((l) => l.trimEnd());
	while (lines.length && lines.at(-1) === "") lines.pop();
	if (lines.length < 20) return undefined;
	const out: string[] = [];
	let deeper = 0;
	const flush = () => {
		if (deeper) out.push(`${" ".repeat(DUMPSYS_DEPTH + 2)}… [+${deeper} deeper lines]`);
		deeper = 0;
	};
	for (const l of lines) {
		if (l.length - l.trimStart().length > DUMPSYS_DEPTH) {
			deeper++;
			continue;
		}
		flush();
		out.push(l);
	}
	flush();
	const runs: string[] = [];
	for (let i = 0; i < out.length; ) {
		const s = shape(out[i]!);
		let j = i + 1;
		while (j < out.length && shape(out[j]!) === s) j++;
		runs.push(...(j - i >= 3 ? [out[i]!, `${out[i]!.match(/^\s*/)![0]}… [${j - i - 2} similar]`, out[j - 1]!] : out.slice(i, j)));
		i = j;
	}
	const capped = capLines(
		runs.map((l) => cutLine(l, limits.lineChars)),
		limits.total,
	);
	return { text: capped.text, truncated: true };
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#(\d+));/g, (_, e: string, n?: string) => (n ? String.fromCodePoint(Number(n)) : ENTITY[e]!));

/**
 * `uiautomator dump` XML (`adb exec-out uiautomator dump /dev/tty`): one line per node that
 * says something (text, description, id, or something to tap), indented by nesting, with its
 * centre to tap at; empty wrappers and off-screen nodes go.
 *
 *   Button "OK" #ok click @540,1820
 */
export function compactUiDump(output: string, limits: Limits = DEFAULT_LIMITS): Squeezed | undefined {
	if (!/<hierarchy\b/.test(output)) return undefined;
	const out: string[] = [];
	/** For every open node: did it print (and so indent its children)? */
	const open: boolean[] = [];
	let nodes = 0;
	for (const m of output.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
		if (!m[1] && !m[2] && m[0] === "</node>") {
			open.pop();
			continue;
		}
		nodes++;
		const a: Record<string, string> = {};
		for (const [, k, v] of m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)) a[k!] = unescape(v!);
		const b = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(a.bounds ?? "");
		const [x1, y1, x2, y2] = (b ?? []).slice(1).map(Number) as number[];
		const visible = !!b && x2! > x1! && y2! > y1!;
		const id = (a["resource-id"] ?? "").replace(/^.*:id\//, "");
		const flags = [
			a.clickable === "true" && "click",
			a["long-clickable"] === "true" && "long-click",
			a.scrollable === "true" && "scroll",
			a.checkable === "true" && (a.checked === "true" ? "checked" : "unchecked"),
			a.selected === "true" && "selected",
			a.focused === "true" && "focused",
			a.enabled === "false" && "disabled",
			a.password === "true" && "password",
		].filter(Boolean);
		// An id alone names a leaf worth finding (an icon, an input); on a container it is layout.
		const says = visible && (a.text || a["content-desc"] || a.hint || flags.length || (id && m[2]));
		if (says) {
			const depth = open.filter(Boolean).length;
			const parts = [
				(a.class ?? "").split(".").pop(),
				a.text && JSON.stringify(a.text),
				a["content-desc"] && `desc=${JSON.stringify(a["content-desc"])}`,
				a.hint && `hint=${JSON.stringify(a.hint)}`,
				id && `#${id}`,
				...flags,
				`@${Math.round((x1! + x2!) / 2)},${Math.round((y1! + y2!) / 2)}`,
			].filter(Boolean);
			out.push(cutLine(`${"  ".repeat(depth)}${parts.join(" ")}`, limits.lineChars));
		}
		if (!m[2]) open.push(!!says);
	}
	if (!nodes) return undefined;
	const pkg = /package="([^"]+)"/.exec(output)?.[1];
	const capped = capLines([`ui: ${out.length} of ${nodes} nodes${pkg ? ` (${pkg})` : ""}`, ...out], limits.total);
	return { text: capped.text, truncated: true };
}
