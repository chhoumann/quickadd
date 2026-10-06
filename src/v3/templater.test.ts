import { describe, expect, it } from "vitest";
import { templaterPrompts, usesTemplater } from "./templater";

describe("usesTemplater", () => {
	it("is true for any Templater tag", () => {
		expect(usesTemplater("# <% tp.file.title %>")).toBe(true);
		expect(usesTemplater("<%* tR += 'x' -%>")).toBe(true);
	});

	it("is false for text without one", () => {
		expect(usesTemplater("# {{VALUE:Title}}\n100% done")).toBe(false);
	});
});

describe("templaterPrompts", () => {
	it("labels a prompt by its first argument, in double or single quotes", () => {
		expect(templaterPrompts(`# <% tp.system.prompt("Guest") %>\n<% tp.system.prompt( 'Where?', "Home", true ) %>`)).toEqual([
			{ label: "Guest", kind: "prompt" },
			{ label: "Where?", kind: "prompt" },
		]);
	});

	it("labels a suggester by its literal options", () => {
		expect(templaterPrompts(`<% tp.system.suggester(["Happy", 'Sad'], ["happy", "sad"]) %>`)).toEqual([
			{ label: "Happy, Sad", kind: "suggester" },
		]);
	});

	it("labels a suggester of variables as a choice", () => {
		expect(templaterPrompts("<% tp.system.suggester(names, files) %>\n<% tp.system.suggester((f) => f.basename, files) %>")).toEqual([
			{ label: "a choice", kind: "suggester" },
			{ label: "a choice", kind: "suggester" },
		]);
	});

	it("reads execution blocks and whitespace-trimming tags, in order of appearance", () => {
		const text = [
			"<%*",
			"const mood = await tp.system.suggester(['Good', 'Bad'], ['good', 'bad']);",
			'const note = await tp.system . prompt ( "Note" );',
			"tR += mood + note;",
			"-%>",
			'<%_ tp.system.prompt("Last") _%>',
		].join("\n");

		expect(templaterPrompts(text)).toEqual([
			{ label: "Good, Bad", kind: "suggester" },
			{ label: "Note", kind: "prompt" },
			{ label: "Last", kind: "prompt" },
		]);
	});

	it("finds nothing in text without tags, or outside them", () => {
		expect(templaterPrompts("# {{VALUE:Title}}")).toEqual([]);
		expect(templaterPrompts('Call tp.system.prompt("Not run") in a tag. <% tp.file.title %>')).toEqual([]);
	});

	it("labels a prompt without a string as a value", () => {
		expect(templaterPrompts("<% tp.system.prompt(question) %>")).toEqual([{ label: "a value", kind: "prompt" }]);
	});

	it("does not throw on broken input", () => {
		for (const text of ["<% tp.system.prompt(", '<% tp.system.prompt("open %>', "<% tp.system.suggester([ %>", "<%", "%><%%>", '<% tp.system.suggester(["a", %>']) {
			expect(() => templaterPrompts(text)).not.toThrow();
		}
		expect(templaterPrompts("<% tp.system.prompt(")).toEqual([]);
		expect(templaterPrompts('<% tp.system.suggester(["a", %>')).toEqual([{ label: "a choice", kind: "suggester" }]);
	});
});
