import { describe, expect, it } from "vitest";
import { migrateChoice } from "../../src/v3/migrate";
import type { ActionNode } from "../../src/v3/model";
import { render, summarize } from "../../src/v3/summary";
import { FIXTURE } from "./fixture";
import { packageChoices } from "./packages";

describe("summary line", () => {
	it("renders placeholders as short names", () => {
		expect(render("{{DATE:YYYY-MM-DD}} {{VALUE:Meeting|optional}} {{VALUE}} {{TIME}} {{VDATE:due,YYYY}} {{DAILY}}"))
			.toBe("{date} {Meeting} {value} {time} {due} today's daily note");
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
