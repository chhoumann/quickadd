import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { getAPI } from "obsidian-dataview";
import { DataviewIntegration } from "./DataviewIntegration";

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

vi.mock("src/logger/logManager", () => ({
	log: { logMessage: vi.fn(), logError: vi.fn() },
}));

const app = {} as App;

function mockDataview(): { query: ReturnType<typeof vi.fn> } {
	const dv = {
		query: vi.fn().mockResolvedValue({
			successful: true,
			value: { values: [] },
		}),
	};
	vi.mocked(getAPI).mockReturnValue(dv as unknown as ReturnType<typeof getAPI>);
	return dv;
}

describe("DataviewIntegration folder DQL escaping", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("escapes a double quote in an include-folder so it cannot break the DQL string literal", async () => {
		const dv = mockDataview();

		await DataviewIntegration.getFieldValuesWithFilter(app, "status", {
			folder: 'a"b',
		});

		const query = dv.query.mock.calls[0][0] as string;
		// The quote must be backslash-escaped inside the DQL string literal.
		expect(query).toContain('regexmatch("^a\\"b/", file.path)');
		// And the raw, literal-terminating form must NOT appear.
		expect(query).not.toContain('regexmatch("^a"b/"');
	});

	it("escapes a double quote in an exclude-folder", async () => {
		const dv = mockDataview();

		await DataviewIntegration.getFieldValuesWithFilter(app, "status", {
			excludeFolders: ['x"y'],
		});

		const query = dv.query.mock.calls[0][0] as string;
		expect(query).toContain('!regexmatch("^x\\"y/", file.path)');
	});

	it("still escapes regex metacharacters and leaves plain folders intact", async () => {
		const dv = mockDataview();

		await DataviewIntegration.getFieldValuesWithFilter(app, "status", {
			folders: ["Projects", "a.b"],
		});

		const query = dv.query.mock.calls[0][0] as string;
		// Plain folders are byte-identical to the pre-fix output.
		expect(query).toContain('regexmatch("^Projects/", file.path)');
		// The '.' is regex-escaped (\.), then the backslash is DQL-escaped (\\),
		// so the source carries "\\." which Dataview's string lexer turns back
		// into the regex "\." that matches a literal dot.
		expect(query).toContain('regexmatch("^a\\\\.b/", file.path)');
	});
});
