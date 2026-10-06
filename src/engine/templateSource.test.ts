import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/templateFolderUtils", () => ({
	getTemplateFile: (_app: unknown, path: string) => (path === "Templates/There.md" ? { path } : null),
}));

import { checkTemplateSource } from "./templateSource";

const app = {} as never;

describe("checkTemplateSource", () => {
	it("refuses a missing template before anything is asked", () => {
		expect(() => checkTemplateSource(app, { templatePath: "Templates/Missing.md" })).toThrow("does not exist");
		expect(() => checkTemplateSource(app, { templatePath: "" })).toThrow("No template is picked");
		expect(() => checkTemplateSource(app, { templatePath: "Templates/There.md" })).not.toThrow();
	});

	it("does not refuse up front a run that may open an existing note instead", () => {
		expect(() =>
			checkTemplateSource(app, { templatePath: "Templates/Missing.md", discoverExistingNotesBeforeCreate: true }),
		).not.toThrow();
	});
});
