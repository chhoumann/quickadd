import { TFile, type App } from "obsidian";
import { orderFilesForPicker } from "src/utils/fileOrdering";
import { buildPickerOrderingDeps } from "src/utils/pickerOrderingDeps";
import { normalizeGeneratedFilePath } from "src/utils/generatedFilePath";
import { escapesVaultBoundary } from "src/utils/vaultPathBoundary";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";

const EXISTING_PREFIX = "@quickadd-existing-note:";
const UNRESOLVED_PREFIX = "@quickadd-unresolved-note:";

export type TemplateNoteDiscoveryResult =
	| { kind: "create"; title: string; vaultRelativePath?: string }
	| { kind: "openExisting"; file: TFile };

export type TemplateNoteSelection =
	| { kind: "existing"; path: string }
	| { kind: "create"; title: string; vaultRelativePath?: string };

export type DiscoveryCandidate = {
	item: string;
	/**
	 * The fuzzy-SEARCH text, not a label: basename + path + aliases, joined. The
	 * in-app picker feeds this to the matcher and draws the visible row from
	 * `renderItem` instead. A remote client has no `renderItem`, so it gets
	 * {@link DiscoveryCandidate.title} - sending `display` there would have shown
	 * rows reading "Tom Areas/Work/Tom.md Thomas" (#1614).
	 */
	display: string;
	/** The human label: the note's basename, or the unresolved link's target. */
	title: string;
	renderPath?: string;
	renderAlias?: string;
	unresolvedTitle?: string;
};

function encodeExisting(path: string): string {
	return `${EXISTING_PREFIX}${path}`;
}

function encodeUnresolved(title: string): string {
	return `${UNRESOLVED_PREFIX}${title}`;
}

function isExistingItem(item: string): boolean {
	return item.startsWith(EXISTING_PREFIX);
}

function isUnresolvedItem(item: string): boolean {
	return item.startsWith(UNRESOLVED_PREFIX);
}

function decodeExistingPath(item: string): string {
	return item.slice(EXISTING_PREFIX.length);
}

function decodeUnresolvedTitle(item: string): string {
	return item.slice(UNRESOLVED_PREFIX.length);
}

export function normalizedKey(value: string): string {
	return value.trim().replace(/\.md$/i, "").toLowerCase();
}

function normalizeVaultPath(value: string): string {
	return value.trim().replace(/^\/+/, "");
}

function isLiteralMarkdownPath(path: string): boolean {
	return path.trim().length > 0 && !path.includes("{{");
}

function templatePathExclusions(choice: ITemplateChoice): Set<string> {
	if (!isLiteralMarkdownPath(choice.templatePath)) return new Set();

	const normalized = normalizeVaultPath(choice.templatePath);
	const markdownPath = /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
	return new Set([markdownPath.toLowerCase()]);
}

function addPathKeys(keys: Set<string>, path: string, basename: string): void {
	const withoutExtension = path.replace(/\.md$/i, "");
	keys.add(normalizedKey(path));
	keys.add(normalizedKey(withoutExtension));
	keys.add(normalizedKey(basename));
}

function readAliases(app: App, file: TFile): string[] {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!frontmatter) return [];

	const aliases: string[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		const lowerKey = key.toLowerCase();
		if (lowerKey !== "alias" && lowerKey !== "aliases") continue;

		if (typeof value === "string") {
			aliases.push(
				...value
					.split(",")
					.map((alias) => alias.trim())
					.filter(Boolean),
			);
		} else if (Array.isArray(value)) {
			aliases.push(
				...value
					.filter((alias): alias is string => typeof alias === "string")
					.map((alias) => alias.trim())
					.filter(Boolean),
			);
		}
	}

	return aliases;
}

function normalizeUnresolvedTarget(raw: string): string | null {
	const withoutAlias = raw.split("|")[0]?.trim() ?? "";
	const withoutSubpath = withoutAlias.split("#")[0]?.trim() ?? "";
	const withoutExtension = withoutSubpath.replace(/\.md$/i, "").trim();
	if (!withoutExtension || withoutExtension === "/") return null;
	// Unresolved-link candidates come from note content (metadataCache.unresolvedLinks),
	// which is untrusted on a synced/shared vault: a planted [[..\\..\\..\\evil]] would
	// otherwise surface as a selectable "create" target that resolves outside the vault.
	// Drop anything that escapes the boundary so it never appears as a traversal lure.
	if (escapesVaultBoundary(withoutExtension)) return null;
	return withoutExtension;
}

function collectUnresolvedTargets(app: App): string[] {
	const unresolvedLinks =
		(app.metadataCache as { unresolvedLinks?: Record<string, Record<string, number>> })
			.unresolvedLinks ?? {};
	const targets = new Map<string, string>();

	for (const links of Object.values(unresolvedLinks)) {
		for (const raw of Object.keys(links)) {
			const target = normalizeUnresolvedTarget(raw);
			if (!target) continue;
			const key = normalizedKey(target);
			if (!targets.has(key)) targets.set(key, target);
		}
	}

	return [...targets.values()].sort((a, b) => a.localeCompare(b));
}

export function buildDiscoveryCandidates(app: App, choice: ITemplateChoice): {
	candidates: DiscoveryCandidate[];
	existingKeys: Set<string>;
} {
	const existingKeys = new Set<string>();
	const excludedPaths = templatePathExclusions(choice);
	const markdownFiles = orderFilesForPicker(
		app.vault.getMarkdownFiles(),
		buildPickerOrderingDeps(app),
	);

	const candidates: DiscoveryCandidate[] = [];
	for (const file of markdownFiles) {
		if (excludedPaths.has(normalizeVaultPath(file.path).toLowerCase())) {
			continue;
		}
		addPathKeys(existingKeys, file.path, file.basename);
		const aliases = readAliases(app, file);
		const searchable = [file.basename, file.path, ...aliases].join(" ");
		candidates.push({
			item: encodeExisting(file.path),
			display: searchable,
			title: aliases[0] ? `${file.basename} (${file.path})` : file.path,
			renderPath: file.path,
			renderAlias: aliases[0],
		});
	}

	for (const target of collectUnresolvedTargets(app)) {
		const key = normalizedKey(target);
		if (existingKeys.has(key)) continue;
		candidates.push({
			item: encodeUnresolved(target),
			display: target,
			title: `${target} (unresolved link)`,
			unresolvedTitle: target,
		});
	}

	return { candidates, existingKeys };
}

export function decodeTemplateNoteSelection(selected: string): TemplateNoteSelection {
	if (isExistingItem(selected)) {
		return { kind: "existing", path: decodeExistingPath(selected) };
	}
	const title = normalizeGeneratedFilePath(
		isUnresolvedItem(selected) ? decodeUnresolvedTitle(selected) : selected,
		"Note title",
	);
	return {
		kind: "create",
		title,
		...(title.includes("/") ? { vaultRelativePath: title } : {}),
	};
}

export function selectionForDiscoveryCandidate(
	app: App,
	item: string,
): TemplateNoteSelection {
	const selection = decodeTemplateNoteSelection(item);
	resolveTemplateNoteSelection(app, selection);
	return selection;
}

export function resolveTemplateNoteSelection(
	app: App,
	selection: TemplateNoteSelection,
): TemplateNoteDiscoveryResult {
	if (selection.kind === "existing") {
		const file = app.vault.getAbstractFileByPath(selection.path);
		if (!(file instanceof TFile)) {
			throw new Error("Selected note no longer exists. Please run QuickAdd again.");
		}
		return { kind: "openExisting", file };
	}
	const title = normalizeGeneratedFilePath(selection.title, "Note title");
	return { kind: "create", title, ...(title.includes("/") ? { vaultRelativePath: title } : {}) };
}

export const testExports = {
	buildDiscoveryCandidates,
	collectUnresolvedTargets,
	normalizeUnresolvedTarget,
	templatePathExclusions,
};
