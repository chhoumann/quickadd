import type { App, TFile } from "obsidian";
import { log } from "../logger/logManager";
import {
	DEFAULT_FRONTMATTER_HANDLING,
	type FrontmatterHandling,
} from "../types/linkPlacement";
import { getOwnerDocument } from "./activeWindow";

const FRONTMATTER_HANDLING_LABELS: Record<FrontmatterHandling, string> = {
	alwaysAppend: "Create or convert",
	createProperty: "Create if missing",
	error: "Require list",
};

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
	const requestedKey = propertyKey.trim();
	if (!requestedKey) {
		throw new Error("Cannot append link to an empty frontmatter property key.");
	}

	const key = resolveFrontmatterPropertyKey(frontmatter, requestedKey);
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

export function appendConfiguredFrontmatterPropertyLinkValue(
	frontmatter: Record<string, unknown>,
	propertyKey: string,
	linkText: string,
	frontmatterHandling: FrontmatterHandling = DEFAULT_FRONTMATTER_HANDLING,
): void {
	const requestedKey = propertyKey.trim();
	if (!requestedKey) {
		throw new Error("Cannot append link to an empty frontmatter property key.");
	}

	const key = resolveFrontmatterPropertyKey(frontmatter, requestedKey);
	const existing = frontmatter[key];
	if (Array.isArray(existing)) {
		existing.push(linkText);
		return;
	}

	if (existing === null || existing === "") {
		frontmatter[key] = [linkText];
		return;
	}

	if (existing === undefined) {
		if (frontmatterHandling === "error") {
			throw new Error(
				`Cannot append link to frontmatter property '${key}' because it does not exist.`,
			);
		}
		frontmatter[key] = [linkText];
		return;
	}

	if (typeof existing === "object") {
		throw new Error(
			`Cannot append link to frontmatter property '${key}' because it contains an object value.`,
		);
	}

	if (frontmatterHandling !== "alwaysAppend") {
		throw new Error(
			`Cannot append link to frontmatter property '${key}' because it is not a list and the link-handling mode is '${FRONTMATTER_HANDLING_LABELS[frontmatterHandling]}'. Choose '${FRONTMATTER_HANDLING_LABELS.alwaysAppend}' to convert it into a list and append.`,
		);
	}

	frontmatter[key] = [existing, linkText];
}

function resolveFrontmatterPropertyKey(
	frontmatter: Record<string, unknown>,
	propertyKey: string,
): string {
	const normalizedPropertyKey = normalizePropertyKey(propertyKey);
	const matchingKeys = Object.keys(frontmatter).filter(
		(key) => normalizePropertyKey(key) === normalizedPropertyKey,
	);

	if (matchingKeys.length > 1) {
		throw new Error(
			`Cannot append link to frontmatter property '${propertyKey}' because the note has multiple properties that normalize to that key.`,
		);
	}

	return matchingKeys[0] ?? propertyKey;
}

function normalizePropertyKey(propertyKey: string): string {
	return propertyKey.trim().toLowerCase();
}

export async function appendLinkToConfiguredFrontmatterProperty(
	app: App,
	targetFile: TFile,
	propertyKey: string,
	fileToLink: TFile,
	frontmatterHandling: FrontmatterHandling = DEFAULT_FRONTMATTER_HANDLING,
): Promise<void> {
	const linkText = app.fileManager.generateMarkdownLink(
		fileToLink,
		targetFile.path,
	);

	await app.fileManager.processFrontMatter(targetFile, (frontmatter) => {
		appendConfiguredFrontmatterPropertyLinkValue(
			frontmatter,
			propertyKey,
			linkText,
			frontmatterHandling,
		);
	});
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
		log.logError(
			`QuickAdd: created the file but could not append the link to frontmatter property '${target.key}' in '${target.file.path}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return false;
	}
}
