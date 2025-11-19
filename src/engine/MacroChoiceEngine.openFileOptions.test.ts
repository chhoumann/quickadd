import { describe, expect, it } from "vitest";
import { buildOpenFileOptions } from "./helpers/openFileOptions";
import { NewTabDirection } from "../types/newTabDirection";
import type { IOpenFileCommand } from "../types/macros/QuickCommands/IOpenFileCommand";
import { CommandType } from "../types/macros/CommandType";

function createCommand(
	overrides: Partial<IOpenFileCommand> = {}
): IOpenFileCommand {
	return {
		id: "test-id",
		name: "Open file: test.md",
		type: overrides.type ?? CommandType.OpenFile,
		filePath: "test.md",
		...overrides,
	};
}

describe("buildOpenFileOptions", () => {
	it("respects explicit location when provided", () => {
		const options = buildOpenFileOptions(
			createCommand({ location: "right-sidebar" })
		);

		expect(options.location).toBe("right-sidebar");
	});

	it("reuses the current tab when openInNewTab is false", () => {
		const options = buildOpenFileOptions(
			createCommand({ openInNewTab: false })
		);

		expect(options.location).toBe("reuse");
		expect(options.direction).toBeUndefined();
	});

	it("opens a new tab without splitting when no direction is chosen", () => {
		const options = buildOpenFileOptions(
			createCommand({ openInNewTab: true, direction: undefined })
		);

		expect(options.location).toBe("tab");
		expect(options.direction).toBeUndefined();
	});

	it("splits vertically when direction is vertical", () => {
		const options = buildOpenFileOptions(
			createCommand({
				openInNewTab: true,
				direction: NewTabDirection.vertical,
				location: "split",
			})
		);

		expect(options.location).toBe("split");
		expect(options.direction).toBe("vertical");
	});

	it("splits horizontally when direction is horizontal", () => {
		const options = buildOpenFileOptions(
			createCommand({
				openInNewTab: true,
				direction: NewTabDirection.horizontal,
				location: "split",
			})
		);

		expect(options.location).toBe("split");
		expect(options.direction).toBe("horizontal");
	});

	it("opens in a new window", () => {
		const options = buildOpenFileOptions(
			createCommand({ location: "window", focus: false })
		);

		expect(options.location).toBe("window");
		expect(options.focus).toBe(false);
	});
});
