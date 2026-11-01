import type { Kind, Result } from "./compact.ts";

export type Stats = { calls: number; before: number; after: number; byKind: Record<Kind, { calls: number; saved: number }> };

export function emptyStats(): Stats {
	return { calls: 0, before: 0, after: 0, byKind: { search: { calls: 0, saved: 0 }, paths: { calls: 0, saved: 0 }, listing: { calls: 0, saved: 0 } } };
}

export function record(stats: Stats, r: Result): void {
	stats.calls++;
	stats.before += r.before;
	stats.after += r.after;
	stats.byKind[r.kind].calls++;
	stats.byKind[r.kind].saved += r.before - r.after;
}

/** Rough token estimate: 4 characters per token. */
export const tokens = (chars: number): number => Math.round(chars / 4);

export function summary(stats: Stats): string {
	if (!stats.calls) return "squeeze: nothing compacted yet in this session";
	const saved = stats.before - stats.after;
	const pct = Math.round((saved / stats.before) * 100);
	const kinds = (Object.entries(stats.byKind) as [Kind, { calls: number; saved: number }][])
		.filter(([, v]) => v.calls)
		.map(([k, v]) => `${k} ${v.calls}× (~${tokens(v.saved)} tokens)`)
		.join(", ");
	return `squeeze: ${stats.calls} outputs compacted, ~${tokens(saved)} tokens saved (${pct}%): ${kinds}`;
}
