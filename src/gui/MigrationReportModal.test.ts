import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { MigrationReportModal } from "./MigrationReportModal";
import type { MigrationReport } from "src/v3/migrate";

vi.mock("src/settingsStore", () => ({ settingsStore: { setState: vi.fn() } }));

function report(count: number): MigrationReport {
	return {
		rows: Array.from({ length: count }, (_, i) => ({ path: `Action ${i}`, id: `a${i}`, name: `Action ${i}`, kind: "action" as const, summary: "Adds a line" })),
		duplicateNames: ["Log"],
		notes: [],
	};
}

describe("MigrationReportModal", () => {
	it("scrolls only the entries, between a fixed intro and a fixed Done", () => {
		const modal = new MigrationReportModal({} as App, report(30), "data.v2.json", () => {});
		modal.open();

		// The package dialogs' rules pin everything but `.qa-package-body`.
		expect(modal.modalEl.classList.contains("qa-package-modal")).toBe(true);
		const dialog = modal.contentEl.querySelector(":scope > .qa-package-dialog");
		const parts = Array.from(dialog?.children ?? [], (el) => el.className);
		expect(parts).toEqual(["qa-migration-report-intro", "qa-package-body qa-migration-report-entries", "modal-button-container"]);
		const body = dialog?.querySelector(".qa-package-body");
		expect(body?.textContent).toContain("Names used more than once");
		expect(body?.textContent).toContain("Action 29");
		expect(dialog?.querySelector(".modal-button-container")?.textContent).toBe("Done");
		modal.close();
	});
});
