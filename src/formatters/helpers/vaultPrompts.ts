import type { App } from "obsidian";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import GenericInputPrompt from "../../gui/GenericInputPrompt/GenericInputPrompt";
import InputSuggester from "../../gui/InputSuggester/inputSuggester";
import MultiSuggester from "../../gui/MultiSuggester/multiSuggester";
import GenericSuggester from "../../gui/GenericSuggester/genericSuggester";
import { FieldSuggestionParser } from "../../utils/FieldSuggestionParser";
import { collectFieldValuesProcessedDetailed } from "../../utils/FieldValueCollector";
import { FieldValueProcessor } from "../../utils/FieldValueProcessor";
import { resolveActiveNoteFieldDefault } from "../../utils/activeNoteFieldDefault";
import { buildFileDisplayLabels, FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, type ParsedFileToken } from "../../utils/fileSyntax";
import { UserCancelError } from "../../errors/UserCancelError";
import { isCancellationError } from "../../utils/errorUtils";
import { log } from "../../logger/logManager";
import { getFileTokenFiles } from "../../utils/vaultQueries";

interface VaultPromptContext {
	app: App;
	executor: IChoiceExecutor | undefined;
	getSourcePath: () => string | null;
}

export async function suggestForField({ app, executor, getSourcePath }: VaultPromptContext, fieldInput: string): Promise<string | string[]> {

	// Route the final picker to a remote interactive session (Raycast) when one
	// is driving; the vault-side value collection below still runs unchanged.
	const provider = executor?.promptProvider;
	try {
		// Parse the field input to extract field name and filters. Do NOT warn
		// on unknown keys here: the field replacer in formatter.ts already parses
		// the same token with { warnUnknown: true } before calling this, so
		// warning again would emit a duplicate notice per malformed FIELD token.
		const { fieldName, filters, multiSelect } =
			FieldSuggestionParser.parse(fieldInput);

		// Resolve the active-note default (issue #1429) BEFORE collection but apply
		// it AFTER, so the resolved value never enters the collection cache key
		// (which is keyed partly on filters.defaultValue). Gate strictly on
		// "active"; an unknown source is ignored. `null` => no usable active value
		// (no/non-Markdown active file, or a missing/empty/object property).
		const activeDefault =
			filters.defaultFrom === "active"
				? resolveActiveNoteFieldDefault(
						app,
						executor?.triggerContext?.activeFile ?? null,
						fieldName,
					)
				: null;

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

		// Enhance placeholder with context
		let placeholder = multiSelect
			? `Select values for ${fieldName}`
			: `Enter value for ${fieldName}`;
		if (hasDefaultValue && effectiveDefault) {
			placeholder = multiSelect
				? `Select values for ${fieldName} (default: ${effectiveDefault})`
				: `Enter value for ${fieldName} (default: ${effectiveDefault})`;
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
				return await provider.inputPrompt(
					`Enter value for ${fieldName}`,
					fallbackPrompt,
				);
			}
			return await GenericInputPrompt.PromptWithContext(
				app,
				`Enter value for ${fieldName}`,
				fallbackPrompt,
				undefined,
				getSourcePath() ?? undefined,
				undefined,
				{ allowPeek: true },
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

		const displayItems = buildFileDisplayLabels(
			files,
			(file) => app.metadataCache.getFileCache(file),
		);
		const items = files.map((file) => `${FILE_PICK_PREFIX}${file.path}`);

		if (parsed.multiSelect) {
			const result = provider
				? await provider.suggesterMulti(displayItems, items, {
						placeholder,
						allowCustomInput: parsed.allowCustomInput,
					})
				: await MultiSuggester.Suggest(app, displayItems, items, {
						placeholder,
						allowCustomValue: parsed.allowCustomInput,
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
			return items.includes(result)
				? result
				: `${FILE_CUSTOM_PREFIX}${result}`;
		}

		if (parsed.allowCustomInput) {
			const basenames = new Set(
				files.map((file) => file.basename.toLowerCase()),
			);
			const displayLabels = new Set(
				displayItems.map((label) => label.toLowerCase()),
			);
			const result = await InputSuggester.Suggest(
				app,
				displayItems,
				items,
				{
					placeholder,
					// Typing a real basename (e.g. "Tom", or "tom") should pick that
					// file, not add a separate, indistinguishable custom row.
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
			parsed.optional ? { skippable: true } : undefined,
		);
		return result ?? "";
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}
