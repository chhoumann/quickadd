import { describe, it, expect } from "vitest";
import { OpenFileCommand } from "./OpenFileCommand";
import { CommandType } from "../CommandType";
import { NewTabDirection } from "../../newTabDirection";

describe("OpenFileCommand", () => {
	it("should create a command with default values", () => {
		const command = new OpenFileCommand();
		
		expect(command.type).toBe(CommandType.OpenFile);
		expect(command.filePath).toBe("{{DATE}}todo.md");
		expect(command.openInNewTab).toBe(false);
		expect(command.name).toBe("Open file: {{DATE}}todo.md");
		expect(command.id).toBeDefined();
	});

	it("should create a command with custom values", () => {
		const command = new OpenFileCommand(
			"notes/{{VALUE}}.md",
			true,
			NewTabDirection.vertical
		);
		
		expect(command.filePath).toBe("notes/{{VALUE}}.md");
		expect(command.openInNewTab).toBe(true);
		expect(command.direction).toBe(NewTabDirection.vertical);
		expect(command.name).toBe("Open file: notes/{{VALUE}}.md");
	});

	it("should generate unique IDs for different instances", () => {
		const command1 = new OpenFileCommand();
		const command2 = new OpenFileCommand();
		
		expect(command1.id).not.toBe(command2.id);
	});
});
