import type { ChoiceType } from "./choiceType";

export default interface IChoice {
	name: string;
	id: string;
	type: ChoiceType;
	command: boolean;
	/** Per-choice override for one-page flow. undefined = follow global setting */
	onePageInput?: "always" | "never" | undefined;
	/**
	 * Optional per-choice icon id (lucide/Obsidian) for the registered command,
	 * shown on the mobile toolbar and in the command palette. undefined = use the
	 * per-type default (see resolveChoiceIcon). Never persisted as a default.
	 */
	icon?: string;
	/**
	 * When true, this choice is added to Obsidian's mobile "share to" in-app menu
	 * (the menu shown after sharing content into Obsidian). The shared text is bound
	 * to the reserved `value` variable, so a bare `{{VALUE}}` resolves to it without
	 * a prompt. Mobile-only effect — the underlying `receive-text-menu` event never
	 * fires on desktop. undefined/false = not shown. See QuickAdd.registerShareMenu.
	 */
	showInShareMenu?: boolean;
}
