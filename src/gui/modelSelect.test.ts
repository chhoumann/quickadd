import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DropdownComponent } from "obsidian";
import type { AIProvider } from "src/ai/Provider";
import { resetModelResolutionWarnings } from "src/ai/aiHelpers";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import { populateModelDropdown, type ModelSelection } from "./modelSelect";

// A minimal stand-in for Obsidian's DropdownComponent over a real <select>,
// enough for the builder: addOption/setValue/onChange plus direct selectEl use.
function makeDropdown() {
	const selectEl = document.createElement("select");
	let changeHandler: ((value: string) => void) | undefined;

	const dropdown = {
		selectEl,
		addOption(value: string, display: string) {
			const option = document.createElement("option");
			option.value = value;
			option.text = display;
			selectEl.appendChild(option);
			return dropdown;
		},
		setValue(value: string) {
			selectEl.value = value;
			return dropdown;
		},
		onChange(handler: (value: string) => void) {
			changeHandler = handler;
			return dropdown;
		},
	};

	return {
		dropdown: dropdown as unknown as DropdownComponent,
		selectEl,
		select(value: string) {
			selectEl.value = value;
			changeHandler?.(value);
		},
	};
}

function provider(overrides: Partial<AIProvider>): AIProvider {
	return {
		name: "Provider",
		endpoint: "https://example.test/v1",
		apiKey: "",
		models: [],
		modelSource: "providerApi",
		...overrides,
	};
}

function setProviders(providers: AIProvider[]): void {
	const current = settingsStore.getState();
	settingsStore.setState({ ai: { ...current.ai, providers } });
}

const twoProvidersSameModel = () => [
	provider({
		id: "openai",
		name: "OpenAI",
		models: [{ name: "gpt-4o", maxTokens: 128_000 }],
	}),
	provider({
		id: "proxy",
		name: "Proxy",
		models: [{ name: "gpt-4o", maxTokens: 64_000 }],
	}),
];

beforeEach(() => {
	settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	resetModelResolutionWarnings();
});

describe("populateModelDropdown", () => {
	it("groups options per provider so duplicate names are distinguishable", () => {
		setProviders(twoProvidersSameModel());
		const { dropdown, selectEl } = makeDropdown();

		populateModelDropdown(dropdown, { model: "Ask me" }, vi.fn());

		const groups = Array.from(selectEl.querySelectorAll("optgroup"));
		expect(groups.map((g) => g.label)).toEqual(["OpenAI", "Proxy"]);
		expect(
			groups.map((g) => Array.from(g.children).map((o) => o.textContent)),
		).toEqual([["gpt-4o"], ["gpt-4o"]]);
		// "Ask me" stays a top-level option, first.
		expect(selectEl.options[0].value).toBe("Ask me");
	});

	it("writes BOTH fields (name + provider-scoped ref) on selection", () => {
		setProviders(twoProvidersSameModel());
		const { dropdown, selectEl, select } = makeDropdown();
		const onSelect = vi.fn<(selection: ModelSelection) => void>();

		populateModelDropdown(dropdown, { model: "Ask me" }, onSelect);

		const proxyOption = Array.from(selectEl.options).find((o) =>
			o.value.startsWith("proxy/"),
		);
		select(proxyOption!.value);

		expect(onSelect).toHaveBeenCalledWith({
			model: "gpt-4o",
			modelRef: { providerId: "proxy", name: "gpt-4o" },
		});
	});

	it("clears the ref when 'Ask me' is selected", () => {
		setProviders(twoProvidersSameModel());
		const { dropdown, select } = makeDropdown();
		const onSelect = vi.fn<(selection: ModelSelection) => void>();

		populateModelDropdown(
			dropdown,
			{ model: "gpt-4o", modelRef: { providerId: "proxy", name: "gpt-4o" } },
			onSelect,
		);
		select("Ask me");

		expect(onSelect).toHaveBeenCalledWith({
			model: "Ask me",
			modelRef: undefined,
		});
	});

	it("preselects the pinned provider's entry, not the first duplicate", () => {
		setProviders(twoProvidersSameModel());
		const { dropdown, selectEl } = makeDropdown();

		populateModelDropdown(
			dropdown,
			{ model: "gpt-4o", modelRef: { providerId: "proxy", name: "gpt-4o" } },
			vi.fn(),
		);

		expect(selectEl.value.startsWith("proxy/")).toBe(true);
	});

	it("preselects the first-match entry for a legacy bare name (mirrors runtime)", () => {
		setProviders(twoProvidersSameModel());
		const { dropdown, selectEl } = makeDropdown();

		populateModelDropdown(dropdown, { model: "gpt-4o" }, vi.fn());

		expect(selectEl.value.startsWith("openai/")).toBe(true);
	});

	it("ignores a STALE ref and preselects by the legacy string instead", () => {
		setProviders(twoProvidersSameModel());
		const { dropdown, selectEl } = makeDropdown();

		populateModelDropdown(
			dropdown,
			// Ref name drifted from the string (downgrade edit): the string wins.
			{ model: "gpt-4o", modelRef: { providerId: "proxy", name: "o3" } },
			vi.fn(),
		);

		expect(selectEl.value.startsWith("openai/")).toBe(true);
	});

	it("shows a disabled (missing) entry for a stored model that no longer exists", () => {
		setProviders(twoProvidersSameModel());
		const { dropdown, selectEl, select } = makeDropdown();
		const onSelect = vi.fn();

		populateModelDropdown(
			dropdown,
			{
				model: "claude-x",
				modelRef: { providerId: "anthropic", name: "claude-x" },
			},
			onSelect,
		);

		const missing = Array.from(selectEl.options).find((o) =>
			o.text.startsWith("(missing)"),
		);
		expect(missing?.text).toBe("(missing) anthropic/claude-x");
		expect(missing?.disabled).toBe(true);
		expect(selectEl.value).toBe(missing?.value);

		// Selecting the placeholder must never fire a save.
		select(missing!.value);
		expect(onSelect).not.toHaveBeenCalled();
	});
});
