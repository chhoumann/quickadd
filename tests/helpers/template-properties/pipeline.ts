import { TFile, type App } from "obsidian";
import { vi } from "vitest";
import { TemplatePropertyCollector } from "../../../src/utils/TemplatePropertyCollector";
import { postProcessFrontMatter } from "../../../src/engine/helpers/frontmatterPostProcessor";

export function createPropertyPipeline(frontmatter: Record<string, unknown> = {}) {
	const collector = new TemplatePropertyCollector();
	const file = Object.assign(new TFile(), { path: "output.md", extension: "md" });
	const processFrontMatter = vi.fn(async (_file: TFile, update: (data: Record<string, unknown>) => void) => {
		update(frontmatter);
	});
	const app = { fileManager: { processFrontMatter } } as unknown as App;

	function collect(input: string, values: Record<string, unknown>, heuristicEnabled = true) {
		for (const match of input.matchAll(/\{\{VALUE:([^}]+)\}\}/g)) {
			collector.maybeCollect({
				input,
				matchStart: match.index,
				matchEnd: match.index + match[0].length,
				rawValue: values[match[1]],
				fallbackKey: match[1],
				collectionActive: true,
				heuristicEnabled,
			});
		}
		return collector.drain();
	}

	return {
		collector, frontmatter, processFrontMatter, collect,
		process: (variables: Map<string, unknown>) => postProcessFrontMatter(app, file, variables),
	};
}

export function propertyTemplate(keys: string[], lineEnding = "\n") {
	return ["---", ...keys.map((key) => `${key}: {{VALUE:${key}}}`), "---", "Body"].join(lineEnding);
}
