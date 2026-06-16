import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import { FormatDisplayFormatter } from "src/formatters/formatDisplayFormatter";
import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { OnePageInputModal } from "./OnePageInputModal";
import {
	canonicalizeOnePageFileValue,
	FILE_VARIABLE_PREFIX,
} from "src/utils/fileSyntax";
import { toWikiLink } from "src/utils/linkWrap";
import {
	collectChoiceRequirements,
	getUnresolvedRequirements,
} from "./collectChoiceRequirements";

export async function runOnePagePreflight(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: IChoice,
): Promise<boolean> {
	try {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			choice,
			{ seedCaptureSelectionAsValue: true },
		);
		if (requirements.length === 0) return false; // Nothing to collect

		// Only prompt for unresolved inputs (variables missing or null). Empty string is intentional.
		const unresolved = getUnresolvedRequirements(
			requirements,
			choiceExecutor.variables,
		);

		if (unresolved.length === 0) return false; // Everything prefilled, skip modal

		// Show modal
		// Optional live preview of a couple of key outputs (best-effort)
		const computePreview = async (values: Record<string, string>) => {
			try {
				const formatter = new FormatDisplayFormatter(app, plugin);
				const out: Record<string, string> = {};
				// File name preview for Template
				if (choice.type === "Template") {
					const tmpl = choice as ITemplateChoice;
					if (tmpl.fileNameFormat?.enabled) {
						// Seed variables map-like into formatter
						for (const [k, v] of Object.entries(values)) {
							formatter["variables"].set(k, v);
						}
						out.fileName = await formatter.format(tmpl.fileNameFormat.format);
					}
				}
				return out;
			} catch {
				return {};
			}
		};

		const modal = new OnePageInputModal(
			app,
			unresolved,
			choiceExecutor.variables,
			computePreview,
		);
		const values = await modal.waitForClose;

		// Date inputs already store @date:ISO. FILE inputs need canonicalizing: the
		// generic suggester stores raw typed text, so a value that isn't one of the
		// requirement's encoded `@file:` picks is treated as typed custom text (and
		// can't spoof a pick by typing the internal `@file:` sentinel).
		const fileOptionsByKey = new Map<string, string[]>();
		// |multi requirements: the suggester stores a ", "-joined string; split it
		// back into a real array so the formatter writes a YAML list (matching the
		// runtime |multi path), applying linklist wrapping when requested.
		const multiEmitByKey = new Map<string, "text" | "linklist">();
		for (const req of unresolved) {
			if (req.id.startsWith(FILE_VARIABLE_PREFIX)) {
				fileOptionsByKey.set(req.id, req.options ?? []);
			}
			if (req.suggesterConfig?.multiSelect) {
				multiEmitByKey.set(req.id, req.multiEmit ?? "text");
			}
		}

		// Store results into executor variables
		Object.entries(values).forEach(([k, v]) => {
			const multiEmit = multiEmitByKey.get(k);
			if (multiEmit !== undefined) {
				const items = String(v)
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				choiceExecutor.variables.set(
					k,
					multiEmit === "linklist" ? items.map(toWikiLink) : items,
				);
				return;
			}
			const fileOptions = fileOptionsByKey.get(k);
			const normalized = fileOptions
				? canonicalizeOnePageFileValue(v, fileOptions)
				: v;
			choiceExecutor.variables.set(k, normalized);
		});

		return true;
	} catch (error) {
		// If user explicitly cancelled, propagate it
		if (error === "cancelled") {
			throw error;
		}
		// For other errors, silently fail and continue
		return false;
	}
}
