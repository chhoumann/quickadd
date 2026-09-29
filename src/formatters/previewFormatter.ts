import { Formatter } from "./formatter";
import { PreviewDiagnostics } from "./previewDiagnostics";
import { DateFormatPreviewGenerator, getCurrentFileLinkPreview, getCurrentFileLinkToSectionPreview, getCurrentFileNamePreview, getCurrentFolderPathPreview } from "./helpers/previewHelpers";
import { defaultDateVariableFormat, rememberDateVariableFormat, renderStoredDateVariable } from "./helpers/dateTokens";
import { snappedExampleDate } from "./helpers/snappedExampleDate";
import { getFileTokenFiles } from "../utils/vaultQueries";
import { FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, type ParsedFileToken } from "../utils/fileSyntax";
import type { ParsedVDateOptions } from "../utils/vdateSyntax";

/** Shared inert resolvers. Concrete previews retain their own pass order. */
export abstract class PreviewFormatter extends Formatter {
	public diagnostics = new PreviewDiagnostics();

	protected warn(message: string): void {
		this.diagnostics.add("warning", message);
	}

	protected reportProblem(message: string): void {
		this.diagnostics.add("error", message);
	}

	protected getCurrentFileLink(): string | null {
		if (!this.app) return null;
		return getCurrentFileLinkPreview(this.app.workspace.getActiveFile());
	}

	protected getCurrentFileLinkToSection(): string | null {
		if (!this.app) return getCurrentFileLinkToSectionPreview(null);
		return getCurrentFileLinkToSectionPreview(
			this.app.workspace.getActiveFile(),
		);
	}

	protected getCurrentFileName(): string | null {
		if (!this.app) return "current_filename";
		return getCurrentFileNamePreview(this.app.workspace.getActiveFile());
	}

	protected getCurrentFolderPath(): string | null {
		if (!this.app) return "current_folder";
		return getCurrentFolderPathPreview(this.app.workspace.getActiveFile());
	}

	/**
	 * A named {{VDATE}} as the run renders it. A token that names no format gets
	 * the run's default (#1589). An answered date wins, through the run's own
	 * renderer, so a seeded @date:ISO shows the date the user picked (#1590).
	 * Otherwise the example is today, snapped and cased the way the run does it.
	 * `text` is undefined when the example cannot be rendered (the snap needs
	 * moment, and a throw would redden the row on every keystroke).
	 */
	protected previewDateVariable(
		token: string,
		variableName: string,
		dateFormat: string | undefined,
		options: ParsedVDateOptions,
	):
		| { format: string; text: string; answered: true }
		| { format: string; text?: string; answered: false } {
		const { withTime, snap, caseStyle } = options;
		const format = dateFormat?.trim() || defaultDateVariableFormat(withTime);
		rememberDateVariableFormat(this.variables, variableName, format);

		const stored = renderStoredDateVariable(
			this.variables.get(variableName),
			format,
			snap,
			this.dateParser,
		);
		if (stored) {
			return {
				format,
				text: this.applyCaseOption(stored.text, caseStyle, token),
				answered: true,
			};
		}

		try {
			const example = DateFormatPreviewGenerator.generate(
				format,
				snappedExampleDate(snap),
			);
			return {
				format,
				text: this.applyCaseOption(example, caseStyle, token),
				answered: false,
			};
		} catch {
			return { format, answered: false };
		}
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("calculation_result");
	}

	protected async getSelectedText(): Promise<string> {
		return "selected_text";
	}

	protected async getClipboardContent(): Promise<string> {
		return "clipboard_content";
	}

	protected suggestForFile(parsed: ParsedFileToken): string {
		// Preview: show a representative real file, else a placeholder. Never prompt.
		const files = this.app ? getFileTokenFiles(this.app, parsed) : [];
		if (files.length > 0) return `${FILE_PICK_PREFIX}${files[0].path}`;
		return `${FILE_CUSTOM_PREFIX}${parsed.folderPath || "file"}`;
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false; // Preview formatter doesn't need structured YAML variable handling
	}
}
