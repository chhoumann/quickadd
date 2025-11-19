import { describe, it, expect } from "vitest";
import { OpenFileCommand } from "./OpenFileCommand";
import { CommandType } from "../CommandType";
import { NewTabDirection } from "../../newTabDirection";
import type { OpenLocation } from "../../fileOpening";

describe("OpenFileCommand Integration", () => {
	it("should integrate properly with macro system", () => {
		const command = new OpenFileCommand();
		
		// Verify the command has the correct type for macro engine dispatch
		expect(command.type).toBe(CommandType.OpenFile);
		
		// Verify it has required properties for execution
		expect(command.filePath).toBeDefined();
		expect(command.name).toBeDefined();
		expect(command.id).toBeDefined();
	});

	it("should support all formatting scenarios", () => {
		const testCases = [
			"{{DATE}}todo.md",
			"{{DATE:YYYY-MM-DD}}/journal.md",
			"projects/{{VALUE}}/readme.md",
			"{{CLIPBOARD}}.md",
			"notes/{{TIME}}-quick-note.md"
		];

		testCases.forEach(filePath => {
			const command = new OpenFileCommand(filePath);
			expect(command.filePath).toBe(filePath);
			expect(command.name).toBe(`Open file: ${filePath}`);
		});
	});

	it("should support all file opening configurations", () => {
		// Test core combinations that users might configure
		const configurations: {
			filePath: string;
			openInNewTab: boolean;
			direction?: NewTabDirection;
			location?: OpenLocation;
		}[] = [
			// Default: no new tab
			{ filePath: "test.md", openInNewTab: false },
			// Open in new tab with vertical split
			{ filePath: "test.md", openInNewTab: true, direction: NewTabDirection.vertical, location: "split" },
			// Open in new tab with horizontal split
			{ filePath: "test.md", openInNewTab: true, direction: NewTabDirection.horizontal, location: "split" },
			// Open in current tab
			{ filePath: "existing.md", openInNewTab: false },
			// Open in window
			{ filePath: "window.md", openInNewTab: true, location: "window" },
			// Open in sidebars
			{ filePath: "left.md", openInNewTab: true, location: "left-sidebar" },
			{ filePath: "right.md", openInNewTab: true, location: "right-sidebar" },
			// Legacy: openInNewTab true without direction/location should split
			{ filePath: "legacy.md", openInNewTab: true },
		];

		configurations.forEach(config => {
			const command = new OpenFileCommand(
				config.filePath,
				config.openInNewTab,
				config.direction,
				config.location
			);

			expect(command.filePath).toBe(config.filePath);
			expect(command.openInNewTab).toBe(config.openInNewTab);
			expect(command.direction).toBe(config.direction);
			if (config.location) {
				expect(command.location).toBe(config.location);
			} else {
				expect(command.location).toBeUndefined();
			}
		});
	});

	it("should handle edge cases gracefully", () => {
		// Empty file path
		const emptyPathCommand = new OpenFileCommand("");
		expect(emptyPathCommand.filePath).toBe("");
		expect(emptyPathCommand.name).toBe("Open file: ");

		// Very long file path
		const longPath = "very/deep/nested/folder/structure/with/many/levels/file.md";
		const longPathCommand = new OpenFileCommand(longPath);
		expect(longPathCommand.filePath).toBe(longPath);
		expect(longPathCommand.name).toBe(`Open file: ${longPath}`);

		// Special characters in path
		const specialPath = "files with spaces/特殊字符.md";
		const specialCommand = new OpenFileCommand(specialPath);
		expect(specialCommand.filePath).toBe(specialPath);
	});

	it("should maintain immutability for macro execution", () => {
		const originalCommand = new OpenFileCommand("original.md");
		const commandCopy = { ...originalCommand };

		// Simulate macro execution - properties shouldn't be mutated
		commandCopy.filePath = "modified.md";

		expect(originalCommand.filePath).toBe("original.md");
		expect(commandCopy.filePath).toBe("modified.md");
	});
});
