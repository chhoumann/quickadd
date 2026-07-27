import { createOwnedElement, getOwnerWindow } from "./utils/activeWindow";
import { log } from "./logger/logManager";

/**
 * Canonical documentation URLs.
 *
 * QuickAdd's power surface is syntax you have to learn ({{VALUE}}, {{DATE}},
 * capture targets, one-page inputs), so the manual has to be reachable from the
 * places where a user is actually stuck (issue #1541). `manifest.json`'s
 * `helpUrl` is NOT that entry point: Obsidian 1.13 does not surface it anywhere
 * in the UI. Keep `gettingStarted` byte-identical to it all the same.
 *
 * Trailing slashes are the canonical form the docs site serves (Astro
 * Starlight); omitting one costs a redirect hop.
 */
export const DOCS_BASE_URL = "https://quickadd.obsidian.guide";

export const DOCS_URLS = {
	gettingStarted: `${DOCS_BASE_URL}/docs/`,
	formatSyntax: `${DOCS_BASE_URL}/docs/FormatSyntax/`,
	onePageInputs: `${DOCS_BASE_URL}/docs/Advanced/onePageInputs/`,
	userScripts: `${DOCS_BASE_URL}/docs/Choices/MacroChoice/#user-scripts`,
	packages: `${DOCS_BASE_URL}/docs/Choices/Packages/`,
} as const;

/**
 * Open a documentation URL in the user's browser.
 *
 * `owner` is any node in the surface the click came from, so a click inside a
 * popout window opens from THAT window rather than the main one. Prefer
 * {@link createDocsLink} wherever an anchor can be rendered; this exists for
 * the handful of programmatic entry points (icon buttons) that have no anchor.
 */
export function openDocsUrl(url: string, owner?: Node): void {
	try {
		const win = owner ? getOwnerWindow(owner) : window;
		win.open(url, "_blank", "noopener,noreferrer");
	} catch (error) {
		log.logError(`QuickAdd: Failed to open documentation (${url}): ${error}`);
	}
}

/**
 * Append a documentation link to `parent`. Built from the parent's own document
 * so it works inside popout windows, where the `document` global still points
 * at the main window.
 */
export function createDocsLink(
	parent: HTMLElement | DocumentFragment,
	url: string,
	text: string,
): HTMLAnchorElement {
	const link = createOwnedElement(parent, "a");
	link.textContent = text;
	link.href = url;
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	// Obsidian deliberately mutes links inside `.setting-item-description`
	// (--link-color: var(--text-muted)), where a docs link would read as prose.
	// See .quickadd-docs-link in styles.css for the deliberate deviation.
	link.classList.add("quickadd-docs-link");
	parent.append(link);
	return link;
}
