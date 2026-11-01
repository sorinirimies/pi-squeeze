import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { configPath } from "../extensions/core/config.ts";
import { fakeCtx, load } from "./helpers.ts";

const raw = readFileSync(join(import.meta.dir, "fixtures", "rg-flat.txt"), "utf8");
const result = (command: unknown, text = raw, extra: object = {}) => ({ toolName: "bash", isError: false, input: { command }, content: [{ type: "text", text }], details: undefined, ...extra });

describe("extension", () => {
	test("registers the hooks and the command", () => {
		const { hooks, commands } = load();
		expect(Object.keys(hooks)).toEqual(["session_start", "tool_result"]);
		expect(Object.keys(commands)).toEqual(["squeeze"]);
		expect(commands.squeeze!.getArgumentCompletions("of")!.map((c) => c.value)).toEqual(["off"]);
	});

	test("replaces a bash rg result with the compact one and shows the savings", async () => {
		const { hooks } = load();
		const ctx = fakeCtx();
		const out = await hooks.tool_result!(result("rg -n import extensions"), ctx);
		expect(out.content[0].text.length).toBeLessThan(raw.length);
		expect(ctx.status.squeeze).toMatch(/^squeeze: ~\d+ tokens saved$/);
	});

	test("the status line switches to k above a thousand tokens", async () => {
		const { hooks } = load();
		const ctx = fakeCtx();
		const big = Array.from({ length: 400 }, (_, i) => `src/dir${i % 9}/file${i}.ts:${i}:${"const value = something();".repeat(8)}`).join("\n");
		await hooks.tool_result!(result("rg -n x", big), ctx);
		expect(ctx.status.squeeze).toMatch(/^squeeze: ~\d+\.\dk tokens saved$/);
	});

	test("leaves everything else alone", async () => {
		const { hooks } = load();
		const h = (r: object) => hooks.tool_result!(r, fakeCtx());
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
		const out = await hooks.tool_result!(result("rg -n x", big), fakeCtx());
		const path = /full output: (.+?)\]$/.exec(out.content[0].text)![1]!;
		expect(readFileSync(path, "utf8")).toBe(big);
	});

	test("on, off and the per-compactor switches persist and take effect", async () => {
		rmSync(configPath(), { force: true });
		const { hooks, commands } = load();
		const ctx = fakeCtx();
		const cmd = commands.squeeze!;
		await hooks.session_start!({}, ctx);

		await cmd.handler("off", ctx);
		expect(JSON.parse(readFileSync(configPath(), "utf8")).enabled).toBe(false);
		expect(await hooks.tool_result!(result("rg -n import extensions"), ctx)).toBeUndefined();
		await cmd.handler("on", ctx);
		await cmd.handler("search off", ctx);
		expect(await hooks.tool_result!(result("rg -n import extensions"), ctx)).toBeUndefined();
		await cmd.handler("search on", ctx);
		await cmd.handler("min 100000", ctx);
		expect(await hooks.tool_result!(result("rg -n import extensions"), ctx)).toBeUndefined();
		expect(JSON.parse(readFileSync(configPath(), "utf8")).minChars).toBe(100000);

		const fresh = fakeCtx();
		const again = load();
		await again.hooks.session_start!({}, fresh);
		expect(await again.hooks.tool_result!(result("rg -n import extensions"), fresh)).toBeUndefined();
		rmSync(configPath(), { force: true });
	});

	test("status reports the settings and the savings; invalid input warns", async () => {
		rmSync(configPath(), { force: true });
		const { hooks, commands } = load();
		const ctx = fakeCtx();
		await hooks.tool_result!(result("rg -n import extensions"), ctx);
		await commands.squeeze!.handler("", ctx);
		await commands.squeeze!.handler("bogus", ctx);
		expect(ctx.notes[0]![0]).toMatch(/^squeeze on · search on · paths on · listing on · min 400 chars\nsqueeze: 1 outputs compacted/);
		expect(ctx.notes[1]![1]).toBe("warning");
	});

	test("session_start reports a broken file and PI_SQUEEZE=off wins over the file", async () => {
		await Bun.write(configPath(), "{ nope");
		const { hooks } = load();
		const ctx = fakeCtx();
		await hooks.session_start!({}, ctx);
		expect(ctx.notes[0]![0]).toContain("is not valid JSON");
		rmSync(configPath(), { force: true });

		process.env.PI_SQUEEZE = "off";
		try {
			const off = load();
			await off.hooks.session_start!({}, fakeCtx());
			expect(await off.hooks.tool_result!(result("rg -n import extensions"), fakeCtx())).toBeUndefined();
		} finally {
			delete process.env.PI_SQUEEZE;
		}
	});

	test("a save that fails is reported and the setting still applies", async () => {
		const { commands } = load();
		const ctx = fakeCtx();
		const dir = process.env.PI_CODING_AGENT_DIR!;
		rmSync(dir, { recursive: true, force: true });
		await Bun.write(dir, "a file where the directory should be");
		await commands.squeeze!.handler("paths off", ctx);
		expect(ctx.notes[0]![0]).toContain("could not save the setting");
		rmSync(dir, { force: true });
	});
});
