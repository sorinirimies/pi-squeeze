/**
 * pi-squeeze: Squeezes tool output and steers commands to fast CLI tools, so the agent's context stays small: uses rtk when installed, native compactors otherwise.
 *
 * Keep the pure logic in exported functions (tested directly in tests/core.test.ts);
 * the default export only wires them to pi's hooks and stays thin.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** The sample feature: a greeting. Replace it with the real logic. */
export function greet(name: string): string {
	const trimmed = name.trim();
	return trimmed ? `Hello, ${trimmed}!` : "Hello!";
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("squeeze", {
		description: "Say hello (sample command)",
		handler: async (args, ctx) => {
			ctx.ui.notify(greet(args), "info");
		},
	});
}
