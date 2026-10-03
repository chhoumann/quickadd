import { type App, Notice, SettingGroup, SettingPage } from "obsidian";
import { openSettingPage, retitleSettingPage } from "../../utils/openPluginSettings";

/**
 * A builder shown as a page of Settings → QuickAdd, pushed onto Obsidian's
 * settings page stack like the AI Assistant's provider pages. Obsidian draws
 * the title bar and the back button (the header on phones), and Esc goes
 * back. A builder opened from another builder (a macro's Choice step, a
 * Conditional's branches) is pushed over it, so back returns to it.
 *
 * Leaving the page saves: going back, Esc, closing settings and switching tabs
 * all call `hide()`, which hands the result to `onSave`. Closing settings
 * hides the pages top first, so a nested builder hands its result to the one
 * below before that one hands on its own. `save()` hands it on without leaving
 * (see saveBuilderPages), so `onSave` must be safe to call more than once.
 */
export abstract class BuilderPage<T> extends SettingPage {
	private rendered = false;
	private opener: Opener | null = null;

	protected constructor(
		protected readonly app: App,
		title: string,
		private readonly onSave: (result: T) => void,
	) {
		super();
		this.title = title;
		// The builder forms are styled under .quickAddModal, which they share
		// with QuickAdd's dialogs, so they look the same here.
		this.rootEl.addClass("quickAddModal", "qa-builder-page");
	}

	/** Open over the settings page that is showing. False if Obsidian can't. */
	open(): boolean {
		this.opener = openerOf(activeDocument.activeElement);
		if (openSettingPage(this.app, this)) return true;
		new Notice(`QuickAdd: Couldn't open the settings for “${this.title}”.`);
		return false;
	}

	/**
	 * Obsidian calls this when the page opens and again when a page pushed
	 * over it closes. Render once, so coming back keeps the page as it was:
	 * its scroll position, and what the page over it wrote into it.
	 */
	display(): void {
		if (this.rendered) return;
		this.rendered = true;
		this.render(this.containerEl);
	}

	hide(): void {
		// Unmount first: a form commits what is still pending as it unmounts,
		// such as a folder typed without Add (#1993).
		this.destroy();
		super.hide();
		this.onSave(this.result());
		if (this.opener) focusOpenerAfterBack(this.opener);
	}

	/** Save what the page holds now, and stay open. */
	save(): void {
		this.onSave(this.result());
	}

	protected abstract render(containerEl: HTMLElement): void;

	/** What the page hands to `onSave`. */
	protected abstract result(): T;

	/** Tear down what `render` mounted. */
	protected destroy(): void {}

	/**
	 * A "Name" field in a new group, retitling the page as you type. An empty
	 * name keeps `fallback` as the title; the result keeps it as the name.
	 * Returns the group, for settings that belong with the name.
	 */
	protected addNameSetting(
		containerEl: HTMLElement,
		name: string,
		fallback: string,
		onChange: (name: string) => void,
	): SettingGroup {
		return new SettingGroup(containerEl).addSetting((setting) => {
			setting.setName("Name").addText((text) => {
				text.setValue(name).onChange((value) => {
					onChange(value);
					retitleSettingPage(this.app, this, value.trim() || fallback);
				});
			});
		});
	}
}

/** The control a page was opened from. */
interface Opener {
	el: HTMLElement;
	/** To find a replaced control again; not for a choice's own (names repeat). */
	label: string | null;
	/** Obsidian's settings content, which it focuses when a page is left. */
	content: Element | null;
	focusVisible: boolean;
}

function openerOf(el: Element | null): Opener | null {
	if (!el?.instanceOf(HTMLElement)) return null;
	return {
		el,
		label: el.closest("[data-choice-id]") ? null : el.getAttribute("aria-label"),
		content: el.closest(".vertical-tab-content-container"),
		focusVisible: el.matches(":focus-visible"),
	};
}

/**
 * Back from a page focuses the settings content, or the row the page was
 * opened from, which for a choice is the whole choice list. Give focus to the
 * control that opened the page instead (the gear, New choice, a macro's
 * button), as a dialog did, so a keyboard user carries on from there. Only
 * where Obsidian put focus on back: closing settings, switching tabs and
 * search results leave it alone.
 */
function focusOpenerAfterBack({ el, label, content, focusVisible }: Opener): void {
	// Obsidian focuses what is below after this page's hide() returns; with
	// Escape, not before this task's microtasks have run, so wait a task.
	window.setTimeout(() => {
		// Adding the first choice swaps the empty list's New choice for the
		// list's own, so look for the same control by its label.
		const target = el.isConnected
			? el
			: label
				? content?.querySelector<HTMLElement>(`[aria-label="${CSS.escape(label)}"]`)
				: null;
		const active = el.ownerDocument.activeElement;
		const leftWithBack =
			active !== null &&
			(active === content || (active.matches(".setting-item") && !!target && active.contains(target)));
		if (target && leftWithBack) target.focus({ focusVisible });
	});
}

/** The name to save from a Name field: trimmed, or `fallback` when empty. */
export function nameOrFallback(name: string, fallback: string): string {
	return name.trim() || fallback;
}

interface PageStack {
	pageStack?: { page: SettingPage }[];
	clearPageStack?: () => void;
}

function pageStackOf(app: App): PageStack | undefined {
	return (app as unknown as { setting?: PageStack }).setting;
}

/**
 * Save the open builder pages, top first, and leave them open. For when the
 * app goes to the background, where a phone may kill it without warning: a
 * builder otherwise holds its edits until it is left.
 */
export function saveBuilderPages(app: App): void {
	const pages = pageStackOf(app)?.pageStack ?? [];
	for (const { page } of [...pages].reverse()) {
		if (page instanceof BuilderPage) page.save();
	}
}

/**
 * Leave the open settings pages, top first, so open builders save (see
 * `hide()`). For when QuickAdd unloads or the app quits with a builder open:
 * Obsidian leaves settings open then. Leaving rather than saving in place
 * means no page saves into an unloaded plugin later.
 */
export function leaveBuilderPages(app: App): void {
	const setting = pageStackOf(app);
	if (setting?.pageStack?.some((entry) => entry.page instanceof BuilderPage)) {
		setting.clearPageStack?.();
	}
}
