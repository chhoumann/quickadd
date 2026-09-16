import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import GenericWideInputPrompt from "./GenericWideInputPrompt";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { UserCancelError } from "../../errors/UserCancelError";

import { makeFakeApp } from "../../../tests/helpers/prompts/app";
import "../../../tests/helpers/prompts/dom";

/**
 * Drives the REAL wide prompt through its PUBLIC contract: open it via the static
 * Prompt(), type into the rendered textarea, fire the documented ctrl+Enter submit
 * gesture, and resolve the value the formatter / quickAddApi.wideInputPrompt()
 * consumer receives. `typed` is the literal text the user keys in (so "C:\\temp" in
 * source is the on-screen `C:\temp`).
 */
function submitWideValue(typed: string): Promise<string> {
	const waitForClose = GenericWideInputPrompt.Prompt(fakeApp as never, "Header");
	const textarea = document.querySelector(
		"textarea.wideInputPromptInputEl",
	) as HTMLTextAreaElement;
	textarea.value = typed;
	textarea.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
	);
	return waitForClose;
}

let fakeApp: ReturnType<typeof makeFakeApp>;

beforeEach(() => {
	fakeApp = makeFakeApp();
	setQuickAddInstance({
		app: fakeApp,
		registerEvent: () => {},
	} as unknown as QuickAdd);
});

afterEach(() => {
	for (const el of Array.from(document.body.children)) el.remove();
});

describe("GenericWideInputPrompt returns the user's input verbatim", () => {

	it("preserves a literal backslash-n in code (issue #799)", async () => {
		// #799's intent — keep a typed `\n` from corrupting code — is met without
		// doubling: a typed `\n` stays literal (not "\\n", not a real newline) because
		// the substituted value is never linebreak-expanded downstream.
		const typed = 'let s = "aa\\nbb";';
		await expect(submitWideValue(typed)).resolves.toBe(typed);
	});

	it("is an identity transform like the single-line prompt (Windows path + real newline)", async () => {
		// Backslashes survive un-doubled ("C:\x", not "C:\\x") and a real newline
		// passes through, so the same {{VALUE}} token stores identical bytes whether
		// the user is on the wide or single-line prompt.
		await expect(submitWideValue("C:\\temp\nC:\\x")).resolves.toBe(
			"C:\\temp\nC:\\x",
		);
	});
});

for (const { name, Prompt, selector } of [
	{ name: "", Prompt: GenericWideInputPrompt, selector: "textarea.wideInputPromptInputEl" },
	{ name: "single ", Prompt: GenericInputPrompt, selector: ".qaInputPrompt input" },
]) {
	describe(`${name}image paste submit/cancel races (issue #1484)`, () => {

		function makePasteApp() {
			let resolveCreate: () => void = () => {};
			const created = new Promise<{ path: string }>((resolve) => {
				resolveCreate = () => resolve({ path: "img.png" });
			});
			let createCalled = false;
			const app = {
				...makeFakeApp(),
				fileManager: {
					getNewFileParent: () => ({ path: "" }),
					getAvailablePathForAttachment: async () => "img.png",
					generateMarkdownLink: (file: { path: string }) => `![[${file.path}]]`,
				},
				vault: {
					...makeFakeApp().vault,
					createBinary: () => {
						createCalled = true;
						return created;
					},
				},
			};
			return {
				app,
				resolveCreate,
				createStarted: () => createCalled,
			};
		}

		function openPromptWithPaste(app: unknown) {
			const waitForClose = Prompt.Prompt(
				app as never,
				"Header",
				undefined,
				undefined,
				undefined,
				{ imagePaste: {} },
			);
			const textarea = document.querySelector(
				selector,
			) as HTMLTextAreaElement | HTMLInputElement;
			return { waitForClose, textarea };
		}

		function dispatchImagePaste(textarea: HTMLTextAreaElement | HTMLInputElement) {
			const file = new File([new Uint8Array([1, 2, 3])], "img.png", {
				type: "image/png",
			});
			const clipboardData = {
				getData: () => "",
				items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
				files: [file],
			};
			const event = new Event("paste", { bubbles: true, cancelable: true });
			Object.defineProperty(event, "clipboardData", { value: clipboardData });
			textarea.dispatchEvent(event);
		}

		async function waitFor(predicate: () => boolean) {
			for (let i = 0; i < 200 && !predicate(); i++) {
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			expect(predicate()).toBe(true);
		}

		it("a ctrl+Enter during the save defers and submits WITH the embed link", async () => {
			const { app, resolveCreate, createStarted } = makePasteApp();
			const { waitForClose, textarea } = openPromptWithPaste(app);

			dispatchImagePaste(textarea);
			await waitFor(createStarted);
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
			);
			resolveCreate();

			await expect(waitForClose).resolves.toBe("![[img.png]]");
		});

		it("cancel during an in-flight save never fires the deferred submit", async () => {
			const { app, resolveCreate, createStarted } = makePasteApp();
			const { waitForClose, textarea } = openPromptWithPaste(app);

			dispatchImagePaste(textarea);
			await waitFor(createStarted);
			// Enter queues a deferred submit behind the pending save...
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
			);
			// ...then the user cancels before the save lands.
			const cancelButton = Array.from(
				document.querySelectorAll("button"),
			).find((button) => button.textContent === "Cancel") as HTMLButtonElement;
			cancelButton.click();

			await expect(waitForClose).rejects.toBeInstanceOf(UserCancelError);

			// The save landing later must NOT resurrect the submit on the closed
			// modal (deferred submit is guarded by didClose).
			resolveCreate();
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
	});
}
