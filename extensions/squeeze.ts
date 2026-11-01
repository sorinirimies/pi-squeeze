/**
 * pi-squeeze: Squeezes tool output so the agent's context stays small.
 *
 * Pure logic lives in core/ (tested directly); this file only wires it to pi's hooks.
 * Output is only ever replaced when the result is clearly smaller, and a truncated
 * result says where the full output was saved.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compact } from "./core/compact.ts";
import { saveFull } from "./core/save.ts";
import { emptyStats, record, summary } from "./core/stats.ts";

export default function (pi: ExtensionAPI) {
	const stats = emptyStats();
	let enabled = process.env.PI_SQUEEZE !== "off";

	pi.on("tool_result", async (event) => {
		if (!enabled || event.toolName !== "bash" || event.isError) return;
		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string") return;
		// pi already truncated this one: its text is not the tool's own format any more.
		if ((event.details as { truncation?: unknown } | undefined)?.truncation) return;
		const blocks = event.content;
		if (blocks.length !== 1 || blocks[0]!.type !== "text") return;
		const original = blocks[0]!.text;

		const r = compact(command, original);
		if (!r) return;
		record(stats, r);
		const text = r.truncated ? `${r.text}\n[squeeze: output shortened; full output: ${saveFull(original)}]` : r.text;
		return { content: [{ type: "text", text }] };
	});

	pi.registerCommand("squeeze", {
		description: "pi-squeeze: /squeeze [status|on|off] shows savings or switches compaction",
		getArgumentCompletions: (prefix: string) =>
			["status", "on", "off"].filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s })),
		handler: async (args, ctx) => {
			const arg = args.trim();
			if (arg === "on" || arg === "off") {
				enabled = arg === "on";
				ctx.ui.notify(`squeeze ${arg}`, "info");
				return;
			}
			ctx.ui.notify(`${enabled ? "on" : "off"} · ${summary(stats)}`, "info");
		},
	});
}
