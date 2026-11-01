import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ext from "../extensions/squeeze.ts";
import { saveFull } from "../extensions/core/save.ts";

type Handler = (event: any) => Promise<any> | any;
type Command = { handler: (args: string, ctx: any) => Promise<void>; getArgumentCompletions: (p: string) => { value: string }[] };

function load() {
	const hooks: Record<string, Handler> = {};
	const commands: Record<string, Command> = {};
	ext({ on: (n: string, h: Handler) => (hooks[n] = h), registerCommand: (n: string, c: Command) => (commands[n] = c) } as any);
	return { hooks, commands };
}

const raw = readFileSync(join(import.meta.dir, "fixtures", "rg-flat.txt"), "utf8");
const result = (command: unknown, text = raw, extra: object = {}) => ({ toolName: "bash", isError: false, input: { command }, content: [{ type: "text", text }], details: undefined, ...extra });

describe("extension", () => {
	test("registers the hook and the command", () => {
		const { hooks, commands } = load();
		expect(Object.keys(hooks)).toEqual(["tool_result"]);
		expect(Object.keys(commands)).toEqual(["squeeze"]);
	});

	test("replaces a bash rg result with the compact one", async () => {
		const { hooks } = load();
		const out = await hooks.tool_result!(result("rg -n import extensions"));
		expect(out.content[0].text.length).toBeLessThan(raw.length);
	});

	test("leaves everything else alone", async () => {
		const { hooks } = load();
		const h = hooks.tool_result!;
		expect(await h(result("rg -n import extensions", raw, { toolName: "read" }))).toBeUndefined();
		expect(await h(result("rg -n import extensions", raw, { isError: true }))).toBeUndefined();
		expect(await h(result(42))).toBeUndefined();
		expect(await h(result("rg -n import extensions", raw, { details: { truncation: {} } }))).toBeUndefined();
		expect(await h(result("rg -n import extensions", raw, { content: [{ type: "image" }] }))).toBeUndefined();
		expect(await h(result("rg -n import extensions", raw, { content: [] }))).toBeUndefined();
		expect(await h(result("cat x"))).toBeUndefined();
	});

	test("a truncated result says where the full output is", async () => {
		const { hooks } = load();
		const big = Array.from({ length: 600 }, (_, i) => `src/f${i}.ts:1:${"x".repeat(40)}`).join("\n");
		const out = await hooks.tool_result!(result("rg -n x", big));
		const text: string = out.content[0].text;
		const path = /full output: (.+?)\]$/.exec(text)![1]!;
		expect(readFileSync(path, "utf8")).toBe(big);
	});

	test("/squeeze off stops compaction, on resumes it, status reports", async () => {
		const { hooks, commands } = load();
		const seen: string[] = [];
		const ctx = { ui: { notify: (m: string) => seen.push(m) } };
		const cmd = commands.squeeze!;
		await cmd.handler("off", ctx);
		expect(await hooks.tool_result!(result("rg -n import extensions"))).toBeUndefined();
		await cmd.handler("on", ctx);
		await hooks.tool_result!(result("rg -n import extensions"));
		await cmd.handler("", ctx);
		expect(seen[0]).toBe("squeeze off");
		expect(seen[1]).toBe("squeeze on");
		expect(seen[2]).toMatch(/^on · squeeze: 1 outputs compacted/);
		expect(cmd.getArgumentCompletions("o").map((c) => c.value)).toEqual(["on", "off"]);
	});

	test("saveFull writes into the given directory", () => {
		const dir = join(process.env.PI_CODING_AGENT_DIR!, "sq");
		const p = saveFull("hello", dir);
		expect(existsSync(p)).toBe(true);
		expect(readFileSync(p, "utf8")).toBe("hello");
	});
});
