/**
 * pi-squeeze: Squeezes tool output so the agent's context stays small.
 *
 * Pure logic lives in core/ and command/ (tested directly); this file only wires it to pi.
 * Output is only ever replaced when the result is clearly smaller, and a truncated result
 * says where the full output was saved. Settings persist in <agent dir>/squeeze.json.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completions, parseCommand } from "./command/parse.ts";
import { compact, compactsFailures } from "./core/compact.ts";
import { type Config, DEFAULT_CONFIG, optionsOf, readConfig, saveConfig } from "./core/config.ts";
import { rewrite } from "./core/rtk.ts";
import { saveFull } from "./core/save.ts";
import { emptyStats, record, saved, summary, tokens } from "./core/stats.ts";

type StatusUi = { ui: { setStatus(key: string, text: string): void } };

export const settingsText = (c: Config): string =>
	`${c.enabled ? "on" : "off"} · rtk ${c.rtk ? "on" : "off"} · search ${c.kinds.search ? "on" : "off"} · paths ${c.kinds.paths ? "on" : "off"} · listing ${c.kinds.listing ? "on" : "off"} · diff ${c.kinds.diff ? "on" : "off"} · tests ${c.kinds.tests ? "on" : "off"} · min ${c.minChars} chars`;

export default function (pi: ExtensionAPI) {
	let config: Config = { ...DEFAULT_CONFIG, kinds: { ...DEFAULT_CONFIG.kinds } };
	const stats = emptyStats();
	if (process.env.PI_SQUEEZE === "off") config.enabled = false;

	const showStatus = (ctx: StatusUi) => {
		const n = tokens(saved(stats));
		ctx.ui.setStatus("squeeze", config.enabled && config.showStatus && n > 0 ? `squeeze: ~${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n} tokens saved` : "");
	};

	pi.on("session_start", async (_event, ctx) => {
		const { config: loaded, problem } = await readConfig();
		config = loaded;
		if (process.env.PI_SQUEEZE === "off") config.enabled = false;
		if (problem) ctx.ui.notify(`squeeze: ${problem}; using the defaults`, "warning");
		showStatus(ctx);
	});

	pi.on("tool_call", async (event) => {
		if (!config.enabled || !config.rtk || event.toolName !== "bash") return;
		const input = event.input as { command?: unknown };
		if (typeof input.command !== "string") return;
		const rewritten = rewrite(input.command);
		if (rewritten) input.command = rewritten;
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!config.enabled || event.toolName !== "bash") return;
		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string") return;
		if (event.isError && !compactsFailures(command)) return;
		// pi already truncated this one: its text is not the tool's own format any more.
		if ((event.details as { truncation?: unknown } | undefined)?.truncation) return;
		const blocks = event.content;
		if (blocks.length !== 1 || blocks[0]!.type !== "text") return;
		const original = blocks[0]!.text;

		const r = compact(command, original, optionsOf(config));
		if (!r) return;
		record(stats, r);
		showStatus(ctx);
		const text = r.truncated ? `${r.text}\n[squeeze: output shortened; full output: ${saveFull(original)}]` : r.text;
		return { content: [{ type: "text", text }] };
	});

	pi.registerCommand("squeeze", {
		description: "pi-squeeze: status, on, off, search|paths|listing|diff|tests|rtk on|off, min <chars>",
		getArgumentCompletions: (prefix: string) => completions(prefix),
		handler: async (args, ctx) => {
			const cmd = parseCommand(args);
			// The setting applies to this session either way; a failed save only means it is not remembered.
			const persist = async () => {
				try {
					await saveConfig(config);
				} catch (error) {
					ctx.ui.notify(`squeeze: could not save the setting (${(error as Error)?.message ?? String(error)}); it applies to this session only`, "warning");
				}
				showStatus(ctx);
			};
			switch (cmd.kind) {
				case "status":
					ctx.ui.notify(`squeeze ${settingsText(config)}\n${summary(stats)}`, "info");
					return;
				case "on":
				case "off":
					config.enabled = cmd.kind === "on";
					await persist();
					ctx.ui.notify(`squeeze ${cmd.kind}`, "info");
					return;
				case "rtk":
					config.rtk = cmd.on;
					await persist();
					ctx.ui.notify(`squeeze: rtk ${cmd.on ? "on" : "off"}`, "info");
					return;
				case "compactor":
					config.kinds[cmd.compactor] = cmd.on;
					await persist();
					ctx.ui.notify(`squeeze: ${cmd.compactor} ${cmd.on ? "on" : "off"}`, "info");
					return;
				case "min":
					config.minChars = cmd.chars;
					await persist();
					ctx.ui.notify(`squeeze: output under ${cmd.chars} characters is left alone`, "info");
					return;
				case "invalid":
					ctx.ui.notify(cmd.message, "warning");
					return;
			}
		},
	});
}
