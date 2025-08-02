import { describe, it, expect } from "vitest";
import { OpenFileCommand } from "../../types/macros/QuickCommands/OpenFileCommand";
import { NewTabDirection } from "../../types/newTabDirection";

describe("OpenFileCommand Configuration", () => {
	it("should handle command configuration updates", () => {
		const command = new OpenFileCommand();
		
		// Simulate what happens when user changes the file path
		command.filePath = "custom/{{VALUE}}.md";
		command.name = `Open file: ${command.filePath}`;
		
		expect(command.name).toBe("Open file: custom/{{VALUE}}.md");
		expect(command.filePath).toBe("custom/{{VALUE}}.md");
	});

	it("should handle direction settings correctly", () => {
		const command = new OpenFileCommand(
			"test.md",
			true,
			NewTabDirection.vertical
		);
		
		expect(command.direction).toBe(NewTabDirection.vertical);
		expect(command.openInNewTab).toBe(true);
	});

	it("should update name when file path changes", () => {
		const command = new OpenFileCommand("initial.md");
		expect(command.name).toBe("Open file: initial.md");
		
		// Simulate settings modal update
		command.filePath = "notes/{{DATE}}-journal.md";
		command.name = `Open file: ${command.filePath}`;
		
		expect(command.name).toBe("Open file: notes/{{DATE}}-journal.md");
	});

	it("should maintain other properties when path changes", () => {
		const command = new OpenFileCommand(
			"test.md",
			true,
			NewTabDirection.horizontal,
			false
		);
		
		// Update just the path
		command.filePath = "new-path.md";
		command.name = `Open file: ${command.filePath}`;
		
		expect(command.filePath).toBe("new-path.md");
		expect(command.openInNewTab).toBe(true);
		expect(command.direction).toBe(NewTabDirection.horizontal);
		expect(command.focus).toBe(false);
	});
});
