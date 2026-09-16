import { describe, expect, it } from "vitest";
import { editorCommands } from "./editorCommands";

const labels = [
	"Copy",
	"Cut",
	"Paste",
	"Paste with format",
	"Select active line",
	"Select link on active line",
	"Move cursor to file start",
	"Move cursor to file end",
	"Move cursor to line start",
	"Move cursor to line end",
];

describe("editor command choices", () => {
	it("preserves the dropdown labels and order", () => {
		expect([...editorCommands.keys()]).toEqual(labels);
	});

	it.each(labels)("creates independent persisted %s commands", (label) => {
		const Command = editorCommands.get(label);
		if (!Command) throw new Error(`Missing editor command: ${label}`);
		const first = new Command();
		const second = new Command();
		expect(first).toMatchObject({
			name: label,
			type: "EditorCommand",
			editorCommandType: label,
		});
		expect(first.id).not.toBe(second.id);
	});
});
