import { StubFormatter as FormatterStub } from "../../tests/helpers/formatters/stubFormatter";
import { TFile, type App } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";
import { rememberFieldLinkTarget } from "../utils/fieldLinkValues";
import { FILE_PICK_PREFIX } from "../utils/fileSyntax";

class FieldTitleFormatter extends FormatterStub {
	public fieldCalls: string[] = [];
	private fieldResponses: Map<string, string | string[]> = new Map();
	private fieldLinkTargets: Map<string, string | string[]> = new Map();
	private linkSourcePath: string | null = null;

	public setLinkSourcePath(path: string | null): void {
		this.linkSourcePath = path;
	}

	public setSharedVariables(variables: Map<string, unknown>): void {
		this.variables = variables;
	}

	protected override getLinkSourcePath(): string | null {
		return this.linkSourcePath;
	}

	public setMockFieldResponse(
		specifier: string,
		value: string | string[],
		linkTarget?: string | string[],
	): void {
		this.fieldResponses.set(specifier, value);
		if (linkTarget !== undefined) this.fieldLinkTargets.set(specifier, linkTarget);
	}

	protected async format(input: string): Promise<string> {
		let output = input;
		output = await this.replaceFieldVarInString(output);
		output = this.replaceTitleInString(output);
		return output;
	}

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	public async runFormat(input: string): Promise<string> {
		return await this.format(input);
	}

	/** Named VALUEs, then FIELDs: the order every formatter replaces them in. */
	public async runValuesThenFields(input: string): Promise<string> {
		return await this.format(await this.replaceVariableInString(input));
	}

	public async runFormatWithPropertyCollection(input: string): Promise<string> {
		return await this.withTemplatePropertyCollection(() => this.format(input));
	}

	protected async suggestForField(
		specifier: string,
		_parsed?: { fieldName: string },
		onLinkTarget?: (targets: string | string[]) => void,
	): Promise<string | string[]> {
		this.fieldCalls.push(specifier);
		const value = this.fieldResponses.get(specifier);

		if (value === undefined) {
			throw new Error(`No mock field response configured for "${specifier}".`);
		}

		const target = this.fieldLinkTargets.get(specifier);
		if (target !== undefined) onLinkTarget?.(target);

		return value;
	}
}

class FieldTitlePreviewFormatter extends FieldTitleFormatter {
	protected getVariableValue(variableName: string): string {
		return `${variableName}_preview`;
	}
}

describe("Formatter FIELD and TITLE namespace handling", () => {
	let formatter: FieldTitleFormatter;

	beforeEach(() => {
		formatter = new FieldTitleFormatter();
		formatter.setMockFieldResponse("title", "YAML Note Title");
	});

	it("resolves FIELD:title even when title variable is pre-populated", async () => {
		formatter.setTitle("My Note");

		const result = await formatter.runFormat("Field={{FIELD:title}} Title={{TITLE}}");

		expect(result).toBe("Field=YAML Note Title Title=My Note");
		expect(formatter.fieldCalls).toEqual(["title"]);
		expect((formatter as any).variables.get("title")).toBe("My Note");
		expect((formatter as any).variables.get("FIELD:title")).toBe("YAML Note Title");
	});

	it("takes the run variable its |name: names instead of asking (#2289)", async () => {
		formatter.setMockFieldResponse("status|name:status", "picked by name");
		formatter.setMockFieldResponse("status", "picked");
		(formatter as any).variables.set("Status", "other");

		const result = await formatter.runFormat("{{FIELD:status|name:status}} / {{FIELD:status}}");

		// Without |name:, a FIELD still keeps to itself.
		expect(result).toBe("other / picked");
		expect(formatter.fieldCalls).toEqual(["status"]);
	});

	it("asks a named FIELD before a {{VALUE}} of that name and shares the pick", async () => {
		formatter.setMockFieldResponse("status|name:state", "Draft");

		const result = await formatter.runValuesThenFields("{{VALUE:state}} {{FIELD:status|name:state}}");

		expect(result).toBe("Draft Draft");
		expect(formatter.fieldCalls).toEqual(["status|name:state"]);
		expect((formatter as any).variables.get("state")).toBe("Draft");
	});

	it("caches FIELD:title values independently of the title variable", async () => {
		formatter.setTitle("My Note");

		const result = await formatter.runFormat("{{FIELD:title}} & {{FIELD:title}}");

		expect(result).toBe("YAML Note Title & YAML Note Title");
		expect(formatter.fieldCalls).toEqual(["title"]);
		expect((formatter as any).variables.get("title")).toBe("My Note");
	});

	it("still sets filename title when FIELD variables were resolved earlier", async () => {
		const firstPass = await formatter.runFormat("Field={{FIELD:title}}");
		expect(firstPass).toBe("Field=YAML Note Title");

		formatter.setTitle("Second Note");
		const secondPass = await formatter.runFormat("{{TITLE}}");

		expect(secondPass).toBe("Second Note");
		expect((formatter as any).variables.get("FIELD:title")).toBe("YAML Note Title");
		expect((formatter as any).variables.get("title")).toBe("Second Note");
	});

	it("preserves display formatter previews when FIELD namespace is used", async () => {
		const previewFormatter = new FieldTitlePreviewFormatter();
		previewFormatter.setMockFieldResponse("title", "Preview Title");

		const result = await previewFormatter.runFormat("{{FIELD:title}}");

		expect(result).toBe("Preview Title");
	});

	it("does not loop when a selected FIELD value is another FIELD token", async () => {
		formatter.setMockFieldResponse("type", "{{FIELD:type}}");

		const result = await formatter.runFormat("{{FIELD:type}}");

		expect(result).toBe("{{FIELD:type}}");
		expect(formatter.fieldCalls).toEqual(["type"]);
	});

	it("collects FIELD multi arrays as YAML list properties", async () => {
		formatter.setMockFieldResponse("topic|multi", ["Alpha", "Beta"]);

		const output = await formatter.runFormatWithPropertyCollection(
			"---\ntopics: {{FIELD:topic|multi}}\n---\n",
		);
		const vars = formatter.getAndClearTemplatePropertyVars();

		expect(output).toBe("---\ntopics: []\n---\n");
		expect(vars.get("topics")).toEqual(["Alpha", "Beta"]);
	});

	it("joins FIELD multi arrays outside frontmatter property positions", async () => {
		formatter.setMockFieldResponse("topic|multi", ["Alpha", "Beta"]);

		await expect(
			formatter.runFormatWithPropertyCollection(
				"Body topics: {{FIELD:topic|multi}}",
			),
		).resolves.toBe("Body topics: Alpha,Beta");
		expect(formatter.getAndClearTemplatePropertyVars().size).toBe(0);
	});

	it("writes an explicit YAML list without property collection", async () => {
		formatter.setMockFieldResponse("topic|multi|format:yaml", ["0042", "a: b"]);

		await expect(
			formatter.runFormat("topics: {{FIELD:topic|multi|format:yaml}}"),
		).resolves.toBe('topics: ["0042", "a: b"]');
	});

	it("writes an explicit vertical Markdown list", async () => {
		formatter.setMockFieldResponse("topic|multi|format:markdown", [
			"Alpha",
			"Beta",
		]);

		await expect(
			formatter.runFormat("  {{FIELD:topic|multi|format:markdown}}"),
		).resolves.toBe("  - Alpha\n  - Beta");
	});

	it("keeps explicit inline output textual inside a collection scope", async () => {
		formatter.setMockFieldResponse("topic|multi|format:inline", [
			"Alpha",
			"Beta",
		]);

		await expect(
			formatter.runFormatWithPropertyCollection(
				"---\ntopics: {{FIELD:topic|multi|format:inline}}\n---\n",
			),
		).resolves.toBe("---\ntopics: Alpha,Beta\n---\n");
		expect(formatter.getAndClearTemplatePropertyVars().size).toBe(0);
	});

	it("writes format:spaced as comma-space text inside a collection scope", async () => {
		formatter.setMockFieldResponse("topic|multi|format:spaced", [
			"Alpha",
			"Beta",
		]);

		await expect(
			formatter.runFormatWithPropertyCollection(
				"---\ntopics: {{FIELD:topic|multi|format:spaced}}\n---\n",
			),
		).resolves.toBe("---\ntopics: Alpha, Beta\n---\n");
		expect(formatter.getAndClearTemplatePropertyVars().size).toBe(0);
	});

	it("collects FIELD multi arrays from YAML list item token positions", async () => {
		formatter.setMockFieldResponse("topic|multi", ["Alpha", "Beta"]);

		const output = await formatter.runFormatWithPropertyCollection(
			"---\ntopics:\n  - \"{{FIELD:topic|multi}}\"\n---\n",
		);
		const vars = formatter.getAndClearTemplatePropertyVars();

		expect(output).toBe("---\ntopics:\n  - \"[]\"\n---\n");
		expect(vars.get("topics")).toEqual(["Alpha", "Beta"]);
	});

	describe("|link (issue #2295)", () => {
		it("quotes a link that is the whole property value", async () => {
			formatter.setMockFieldResponse("author|link", "[[Ted Chiang]]");

			await expect(
				formatter.runFormat("---\nauthor: {{FIELD:author|link}}\n---\nBy {{FIELD:author|link}}"),
			).resolves.toBe('---\nauthor: "[[Ted Chiang]]"\n---\nBy [[Ted Chiang]]');
		});

		it("escapes rather than re-quotes an author-quoted token", async () => {
			formatter.setMockFieldResponse("author|link", '[[Say "hi"]]');

			await expect(
				formatter.runFormat('---\nauthor: "{{FIELD:author|link}}"\n---\n'),
			).resolves.toBe('---\nauthor: "[[Say \\"hi\\"]]"\n---\n');
		});

		it("writes a plain answer from a script or the CLI as a link", async () => {
			formatter.setMockFieldResponse("author|link", "Nobody Yet");

			await expect(formatter.runFormat("By {{FIELD:author|link}}")).resolves.toBe("By [[Nobody Yet]]");
		});

		it("links a plain answer to an existing note the way the link settings write it", async () => {
			const file = { path: "People/Ted Chiang.md" };
			const app = {
				metadataCache: { getFirstLinkpathDest: (text: string) => (text === "Ted Chiang" ? file : null) },
				fileManager: { generateMarkdownLink: () => "[Ted Chiang](People/Ted%20Chiang.md)" },
			} as unknown as App;
			const linked = new FieldTitleFormatter(app);
			linked.setMockFieldResponse("author|link", "Ted Chiang");

			await expect(linked.runFormat("---\nauthor: {{FIELD:author|link}}\n---\n")).resolves.toBe(
				'---\nauthor: "[Ted Chiang](People/Ted%20Chiang.md)"\n---\n',
			);
		});

		it("links a |name: answer shared from a VALUE", async () => {
			(formatter as any).variables.set("who", "Ted Chiang");

			await expect(formatter.runFormat("{{FIELD:author|link|name:who}}")).resolves.toBe("[[Ted Chiang]]");
			expect(formatter.fieldCalls).toEqual([]);
		});

		it("quotes a single link inside a flow sequence", async () => {
			formatter.setMockFieldResponse("category|link", "Books");

			await expect(
				formatter.runFormat("---\ncategories: [{{FIELD:category|link}}]\n---\n"),
			).resolves.toBe('---\ncategories: ["[[Books]]"]\n---\n');
		});

		it("quotes each link of a |multi|link inside a flow sequence", async () => {
			formatter.setMockFieldResponse("categories|multi|link", ["[[Books]]", "Reading"]);

			await expect(
				formatter.runFormatWithPropertyCollection("---\ncategories: [{{FIELD:categories|multi|link}}]\n---\n"),
			).resolves.toBe('---\ncategories: ["[[Books]]", "[[Reading]]"]\n---\n');
			expect(formatter.getAndClearTemplatePropertyVars().size).toBe(0);
		});

		it("leaves an empty flow sequence for an empty |multi|link", async () => {
			formatter.setMockFieldResponse("categories|multi|link", []);

			await expect(
				formatter.runFormat("---\ncategories: [{{FIELD:categories|multi|link}}]\n---\n"),
			).resolves.toBe("---\ncategories: []\n---\n");
		});

		it("trims adjacent commas when an empty |link sits beside other flow-list items", async () => {
			formatter.setMockFieldResponse("cat|multi|link", []);
			formatter.setMockFieldResponse("other|multi|link", []);
			formatter.setMockFieldResponse("single|link", "");

			await expect(
				formatter.runFormat("---\nrefs: [{{FIELD:cat|multi|link}}, Fixed]\n---\n"),
			).resolves.toBe("---\nrefs: [Fixed]\n---\n");
			await expect(
				formatter.runFormat("---\nrefs: [Fixed, {{FIELD:cat|multi|link}}]\n---\n"),
			).resolves.toBe("---\nrefs: [Fixed]\n---\n");
			await expect(
				formatter.runFormat("---\nrefs: [A, {{FIELD:cat|multi|link}}, B]\n---\n"),
			).resolves.toBe("---\nrefs: [A, B]\n---\n");
			await expect(
				formatter.runFormat("---\nrefs: [{{FIELD:cat|multi|link}}, {{FIELD:other|multi|link}}]\n---\n"),
			).resolves.toBe("---\nrefs: []\n---\n");
			await expect(
				formatter.runFormat("---\nrefs: [Fixed, {{FIELD:cat|multi|link}}, {{FIELD:other|multi|link}}]\n---\n"),
			).resolves.toBe("---\nrefs: [Fixed]\n---\n");
			await expect(
				formatter.runFormat("---\nrefs: [{{FIELD:single|link}}, Fixed]\n---\n"),
			).resolves.toBe("---\nrefs: [Fixed]\n---\n");
			await expect(
				formatter.runFormat("---\nrefs: [\n  {{FIELD:cat|multi|link}},\n  Fixed\n]\n---\n"),
			).resolves.toBe("---\nrefs: [\n  Fixed\n]\n---\n");
			await expect(
				formatter.runFormat("---\nrefs: [{{FIELD:cat|multi|link}} # optional\n  , Fixed]\n---\n"),
			).resolves.toBe("---\nrefs: [ # optional\n  Fixed]\n---\n");
			await expect(
				formatter.runFormat("---\nrefs: [{{FIELD:cat|multi|link}}\n  , Fixed]\n---\n"),
			).resolves.toBe("---\nrefs: [Fixed]\n---\n");
			await expect(
				formatter.runFormat("---\nrefs: [Fixed # keep\n  , {{FIELD:cat|multi|link}}]\n---\n"),
			).resolves.toBe("---\nrefs: [Fixed # keep\n]\n---\n");
			await expect(
				formatter.runFormat('---\nrefs: ["East, #1", {{FIELD:cat|multi|link}}]\n---\n'),
			).resolves.toBe('---\nrefs: ["East, #1"]\n---\n');
			await expect(
				formatter.runFormat('---\nrefs: ["East, #1", # keep\n  {{FIELD:cat|multi|link}}]\n---\n'),
			).resolves.toBe('---\nrefs: ["East, #1" # keep\n  ]\n---\n');
		});

		it("expands author-quoted |multi|link flow-list placeholders into distinct YAML items", async () => {
			formatter.setMockFieldResponse("cat|multi|link", ["[[A]]", "[[B]]"]);
			formatter.setMockFieldResponse("empty|multi|link", []);

			await expect(
				formatter.runFormat('---\nrefs: ["{{FIELD:cat|multi|link}}"]\n---\n'),
			).resolves.toBe('---\nrefs: ["[[A]]", "[[B]]"]\n---\n');
			await expect(
				formatter.runFormat('---\nitems:\n  - name: First\n    refs: ["{{FIELD:cat|multi|link}}"]\n---\n'),
			).resolves.toBe('---\nitems:\n  - name: First\n    refs: ["[[A]]", "[[B]]"]\n---\n');
			await expect(
				formatter.runFormat('---\nrefs: ["{{FIELD:empty|multi|link}}", Fixed]\n---\n'),
			).resolves.toBe("---\nrefs: [Fixed]\n---\n");
			await expect(
				formatter.runFormat('---\nrefs: ["{{FIELD:empty|multi|link}}"]\n---\n'),
			).resolves.toBe("---\nrefs: []\n---\n");
		});

		it("keeps same-note heading and block links intact without adding brackets", async () => {
			formatter.setMockFieldResponse("section|link", "[[#Details]]");
			formatter.setMockFieldResponse("mdsection|link", "[Details](#Details)");

			await expect(formatter.runFormat("See {{FIELD:section|link}} and {{FIELD:mdsection|link}}")).resolves.toBe(
				"See [[#Details]] and [Details](#Details)",
			);
		});

		it("renders remembered link targets relative to each destination note and leaves plain @file: VALUEs literal", async () => {
			const westPerson = Object.assign(new TFile(), { path: "West/Person.md", basename: "Person", name: "Person.md", extension: "md" });
			const eastPerson = Object.assign(new TFile(), { path: "East/Person.md", basename: "Person", name: "Person.md", extension: "md" });
			const files = [westPerson, eastPerson];
			const app = {
				vault: { getAbstractFileByPath: (path: string) => files.find((f) => f.path === path) ?? null },
				fileManager: {
					generateMarkdownLink: (file: TFile, sourcePath: string) => {
						const srcDir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
						const fileDir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
						if (srcDir && srcDir === fileDir) return `[${file.basename}](${file.name})`;
						return srcDir ? `[${file.basename}](../${file.path})` : `[${file.basename}](${file.path})`;
					},
				},
			} as unknown as App;

			const sharedVariables = new Map<string, unknown>();
			const first = new FieldTitleFormatter(app);
			first.setSharedVariables(sharedVariables);
			first.setLinkSourcePath("East/First.md");
			first.setMockFieldResponse("owner|link|name:who", "[Person](Person.md)", `${FILE_PICK_PREFIX}East/Person.md`);
			await expect(first.runValuesThenFields("---\nowner: {{FIELD:owner|link|name:who}}\n---\n")).resolves.toBe(
				'---\nowner: "[Person](Person.md)"\n---\n',
			);

			const second = new FieldTitleFormatter(app);
			second.setSharedVariables(sharedVariables);
			second.setLinkSourcePath("West/Second.md");
			await expect(
				second.runValuesThenFields("---\nowner: {{FIELD:owner|link|name:who}}\n---\nBy {{VALUE:who}}"),
			).resolves.toBe('---\nowner: "[Person](../East/Person.md)"\n---\nBy [Person](../East/Person.md)');

			sharedVariables.set("FIELD:author|link", "[Person](West/Person.md)");
			rememberFieldLinkTarget(sharedVariables, "FIELD:author|link", "[Person](West/Person.md)", `${FILE_PICK_PREFIX}West/Person.md`);
			sharedVariables.set("people", ["[Person](West/Person.md)", "[[Ghost]]"]);
			rememberFieldLinkTarget(sharedVariables, "people", sharedVariables.get("people"), [`${FILE_PICK_PREFIX}West/Person.md`, "[[Ghost]]"]);
			sharedVariables.set("literal", "@file:Ideas/Todo.md");

			const third = new FieldTitleFormatter(app);
			third.setSharedVariables(sharedVariables);
			third.setLinkSourcePath("East/New.md");
			await expect(
				third.runValuesThenFields(
					"---\nauthor: {{FIELD:author|link}}\nlit: {{VALUE:literal|type:text}}\n---\nWith {{VALUE:people}} and {{VALUE:literal}}",
				),
			).resolves.toBe(
				'---\nauthor: "[Person](../West/Person.md)"\nlit: "@file:Ideas/Todo.md"\n---\nWith [Person](../West/Person.md),[[Ghost]] and @file:Ideas/Todo.md',
			);

			const people = sharedVariables.get("people") as string[];
			people.splice(0, 1);
			const fourth = new FieldTitleFormatter(app);
			fourth.setSharedVariables(sharedVariables);
			fourth.setLinkSourcePath("East/AfterSplice.md");
			await expect(
				fourth.runValuesThenFields("After splice: {{FIELD:people|multi|link|name:people}}"),
			).resolves.toBe("After splice: [[Ghost]]");
		});

		it("quotes a link after an apostrophe inside a flow sequence without touching prose VALUE brackets", async () => {
			formatter.setMockFieldResponse("cat|link", "Books");
			(formatter as any).variables.set("code", "42");

			await expect(
				formatter.runValuesThenFields(
					"---\ncaption: see [{{VALUE:code|type:text}}]\nrefs: [O'Brien, {{FIELD:cat|link}}]\n---\n",
				),
			).resolves.toBe(
				'---\ncaption: see [42]\nrefs: [O\'Brien, "[[Books]]"]\n---\n',
			);
		});

		it("collects a |multi|link property as a list of links", async () => {
			formatter.setMockFieldResponse("categories|multi:linklist", ["Books", "[[Reading]]"]);

			await formatter.runFormatWithPropertyCollection("---\ncategories: {{FIELD:categories|multi:linklist}}\n---\n");

			expect(formatter.getAndClearTemplatePropertyVars().get("categories")).toEqual(["[[Books]]", "[[Reading]]"]);
		});
	});

	describe("ReDoS resistance (replaceFieldVarInString exec loop)", () => {
		// The formatter runs FIELD_VAR_REGEX_WITH_FILTERS UNanchored over template
		// content (attacker-controllable via an imported/synced template). Before
		// the interior excluded `{`, a template that was a long run of unterminated
		// openers drove O(n^2) backtracking: at every `{{FIELD:` opener the greedy
		// interior ate the rest of the string before failing (~38s at 100K openers,
		// freezing the main thread). Excluding `{` from both interior classes stops
		// each attempt at the next opener, so the scan is linear. Generous budget
		// keeps the test non-flaky while failing hard on any regression.
		const BUDGET_MS = 1500;

		it(
			"resolves a {{FIELD: opener flood in linear time",
			async () => {
				const input = "lead " + "{{FIELD:".repeat(200_000) + " tail";
				const start = performance.now();
				const result = await formatter.runFormat(input);
				const elapsed = performance.now() - start;

				// No opener is ever closed, so nothing matches and the template is
				// returned verbatim without a single suggestForField call.
				expect(result).toBe(input);
				expect(formatter.fieldCalls).toEqual([]);
				expect(elapsed).toBeLessThan(BUDGET_MS);
			},
			20_000,
		);

		it(
			"resolves a {{FIELD:| opener flood in linear time",
			async () => {
				// The pipe-prefixed variant: closing only group 1's `{` exclusion
				// would still let group 2 (`|filters`) span openers, so both classes
				// must exclude `{`.
				const input = "{{FIELD:|".repeat(200_000);
				const start = performance.now();
				const result = await formatter.runFormat(input);
				const elapsed = performance.now() - start;

				expect(result).toBe(input);
				expect(formatter.fieldCalls).toEqual([]);
				expect(elapsed).toBeLessThan(BUDGET_MS);
			},
			20_000,
		);
	});
});
