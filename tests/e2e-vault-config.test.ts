import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const E2E = join(ROOT, "tests/e2e");

it("sets vault options in e2e specs without writing app.json", () => {
	const hits = readdirSync(E2E, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".ts"))
		.flatMap((file) =>
			readFileSync(join(E2E, file), "utf8")
				.split("\n")
				.flatMap((line, i) => (/\b(setConfig|saveConfig|requestSaveConfig)\s*\(/.test(line) ? [`${relative(ROOT, join(E2E, file))}:${i + 1}`] : [])),
		);
	expect(
		hits,
		"Use setVaultConfig from tests/e2e/uiHelpers.ts: setConfig and saveConfig write app.json, which Obsidian can read back under load after the spec restores the option, leaking it into every later spec (#2207).",
	).toEqual([]);
});
