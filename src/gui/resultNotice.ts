import { Notice, TFile, type App } from "obsidian";
import { openChoiceFile } from "../engine/choiceFileActions";
import type { ChoiceEffect, NoteWrite } from "../types/ChoiceOutcome";
import { processNote, readNote, toLF } from "../utils/noteContent";

const RESULT_NOTICE_DURATION = 8000;

export const UNDONE = "Undone";
export const CHANGED_SINCE = "Changed since, opened instead";

const VERBS: Record<ChoiceEffect, string> = {
	created: "created",
	changed: "added to",
	unchanged: "nothing to add to",
};

export function resultNoticeText(choiceName: string, effect: ChoiceEffect, file: TFile): string {
	return `${choiceName}: ${VERBS[effect]} '${file.basename}'`;
}

/** What a run did and where, with Open and, when the run wrote, Undo. */
export function showResultNotice(app: App, choiceName: string, result: {
	file: TFile;
	effect: ChoiceEffect;
	write?: NoteWrite;
}): Notice {
	const notice = new Notice(resultNoticeText(choiceName, result.effect, result.file), RESULT_NOTICE_DURATION);
	const actions = notice.messageEl.createDiv({ cls: "qa-result-notice-actions" });
	actions.createEl("button", { text: "Open" }).addEventListener("click", () => {
		void openResultFile(app, result.file);
	});
	const { write } = result;
	if (write) {
		actions.createEl("button", { text: "Undo" }).addEventListener("click", (event) => {
			// Clicking a notice hides it; this one stays to say what Undo did.
			event.stopPropagation();
			actions.remove();
			void undoWrite(app, write).then((message) => notice.setMessage(message));
		});
	}
	return notice;
}

/**
 * Puts the note back the way it was before the run, unless it changed since:
 * then nothing is undone and the note is opened so the user can look.
 */
export async function undoWrite(app: App, write: NoteWrite): Promise<string> {
	const file = app.vault.getAbstractFileByPath(write.path);
	if (!(file instanceof TFile)) return `'${write.path}' no longer exists`;
	const { before } = write;
	let undone = false;
	if (before === null) {
		if (sameText(await readNote(app, file), write.after)) {
			await app.fileManager.trashFile(file);
			undone = true;
		}
	} else {
		await processNote(app, file, (current) => {
			if (!sameText(current, write.after)) return current;
			undone = true;
			return before;
		});
	}
	if (undone) return UNDONE;
	await openResultFile(app, file);
	return CHANGED_SINCE;
}

function sameText(a: string, b: string): boolean {
	return toLF(a) === toLF(b);
}

function openResultFile(app: App, file: TFile): Promise<boolean> {
	return openChoiceFile({ app, file, opening: { location: "reuse" }, originLeaf: null });
}
