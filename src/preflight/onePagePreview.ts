import type { PreviewDiagnostic } from "src/formatters/previewDiagnostics";

export type PreviewRow = {
	label: string;
	text: string;
	diagnostics: readonly PreviewDiagnostic[];
};


export function renderOnePagePreview(container: HTMLElement, rows: readonly PreviewRow[]): void {
	container.empty();
	container.toggleClass("qa-hidden", rows.length === 0);

	for (const row of rows) {
		const errors = row.diagnostics.filter((d) => d.severity === "error");
		const unresolved = errors.some((d) => d.kind !== "path");
		const label = unresolved
			? "Unresolved"
			: errors.length > 0
				? "Won't be created"
				: row.label;

		const rowEl = container.createDiv({
			cls: "qa-onepage-preview-row",
		});
		rowEl.createEl("div", { text: `${label}:`, cls: "qa-preview-key" });
		const valueEl = rowEl.createEl("div", {
			text: row.text,
			cls: "qa-preview-val",
		});
		valueEl.setAttribute("title", row.text);

		for (const diagnostic of row.diagnostics) {
			const issueEl = container.createDiv({
				cls: "qa-preview-issue",
			});
			issueEl.toggleClass(
				"qa-preview-issue--error",
				diagnostic.severity === "error",
			);
			issueEl.createSpan({
				cls: "qa-visually-hidden",
				text: diagnostic.severity === "error" ? "Error: " : "Warning: ",
			});
			issueEl.appendText(diagnostic.message);
			issueEl.setAttribute("title", diagnostic.message);
		}
	}
}
