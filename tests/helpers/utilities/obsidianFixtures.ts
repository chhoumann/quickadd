import { TFile } from "obsidian";
import { vi } from "vitest";

export function markdownFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.basename = file.name.replace(/\.md$/i, "");
	file.extension = "md";
	return file;
}

export function frontmatterManager(frontmatter: Record<string, unknown>, link = "[[Created]]") {
	return {
		generateMarkdownLink: vi.fn(() => link),
		processFrontMatter: vi.fn(async (_file: TFile, update: (fm: Record<string, unknown>) => void) => {
			update(frontmatter);
		}),
	};
}
