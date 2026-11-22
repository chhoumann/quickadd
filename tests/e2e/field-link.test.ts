import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import {
	POLL_OPTS,
	clickWhenStill,
	closeOpenPrompts,
	expectNoPrompt,
	jsLiteral,
	pressKey,
	setVaultConfig,
	typeInto,
	waitForElement,
} from "./uiHelpers";

const getContext = createQuickAddE2EHarness("field-link");

type QuickAddData = { choices: IChoice[]; onePageInputEnabled: boolean };

const PICKER_INPUT = ".prompt .prompt-input";
const SINGLE_TEMPLATE = "---\nauthor: {{FIELD:author|link}}\n---\nBy {{FIELD:author|link}}\n";

beforeEach(() => closeOpenPrompts(getContext().obsidian));
afterEach(() => closeOpenPrompts(getContext().obsidian));

async function seedNotes(): Promise<void> {
	const { obsidian, sandbox } = getContext();
	await seedVaultFile(obsidian, sandbox, "People/Steph Ango.md", "---\naliases: [Steph]\n---\n");
	await seedVaultFile(obsidian, sandbox, "People/Ted Chiang.md", "");
	await seedVaultFile(obsidian, sandbox, "People/Other Person.md", "");
	await seedVaultFile(obsidian, sandbox, "Books/The Diamond Age.md", "");
	await seedVaultFile(obsidian, sandbox, "Categories/Books.md", "");
	await seedVaultFile(obsidian, sandbox, "Categories/Movies.md", "");
	await seedVaultFile(
		obsidian,
		sandbox,
		"Notes/entry-a.md",
		'---\nauthor: "[[Steph Ango]]"\ncategories: ["[[Books]]", "[[Unwritten Cat]]"]\n---\n',
	);
	await seedVaultFile(
		obsidian,
		sandbox,
		"Notes/entry-b.md",
		'---\nauthor: "[[Steph Ango|Kepano]]"\n---\n',
	);
	await seedVaultFile(
		obsidian,
		sandbox,
		"Notes/entry-c.md",
		'---\nauthor: "[[Paul Person]]"\n---\n',
	);
	await seedVaultFile(
		obsidian,
		sandbox,
		"Notes/entry-d.md",
		'---\nauthor: "[[The Diamond Age]]"\n---\n',
	);
}

async function runTemplate(
	name: string,
	body = SINGLE_TEMPLATE,
	options: { onePage?: boolean } = {},
): Promise<void> {
	const { obsidian, plugin, sandbox } = getContext();
	await seedNotes();
	const template = new TemplateChoice(name);
	template.command = true;
	template.onePageInput = options.onePage ? "always" : "never";
	template.templatePath = await seedVaultFile(obsidian, sandbox, `${name}.template.md`, body);
	template.fileNameFormat = { enabled: true, format: name };
	template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("out")] };
	await plugin.data<QuickAddData>().patch((data) => {
		data.onePageInputEnabled = Boolean(options.onePage);
		data.choices.push(template);
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.command(`quickadd:choice:${template.id}`).run();
}

const promptRows = () =>
	getContext().obsidian.dev.evalJson<
		Array<{ text: string; link: boolean; unresolved: boolean; alias: boolean; icon: string | null }>
	>(`Array.from(document.querySelectorAll(".prompt .suggestion-item")).map((row) => ({
		text: row.textContent ?? "",
		link: Boolean(row.querySelector(".qa-field-link")),
		unresolved: Boolean(row.querySelector(".qa-field-link.is-unresolved")),
		alias: Boolean(row.querySelector('[aria-label="Alias"]')),
		icon: Array.from(row.querySelector(".suggestion-flair svg")?.classList ?? [])
			.find((cls) => cls !== "svg-icon")?.replace(/^lucide-/, "") ?? null,
	}))`);

async function expectNote(name: string, content: string, frontmatterLinks: string[]): Promise<void> {
	const { obsidian, sandbox } = getContext();
	const path = sandbox.path(`out/${name}.md`);
	await expect.poll(() => sandbox.read(`out/${name}.md`).catch(() => ""), POLL_OPTS).toBe(content);
	await expect
		.poll(
			() =>
				obsidian.dev.evalJson<string[]>(`(() => {
					const file = app.vault.getAbstractFileByPath(${jsLiteral(path)});
					return (file && app.metadataCache.getFileCache(file)?.frontmatterLinks || []).map((link) => link.link);
				})()`),
			POLL_OPTS,
		)
		.toEqual(frontmatterLinks);
}

describe("FIELD |link", () => {
	it("opens on merged existing values in link color, ranks existing first on similar matches and lets much better matches win", async () => {
		const { obsidian } = getContext();
		await runTemplate("ranking");
		await waitForElement(obsidian, PICKER_INPUT);

		await expect
			.poll(async () => (await promptRows()).map((row) => row.text), POLL_OPTS)
			.toEqual(expect.arrayContaining(["Paul Person", "Steph Ango", "The Diamond Age"]));

		const initial = await promptRows();
		expect(initial.filter((row) => row.text === "Steph Ango")).toEqual([
			{ text: "Steph Ango", link: true, unresolved: false, alias: false, icon: null },
		]);
		expect(initial.find((row) => row.text === "Paul Person")).toEqual({
			text: "Paul Person",
			link: true,
			unresolved: true,
			alias: false,
			icon: null,
		});
		expect(initial.map((row) => row.text)).not.toContain("Other Person");
		expect(initial.map((row) => row.text)).not.toContain("Ted Chiang");

		await typeInto(obsidian, PICKER_INPUT, "Person");
		await expect
			.poll(async () => {
				const names = (await promptRows()).map((row) => row.text);
				return names.indexOf("Paul Person") >= 0 && names.indexOf("Paul Person") < names.indexOf("Other Person");
			}, POLL_OPTS)
			.toBe(true);

		await typeInto(obsidian, PICKER_INPUT, "Ted");
		await expect
			.poll(async () => (await promptRows()).map((row) => row.text), POLL_OPTS)
			.toEqual(expect.arrayContaining(["Ted Chiang", "The Diamond Age"]));
		expect((await promptRows())[0]?.text).toBe("Ted Chiang");

		await pressKey(obsidian, "Enter");
		await expectNote("ranking", '---\nauthor: "[[Ted Chiang]]"\n---\nBy [[Ted Chiang]]\n', ["Ted Chiang"]);
		await expectNoPrompt(obsidian);
	});

	it("matches aliases with link styling and alias flair, and Tab completes note name without brackets", async () => {
		const { obsidian } = getContext();
		await runTemplate("alias-and-tab");
		await waitForElement(obsidian, PICKER_INPUT);

		await typeInto(obsidian, PICKER_INPUT, "Steph");
		await expect
			.poll(async () => (await promptRows())[0], POLL_OPTS)
			.toEqual({
				text: "StephSteph Ango",
				link: true,
				unresolved: false,
				alias: true,
				icon: "forward",
			});

		await pressKey(obsidian, "Tab");
		await expect
			.poll(
				() =>
					obsidian.dev.evalJson<string>(
						`document.querySelector(${jsLiteral(PICKER_INPUT)})?.value ?? ""`,
					),
				POLL_OPTS,
			)
			.toBe("Steph Ango");

		await pressKey(obsidian, "Enter");
		await expectNote("alias-and-tab", '---\nauthor: "[[Steph Ango]]"\n---\nBy [[Steph Ango]]\n', ["Steph Ango"]);
	});

	it("offers Link to [[...]] with link icon for unmatched names without creating a file", async () => {
		const { obsidian, sandbox } = getContext();
		await runTemplate("new-link");
		await waitForElement(obsidian, PICKER_INPUT);

		await typeInto(obsidian, PICKER_INPUT, "Zqxw Person");
		await expect
			.poll(async () => (await promptRows())[0], POLL_OPTS)
			.toEqual({
				text: "Link to [[Zqxw Person]]",
				link: false,
				unresolved: false,
				alias: false,
				icon: "link",
			});
		await pressKey(obsidian, "Enter");

		await expectNote("new-link", '---\nauthor: "[[Zqxw Person]]"\n---\nBy [[Zqxw Person]]\n', ["Zqxw Person"]);
		expect(await sandbox.read("Zqxw Person.md").catch(() => null)).toBeNull();
	});

	it("lists only existing values in |multi|link, suggests other notes without covering actions, and writes quoted YAML list", async () => {
		const { obsidian } = getContext();
		await runTemplate("multi-list", "---\ncategories: {{FIELD:categories|multi|link}}\n---\n");
		await waitForElement(obsidian, ".qa-multi-custom-input");

		expect(
			await obsidian.dev.evalJson<Array<{ text: string; unresolved: boolean }>>(
				`Array.from(document.querySelectorAll(".qaMultiSuggester .qa-searchable-multi-select__option-label")).map((el) => ({
					text: el.textContent ?? "",
					unresolved: el.classList.contains("is-unresolved"),
				}))`,
			),
		).toEqual([
			{ text: "Books", unresolved: false },
			{ text: "Unwritten Cat", unresolved: true },
		]);

		await typeInto(obsidian, ".qa-multi-custom-input", "Mov");
		await expect
			.poll(
				() =>
					obsidian.dev.evalJson<string[]>(
						'Array.from(document.querySelectorAll(".qa-text-input-suggest .suggestion-item")).map((row) => row.textContent ?? "")',
					),
				POLL_OPTS,
			)
			.toEqual(["Movies", "Link to [[Mov]]"]);

		expect(
			await obsidian.dev.evalJson<boolean>(`(() => {
				const popup = document.querySelector(".qa-text-input-suggest")?.getBoundingClientRect();
				const actions = document.querySelector(".qa-multi-actions")?.getBoundingClientRect();
				return Boolean(popup && actions && (popup.bottom <= actions.top || popup.top >= actions.bottom));
			})()`),
		).toBe(true);

		await pressKey(obsidian, "Escape");
		await expect
			.poll(
				() => obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".qa-text-input-suggest"))'),
				POLL_OPTS,
			)
			.toBe(false);
		expect(
			await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".qaMultiSuggester"))'),
		).toBe(true);

		await typeInto(obsidian, ".qa-multi-custom-input", "Movi");
		await expect
			.poll(
				() =>
					obsidian.dev.evalJson<string[]>(
						'Array.from(document.querySelectorAll(".qa-text-input-suggest .suggestion-item")).map((row) => row.textContent ?? "")',
					),
				POLL_OPTS,
			)
			.toEqual(["Movies", "Link to [[Movi]]"]);
		await pressKey(obsidian, "Enter");

		await expect
			.poll(
				() =>
					obsidian.dev.evalJson<string[]>(
						'Array.from(document.querySelectorAll(".qaMultiSuggester .qa-searchable-multi-select__option.is-selected")).map((row) => row.textContent ?? "")',
					),
				POLL_OPTS,
			)
			.toEqual(["Movies"]);

		await clickWhenStill(obsidian, ".qa-multi-actions button.mod-cta");
		await expectNote("multi-list", '---\ncategories:\n  - "[[Movies]]"\n---\n', ["Movies"]);
		await expectNoPrompt(obsidian);
	});

	it("auto-quotes flow-list YAML positions for single and multi |link fields", async () => {
		const { obsidian } = getContext();
		await runTemplate(
			"flow-yaml",
			"---\nsingle: [{{FIELD:author|link}}]\nmany: [{{FIELD:categories|multi|link}}]\n---\n",
			{ onePage: true },
		);
		await waitForElement(obsidian, ".onePageInputModal");

		const inputs = ".onePageInputModal .qa-onepage-field-link-picker input";
		await expect
			.poll(() => obsidian.dev.evalJson<number>(`document.querySelectorAll(${jsLiteral(inputs)}).length`), POLL_OPTS)
			.toBe(2);

		await typeInto(obsidian, inputs, "Ted Chiang");
		await expect
			.poll(
				() =>
					obsidian.dev.evalJson<string>(
						'document.querySelector(".qa-text-input-suggest .suggestion-item.is-selected")?.textContent ?? ""',
					),
				POLL_OPTS,
			)
			.toBe("Ted Chiang");
		await pressKey(obsidian, "Enter");

		await expect
			.poll(
				() =>
					obsidian.dev.evalJson<string[]>(
						'Array.from(document.querySelectorAll(".onePageInputModal .qa-onepage-field-link-picker .qa-onepage-file-picker__chip-label")).map((el) => el.textContent ?? "")',
					),
				POLL_OPTS,
			)
			.toEqual(["Ted Chiang"]);

		await obsidian.dev.evalJson(`(() => {
			const input = document.querySelectorAll(${jsLiteral(inputs)})[1];
			input.focus();
			input.value = "Books";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return true;
		})()`);
		await expect
			.poll(
				() =>
					obsidian.dev.evalJson<string>(
						'document.querySelector(".qa-text-input-suggest .suggestion-item.is-selected")?.textContent ?? ""',
					),
				POLL_OPTS,
			)
			.toBe("Books");
		await pressKey(obsidian, "Enter");

		await obsidian.dev.evalJson(`(() => {
			const input = document.querySelectorAll(${jsLiteral(inputs)})[1];
			input.value = "Steph";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return true;
		})()`);
		await pressKey(obsidian, "Escape");
		await clickWhenStill(obsidian, ".qa-prompt-actions button.mod-cta");

		await expectNote(
			"flow-yaml",
			'---\nsingle: ["[[Ted Chiang]]"]\nmany: ["[[Books]]", "[[Steph Ango]]"]\n---\n',
			["Ted Chiang", "Books", "Steph Ango"],
		);
		await expectNoPrompt(obsidian);
	});

	it("surfaces pasted wikilinks and trims empty flow-list commas", async () => {
		const { obsidian } = getContext();
		await runTemplate("paste-and-empty-flow", "---\nauthor: {{FIELD:author|link}}\nrefs: [{{FIELD:empty|multi|link}}, Fixed]\n---\n");
		await waitForElement(obsidian, PICKER_INPUT);

		await typeInto(obsidian, PICKER_INPUT, "[[Steph Ango]]");
		await expect
			.poll(async () => (await promptRows()).map((row) => row.text), POLL_OPTS)
			.toContain("Steph Ango");
		await pressKey(obsidian, "Enter");

		await waitForElement(obsidian, ".qa-multi-actions button.mod-cta");
		await clickWhenStill(obsidian, ".qa-multi-actions button.mod-cta");

		await expectNote(
			"paste-and-empty-flow",
			'---\nauthor: "[[Steph Ango]]"\nrefs: [Fixed]\n---\n',
			["Steph Ango"],
		);
		await expectNoPrompt(obsidian);
	});

	it("keeps source-relative property links distinct and renders one-page Markdown links relative to the destination note", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		await seedVaultFile(obsidian, sandbox, "East/Person.md", "");
		await seedVaultFile(obsidian, sandbox, "West/Person.md", "");
		await seedVaultFile(obsidian, sandbox, "East/Book.md", '---\nowner: "[Person](./Person.md)"\n---\n');
		await seedVaultFile(obsidian, sandbox, "West/Book.md", '---\nowner: "[Person](./Person.md)"\n---\n');

		const template = new TemplateChoice("relative-links");
		template.command = true;
		template.onePageInput = "always";
		template.templatePath = await seedVaultFile(
			obsidian,
			sandbox,
			"relative-links.template.md",
			"---\nowner: {{FIELD:owner|link}}\n---\nBy {{FIELD:owner|link}}\n",
		);
		template.fileNameFormat = { enabled: true, format: "New" };
		template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("East")] };
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = true;
			data.choices.push(template);
		});
		await plugin.reload({ waitUntilReady: true });

		const savedConfig = await obsidian.dev.evalJson<{ useMarkdownLinks: unknown; newLinkFormat: unknown }>(`(() => {
			const prev = {
				useMarkdownLinks: app.vault.getConfig("useMarkdownLinks"),
				newLinkFormat: app.vault.getConfig("newLinkFormat"),
			};
			${setVaultConfig("useMarkdownLinks", true)};
			${setVaultConfig("newLinkFormat", "relative")};
			return prev;
		})()`);

		try {
			await obsidian.command(`quickadd:choice:${template.id}`).run();
			await waitForElement(obsidian, ".onePageInputModal .qa-onepage-field-link-picker input");

			const inputSelector = ".onePageInputModal .qa-onepage-field-link-picker input";
			await clickWhenStill(obsidian, inputSelector);
			await expect
				.poll(
					() =>
						obsidian.dev.evalJson<string[]>(
							'Array.from(document.querySelectorAll(".qa-text-input-suggest .suggestion-item")).map((row) => row.textContent ?? "")',
						),
					POLL_OPTS,
				)
				.toEqual(expect.arrayContaining([expect.stringContaining("East"), expect.stringContaining("West")]));

			await typeInto(obsidian, inputSelector, "West");
			await expect
				.poll(
					() =>
						obsidian.dev.evalJson<string>(
							'document.querySelector(".qa-text-input-suggest .suggestion-item.is-selected")?.textContent ?? ""',
						),
					POLL_OPTS,
				)
				.toContain("West");
			await pressKey(obsidian, "Enter");
			await clickWhenStill(obsidian, ".qa-prompt-actions button.mod-cta");

			await expect
				.poll(() => sandbox.read("East/New.md").catch(() => ""), POLL_OPTS)
				.toBe('---\nowner: "[Person](../West/Person.md)"\n---\nBy [Person](../West/Person.md)\n');
			await expectNoPrompt(obsidian);
		} finally {
			await obsidian.dev.evalJson(`(() => {
				${setVaultConfig("useMarkdownLinks", savedConfig.useMarkdownLinks)};
				${setVaultConfig("newLinkFormat", savedConfig.newLinkFormat)};
				return true;
			})()`);
		}
	});
});
