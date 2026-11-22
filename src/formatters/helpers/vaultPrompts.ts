import type { App } from "obsidian";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import type { PromptProvider } from "../../interactive/promptProvider";
import { FieldLinkSuggester } from "../../gui/FieldLinkSuggester/fieldLinkSuggester";
import GenericInputPrompt from "../../gui/GenericInputPrompt/GenericInputPrompt";
import InputSuggester from "../../gui/InputSuggester/inputSuggester";
import MultiSuggester from "../../gui/MultiSuggester/multiSuggester";
import GenericSuggester from "../../gui/GenericSuggester/genericSuggester";
import { FieldSuggestionParser } from "../../utils/FieldSuggestionParser";
import {
	collectFieldValuesProcessedDetailed,
	collectFieldValuesWithSource,
} from "../../utils/FieldValueCollector";
import { FieldValueProcessor } from "../../utils/FieldValueProcessor";
import { resolveActiveNoteFieldDefault } from "../../utils/activeNoteFieldDefault";
import { buildFileDisplayInfos, FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, itemWithAlias, type ParsedFileToken } from "../../utils/fileSyntax";
import { UserCancelError } from "../../errors/UserCancelError";
import { isCancellationError } from "../../utils/errorUtils";
import { log } from "../../logger/logManager";
import { getFileTokenFiles } from "../../utils/vaultQueries";
import {
	createFieldLinkOptions,
	rankFieldLinkOptions,
	storedFieldLinkTarget,
	type FieldLinkOptions,
	type FieldLinkSuggestion,
} from "../../utils/fieldLinkValues";

const OTHER_NOTES_LIMIT = 200;

interface VaultPromptContext {
	app: App;
	executor: IChoiceExecutor | undefined;
	getSourcePath: () => string | null;
	onLinkTarget?: (targets: string | string[]) => void;
}

export async function suggestForField({ app, executor, getSourcePath, onLinkTarget }: VaultPromptContext, fieldInput: string): Promise<string | string[]> {

	// Route the final picker to a remote interactive session (Raycast) when one
	// is driving; the vault-side value collection below still runs unchanged.
	const provider = executor?.promptProvider;
	try {
		// Parse the field input to extract field name and filters. Do NOT warn
		// on unknown keys here: the field replacer in formatter.ts already parses
		// the same token with { warnUnknown: true } before calling this, so
		// warning again would emit a duplicate notice per malformed FIELD token.
		const { fieldName, filters, multiSelect, label, link } =
			FieldSuggestionParser.parse(fieldInput);

		const activeFile = executor?.triggerContext?.activeFile ?? null;
		const activeDefault =
			filters.defaultFrom === "active"
				? resolveActiveNoteFieldDefault(app, activeFile, fieldName)
				: null;

		const title = label ?? `Enter value for ${fieldName}`;
		let placeholder =
			multiSelect && !label ? `Select values for ${fieldName}` : title;

		if (link) {
			const { values: collectedEntries, hasDefaultValue: literalHasDefault } =
				await collectFieldValuesWithSource(app, fieldName, filters);
			let entries = collectedEntries;
			let hasDefaultValue = literalHasDefault;
			let effectiveDefault = filters.defaultValue;
			let effectiveDefaultSourcePath: string | undefined;

			if (!multiSelect && typeof activeDefault === "string") {
				entries = [{ value: activeDefault, sourcePath: activeFile?.path ?? "" }, ...entries];
				effectiveDefault = activeDefault;
				effectiveDefaultSourcePath = activeFile?.path;
				hasDefaultValue = true;
			} else if (!multiSelect && Array.isArray(activeDefault) && activeDefault.length > 0) {
				log.logMessage(
					`{{FIELD:${fieldName}|default-from:active}}: the active note's "${fieldName}" is a list value, which applies only to |multi FIELD prompts, so no default was prefilled.`,
				);
			}

			const links = createFieldLinkOptions(app, entries, getSourcePath() ?? "", {
				pinnedFirst: hasDefaultValue,
			});
			if (hasDefaultValue && effectiveDefault) {
				placeholder = `${placeholder} (default: ${links.displayFor(effectiveDefault, effectiveDefaultSourcePath)})`;
			}
			return await suggestFieldLinks(
				app,
				provider,
				links,
				placeholder,
				multiSelect ?? false,
				activeDefault,
				activeFile?.path,
				onLinkTarget,
			);
		}

		// Collect and process via shared collector (filters unmutated).
		const { values: collectedValues, hasDefaultValue: literalHasDefault } =
			await collectFieldValuesProcessedDetailed(app, fieldName, filters);

		let values = collectedValues;
		let hasDefaultValue = literalHasDefault;
		// The default shown in the placeholder hint: the active-note value wins
		// over a literal |default: when both are present.
		let effectiveDefault = filters.defaultValue;

		if (!multiSelect && typeof activeDefault === "string") {
			// Promote the active note's scalar value to the top so an empty-query
			// Enter accepts it, matching the existing default-always semantics.
			values = FieldValueProcessor.promoteValueToFront(
				values,
				activeDefault,
				filters.caseSensitive,
			);
			effectiveDefault = activeDefault;
			hasDefaultValue = true;
		} else if (
			!multiSelect &&
			Array.isArray(activeDefault) &&
			activeDefault.length > 0
		) {
			// A list-valued property has no single default; lists apply to |multi
			// only. Log (console-only) so a user expecting a default isn't mystified.
			log.logMessage(
				`{{FIELD:${fieldName}|default-from:active}}: the active note's "${fieldName}" is a list value, which applies only to |multi FIELD prompts, so no default was prefilled.`,
			);
		}

		if (hasDefaultValue && effectiveDefault) {
			placeholder = `${placeholder} (default: ${effectiveDefault})`;
		}

		if (multiSelect) {
			// When the vault has no existing values yet, seed the picker with the
			// same smart defaults the single-select no-values fallback surfaces
			// (e.g. To Do / In Progress / Done), so a brand-new {{FIELD:x|multi}}
			// offers starting hints instead of an empty list. Custom values stay
			// enabled so the user can still type anything.
			let multiValues = values;
			if (values.length === 0 && !filters.defaultValue) {
				const smartDefaults = FieldValueProcessor.getSmartDefaults(
					fieldName,
					[],
				);
				if (smartDefaults.length > 0) multiValues = smartDefaults;
			}
			// Pre-check the active note's value(s) (scalar -> one, list -> each).
			// Never [undefined]: activeDefault is null | string | string[].
			// Canonicalize each against the collected suggestions under the dedup
			// case fold, so an active "Done" toggles a collected "done" option
			// instead of adding a duplicate custom row (matching FIELD's
			// case-insensitive dedup).
			const preselected =
				activeDefault === null
					? undefined
					: (Array.isArray(activeDefault)
							? activeDefault
							: [activeDefault]
						).map((v) =>
							FieldValueProcessor.canonicalizeAgainst(
								multiValues,
								v,
								filters.caseSensitive,
							),
						);
			// Route to a remote interactive session (Raycast) when one is driving.
			if (provider) {
				return await provider.suggesterMulti(multiValues, multiValues, {
					placeholder,
					allowCustomInput: true,
					preselected:
						preselected && preselected.length > 0 ? preselected : undefined,
				});
			}
			return await MultiSuggester.Suggest(app, multiValues, multiValues, {
				placeholder,
				allowCustomValue: true,
				...(preselected && preselected.length > 0
					? { preselected }
					: {}),
			});
		}

		if (values.length === 0) {
			// No values found even after processing defaults
			let fallbackPrompt = `No existing values were found in your vault.`;

			// Suggest smart defaults if no custom default was provided
			if (!filters.defaultValue) {
				const smartDefaults = FieldValueProcessor.getSmartDefaults(
					fieldName,
					[],
				);
				if (smartDefaults.length > 0) {
					fallbackPrompt += `\n\nSuggested values for ${fieldName}: ${smartDefaults.slice(0, 3).join(", ")}`;
				}
			}

			if (provider) {
				return await provider.inputPrompt(title, fallbackPrompt);
			}
			return await GenericInputPrompt.Prompt(
				app,
				title,
				fallbackPrompt,
				undefined,
				undefined,
				{ allowPeek: true, linkSourcePath: getSourcePath() ?? undefined },
			);
		}

		if (provider) {
			return String(
				await provider.suggester(values, values, placeholder, true),
			);
		}
		return await InputSuggester.Suggest(app, values, values, {
			placeholder,
		});
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}

async function suggestFieldLinks(
	app: App,
	provider: PromptProvider | undefined,
	links: FieldLinkOptions,
	placeholder: string,
	multiSelect: boolean,
	activeDefault: string | string[] | null,
	activeSourcePath?: string,
	onLinkTarget?: (targets: string | string[]) => void,
): Promise<string | string[]> {
	const toLink = (value: string) => links.linkForTyped(value);
	const toTarget = (value: string): string => {
		const resolved = links.resolveTyped(value);
		if (resolved.kind === "option") return storedFieldLinkTarget(resolved.option);
		return resolved.kind === "new" ? resolved.link : "";
	};
	const collectMulti = (picks: string[], optionByLink?: ReadonlyMap<string, FieldLinkOptions["existingOptions"][number]>): string[] => {
		const seen = new Set<string>();
		const outLinks: string[] = [];
		const outTargets: string[] = [];
		for (const pick of picks) {
			const matched = optionByLink?.get(pick);
			const link = matched ? links.linkForOption(matched) : toLink(pick);
			if (!link || seen.has(link)) continue;
			seen.add(link);
			outLinks.push(link);
			outTargets.push(matched ? storedFieldLinkTarget(matched) : toTarget(pick));
		}
		onLinkTarget?.(outTargets);
		return outLinks;
	};

	if (provider) {
		const remoteOptions = links.allOptions;
		const remoteDisplays = remoteOptions.map((option) => option.display);
		const remoteIds = remoteOptions.map((option) => option.id);
		if (!multiSelect) {
			const reply = String(await provider.suggester(remoteDisplays, remoteIds, placeholder, true));
			const target = toTarget(reply);
			if (target) onLinkTarget?.(target);
			return toLink(reply);
		}
		const preselected = (activeDefault === null ? [] : [activeDefault].flat())
			.map((value) => {
				const resolved = links.resolveTyped(value, activeSourcePath);
				if (resolved.kind === "option") return resolved.option.id;
				return resolved.kind === "new" ? resolved.link : "";
			})
			.filter(Boolean);
		const picks = await provider.suggesterMulti(remoteDisplays, remoteIds, {
			placeholder,
			allowCustomInput: true,
			preselected: preselected.length > 0 ? preselected : undefined,
		});
		return collectMulti(picks);
	}

	if (!multiSelect) {
		return await FieldLinkSuggester.Suggest(app, links, {
			placeholder,
			...(onLinkTarget ? { onPick: (target) => onLinkTarget(target) } : {}),
		});
	}

	const existing = links.existingOptions;
	const displays = existing.map((option) => option.display);
	const existingLinks = existing.map((option) => links.linkForOption(option));
	const optionByLink = new Map(existing.map((option, index) => [existingLinks[index], option]));
	const preselected = (activeDefault === null ? [] : [activeDefault].flat())
		.map((value) => links.linkForTyped(value, activeSourcePath))
		.filter(Boolean);
	const picks = await MultiSuggester.Suggest(app, displays, existingLinks, {
		placeholder,
		allowCustomValue: true,
		aliases: existing.map((option) => [...option.aliases]),
		linkValues: true,
		unresolvedValues: new Set(existingLinks.filter((_, index) => existing[index].kind === "unresolved")),
		customPlaceholder: "Search other notes or type a link…",
		emptyText: "No existing values yet. Add notes below.",
		resolveTyped: toLink,
		customLabel: (value) => links.displayFor(value),
		isCustomUnresolved: (value) => links.isUnresolved(value),
		suggestCustom: (query, excluded) => suggestOtherNotes(links, query, excluded),
		...(preselected.length > 0 ? { preselected } : {}),
	});
	return collectMulti(picks, optionByLink);
}

function suggestOtherNotes(
	links: FieldLinkOptions,
	query: string,
	listed: ReadonlySet<string>,
): FieldLinkSuggestion[] {
	const excludeIds = new Set<string>();
	for (const value of listed) {
		const resolution = links.resolveTyped(value);
		if (resolution.kind === "option") excludeIds.add(resolution.option.id);
	}
	return rankFieldLinkOptions(links, query, {
		limit: OTHER_NOTES_LIMIT,
		scope: "other-only",
		excludeIds,
		includeNewRow: true,
	}).filter((suggestion) => suggestion.kind !== "new" || !listed.has(suggestion.link));
}

export async function suggestForFile({ app, executor, getSourcePath }: VaultPromptContext, parsed: ParsedFileToken): Promise<string | string[]> {

	// Route the final picker to a remote interactive session (Raycast) when one
	// is driving; the vault-side file filtering below still runs unchanged.
	const provider = executor?.promptProvider;
	try {
		const files = getFileTokenFiles(app, parsed);

		const placeholder =
			parsed.label ?? `Select a file from ${parsed.folderPath}`;

		// Empty folder (or no match): fall back to free-text so a capture never
		// dead-ends, mirroring suggestForField. A typed value is stored as custom
		// (never resolved to a real file); an empty/skip stays "".
		if (files.length === 0) {
			const description = `No matching files found in "${parsed.folderPath}". Type a value or leave empty.`;
			const typed = provider
				? await provider.inputPrompt(placeholder, description)
				: await GenericInputPrompt.Prompt(
						app,
						placeholder,
						description,
						undefined,
						undefined,
						{ optional: parsed.optional || undefined, allowPeek: true },
					);
			if (parsed.multiSelect) {
				return typed ? [`${FILE_CUSTOM_PREFIX}${typed}`] : [];
			}
			return typed ? `${FILE_CUSTOM_PREFIX}${typed}` : "";
		}

		const infos = buildFileDisplayInfos(
			files,
			(file) => app.metadataCache.getFileCache(file),
		);
		const displayItems = infos.map((info) => info.label);
		const aliases = infos.map((info) => info.aliases);
		const items = files.map((file) => `${FILE_PICK_PREFIX}${file.path}`);

		if (parsed.multiSelect) {
			const result = provider
				? (await provider.suggesterMulti(displayItems, items, {
						placeholder,
						allowCustomInput: parsed.allowCustomInput,
					})).map((reply) =>
						// The client matches titles only; a typed alias names its note.
						items.includes(reply) ? reply : (itemWithAlias(items, aliases, reply) ?? reply),
					)
				: await MultiSuggester.Suggest(app, displayItems, items, {
						placeholder,
						allowCustomValue: parsed.allowCustomInput,
						aliases,
						...(parsed.optional ? { skippable: true } : {}),
					});
			return result.map((item) =>
				items.includes(item) ? item : `${FILE_CUSTOM_PREFIX}${item}`,
			);
		}

		if (provider) {
			const result = String(
				await provider.suggester(
					displayItems,
					items,
					placeholder,
					parsed.allowCustomInput,
				),
			);
			if (!result) return "";
			if (items.includes(result)) return result;
			// The client matches titles only. A typed alias names its note, as in
			// the in-app picker.
			return itemWithAlias(items, aliases, result) ?? `${FILE_CUSTOM_PREFIX}${result}`;
		}

		if (parsed.allowCustomInput) {
			const basenames = new Set(
				files.map((file) => file.basename.toLowerCase()),
			);
			const displayLabels = new Set(
				[...displayItems, ...aliases.flat()].map((label) => label.toLowerCase()),
			);
			const result = await InputSuggester.Suggest(
				app,
				displayItems,
				items,
				{
					placeholder,
					aliases,
					// Typing a real basename, label or alias (e.g. "Tom", or "tom")
					// should pick that file, not add an indistinguishable custom row.
					valueExists: (typed) =>
						basenames.has(typed.toLowerCase()) ||
						displayLabels.has(typed.toLowerCase()),
					...(parsed.optional ? { skippable: true } : {}),
				},
			);
			if (!result) return ""; // skipped
			// A chosen row returns the encoded item; anything else is a type-in.
			return items.includes(result)
				? result
				: `${FILE_CUSTOM_PREFIX}${result}`;
		}

		const result = await GenericSuggester.Suggest(
			app,
			displayItems,
			items,
			placeholder,
			undefined,
			{ aliases, ...(parsed.optional ? { skippable: true } : {}) },
		);
		return result ?? "";
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}
