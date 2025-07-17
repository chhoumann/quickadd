import { describe, it, expect } from "vitest";
import { duplicateChoice } from "./choiceDuplicator";
import { MacroChoice } from "../types/choices/MacroChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";

describe("choiceDuplicator", () => {
	describe("duplicateChoice", () => {
		it("should duplicate a macro choice with unique IDs", () => {
			// Create a macro choice with embedded macro
			const original = new MacroChoice("Test Macro");
			(original as IMacroChoice).macro = {
				id: "original-macro-id",
				name: "Test Macro",
				commands: [
					{ id: "original-cmd-1", type: "UserScript" as any, name: "Script 1" },
					{ id: "original-cmd-2", type: "ObsidianCommand" as any, name: "Command 2" }
				]
			};

			// Duplicate the choice
			const duplicated = duplicateChoice(original) as IMacroChoice;

			// Should have different IDs
			expect(duplicated.id).not.toBe(original.id);
			expect(duplicated.macro.id).not.toBe(original.macro.id);
			expect(duplicated.macro.commands[0].id).not.toBe(original.macro.commands[0].id);
			expect(duplicated.macro.commands[1].id).not.toBe(original.macro.commands[1].id);

			// Should have same content but with "(copy)" suffix
			expect(duplicated.name).toBe("Test Macro (copy)");
			expect(duplicated.macro.name).toBe("Test Macro");
			expect(duplicated.macro.commands).toHaveLength(2);
			expect(duplicated.macro.commands[0].name).toBe("Script 1");
			expect(duplicated.macro.commands[1].name).toBe("Command 2");

			// Should be separate objects (deep clone)
			duplicated.macro.commands[0].name = "Modified";
			expect(original.macro.commands[0].name).toBe("Script 1");
		});

		it("should handle choices without macros", () => {
			const original = new MacroChoice("Simple Choice");
			const duplicated = duplicateChoice(original);

			expect(duplicated.id).not.toBe(original.id);
			expect(duplicated.name).toBe("Simple Choice (copy)");
		});
	});
});
