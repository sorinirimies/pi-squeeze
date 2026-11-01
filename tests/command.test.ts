import { describe, expect, test } from "bun:test";
import { completions, parseCommand } from "../extensions/command/parse.ts";

describe("parseCommand", () => {
	test("no argument and status show the status", () => {
		expect(parseCommand(undefined)).toEqual({ kind: "status" });
		expect(parseCommand("  ")).toEqual({ kind: "status" });
		expect(parseCommand("STATUS")).toEqual({ kind: "status" });
	});

	test("on and off, with their long forms", () => {
		expect(parseCommand("on")).toEqual({ kind: "on" });
		expect(parseCommand("enable")).toEqual({ kind: "on" });
		expect(parseCommand("off")).toEqual({ kind: "off" });
		expect(parseCommand("disable")).toEqual({ kind: "off" });
	});

	test("each compactor switches on and off", () => {
		expect(parseCommand("search off")).toEqual({ kind: "compactor", compactor: "search", on: false });
		expect(parseCommand("paths on")).toEqual({ kind: "compactor", compactor: "paths", on: true });
		expect(parseCommand("listing off")).toEqual({ kind: "compactor", compactor: "listing", on: false });
		for (const bad of ["search", "search maybe"]) expect(parseCommand(bad).kind).toBe("invalid");
	});

	test("min takes an integer 100..1000000", () => {
		expect(parseCommand("min 800")).toEqual({ kind: "min", chars: 800 });
		for (const bad of ["min", "min 5", "min 2000000", "min x", "min 150.5"]) expect(parseCommand(bad).kind).toBe("invalid");
	});

	test("anything else is invalid and prints the usage", () => {
		const c = parseCommand("bogus");
		expect(c.kind === "invalid" && c.message).toContain("Usage: /squeeze");
	});
});

describe("completions", () => {
	test("completes the top level by prefix, every item has a label", () => {
		expect(completions("")!.map((i) => i.label)).toEqual(["status", "on", "off", "search", "paths", "listing", "min"]);
		expect(completions("o")!.map((i) => i.label)).toEqual(["on", "off"]);
		expect(completions("  SE")!.map((i) => i.label)).toEqual(["search"]);
		for (const i of completions("")!) expect(typeof i.label).toBe("string");
	});

	test("after a compactor name it offers on and off", () => {
		expect(completions("paths ")!.map((i) => i.value)).toEqual(["paths on", "paths off"]);
		expect(completions("paths of")!.map((i) => i.value)).toEqual(["paths off"]);
	});

	test("nothing matches, nothing is offered", () => {
		expect(completions("zzz")).toBeNull();
		expect(completions(undefined as unknown as string)).not.toBeNull();
	});
});
