/**
 * pi-squeeze: Squeezes tool output so the agent's context stays small.
 *
 * Pure logic lives in core/ and command/ (tested directly); this file only wires it to pi.
 * Output is only ever replaced when the result is clearly smaller, and a truncated result
 * says where the full output was saved. When pi itself cut a long output to its tail, the
 * full output pi saved is compacted instead (a build's tail alone often misses its errors). Settings persist in <agent dir>/squeeze.json.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completions, parseCommand } from "./command/parse.ts";
import { compact, KINDS } from "./core/compact.ts";
import { type Config, DEFAULT_CONFIG, optionsOf, readConfig, saveConfig } from "./core/config.ts";
import { rewrite } from "./core/rtk.ts";
import { appendSaving } from "./core/savings.ts";
import { fileIn, readFullOutput } from "./core/files.ts";
import { saveFull } from "./core/save.ts";
import { emptyStats, record, saved, summary, tokens } from "./core/stats.ts";

type StatusUi = { ui: { setStatus(key: string, text: string): void } };

export const settingsText = (c: Config): string =>
	[c.enabled ? "on" : "off", `rtk ${c.rtk ? "on" : "off"}`, ...KINDS.map((k) => `${k} ${c.kinds[k] ? "on" : "off"}`), `min ${c.minChars} chars`].join(" · ");

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
		const blocks = event.content;
		if (blocks.length !== 1 || blocks[0]!.type !== "text") return;
		const shown = blocks[0]!.text;
		// pi cut this one to its tail and saved the whole of it: compact the whole, not the tail.
		const details = event.details as { truncation?: unknown; fullOutputPath?: unknown } | undefined;
		const fullPath = details?.truncation ? details.fullOutputPath : undefined;
		let original = shown;
		if (details?.truncation) {
			const full = readFullOutput(fullPath);
			if (full === undefined) return;
			// The exit status pi appends to a failed run's text.
			original = full + (/\n\nCommand exited with code \d+$/.exec(shown)?.[0] ?? "");
		}

		const r = compact(command, original, { ...optionsOf(config), failed: event.isError, isFile: fileIn(ctx.cwd) });
		// Never more than pi would have shown.
		if (!r || r.text.length >= shown.length) return;
		record(stats, { ...r, before: shown.length });
		if (config.logSavings) {
			const chars = shown.length - r.after;
			void appendSaving({
				ts: new Date(Date.now()).toISOString(),
				session: ctx.sessionManager?.getSessionId?.() ?? "",
				cwd: ctx.cwd ?? "",
				tokens: tokens(chars),
				chars,
				kind: r.kind,
			});
		}
		showStatus(ctx);
		const where = fullPath ?? (r.truncated ? saveFull(original) : undefined);
		const text = where ? `${r.text}\n[squeeze: output shortened; full output: ${where}]` : r.text;
		return { content: [{ type: "text", text }] };
	});

	pi.registerCommand("squeeze", {
		description: "pi-squeeze: status, on, off, <compactor>|rtk on|off, min <chars>",
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
