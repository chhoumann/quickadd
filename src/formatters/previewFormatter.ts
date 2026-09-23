import { Formatter } from "./formatter";
import { PreviewDiagnostics } from "./previewDiagnostics";
import { getCurrentFileLinkPreview, getCurrentFileNamePreview, getCurrentFolderPathPreview } from "./helpers/previewHelpers";
import { getFileTokenFiles } from "../utils/vaultQueries";
import { FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, type ParsedFileToken } from "../utils/fileSyntax";

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

	protected getCurrentFileName(): string | null {
		if (!this.app) return "current_filename";
		return getCurrentFileNamePreview(this.app.workspace.getActiveFile());
	}

	protected getCurrentFolderPath(): string | null {
		if (!this.app) return "current_folder";
		return getCurrentFolderPathPreview(this.app.workspace.getActiveFile());
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
