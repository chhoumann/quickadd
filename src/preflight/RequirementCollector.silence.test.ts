import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { RequirementCollector } from "./RequirementCollector";
import type QuickAdd from "../main";
import { LogManager } from "../logger/logManager";
import type { ILogger } from "../logger/ilogger";

vi.mock("../engine/SingleTemplateEngine", () => ({
	SingleTemplateEngine: class {
		run(): Promise<string> {
			return Promise.resolve("");
		}
	},
}));

const app = {
	workspace: { getActiveFile: () => null },
	vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
	metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
} as unknown as App;

const plugin = {
	settings: { globalVariables: {}, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

let reported: string[] = [];

beforeEach(() => {
	reported = [];
	LogManager.loggers = [
		{
			logError: (m: string) => reported.push(`error ${m}`),
			logWarning: (m: string) => reported.push(`warning ${m}`),
			logMessage: () => {},
		} as unknown as ILogger,
	];
});

/**
 * Issue #1558. The preflight scan walks the same strings the run is about to
 * format. It used to emit the run's warnings itself - twice per token, because
 * it parses in both a pre-pass and a main pass - so with one-page inputs enabled
 * a single `|case:` typo produced two Notices before the form opened and a third
 * when the run formatted for real. Verified live in Obsidian 1.13.0.
 */
describe("#1558 the preflight scan does not re-report the run's warnings", () => {
	const cases = [
		"{{VALUE:title|case:pasc}}",
		"{{VALUE|type:numbr}}",
		"{{VALUE:x|type:slider|min:1}}",
		"{{FIELD:status|fodler:abc}}",
		"{{VALUE:a,b|name:title}}",
	];

	for (const input of cases) {
		it(`stays silent scanning ${input}`, async () => {
			await new RequirementCollector(app, plugin).scanString(input);
			expect(reported).toEqual([]);
		});
	}

	it("still collects the requirement it was scanning for", async () => {
		const collector = new RequirementCollector(app, plugin);
		await collector.scanString("{{VALUE:title|case:pasc}}");
		expect(collector.requirements.size).toBe(1);
	});
});
