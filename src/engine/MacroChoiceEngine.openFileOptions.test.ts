import { describe, expect, it } from "vitest";
import { buildOpenFileOptions } from "./helpers/openFileOptions";
import { NewTabDirection } from "../types/newTabDirection";
import type { IOpenFileCommand } from "../types/macros/QuickCommands/IOpenFileCommand";
import { CommandType } from "../types/macros/CommandType";
import { OpenFileCommand } from "../types/macros/QuickCommands/OpenFileCommand";

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

	it("opens in the current tab when openInNewTab is false", () => {
		const options = buildOpenFileOptions(
			createCommand({ openInNewTab: false, location: undefined })
		);

		expect(options.location).toBe("reuse");
		expect(options.direction).toBeUndefined();
	});

	it("keeps legacy default behavior: split when openInNewTab is true and no direction", () => {
		const options = buildOpenFileOptions(
			createCommand({ openInNewTab: true, direction: undefined, location: undefined })
		);

		expect(options.location).toBe("split");
		expect(options.direction).toBe("vertical");
	});

	it("legacy OpenFileCommand (openInNewTab true, no direction/location) splits by default", () => {
		const command = new OpenFileCommand("file.md", true);
		const options = buildOpenFileOptions(command);

		expect(options.location).toBe("split");
		expect(options.direction).toBe("vertical");
	});

	it("reuses the current tab when openInNewTab is false and location set to reuse", () => {
		const options = buildOpenFileOptions(
			createCommand({ openInNewTab: false, location: "reuse" })
		);

		expect(options.location).toBe("reuse");
		expect(options.direction).toBeUndefined();
	});

	it("opens a new tab without splitting when location is explicitly tab", () => {
		const options = buildOpenFileOptions(
			createCommand({ openInNewTab: true, direction: undefined, location: "tab" })
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

	it("defaults focus and mode when not specified", () => {
		const options = buildOpenFileOptions(
			createCommand({ location: "tab", focus: undefined })
		);

		expect(options.focus).toBe(true);
		expect(options.mode).toBe("default");
	});
});
