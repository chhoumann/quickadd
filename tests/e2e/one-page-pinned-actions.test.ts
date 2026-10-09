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
	/** Distances from the modal's inner edges to the rows and to the footer buttons. */
	insets: { fieldsLeft: number; fieldsRight: number; buttonsLeft: number; buttonsRight: number };
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
	const outer = modal.getBoundingClientRect();
	const border = parseFloat(getComputedStyle(modal).borderLeftWidth);
	const rows = Array.from(content.querySelectorAll(".setting-item")).map((row) => row.getBoundingClientRect());
	const buttons = Array.from(modal.querySelectorAll(".qa-modal-footer button")).map((button) => button.getBoundingClientRect());
	const inset = (rects) => ({
		left: Math.min(...rects.map((rect) => rect.left)) - outer.left - border,
		right: outer.right - border - Math.max(...rects.map((rect) => rect.right)),
	});
	const fields = inset(rows);
	const actions = inset(buttons);
	return {
		insets: { fieldsLeft: fields.left, fieldsRight: fields.right, buttonsLeft: actions.left, buttonsRight: actions.right },
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
		// The footer reserves the scrollbar's gutter through a scroll-driven
		// animation, which applies a couple of frames after the form opens.
		await expect.poll(async () => {
			const { insets } = await layout();
			return Math.abs(insets.buttonsRight - insets.fieldsRight);
		}, POLL_OPTS).toBeLessThan(0.5);

		const opened = await layout();
		expect(opened.overflows).toBe(true);
		expect(opened.atSubmit).toBe("Submit");
		// The scrollbar narrows the fields; the buttons line up with them anyway.
		expect(opened.insets.buttonsRight).toBeCloseTo(opened.insets.fieldsRight, 0);
		expect(opened.insets.buttonsLeft).toBeCloseTo(opened.insets.fieldsLeft, 0);

		// Keyboard path: from the last field, Tab lands on Submit, and the pinned
		// footer doesn't clip its focus ring.
		await typeInto(obsidian, ".onePageInputModal textarea", "Pinned");
		await pressKey(obsidian, "Tab");
		// The ring grows in over a transition; measure it at its full size.
		await obsidian.dev.evalJsonAsync(`Promise.all(document.activeElement.getAnimations().map((animation) => animation.finished)).then(() => true)`);
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

// A form that fits used to keep a scrollbar's width of blank space on its right
// only, reserved for a scrollbar it never showed.
it.each(["desktop", "is-phone"])("keeps a form that fits symmetric, and aligned once it scrolls, under %s host styles", async (deviceClass) => {
	const { obsidian } = getContext();
	try {
		await obsidian.dev.evalJson(`(() => {
			window.__qaPinnedOriginalClasses = document.body.className;
			if (${JSON.stringify(deviceClass)} === "is-phone") {
				document.body.classList.remove("is-tablet");
				document.body.classList.add("is-mobile", "is-phone");
			}
			void app.plugins.plugins.quickadd.api.requestInputs([
				{ id: "title", label: "Title", type: "text" },
				{ id: "body", label: "Body", type: "textarea", optional: true },
			]).catch(() => undefined);
			return true;
		})()`);
		await waitForElement(obsidian, ".onePageInputModal textarea");

		const short = await layout();
		expect(short.overflows).toBe(false);
		expect(short.insets.fieldsLeft).toBeGreaterThan(0);
		expect(short.insets.fieldsRight).toBeCloseTo(short.insets.fieldsLeft, 0);
		expect(short.insets.buttonsLeft).toBeCloseTo(short.insets.fieldsLeft, 0);
		expect(short.insets.buttonsRight).toBeCloseTo(short.insets.fieldsLeft, 0);

		// Growing past the dialog brings in the scrollbar; the footer follows it.
		await obsidian.dev.evalJson(`(() => {
			document.querySelector(".onePageInputModal textarea").style.height = "2000px";
			return true;
		})()`);
		await expect.poll(async () => (await layout()).overflows, POLL_OPTS).toBe(true);
		await expect.poll(async () => {
			const { insets } = await layout();
			return Math.abs(insets.buttonsRight - insets.fieldsRight) < 0.5;
		}, POLL_OPTS).toBe(true);
	} finally {
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll(".onePageInputModal button")].find((e) => e.textContent === "Cancel")?.click();
			if (window.__qaPinnedOriginalClasses !== undefined) document.body.className = window.__qaPinnedOriginalClasses;
			delete window.__qaPinnedOriginalClasses;
			return true;
		})()`);
	}
});
