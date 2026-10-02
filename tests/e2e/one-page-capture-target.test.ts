import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { insertText, jsLiteral, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

// The one-page form asks for a folder capture's note in a searchable field,
// which finds notes by alias like the run's picker, instead of a dropdown of
// every note in the folder.
const getContext = createQuickAddE2EHarness("one-page-capture-target");

it("picks the one-page capture target by searching, aliases included", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const thomas = await seedVaultFile(obsidian, sandbox, "People/Thomas Anderson.md",
		"---\naliases: [Neo, The One]\n---\n");
	const classic = await seedVaultFile(obsidian, sandbox, "People/Neo Classic.md", "");

	const choice = new CaptureChoice("One-page capture target");
	choice.command = true;
	choice.captureTo = `${sandbox.path("People")}/`;
	choice.onePageInput = "always";
	choice.createFileIfItDoesntExist = { ...choice.createFileIfItDoesntExist, enabled: true };
	choice.format = { enabled: true, format: "- {{VALUE:note}}\n" };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	const read = (path: string) => obsidian.dev.evalJsonAsync<string | null>(
		`(async () => (await app.vault.adapter.exists(${jsLiteral(path)})) ? app.vault.adapter.read(${jsLiteral(path)}) : null)()`,
	);
	const field = ".qa-onepage-file-picker input";
	await obsidian.command(`quickadd:choice:${choice.id}`).run();
	await expect.poll(() => obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(${jsLiteral(field)}))`), POLL_OPTS).toBe(true);
	expect(await obsidian.dev.evalJson<number>('document.querySelectorAll(".modal-container select").length')).toBe(0);

	await typeInto(obsidian, field, "the one");
	await expect.poll(() => obsidian.dev.evalJson(`
		Array.from(document.querySelectorAll(".suggestion-container .suggestion-item"), (row) => ({
			title: row.querySelector(".qa-onepage-file-suggestion__label")?.textContent,
			note: row.querySelector(".qa-onepage-file-suggestion__path")?.textContent,
			alias: Boolean(row.querySelector('[aria-label="Alias"]')),
		}))
	`), POLL_OPTS).toEqual([{ title: "The One", note: "Thomas Anderson", alias: true }]);
	await pressKey(obsidian, "Enter");
	await expect.poll(() => obsidian.dev.evalJson<string[]>(
		'Array.from(document.querySelectorAll(".qa-onepage-file-picker__chip-label"), (chip) => chip.textContent)',
	), POLL_OPTS).toEqual(["Thomas Anderson"]);

	await typeInto(obsidian, ".modal-container input[type=text]:not(.qa-onepage-file-picker__input)", "from the form");
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const submit = Array.from(document.querySelectorAll(".modal-container button")).find((b) => b.textContent.trim() === "Submit");
		submit?.click();
		return Boolean(submit);
	})()`)).toBe(true);
	await expect.poll(() => read(thomas), POLL_OPTS).toContain("- from the form");
	expect(await read(classic)).toBe("");
});

// With "Create file if it doesn't exist", a name typed in the field is a new
// note, as in the run's picker, for folder, tag and property scopes. A note's
// name or alias still picks the note, and outside a folder a name no new note
// may take is not offered.
it("creates the note named in the one-page capture target field", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const crew = "---\ntags: [qa-crew]\nqaRole: crew\naliases: [Neo]\n---\n";
	await seedVaultFile(obsidian, sandbox, "Crew/Thomas Anderson.md", crew);
	await seedVaultFile(obsidian, sandbox, "Crew/Agent Smith.md", "---\ntitle: Program\ntags: [qa-crew]\nqaRole: crew\n---\n");
	// Listed first, so it is the field's default and the others stay searchable.
	await seedVaultFile(obsidian, sandbox, "Crew/Apoc.md", "---\ntags: [qa-crew]\nqaRole: crew\n---\n");
	// Outside every scope below.
	await seedVaultFile(obsidian, sandbox, "Elsewhere/Oracle.md", "");

	const choiceFor = (name: string, captureTo: string) => {
		const choice = new CaptureChoice(name);
		choice.command = true;
		choice.captureTo = captureTo;
		choice.onePageInput = "always";
		choice.createFileIfItDoesntExist = { ...choice.createFileIfItDoesntExist, enabled: true };
		choice.format = { enabled: true, format: "- {{VALUE:note}}\n" };
		return choice;
	};
	const scopes = [
		// A folder capture creates its new note in the folder, so another
		// folder's note name is free there, as in the run's picker.
		{ choice: choiceFor("Folder", `${sandbox.path("Crew")}/`), typed: "Niobe", created: sandbox.path("Crew/Niobe.md"), oracle: ["Create new note: oracle"] },
		{ choice: choiceFor("Tag", "#qa-crew"), typed: sandbox.path("Tank"), created: sandbox.path("Tank.md"), oracle: [] },
		{ choice: choiceFor("Property", "property:qaRole=crew"), typed: sandbox.path("Dozer"), created: sandbox.path("Dozer.md"), oracle: [] },
	];
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = scopes.map(({ choice }) => choice);
	});
	await plugin.reload({ waitUntilReady: true });

	const field = ".qa-onepage-file-picker input";
	const rows = () => obsidian.dev.evalJson<string[]>(
		'Array.from(document.querySelectorAll(".suggestion-container .suggestion-item .qa-onepage-file-suggestion__label"), (label) => label.textContent)',
	);
	for (const { choice, typed, created, oracle } of scopes) {
		await obsidian.command(`quickadd:choice:${choice.id}`).run();
		await expect.poll(() => obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(${jsLiteral(field)}))`), POLL_OPTS).toBe(true);

		// A name or an alias lists the note first, with no row offering a new
		// note (that row would come first).
		for (const [query, first] of [["neo", "Neo"], ["agent smith", "Program (Agent Smith)"]]) {
			await typeInto(obsidian, field, query);
			await expect.poll(async () => (await rows())[0], POLL_OPTS).toBe(first);
		}
		await typeInto(obsidian, field, "oracle");
		await expect.poll(rows, POLL_OPTS).toEqual(oracle);

		await typeInto(obsidian, field, typed);
		await expect.poll(async () => (await rows())[0], POLL_OPTS).toBe(`Create new note: ${typed}`);
		await pressKey(obsidian, "Enter");
		await typeInto(obsidian, ".modal-container input[type=text]:not(.qa-onepage-file-picker__input)", `into ${choice.name}`);
		expect(await obsidian.dev.evalJson<boolean>(`(() => {
			const submit = Array.from(document.querySelectorAll(".modal-container button")).find((b) => b.textContent.trim() === "Submit");
			submit?.click();
			return Boolean(submit);
		})()`)).toBe(true);
		await expect.poll(() => obsidian.dev.evalJsonAsync<string | null>(
			`(async () => (await app.vault.adapter.exists(${jsLiteral(created)})) ? app.vault.adapter.read(${jsLiteral(created)}) : null)()`,
		), POLL_OPTS).toBe(`- into ${choice.name}\n`);
	}
});

// On a phone, Obsidian stretches a modal's setting-control buttons to full
// width, so the picked note's remove button took the chip and cut its name to
// a few letters (#2106). A name longer than the chip was cut with an ellipsis
// (#2134); it wraps instead.
const LONG_NAME = "Mercury, the smallest planet in the solar system and the one that orbits closest to the Sun";

it("shows the picked note's whole name on a phone", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await seedVaultFile(obsidian, sandbox, `Planets/${LONG_NAME}.md`, "");

	const choice = new CaptureChoice("Phone capture target");
	choice.command = true;
	choice.captureTo = `${sandbox.path("Planets")}/`;
	choice.onePageInput = "always";
	choice.format = { enabled: true, format: "- {{VALUE:note}}\n" };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	try {
		await obsidian.dev.evalJson(`(() => {
			window.__qaChipClasses = document.body.className;
			document.body.classList.remove("is-tablet");
			document.body.classList.add("is-mobile", "is-phone");
			return true;
		})()`);
		await obsidian.command(`quickadd:choice:${choice.id}`).run();
		await expect.poll(() => obsidian.dev.evalJson<boolean>(
			'Boolean(document.querySelector(".qa-onepage-file-picker__chip"))',
		), POLL_OPTS).toBe(true);

		const chip = await obsidian.dev.evalJson<{ name: string; cut: boolean; removeWidth: number; lineStarts: number; lines: number }>(`(() => {
			// A phone's modal is the screen's width; 440px is an iPhone's.
			document.querySelector(".onePageInputModal").style.setProperty("--dialog-width", "440px");
			const label = document.querySelector(".qa-onepage-file-picker__chip-label");
			const remove = document.querySelector(".qa-onepage-file-picker__remove");
			const range = document.createRange();
			range.selectNodeContents(label);
			const lines = [...range.getClientRects()];
			return {
				name: label.textContent,
				cut: label.scrollWidth > label.clientWidth || label.getBoundingClientRect().right > label.closest(".qa-onepage-file-picker").getBoundingClientRect().right,
				removeWidth: Math.round(remove.getBoundingClientRect().width),
				lineStarts: new Set(lines.map((line) => Math.round(line.left))).size,
				lines: new Set(lines.map((line) => Math.round(line.top))).size,
			};
		})()`);
		expect(chip).toMatchObject({ name: LONG_NAME, cut: false, removeWidth: 22, lineStarts: 1 });
		expect(chip.lines).toBeGreaterThan(1);
	} finally {
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll(".onePageInputModal button")].find((e) => e.textContent === "Cancel")?.click();
			if (window.__qaChipClasses !== undefined) document.body.className = window.__qaChipClasses;
			delete window.__qaChipClasses;
			return true;
		})()`);
	}
});

// #2124: a long note name is cut with an ellipsis, which hides a match's text
// but not its highlight background, leaving a block after the "…".
it("leaves no highlight showing for a match the ellipsis cuts off", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await seedVaultFile(obsidian, sandbox, "Moons/The note name long enough to run past the end of the field Zebra.md", "");
	// Listed first, so it is the field's default and the long one stays searchable.
	await seedVaultFile(obsidian, sandbox, "Moons/Io.md", "");

	const choice = new CaptureChoice("Cut-off match");
	choice.command = true;
	choice.captureTo = `${sandbox.path("Moons")}/`;
	choice.onePageInput = "always";
	choice.format = { enabled: true, format: "- {{VALUE:note}}\n" };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	try {
		await obsidian.command(`quickadd:choice:${choice.id}`).run();
		await expect.poll(() => obsidian.dev.evalJson<boolean>(
			'Boolean(document.querySelector(".qa-onepage-file-picker input"))',
		), POLL_OPTS).toBe(true);
		await typeInto(obsidian, ".qa-onepage-file-picker input", "zebra");
		await expect.poll(() => obsidian.dev.evalJson(`(() => {
			const label = [...document.querySelectorAll(".suggestion-container .qa-onepage-file-suggestion__label")]
				.find((el) => el.textContent.endsWith("Zebra"));
			const mark = label?.querySelector(".qa-highlight");
			if (!mark) return null;
			return {
				match: mark.textContent,
				cut: label.scrollWidth > label.clientWidth || label.getBoundingClientRect().right > label.closest(".qa-onepage-file-picker").getBoundingClientRect().right,
				background: getComputedStyle(mark).backgroundColor,
			};
		})()`), POLL_OPTS).toEqual({ match: "Zebra", cut: true, background: "rgba(0, 0, 0, 0)" });
	} finally {
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll(".onePageInputModal button")].find((e) => e.textContent === "Cancel")?.click();
			return true;
		})()`);
	}
});

// Obsidian focused the first focusable element, the picked note's remove
// button, so typing went nowhere and Enter dropped the note. The form now
// opens ready for the capture text.
it("opens a folder capture's form in the first field without a picked note", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const mercury = await seedVaultFile(obsidian, sandbox, "Planets/Mercury.md", "");

	const choice = new CaptureChoice("Focus capture target");
	choice.command = true;
	choice.captureTo = `${sandbox.path("Planets")}/`;
	choice.onePageInput = "always";
	choice.format = { enabled: true, format: "- {{VALUE:note}}\n" };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	await obsidian.command(`quickadd:choice:${choice.id}`).run();
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		'Boolean(document.querySelector(".qa-onepage-file-picker__chip"))',
	), POLL_OPTS).toBe(true);
	await expect.poll(() => obsidian.dev.evalJson<string>(
		'document.activeElement?.closest(".setting-item")?.querySelector(".setting-item-name")?.textContent ?? document.activeElement?.tagName',
	), POLL_OPTS).toBe("note");

	await insertText(obsidian, "typed straight away");
	await pressKey(obsidian, "Enter", true);
	await expect.poll(() => obsidian.dev.evalJsonAsync<string>(
		`app.vault.adapter.read(${jsLiteral(mercury)})`,
	), POLL_OPTS).toBe("- typed straight away\n");
});
