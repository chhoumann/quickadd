import type { App } from "obsidian";
import { requestUrl } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// vi.mock is hoisted above imports by vitest, so UpdateModal binds to the mocked
// obsidian exports below. The element helpers are installed before any test runs.
import { UpdateModal } from "./UpdateModal";

// The UpdateModal's whole reason to exist (#635) is a self-owned exit: on iPhone the
// system close button (the X) sits in the status-bar/Dynamic-Island safe-area zone and
// can be untappable, and this modal has no other dismiss on mobile (no Esc, no backdrop).
// These tests pin that escape hatch so it can't silently regress. Isolated in its own
// file with a local obsidian mock so it doesn't disturb the renderVideoAttachments suite.

vi.mock("obsidian", () => {
	class Modal {
		app: App;
		containerEl: HTMLElement;
		contentEl: HTMLElement;

		constructor(app: App) {
			this.app = app;
			this.containerEl = document.createElement("div");
			this.contentEl = document.createElement("div");
			this.containerEl.appendChild(this.contentEl);
			document.body.appendChild(this.containerEl);
		}

		open() {
			this.onOpen();
		}

		close() {
			this.onClose();
		}

		onOpen() {}
		onClose() {}
	}

	class Component {
		load() {}
		unload() {}
	}

	class ButtonComponent {
		buttonEl: HTMLButtonElement;

		constructor(containerEl: HTMLElement) {
			this.buttonEl = document.createElement("button");
			containerEl.appendChild(this.buttonEl);
		}

		setButtonText(text: string): this {
			this.buttonEl.textContent = text;
			return this;
		}

		setCta(): this {
			this.buttonEl.classList.add("mod-cta");
			return this;
		}

		onClick(cb: () => void): this {
			this.buttonEl.addEventListener("click", cb);
			return this;
		}
	}

	const MarkdownRenderer = { render: vi.fn(async () => {}) };
	const requestUrl = vi.fn();

	return { Modal, Component, ButtonComponent, MarkdownRenderer, requestUrl };
});

function installObsidianElementHelpers(): void {
	const proto = HTMLElement.prototype as unknown as {
		addClass?: (this: HTMLElement, ...classes: string[]) => HTMLElement;
		createDiv?: (
			this: HTMLElement,
			cls?: string | { cls?: string },
		) => HTMLDivElement;
		createEl?: (
			this: HTMLElement,
			tag: string,
			options?: { text?: string },
		) => HTMLElement;
		empty?: (this: HTMLElement) => void;
	};

	proto.addClass ??= function (...classes: string[]) {
		this.classList.add(...classes);
		return this;
	};

	proto.createDiv ??= function (cls?: string | { cls?: string }) {
		const div = document.createElement("div");
		const className = typeof cls === "string" ? cls : cls?.cls;
		if (className) div.className = className;
		this.appendChild(div);
		return div;
	};

	proto.createEl ??= function (tag: string, options?: { text?: string }) {
		const el = document.createElement(tag);
		if (options?.text) el.textContent = options.text;
		this.appendChild(el);
		return el;
	};

	proto.empty ??= function () {
		this.replaceChildren();
	};
}

installObsidianElementHelpers();

const app = {
	vault: { getRoot: () => ({ path: "/" }) },
} as unknown as App;

/** Two releases so getReleaseNotesAfter("1.0.0") returns one note (the 1.2.0 release). */
function mockReleasesFetch(): void {
	vi.mocked(requestUrl).mockResolvedValue({
		status: 200,
		json: [
			{ tag_name: "1.2.0", body: "notes", draft: false, prerelease: false },
			{ tag_name: "1.0.0", body: "", draft: false, prerelease: false },
		],
	} as unknown as ReturnType<typeof requestUrl> extends Promise<infer R>
		? R
		: never);
}

/** Let the constructor's requestUrl → getReleaseNotesAfter → .then chain settle. */
function flushAsync(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function footerButtons(modal: { contentEl: HTMLElement }): HTMLButtonElement[] {
	return Array.from(
		modal.contentEl.querySelectorAll<HTMLButtonElement>(
			".quickadd-update-modal-footer button",
		),
	);
}

describe("UpdateModal dismiss affordance (#635)", () => {
	beforeEach(() => {
		document.body.replaceChildren();
		vi.mocked(requestUrl).mockReset();
		// Default: a fetch that never settles, so onOpen-only tests stay synchronous.
		vi.mocked(requestUrl).mockReturnValue(
			new Promise(() => {}) as ReturnType<typeof requestUrl>,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders exactly one reachable 'Done' exit while fetching", () => {
		const modal = new UpdateModal(app, "0.0.1");
		modal.onOpen();

		const buttons = footerButtons(modal);
		expect(buttons).toHaveLength(1);
		expect(buttons[0].textContent).toBe("Done");
	});

	it("closes the modal when the 'Done' button is clicked", () => {
		const modal = new UpdateModal(app, "0.0.1");
		const closeSpy = vi.spyOn(modal, "close");
		modal.onOpen();

		footerButtons(modal)[0].click();

		expect(closeSpy).toHaveBeenCalledTimes(1);
	});

	it("renders the notes and a single Done exit once the fetch resolves", async () => {
		mockReleasesFetch();

		const modal = new UpdateModal(app, "1.0.0");
		modal.onOpen();
		await flushAsync();

		expect(modal.contentEl.querySelector(".quickadd-update-modal")).not.toBeNull();
		expect(footerButtons(modal)).toHaveLength(1);
	});

	it("does not render notes if the fetch resolves after the modal is closed", async () => {
		mockReleasesFetch();

		const modal = new UpdateModal(app, "1.0.0");
		const displaySpy = vi.spyOn(
			modal as unknown as { display: () => void },
			"display",
		);
		modal.onOpen();
		modal.close(); // user dismisses before the fetch resolves

		await flushAsync();

		expect(displaySpy).not.toHaveBeenCalled();
		expect(modal.contentEl.querySelector(".quickadd-update-modal")).toBeNull();
	});
});
