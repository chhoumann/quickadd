import { describe, expect, it } from "vitest";
import {
	obsidianCommandArgs,
	obsidianEnv,
	parseArgs,
} from "../scripts/obsidian-e2e-cli.mjs";

describe("obsidian-e2e-cli", () => {
	it("defaults to quickadd:list when no Obsidian command is provided", () => {
		const parsed = parseArgs([]);

		expect(parsed.instanceArgs).toEqual([]);
		expect(parsed.commandArgs).toEqual(["quickadd:list"]);
	});

	it("splits instance options from the Obsidian command", () => {
		const parsed = parseArgs([
			"--vault",
			"quickadd-worktree-a",
			"--profile-root",
			"profiles",
			"dev:errors",
		]);

		expect(parsed.instanceArgs).toEqual([
			"--vault",
			"quickadd-worktree-a",
			"--profile-root",
			"profiles",
		]);
		expect(parsed.commandArgs).toEqual(["dev:errors"]);
	});

	it("uses -- to pass option-like Obsidian command arguments", () => {
		const parsed = parseArgs([
			"--vault",
			"quickadd-worktree-a",
			"--",
			"eval",
			"--some-obsidian-flag",
		]);

		expect(parsed.instanceArgs).toEqual(["--vault", "quickadd-worktree-a"]);
		expect(parsed.commandArgs).toEqual(["eval", "--some-obsidian-flag"]);
	});

	it("accepts the leading separator produced by pnpm run before wrapper options", () => {
		const parsed = parseArgs([
			"--",
			"--vault",
			"quickadd-worktree-a",
			"quickadd:list",
		]);

		expect(parsed.instanceArgs).toEqual(["--vault", "quickadd-worktree-a"]);
		expect(parsed.commandArgs).toEqual(["quickadd:list"]);
	});

	it("prefixes commands with the resolved isolated vault", () => {
		expect(obsidianCommandArgs(
			{ vaultName: "quickadd-worktree-a" },
			["quickadd:list"],
		)).toEqual(["vault=quickadd-worktree-a", "quickadd:list"]);
	});

	it("runs Obsidian CLI commands with the isolated HOME", () => {
		expect(obsidianEnv({ obsidianHome: "/tmp/quickadd/home" })).toMatchObject({
			HOME: "/tmp/quickadd/home",
		});
	});
});
