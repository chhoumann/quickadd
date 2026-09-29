import { expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { DESCRIBE_ELEMENT, POLL_OPTS, clickAt, expectNoPrompt, pressKey, typeInto, waitForElement } from "./uiHelpers";

// A one-page form taller than its dialog used to put Submit and Cancel after
// the last field, out of view until the form was scrolled to the end (#1910).
const getContext = createQuickAddE2EHarness("one-page-pinned-actions");

type Layout = {
	/** Whether the fields overflow the dialog, which the test needs to mean anything. */
	overflows: boolean;
	submitCentre: { x: number; y: number };
	/** What a click at Submit's centre would hit. */
	atSubmit: string;
	/** Whether focused Submit's ring fits inside the footer, which clips it. */
	ringFits: boolean | null;
	focused: string;
};

const layout = () => getContext().obsidian.dev.evalJson<Layout>(`(() => {
	${DESCRIBE_ELEMENT}
	const modal = document.querySelector(".onePageInputModal .modal");
	const content = modal.querySelector(".modal-content");
	const submit = Array.from(modal.querySelectorAll("button")).find((button) => button.textContent === "Submit");
	const box = submit.getBoundingClientRect();
	const x = box.left + box.width / 2;
	const y = box.top + box.height / 2;
	const hit = document.elementFromPoint(x, y);
	let ringFits = null;
	if (document.activeElement === submit) {
		const ring = Math.max(0, ...(getComputedStyle(submit).boxShadow.match(/-?[\\d.]+px/g) ?? []).map(parseFloat));
		const footer = submit.closest(".qa-modal-footer");
		const clip = footer.getBoundingClientRect();
		const style = getComputedStyle(footer);
		ringFits = ring > 0
			&& box.top - ring >= clip.top + parseFloat(style.borderTopWidth)
			&& box.bottom + ring <= clip.bottom - parseFloat(style.borderBottomWidth)
			&& box.left - ring >= clip.left
			&& box.right + ring <= clip.right;
	}
	return {
		overflows: content.scrollHeight > content.clientHeight || modal.scrollHeight > modal.clientHeight,
		submitCentre: { x, y },
		atSubmit: submit.contains(hit) ? "Submit" : describe(hit),
		ringFits,
		focused: describe(document.activeElement),
	};
})()`);

it.each(["desktop", "is-phone"])("keeps Submit in view on a form taller than the dialog under %s host styles", async (deviceClass) => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => {
			window.__qaPinnedOriginalClasses = document.body.className;
			if (${JSON.stringify(deviceClass)} === "is-phone") {
				document.body.classList.remove("is-tablet");
				document.body.classList.add("is-mobile", "is-phone");
			}
			window.__qaPinnedResult = null;
			const inputs = Array.from({ length: 19 }, (_, i) => ({ id: "field" + i, label: "Field " + i, type: "text" }));
			inputs.push({ id: "notes", label: "Notes", type: "textarea" });
			void app.plugins.plugins.quickadd.api.requestInputs(inputs)
				.then((value) => window.__qaPinnedResult = value)
				.catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".onePageInputModal textarea");

		const opened = await layout();
		expect(opened.overflows).toBe(true);
		expect(opened.atSubmit).toBe("Submit");

		// Keyboard path: from the last field, Tab lands on Submit, and the pinned
		// footer doesn't clip its focus ring.
		await typeInto(obsidian, ".onePageInputModal textarea", "Pinned");
		await pressKey(obsidian, "Tab");
		const focused = await layout();
		expect(focused.focused).toBe('button.mod-cta "Submit"');
		expect(focused.ringFits).toBe(true);

		await clickAt(obsidian, opened.submitCentre.x, opened.submitCentre.y);
		await expectNoPrompt(obsidian);
		await expect.poll(() => obsidian.dev.evalJson<string | null>(
			"window.__qaPinnedResult?.notes ?? null",
		), POLL_OPTS).toBe("Pinned");
	} finally {
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll(".onePageInputModal button")].find((e) => e.textContent === "Cancel")?.click();
			if (window.__qaPinnedOriginalClasses !== undefined) document.body.className = window.__qaPinnedOriginalClasses;
			delete window.__qaPinnedOriginalClasses;
			delete window.__qaPinnedResult;
			return true;
		})()`);
	}
});
