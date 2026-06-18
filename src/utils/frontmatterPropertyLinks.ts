import type { App, TFile } from "obsidian";
import { log } from "../logger/logManager";
import { getOwnerDocument } from "./activeWindow";

const TYPED_PROPERTY_INPUT_SELECTOR = [
	'input[type="number"]',
	'input[type="date"]',
	'input[type="datetime-local"]',
	'input[type="time"]',
	'input[type="month"]',
	'input[type="checkbox"]',
].join(", ");

export interface FrontmatterPropertyTarget {
	file: TFile;
	key: string;
}

type MarkdownPropertyView = {
	containerEl?: HTMLElement;
	file?: TFile | null;
};

export function getFocusedPropertyTarget(
	app: App,
): FrontmatterPropertyTarget | null {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view as MarkdownPropertyView;
		if (!view.containerEl || !view.file || view.file.extension !== "md") {
			continue;
		}

		try {
			const focused = getOwnerDocument(view.containerEl).activeElement;
			if (!focused || !view.containerEl.contains(focused)) continue;
			if (!focused.closest(".metadata-property-value")) continue;
			if (focused.matches(TYPED_PROPERTY_INPUT_SELECTOR)) continue;

			const row = focused.closest(".metadata-property");
			const key = row?.getAttribute("data-property-key");
			if (!key) continue;

			return { file: view.file, key };
		} catch {
			continue;
		}
	}

	return null;
}

export function appendFrontmatterPropertyLinkValue(
	frontmatter: Record<string, unknown>,
	propertyKey: string,
	linkText: string,
): void {
	const key = propertyKey.trim();
	if (!key) {
		throw new Error("Cannot append link to an empty frontmatter property key.");
	}

	const existing = frontmatter[key];
	if (Array.isArray(existing)) {
		existing.push(linkText);
		return;
	}

	if (existing === undefined || existing === null || existing === "") {
		frontmatter[key] = linkText;
		return;
	}

	if (typeof existing === "string") {
		frontmatter[key] = `${existing} ${linkText}`;
		return;
	}

	throw new Error(
		`Cannot append link to frontmatter property '${key}' because it contains a ${typeof existing} value.`,
	);
}

export async function appendLinkToFrontmatterProperty(
	app: App,
	target: FrontmatterPropertyTarget,
	fileToLink: TFile,
): Promise<boolean> {
	const linkText = app.fileManager.generateMarkdownLink(
		fileToLink,
		target.file.path,
	);

	try {
		await app.fileManager.processFrontMatter(target.file, (frontmatter) => {
			appendFrontmatterPropertyLinkValue(frontmatter, target.key, linkText);
		});
		return true;
	} catch (error) {
		log.logWarning(
			`QuickAdd: could not append link to frontmatter property '${target.key}' in '${target.file.path}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return false;
	}
}
