import { describe, expect, it } from "vitest";
import { migrateChoice } from "../../src/v3/migrate";
import type { Action, ActionNode, Step } from "../../src/v3/model";
import { describeStepLine, render, summarize } from "../../src/v3/summary";
import { FIXTURE } from "./fixture";
import { packageChoices } from "./packages";

describe("summary line", () => {
	it("renders placeholders as short names", () => {
		expect(render("{{DATE:YYYY-MM-DD}} {{VALUE:Meeting|optional}} {{VALUE}} {{TIME}} {{VDATE:due,YYYY}} {{DAILY}}"))
			.toBe("{date} {Meeting} {value} {time} {due} today's daily note");
	});

	const action = (steps: Step[]): Action => ({ kind: "action", id: "a", name: "A", steps, show: { command: false } });

	it("says an action without steps has none yet", () => {
		expect(summarize(action([]))).toBe("No steps yet");
	});

	it("names the script, or says a script when none is picked yet", () => {
		const script = (path: string): Step => ({ type: "runScript", id: "s", path, settings: {} });
		expect(summarize(action([script("Scripts/clip.js::run")]))).toBe("Runs clip.js::run");
		expect(summarize(action([script("")]))).toBe("Runs a script");
	});

	it("says what one step does as a line of its own", () => {
		expect(describeStepLine({ type: "open", id: "o", note: "{{NOTE}}", location: "tab", direction: "vertical", mode: "default", focus: true }))
			.toBe("Opens it");
		expect(describeStepLine({ type: "runScript", id: "s", path: "", settings: {} })).toBe("Runs a script");
	});

	it("says where and how a Link it step puts the link", () => {
		const link = (insert?: Extract<Step, { type: "link" }>["insert"], copyToClipboard?: boolean) =>
			describeStepLine({ type: "link", id: "l", link: "{{NOTE}}", insert, copyToClipboard });
		const here = { requireActiveFile: false, destination: { type: "activeFile" } } as const;

		expect(link({ ...here, placement: "newLine" })).toBe("Links it on a new line here");
		expect(link({ ...here, placement: "replaceSelection" })).toBe("Links it at the cursor here");
		expect(link({ ...here, placement: "endOfLine", linkType: "embed" })).toBe("Embeds it at the end of the line here");
		expect(link({ ...here, placement: "inFrontmatter", frontmatterProperty: "related" })).toBe("Links it in the related property here");
		// A specified note gets the link on a line at its bottom, whatever the placement says.
		expect(link({ ...here, placement: "inFrontmatter", linkType: "embed", destination: { type: "specifiedFile", path: "Projects.md" } }))
			.toBe("Links it at the bottom of Projects");
		expect(link(undefined, true)).toBe("Copies its link");
		expect(link({ ...here, placement: "newLine" }, true)).toBe("Links it on a new line here and copies its link");
	});

	it("matches the reviewed lines for every package and fixture action", async () => {
		const sources = [
			...packageChoices()
				// A folder's children are also package entries of their own.
				.filter(({ choice }, index, all) => all.findIndex((other) => other.choice.id === choice.id) === index)
				.map(({ pkg, choice }) => ({ source: pkg, node: migrateChoice(choice).node })),
			...FIXTURE.map((choice) => ({ source: "fixture", node: migrateChoice(choice).node })),
		];
		const names = new Map<string, string>();
		const lines: string[] = [];
		const index = (node: ActionNode) => {
			names.set(node.id, node.name);
			if (node.kind === "folder") node.items.forEach(index);
		};
		sources.forEach(({ node }) => index(node));
		const visit = (source: string, node: ActionNode, parents: string[]) => {
			const path = [...parents, node.name].join(" / ");
			if (node.kind === "folder") node.items.forEach((item) => visit(source, item, [...parents, node.name]));
			else lines.push(`${source} | ${path}\n    ${summarize(node, (id) => names.get(id))}`);
		};
		sources.forEach(({ source, node }) => visit(source, node, []));
		await expect(`${lines.join("\n")}\n`).toMatchFileSnapshot("./summary-lines.txt");
	});
});
