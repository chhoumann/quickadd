import { describe, it, expect } from "vitest";
import { FormatStringPathParser } from "./formatStringPathParser";

describe("FormatStringPathParser", () => {
	describe("parseTemplateReferences", () => {
		it("should extract template paths from format strings", () => {
			const formatString = "{{TEMPLATE:Templates/daily.md}} and {{TEMPLATE:work/meeting.md}}";
			const paths = FormatStringPathParser.parseTemplateReferences(formatString);
			
			expect(paths).toEqual(["Templates/daily.md", "work/meeting.md"]);
		});

		it("should handle empty format strings", () => {
			const paths = FormatStringPathParser.parseTemplateReferences("");
			expect(paths).toEqual([]);
		});

		it("should handle format strings without template references", () => {
			const formatString = "{{DATE}} - {{value}}";
			const paths = FormatStringPathParser.parseTemplateReferences(formatString);
			expect(paths).toEqual([]);
		});
	});

	describe("parseFieldFolderFilters", () => {
		it("should extract folder paths from field filters", () => {
			const formatString = "{{FIELD:status|folder:daily}} {{FIELD:project|folder:work/active|tag:urgent}}";
			const paths = FormatStringPathParser.parseFieldFolderFilters(formatString);
			
			expect(paths).toEqual(["daily", "work/active"]);
		});

		it("should extract exclude-folder paths", () => {
			const formatString = "{{FIELD:notes|exclude-folder:archive|exclude-folder:templates}}";
			const paths = FormatStringPathParser.parseFieldFolderFilters(formatString);
			
			expect(paths).toEqual(["archive", "templates"]);
		});

		it("should extract both folder and exclude-folder paths", () => {
			const formatString = "{{FIELD:docs|folder:active|exclude-folder:old|exclude-folder:temp}}";
			const paths = FormatStringPathParser.parseFieldFolderFilters(formatString);
			
			expect(paths).toEqual(["active", "old", "temp"]);
		});
	});

	describe("updateTemplateReferences", () => {
		it("should update template paths for file renames", () => {
			const formatString = "{{TEMPLATE:Templates/daily.md}} content {{TEMPLATE:work/meeting.md}}";
			const updated = FormatStringPathParser.updateTemplateReferences(
				formatString,
				"Templates/daily.md",
				"Templates/journal.md",
				true
			);
			
			expect(updated).toBe("{{TEMPLATE:Templates/journal.md}} content {{TEMPLATE:work/meeting.md}}");
		});

		it("should update template paths for folder renames", () => {
			const formatString = "{{TEMPLATE:Templates/daily.md}} and {{TEMPLATE:Templates/weekly.md}}";
			const updated = FormatStringPathParser.updateTemplateReferences(
				formatString,
				"Templates",
				"MyTemplates",
				false
			);
			
			expect(updated).toBe("{{TEMPLATE:MyTemplates/daily.md}} and {{TEMPLATE:MyTemplates/weekly.md}}");
		});
	});

	describe("updateFieldFolderFilters", () => {
		it("should update folder filter paths", () => {
			const formatString = "{{FIELD:status|folder:daily|tag:work}}";
			const updated = FormatStringPathParser.updateFieldFolderFilters(
				formatString,
				"daily",
				"journal"
			);
			
			expect(updated).toBe("{{FIELD:status|folder:journal|tag:work}}");
		});

		it("should update exclude-folder filter paths", () => {
			const formatString = "{{FIELD:notes|exclude-folder:archive|exclude-folder:old}}";
			const updated = FormatStringPathParser.updateFieldFolderFilters(
				formatString,
				"archive",
				"backup"
			);
			
			expect(updated).toBe("{{FIELD:notes|exclude-folder:backup|exclude-folder:old}}");
		});

		it("should preserve filter order and other filters", () => {
			const formatString = "{{FIELD:project|tag:urgent|folder:work/active|inline:true|exclude-folder:archive}}";
			const updated = FormatStringPathParser.updateFieldFolderFilters(
				formatString,
				"work/active",
				"projects/current"
			);
			
			expect(updated).toBe("{{FIELD:project|tag:urgent|folder:projects/current|inline:true|exclude-folder:archive}}");
		});

		it("should preserve unknown custom filters", () => {
			// Test that unknown filters like |priority:high|color:red are preserved
			const formatString = "{{FIELD:task|priority:high|folder:projects|color:red|exclude-folder:archive|status:active}}";
			const updated = FormatStringPathParser.updateFieldFolderFilters(
				formatString,
				"projects",
				"work/current"
			);
			
			// Should only update folder and exclude-folder values, preserving all other filters exactly
			expect(updated).toBe("{{FIELD:task|priority:high|folder:work/current|color:red|exclude-folder:archive|status:active}}");
		});

		it("should preserve filter casing and spacing", () => {
			const formatString = "{{FIELD:notes|FOLDER:Daily Notes|exclude-folder:Archive}}";
			const updated = FormatStringPathParser.updateFieldFolderFilters(
				formatString,
				"Daily Notes",
				"Journal"
			);
			
			// Should preserve the uppercase FOLDER: and exact spacing
			expect(updated).toBe("{{FIELD:notes|FOLDER:Journal|exclude-folder:Archive}}");
		});
	});

	describe("updateAllPathReferences", () => {
		it("should update both template and field references for folder renames", () => {
			const formatString = "{{TEMPLATE:Templates/note.md}} {{FIELD:status|folder:Templates}}";
			const updated = FormatStringPathParser.updateAllPathReferences(
				formatString,
				"Templates",
				"MyTemplates",
				false
			);
			
			expect(updated).toBe("{{TEMPLATE:MyTemplates/note.md}} {{FIELD:status|folder:MyTemplates}}");
		});

		it("should only update template references for file renames", () => {
			const formatString = "{{TEMPLATE:Templates/note.md}} {{FIELD:status|folder:Templates}}";
			const updated = FormatStringPathParser.updateAllPathReferences(
				formatString,
				"Templates/note.md",
				"Templates/journal.md",
				true
			);
			
			expect(updated).toBe("{{TEMPLATE:Templates/journal.md}} {{FIELD:status|folder:Templates}}");
		});

		it("should handle complex format strings", () => {
			const formatString = "{{DATE}} {{TEMPLATE:daily.md}} {{FIELD:project|folder:work|tag:active}} {{value}}";
			const updated = FormatStringPathParser.updateAllPathReferences(
				formatString,
				"work",
				"projects",
				false
			);
			
			expect(updated).toBe("{{DATE}} {{TEMPLATE:daily.md}} {{FIELD:project|folder:projects|tag:active}} {{value}}");
		});
	});
});