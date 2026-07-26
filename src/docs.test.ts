import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./logger/logManager", () => ({ log: { logError: vi.fn() } }));

import { log } from "./logger/logManager";
import { createDocsLink, DOCS_URLS, openDocsUrl } from "./docs";

describe("createDocsLink", () => {
	it("opens externally without handing the docs site a window reference", () => {
		const parent = document.createElement("div");

		const link = createDocsLink(parent, DOCS_URLS.gettingStarted, "Learn more");

		expect(link.getAttribute("target")).toBe("_blank");
		// noopener is the security-relevant half; noreferrer keeps the vault's
		// local page out of the referrer.
		expect(link.getAttribute("rel")).toBe("noopener noreferrer");
		expect(link.getAttribute("href")).toBe(DOCS_URLS.gettingStarted);
		expect(link.textContent).toBe("Learn more");
		expect(parent.contains(link)).toBe(true);
	});

	it("builds the anchor from the parent's document so popouts work", () => {
		const popout = document.implementation.createHTMLDocument("popout");
		const parent = popout.createElement("div");

		const link = createDocsLink(parent, DOCS_URLS.packages, "Learn more");

		expect(link.ownerDocument).toBe(popout);
	});

	it("accepts a fragment parent (settings descriptions are built detached)", () => {
		const fragment = document.createDocumentFragment();

		createDocsLink(fragment, DOCS_URLS.onePageInputs, "Learn more");

		expect(fragment.querySelector("a")?.getAttribute("href")).toBe(
			DOCS_URLS.onePageInputs,
		);
	});
});

describe("openDocsUrl", () => {
	afterEach(() => vi.restoreAllMocks());

	it("opens from the owner's window so a popout does not target the main one", () => {
		const open = vi.fn();
		const owner = document.createElement("div");
		// jsdom has no second window to borrow, so stand one in. Restored by hand:
		// vi.restoreAllMocks() does not undo defineProperty, and leaving the real
		// document.defaultView shadowed would poison every later test in the run.
		const original = Object.getOwnPropertyDescriptor(
			owner.ownerDocument,
			"defaultView",
		);
		Object.defineProperty(owner.ownerDocument, "defaultView", {
			configurable: true,
			value: { open },
		});

		try {
			openDocsUrl(DOCS_URLS.gettingStarted, owner);
		} finally {
			if (original) {
				Object.defineProperty(owner.ownerDocument, "defaultView", original);
			} else {
				Reflect.deleteProperty(owner.ownerDocument, "defaultView");
			}
		}

		expect(open).toHaveBeenCalledWith(
			DOCS_URLS.gettingStarted,
			"_blank",
			"noopener,noreferrer",
		);
		// The real window is back, so a later openDocsUrl() targets it again.
		expect(document.defaultView).toBe(window);
	});

	// A failure to open the docs must never take down the click handler it was
	// called from.
	it("logs instead of throwing when the window refuses", () => {
		vi.spyOn(window, "open").mockImplementation(() => {
			throw new Error("blocked");
		});

		expect(() => openDocsUrl(DOCS_URLS.gettingStarted)).not.toThrow();
		expect(log.logError).toHaveBeenCalledWith(
			expect.stringContaining("Failed to open documentation"),
		);
	});
});

describe("DOCS_URLS", () => {
	// The docs site (Astro Starlight) serves the trailing-slash form; omitting it
	// costs a redirect hop on every click.
	it("uses the canonical trailing-slash form", () => {
		for (const url of Object.values(DOCS_URLS)) {
			const path = new URL(url).pathname;
			expect(path.endsWith("/")).toBe(true);
		}
	});
});
