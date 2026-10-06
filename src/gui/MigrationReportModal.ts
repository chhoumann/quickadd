import type { App } from "obsidian";
import { ButtonComponent, Modal, Setting } from "obsidian";
import { log } from "src/logger/logManager";
import type QuickAdd from "src/main";
import { settingsStore } from "src/settingsStore";
import type { MigrationNote, MigrationReport } from "src/v3/migrate";
import { buildReport } from "src/v3/migrate";

const NOTE_LABELS: Record<MigrationNote["kind"], string> = {
	inlined: "Nested choice became steps",
	keptNested: "Kept as a nested choice",
	writePositionConflict: "Several write positions were on",
	folderModeConflict: "Several folder options were on",
	dropped: "Dropped",
	templaterRerun: "Runs Templater twice",
	wholeFileTemplater: "Templater became a step",
	unknownCommand: "Kept a step this version cannot read",
	unknownKey: "Dropped unknown settings",
	danglingRunAction: "Runs a choice that does not exist",
};

/** What the QuickAdd 3 migration did, action by action. */
export class MigrationReportModal extends Modal {
	constructor(
		app: App,
		private report: MigrationReport,
		private snapshot: string,
		private onDismiss: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		// The package dialogs' layout: the title and intro stay put while the
		// entries scroll, and Done stays at the bottom.
		this.modalEl.addClass("quickAddModal", "qa-package-modal", "qa-migration-report-modal");
		this.setTitle("Migrated to QuickAdd 3");
		const dialog = this.contentEl.createDiv({ cls: "qa-package-dialog" });
		dialog.createEl("p", {
			cls: "qa-migration-report-intro",
			text: `Your previous settings are kept in ${this.snapshot}. Restore them from QuickAdd's Advanced settings.`,
		});
		const entries = dialog.createDiv({ cls: "qa-package-body qa-migration-report-entries" });

		if (this.report.duplicateNames.length > 0) {
			new Setting(entries)
				.setName("Names used more than once")
				.setDesc(this.report.duplicateNames.join(", "));
		}

		for (const row of this.report.rows) {
			const notes = this.report.notes.filter((note) => note.nodeId === row.id);
			if (row.kind === "folder" && notes.length === 0) continue;
			const desc = createFragment();
			if (row.summary) desc.createDiv({ text: row.summary });
			if (notes.length > 0) {
				const list = desc.createEl("ul");
				for (const note of notes) list.createEl("li", { text: `${NOTE_LABELS[note.kind]}: ${note.detail}` });
			}
			new Setting(entries).setName(row.path).setDesc(desc);
		}

		new ButtonComponent(dialog.createDiv({ cls: "modal-button-container" }))
			.setButtonText("Done")
			.setCta()
			.onClick(() => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
		this.onDismiss();
	}
}

/**
 * Shows the migration report until it is closed once. The report is rebuilt
 * from the data.json copy taken before migrating, so nothing but the
 * dismissal is stored.
 */
export async function showMigrationReportOnce(plugin: QuickAdd): Promise<void> {
	const migration = plugin.settings.v3Migration;
	if (!migration || migration.reportDismissedIn) return;
	const dismiss = () =>
		settingsStore.setState((state) => ({
			v3Migration: state.v3Migration && { ...state.v3Migration, reportDismissedIn: plugin.manifest.version },
		}));

	let report: MigrationReport | null = null;
	if (migration.snapshot) {
		try {
			const data = JSON.parse(await plugin.app.vault.adapter.read(`${plugin.manifest.dir}/${migration.snapshot}`)) as {
				choices?: unknown;
			};
			report = buildReport({ choices: data?.choices });
		} catch (error) {
			log.logWarning(`QuickAdd could not build its migration report: ${String(error)}`);
		}
	}
	// Nothing to report on a vault that had no choices.
	if (!migration.snapshot || !report || report.rows.length === 0) {
		dismiss();
		return;
	}
	new MigrationReportModal(plugin.app, report, migration.snapshot, dismiss).open();
}
