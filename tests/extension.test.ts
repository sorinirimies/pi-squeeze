import { describe, expect, test } from "bun:test";
import ext from "../extensions/squeeze.ts";

type Command = { description: string; handler: (args: string, ctx: any) => Promise<void> };

function load() {
	const commands: Record<string, Command> = {};
	ext({ registerCommand: (name: string, c: Command) => (commands[name] = c) } as any);
	return commands;
}

describe("extension", () => {
	test("registers the /squeeze command", () => {
		expect(Object.keys(load())).toEqual(["squeeze"]);
	});

	test("the command notifies with the greeting", async () => {
		const seen: [string, string][] = [];
		await load().squeeze.handler("pi", { ui: { notify: (m: string, l: string) => seen.push([m, l]) } });
		expect(seen).toEqual([["Hello, pi!", "info"]]);
	});
});
