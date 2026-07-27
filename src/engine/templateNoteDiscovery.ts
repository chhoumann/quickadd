import { TFile, type App } from "obsidian";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import {
	routePrompt,
	type PromptRoutingContext,
} from "../interactive/routePrompt";
import { promptEngineChoice } from "../interactive/engineChoice";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { renderNotePathSuggestion } from "src/gui/InputSuggester/renderNotePathSuggestion";
import { orderFilesForPicker } from "src/utils/fileOrdering";
import { buildPickerOrderingDeps } from "src/utils/pickerOrderingDeps";
import { isCancellationError } from "src/utils/errorUtils";
import { UserCancelError } from "src/errors/UserCancelError";
import { normalizeGeneratedFilePath } from "src/utils/generatedFilePath";
import { escapesVaultBoundary } from "src/utils/vaultPathBoundary";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";

export {
	shouldRunTemplateNoteDiscovery,
	usesDefaultTemplateTitlePrompt,
} from "src/utils/templateNoteDiscoveryEligibility";

const EXISTING_PREFIX = "@quickadd-existing-note:";
const UNRESOLVED_PREFIX = "@quickadd-unresolved-note:";

export type TemplateNoteDiscoveryResult =
	| { kind: "create"; title: string; vaultRelativePath?: string }
	| { kind: "openExisting"; file: TFile };

type DiscoveryCandidate = {
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

function normalizedKey(value: string): string {
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

function buildDiscoveryCandidates(app: App, choice: ITemplateChoice): {
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

function renderUnresolvedSuggestion(el: HTMLElement, title: string): void {
	el.addClass("mod-complex");
	const content = el.createDiv({ cls: "suggestion-content" });
	content.createDiv({ cls: "suggestion-title", text: title });
	content.createDiv({ cls: "suggestion-note", text: "Unresolved link" });
}

function renderExistingSuggestion(
	el: HTMLElement,
	path: string,
	alias?: string,
): void {
	renderNotePathSuggestion(el, path);
	if (!alias) return;

	const content = el.querySelector(".suggestion-content");
	content?.createDiv({ cls: "suggestion-note", text: `Alias: ${alias}` });
}

export async function promptForTemplateNoteDiscovery(
	app: App,
	choice: ITemplateChoice,
	executor: PromptRoutingContext,
): Promise<TemplateNoteDiscoveryResult> {
	const { candidates, existingKeys } = buildDiscoveryCandidates(app, choice);
	const candidateByItem = new Map(
		candidates.map((candidate) => [candidate.item, candidate]),
	);

	const placeholder = `Search notes or create ${choice.name}`;

	try {
		const selected = String(
			await routePrompt(executor, {
				// This picker is the one the one-page preflight deliberately does NOT
				// pre-collect (it filters the `value` requirement out for discovery), so
				// before this an interactive run collected nothing and walked straight
				// into a desktop list of every note in the vault (#1614).
				remote: (provider) =>
					promptEngineChoice(provider, {
						items: candidates.map((candidate) => ({
							value: candidate.item,
							title: candidate.title,
						})),
						placeholder,
						// "Create new note" - the whole point of the picker.
						allowCustomInput: true,
						what: "the note-discovery picker",
					}),
				// A headless run never reaches here: `shouldRunTemplateNoteDiscovery`
				// needs an unresolved `value`, which the CLI refuses up front as a
				// missing input. Guarded anyway, so the branch cannot become a hang.
				headless: () => {
					throw new ChoiceAbortError(
						`'${choice.name}' needs to ask which note to open or create, but this run is non-interactive. ` +
							`Pass the note name (e.g. value-value=<name>), or re-run with the ui flag.`,
					);
				},
				app: () =>
					InputSuggester.Suggest(
			app,
			candidates.map((candidate) => candidate.display),
			candidates.map((candidate) => candidate.item),
			{
				placeholder,
				allowCustomValue: true,
				customValueLabel: (value) => `Create new note: ${value}`,
				valueExists: (value) => {
					const key = normalizedKey(value);
					return (
						existingKeys.has(key) ||
						candidates.some(
							(candidate) =>
								candidate.unresolvedTitle &&
								normalizedKey(candidate.unresolvedTitle) === key,
						)
					);
				},
				renderItem: (item, el) => {
					const candidate = candidateByItem.get(item);
					if (!candidate) return;
					if (candidate.renderPath) {
						renderExistingSuggestion(
							el,
							candidate.renderPath,
							candidate.renderAlias,
						);
						return;
					}
					if (candidate.unresolvedTitle) {
						renderUnresolvedSuggestion(el, candidate.unresolvedTitle);
					}
				},
			},
					),
			}),
		);

		if (isExistingItem(selected)) {
			const file = app.vault.getAbstractFileByPath(decodeExistingPath(selected));
			if (file instanceof TFile) {
				return { kind: "openExisting", file };
			}
			throw new Error("Selected note no longer exists. Please run QuickAdd again.");
		}

		if (isUnresolvedItem(selected)) {
			const title = normalizeGeneratedFilePath(
				decodeUnresolvedTitle(selected),
				"Note title",
			);
			return {
				kind: "create",
				title,
				...(title.includes("/") ? { vaultRelativePath: title } : {}),
			};
		}

		const typedTitle = normalizeGeneratedFilePath(selected, "Note title");
		return {
			kind: "create",
			title: typedTitle,
			// A typed name containing "/" is a vault-relative path, mirroring the
			// unresolved-link branch above — otherwise the same text resolves to a
			// different destination depending on whether it matched a link.
			...(typedTitle.includes("/") ? { vaultRelativePath: typedTitle } : {}),
		};
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}

export const testExports = {
	buildDiscoveryCandidates,
	collectUnresolvedTargets,
	normalizeUnresolvedTarget,
	templatePathExclusions,
};
