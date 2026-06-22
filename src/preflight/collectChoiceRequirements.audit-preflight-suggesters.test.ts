import { describe, expect, it, vi } from "vitest";
import type { FieldRequirement } from "./RequirementCollector";

// collectChoiceRequirements imports utilityObsidian + the logger; mock them so
// the pure getUnresolvedRequirements helper can be exercised in isolation.
vi.mock("src/utilityObsidian", () => ({
	getMarkdownFilesInFolder: vi.fn(() => []),
	getMarkdownFilesMatchingFilter: vi.fn(() => []),
	getMarkdownFilesWithTag: vi.fn(() => []),
	getMarkdownFilesWithProperty: vi.fn(() => []),
	getUserScript: vi.fn(),
	getTemplateFile: vi.fn(() => null),
	isFolder: vi.fn(() => false),
}));

vi.mock("src/logger/logManager", () => ({
	log: { logWarning: vi.fn(), logMessage: vi.fn() },
}));

import { getUnresolvedRequirements } from "./collectChoiceRequirements";

const req = (id: string): FieldRequirement => ({
	id,
	label: id,
	type: "text",
});

// Finding: prompts-gui-onepage-orchestration — the documented rule is
// "unresolved = variables missing or null", but the existence check only
// rejected undefined, so a null-valued variable was wrongly treated as resolved
// and silently skipped by the one-page modal.
describe("getUnresolvedRequirements null handling", () => {
	it("treats a null-valued variable as unresolved", () => {
		const requirements = [req("value")];
		const variables = new Map<string, unknown>([["value", null]]);

		expect(getUnresolvedRequirements(requirements, variables)).toEqual(
			requirements,
		);
	});

	it("treats a missing variable as unresolved", () => {
		const requirements = [req("value")];
		const variables = new Map<string, unknown>();

		expect(getUnresolvedRequirements(requirements, variables)).toEqual(
			requirements,
		);
	});

	it("treats a non-null value (including empty string) as resolved", () => {
		const requirements = [req("value")];
		const resolvedString = new Map<string, unknown>([["value", "x"]]);
		const resolvedEmpty = new Map<string, unknown>([["value", ""]]);

		expect(getUnresolvedRequirements(requirements, resolvedString)).toEqual(
			[],
		);
		expect(getUnresolvedRequirements(requirements, resolvedEmpty)).toEqual(
			[],
		);
	});
});
