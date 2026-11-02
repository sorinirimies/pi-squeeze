import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath } from "../extensions/core/config.ts";
import { resetRtk, useRunner } from "../extensions/core/rtk.ts";
import { fakeCtx, load } from "./helpers.ts";

const raw = readFileSync(join(import.meta.dir, "fixtures", "rg-flat.txt"), "utf8");
const result = (command: unknown, text = raw, extra: object = {}) => ({ toolName: "bash", isError: false, input: { command }, content: [{ type: "text", text }], details: undefined, ...extra });

describe("extension", () => {
	test("registers the hooks and the command", () => {
		const { hooks, commands } = load();
		expect(Object.keys(hooks)).toEqual(["session_start", "tool_call", "tool_result"]);
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
		expect(await h(result("rg -n import extensions", raw, { details: { truncation: {}, fullOutputPath: "/nonexistent/squeeze-full.log" } }))).toBeUndefined();
		expect(await h(result("rg -n import extensions", raw, { content: [{ type: "image" }] }))).toBeUndefined();
		expect(await h(result("rg -n import extensions", raw, { content: [] }))).toBeUndefined();
		expect(await h(result("cat x"))).toBeUndefined();
	});

	test("output pi cut to its tail: the full output it saved is compacted, and pointed to", async () => {
		const { hooks } = load();
		const dir = mkdtempSync(join(tmpdir(), "squeeze-full-"));
		const full = join(dir, "bash.log");
		const maven = readFileSync(join(import.meta.dir, "fixtures", "maven-test-fail.txt"), "utf8");
		writeFileSync(full, maven);
		const tail = maven.slice(-4000);
		const shown = `${tail}\n\n[Showing lines 40-137 of 137. Full output: ${full}]\n\nCommand exited with code 1`;
		const ctx = fakeCtx();
		const out = await hooks.tool_result!(result("mvn test", shown, { isError: true, details: { truncation: { truncated: true }, fullOutputPath: full } }), ctx);
		expect(out.content[0].text).toContain("maven: 3 test classes passed");
		expect(out.content[0].text).toContain("throwsDeep");
		expect(out.content[0].text).toContain(`[squeeze: output shortened; full output: ${full}]`);
		expect(ctx.status.squeeze).toMatch(/tokens saved/);
		// Never longer than what pi would have shown.
		expect(await hooks.tool_result!(result("mvn test", "[ERROR] BUILD FAILURE", { details: { truncation: { truncated: true }, fullOutputPath: full } }), fakeCtx())).toBeUndefined();
		rmSync(dir, { recursive: true, force: true });
	});

	test("a failed test run is compacted, any other failed command is left alone", async () => {
		const { hooks } = load();
		const cargo = readFileSync(join(import.meta.dir, "fixtures", "cargo-test-ok.txt"), "utf8");
		const out = await hooks.tool_result!(result("cargo test", `${cargo}\n\nCommand exited with code 101`, { isError: true }), fakeCtx());
		expect(out.content[0].text).toContain("cargo test: 226 passed");
		expect(out.content[0].text).toContain("Command exited with code 101");
		expect(await hooks.tool_result!(result("rg -n import extensions", raw, { isError: true }), fakeCtx())).toBeUndefined();
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
		expect(ctx.notes[0]![0]).toMatch(/^squeeze on · rtk on · search on · paths on · listing on · diff on · tests on · git on · build on · lint on · install on · logs on · tree on · generic on · min 400 chars\nsqueeze: 1 outputs compacted/);
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

	describe("rtk layer", () => {
		const call = (command: unknown, toolName = "bash") => ({ toolName, input: { command } });
		const fake = (status: number | null, stdout: string) => {
			const seen: string[] = [];
			useRunner((c) => (seen.push(c), { status, stdout }));
			resetRtk();
			return seen;
		};

		test("rewrites a command through rtk and remembers the answer", async () => {
			const seen = fake(0, "rtk docker ps\n");
			const { hooks } = load();
			const ev = call("docker ps");
			await hooks.tool_call!(ev, fakeCtx());
			expect(ev.input.command).toBe("rtk docker ps");
			await hooks.tool_call!(call("docker ps"), fakeCtx());
			expect(seen).toEqual(["docker ps"]);
			useRunner();
		});

		test("leaves the command alone when rtk has no rewrite, denies, or returns the same", async () => {
			const { hooks } = load();
			for (const [status, out] of [[1, ""], [2, ""], [0, "docker images"], [0, ""], [null, "rtk x"]] as const) {
				fake(status, out);
				const ev = call("docker images");
				await hooks.tool_call!(ev, fakeCtx());
				expect(ev.input.command).toBe("docker images");
			}
			useRunner();
		});

		test("exit 3 (ask) still rewrites; a file read never does", async () => {
			const { hooks } = load();
			fake(3, "rtk docker images");
			const a = call("docker images");
			await hooks.tool_call!(a, fakeCtx());
			expect(a.input.command).toBe("rtk docker images");
			fake(0, "rtk read foo.ts");
			const b = call("cat foo.ts");
			await hooks.tool_call!(b, fakeCtx());
			expect(b.input.command).toBe("cat foo.ts");
			useRunner();
		});

		test("never rewrites what a native compactor handles, other tools, or odd input", async () => {
			const seen = fake(0, "rtk whatever");
			const { hooks } = load();
			const a = call("rg -n x src");
			await hooks.tool_call!(a, fakeCtx());
			await hooks.tool_call!(call("docker ps", "read"), fakeCtx());
			await hooks.tool_call!(call(42), fakeCtx());
			await hooks.tool_call!(call("   "), fakeCtx());
			expect(a.input.command).toBe("rg -n x src");
			expect(seen).toEqual([]);
			useRunner();
		});

		test("a missing rtk binary is noticed once and then ignored", async () => {
			let calls = 0;
			useRunner(() => (calls++, { status: null, stdout: "", missing: true }));
			resetRtk();
			const { hooks } = load();
			await hooks.tool_call!(call("docker ps"), fakeCtx());
			await hooks.tool_call!(call("git diff"), fakeCtx());
			expect(calls).toBe(1);
			useRunner();
			resetRtk();
		});

		test("the cache is bounded", async () => {
			fake(0, "rtk x");
			const { hooks } = load();
			for (let i = 0; i < 520; i++) await hooks.tool_call!(call(`git log -${i + 1}`), fakeCtx());
			useRunner();
			resetRtk();
		});

		test("rtk off and squeeze off both skip the rewrite; the real runner works", async () => {
			const seen = fake(0, "rtk docker ps");
			const { commands, hooks } = load();
			await commands.squeeze!.handler("rtk off", fakeCtx());
			await hooks.tool_call!(call("docker ps"), fakeCtx());
			await commands.squeeze!.handler("rtk on", fakeCtx());
			await commands.squeeze!.handler("off", fakeCtx());
			await hooks.tool_call!(call("docker ps"), fakeCtx());
			expect(seen).toEqual([]);
			await commands.squeeze!.handler("on", fakeCtx());
			useRunner();
			resetRtk();
			const ev = call("docker ps");
			await hooks.tool_call!(ev, fakeCtx()); // the real process: rewritten if rtk is installed, else untouched
			expect(["docker ps", "rtk docker ps"]).toContain(ev.input.command as string);
		});
	});
});
