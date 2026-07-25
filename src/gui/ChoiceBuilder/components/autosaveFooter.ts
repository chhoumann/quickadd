import type { Modal } from "obsidian";

/**
 * Pin an autosave footer to the bottom of a builder modal: a quiet statement
 * that edits persist, plus a Done button that just closes.
 *
 * The builders save on close by ANY route — the X, Escape, a click outside —
 * because the caller persists whatever the modal resolves with (see
 * ChoiceView.handleConfigureChoice). Nothing in the UI said so, and the modal had
 * no Save/Done/Cancel at all, so a user who had just spent minutes configuring a
 * capture had no way to know whether closing would keep or discard the work
 * (#1545). The footer states the contract where it is needed — before the close —
 * and gives the completion affordance the modal never had.
 *
 * Appended to `modalEl` as a sibling of `modal-content` rather than into the
 * content itself, so it stays pinned while the settings scroll (the doubt is not
 * confined to the bottom of a long form) and so a builder that rebuilds its
 * content cannot drop it — MacroBuilder.reload() empties contentEl. Idempotent
 * for the same reason.
 *
 * @param subject What the modal edits, e.g. "choice" or "macro".
 */
export function addAutosaveFooter(modal: Modal, subject: string): void {
	modal.containerEl.addClass("qa-choice-builder");
	if (modal.modalEl.querySelector(".qa-builder-footer")) return;

	// Plain DOM rather than Obsidian's createDiv/createSpan helpers, which the
	// vitest environment does not implement.
	const doc = modal.modalEl.ownerDocument;
	const footer = doc.createElement("div");
	footer.className = "qa-builder-footer";

	const note = doc.createElement("span");
	note.className = "qa-builder-footer-note";
	note.textContent = `Changes to this ${subject} are saved automatically`;
	footer.appendChild(note);

	const done = doc.createElement("button");
	done.type = "button";
	done.className = "mod-cta";
	done.textContent = "Done";
	done.addEventListener("click", () => modal.close());
	footer.appendChild(done);

	modal.modalEl.appendChild(footer);
}
