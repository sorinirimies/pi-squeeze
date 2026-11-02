import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSaving, SAVINGS_LOG, savingLine, savingsLogPath } from "../extensions/core/savings.ts";
import { fakeCtx, load } from "./helpers.ts";

const raw = readFileSync(join(import.meta.dir, "fixtures", "rg-flat.txt"), "utf8");
const result = (command: string) => ({ toolName: "bash", isError: false, input: { command }, content: [{ type: "text", text: raw }], details: undefined });
const lines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
// appendSaving runs in the background: wait until it has written.
const settle = async (path: string, n: number) => {
	for (let i = 0; i < 100 && lines(path).length < n; i++) await new Promise((r) => setTimeout(r, 5));
};

describe("savings log", () => {
	let agent: string;
	let previous: string | undefined;
	beforeEach(() => {
		previous = process.env.PI_CODING_AGENT_DIR;
		agent = mkdtempSync(join(tmpdir(), "squeeze-savings-"));
		process.env.PI_CODING_AGENT_DIR = agent;
	});
	afterEach(() => {
		process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(agent, { recursive: true, force: true });
	});

	test("lives in pi's agent dir", () => {
		expect(savingsLogPath({ PI_CODING_AGENT_DIR: "/a" }, "/h")).toBe(join("/a", SAVINGS_LOG));
		expect(savingsLogPath({ XDG_CONFIG_HOME: "/x" }, "/h")).toBe(join("/x", "pi", "agent", SAVINGS_LOG));
		expect(savingsLogPath({}, "/h")).toBe(join("/h", ".pi", "agent", SAVINGS_LOG));
		expect(savingsLogPath()).toBe(join(agent, SAVINGS_LOG));
	});

	test("writes one JSON line per record and never throws", async () => {
		const r = { ts: "2026-01-02T09:15:00.000Z", session: "s", cwd: "/w", tokens: 10, chars: 40, kind: "search" as const };
		expect(savingLine(r)).toBe(JSON.stringify(r) + "\n");
		const path = join(agent, "deep", "log.jsonl");
		expect(await appendSaving(r, path)).toBe(true);
		expect(await appendSaving(r, path)).toBe(true);
		expect(lines(path)).toEqual([r, r]);
		writeFileSync(join(agent, "file"), "");
		expect(await appendSaving(r, join(agent, "file", "log.jsonl"))).toBe(false);
	});

	test("logs each squeeze for usage trackers", async () => {
		const { hooks } = load();
		const ctx = { ...fakeCtx(), cwd: "/work/demo", sessionManager: { getSessionId: () => "s-1" } };
		const out = await hooks.tool_result!(result("rg -n import extensions"), ctx);
		const path = savingsLogPath();
		await settle(path, 1);
		const [rec] = lines(path);
		const chars = raw.length - out.content[0].text.length;
		expect(rec).toMatchObject({ session: "s-1", cwd: "/work/demo", kind: "search", chars, tokens: Math.round(chars / 4) });
		expect(Date.parse(rec.ts)).toBeGreaterThan(0);
	});

	test("logs without a session or cwd, and nothing for output left alone", async () => {
		const { hooks } = load();
		await hooks.tool_result!(result("cat x"), fakeCtx());
		await hooks.tool_result!(result("rg -n import extensions"), fakeCtx());
		const path = savingsLogPath();
		await settle(path, 1);
		expect(lines(path).map((r) => [r.session, r.cwd, r.kind])).toEqual([["", "", "search"]]);
	});

	test("logs nothing when logSavings is off, and still squeezes", async () => {
		writeFileSync(join(agent, "squeeze.json"), JSON.stringify({ logSavings: false }));
		const { hooks } = load();
		const ctx = fakeCtx();
		await hooks.session_start!({}, ctx);
		const out = await hooks.tool_result!(result("rg -n import extensions"), ctx);
		expect(out.content[0].text.length).toBeLessThan(raw.length);
		await new Promise((r) => setTimeout(r, 30));
		expect(existsSync(savingsLogPath())).toBe(false);
	});
});
