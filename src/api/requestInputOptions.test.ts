import { describe, expect, it, vi } from "vitest";
import {
	encodeRequestInputOptions,
	resolveExistingVariableValue,
	shouldReturnArray,
	type RequestInputSpec,
} from "./requestInputOptions";

const multi = (spec: Partial<RequestInputSpec<unknown>> = {}): RequestInputSpec<unknown> => ({
	id: "tags",
	type: "suggester",
	...spec,
	suggesterConfig: { multiSelect: true, ...spec.suggesterConfig },
});

describe("encodeRequestInputOptions", () => {
	it("keeps distinct string options on the wire as they are", () => {
		const codec = encodeRequestInputOptions({ id: "x", type: "suggester", options: ["a", "b, c"] });

		expect(codec.options).toEqual(["a", "b, c"]);
		expect(codec.displayOptions).toBeUndefined();
		expect(codec.decode("b, c")).toBe("b, c");
		expect(codec.decode("typed")).toBe("typed");
	});

	it("labels options from a displayOptions array, falling back to the option", () => {
		const codec = encodeRequestInputOptions({
			id: "x",
			type: "suggester",
			options: ["hi", "lo", "mid"],
			displayOptions: ["High", "Low"],
		});

		expect(codec.options).toEqual(["hi", "lo", "mid"]);
		expect(codec.displayOptions).toEqual(["High", "Low", "mid"]);
	});

	it("labels options with a displayOptions function", () => {
		const display = vi.fn((value: string, index: number) => `${index + 1}. ${value.toUpperCase()}`);
		const codec = encodeRequestInputOptions({ id: "x", type: "dropdown", options: ["a", "b"], displayOptions: display });

		expect(codec.displayOptions).toEqual(["1. A", "2. B"]);
		expect(display).toHaveBeenCalledWith("a", 0, ["a", "b"]);
	});

	it("round-trips object options to the same instances", () => {
		const ada = { name: "Ada" };
		const grace = { name: "Grace" };
		const codec = encodeRequestInputOptions({
			id: "person",
			type: "suggester",
			options: [ada, grace],
			displayOptions: (person) => person.name,
		});

		expect(codec.displayOptions).toEqual(["Ada", "Grace"]);
		expect(codec.options).toHaveLength(2);
		expect(new Set(codec.options).size).toBe(2);
		expect(codec.decode(codec.options![1])).toBe(grace);
		expect(codec.text(codec.options![0])).toBe("Ada");
		expect(codec.decode("Somebody else")).toBe("Somebody else");
	});

	it("gives each index its own token when one value has two labels", () => {
		const codec = encodeRequestInputOptions({
			id: "x",
			type: "suggester",
			options: ["a", "a"],
			displayOptions: ["Apple", "Avocado"],
		});

		expect(codec.options![0]).not.toBe(codec.options![1]);
		expect(codec.decode(codec.options![1])).toBe("a");
		expect(codec.text(codec.options![1])).toBe("a");
	});

	it("does not let a string option that looks like a token stand for another option", () => {
		const spoof = `${String.fromCharCode(0)}qa-opt:1`;
		const codec = encodeRequestInputOptions({ id: "x", type: "suggester", options: [spoof, "real"] });

		expect(codec.options).not.toEqual([spoof, "real"]);
		expect(codec.decode(codec.options![0])).toBe(spoof);
		expect(codec.decode(codec.options![1])).toBe("real");
	});

	it("encodes a default that is an option as that option's wire value", () => {
		const ada = { name: "Ada" };
		const codec = encodeRequestInputOptions({
			id: "person",
			type: "suggester",
			options: [{ name: "Grace" }, ada],
			defaultValue: ada,
		});

		expect(codec.decode(codec.defaultValue!)).toBe(ada);
	});

	it("encodes an array default of a multi-select as one value per pick", () => {
		const ada = { name: "Ada" };
		const codec = encodeRequestInputOptions(multi({
			options: [ada, { name: "Grace" }],
			defaultValue: [ada, "Someone, new"],
		}));

		expect(codec.defaultValue).toBeUndefined();
		expect(codec.defaultValues).toHaveLength(2);
		expect(codec.decode(codec.defaultValues![0])).toBe(ada);
		expect(codec.defaultValues![1]).toBe("Someone, new");
	});

	it("encodes an array-valued option passed as defaultValue without unpacking it", () => {
		const paris = [48.9, 2.3];
		const tokyo = [35.7, 139.7];
		const single = encodeRequestInputOptions({
			id: "city",
			type: "suggester",
			options: [tokyo, paris],
			displayOptions: ["Tokyo", "Paris"],
			defaultValue: paris,
		});
		expect(single.decode(single.defaultValue!)).toBe(paris);

		const dropdown = encodeRequestInputOptions({
			id: "city",
			type: "dropdown",
			options: [tokyo, paris],
			displayOptions: ["Tokyo", "Paris"],
			defaultValue: paris,
		});
		expect(dropdown.decode(dropdown.defaultValue!)).toBe(paris);

		const multiSingle = encodeRequestInputOptions(multi({
			options: [tokyo, paris],
			displayOptions: ["Tokyo", "Paris"],
			defaultValue: paris,
		}));
		expect(multiSingle.defaultValues).toBeUndefined();
		expect(multiSingle.decode(multiSingle.defaultValue!)).toBe(paris);
	});

	it("hands renderItem the original option", () => {
		const ada = { name: "Ada" };
		const renderItem = vi.fn();
		const codec = encodeRequestInputOptions({
			id: "person",
			type: "suggester",
			options: [ada],
			suggesterConfig: { renderItem },
		});
		const el = {} as HTMLElement;

		codec.renderOption!(codec.options![0], el);

		expect(renderItem).toHaveBeenCalledWith(ada, el);
	});
});

describe("shouldReturnArray", () => {
	it("returns a joined string for string options unless asked for an array", () => {
		expect(shouldReturnArray(multi({ options: ["a"] }))).toBe(false);
		expect(shouldReturnArray(multi({ options: ["a"], suggesterConfig: { returnArray: true } }))).toBe(true);
	});

	it("returns an array for non-string options unless a separator is named", () => {
		expect(shouldReturnArray(multi({ options: [{}] }))).toBe(true);
		expect(shouldReturnArray(multi({ options: [{}], suggesterConfig: { separator: "; " } }))).toBe(false);
		expect(shouldReturnArray(multi({ options: [{}], suggesterConfig: { returnArray: false } }))).toBe(false);
	});

	it("never returns an array from a single-select field", () => {
		expect(shouldReturnArray({ type: "suggester", options: [{}], suggesterConfig: { returnArray: true } })).toBe(false);
	});
});

describe("resolveExistingVariableValue", () => {
	it("keeps an array variable for a field that returns arrays", () => {
		const value = ["a, b", "c"];
		expect(resolveExistingVariableValue(multi({ suggesterConfig: { returnArray: true } }), value)).toBe(value);
		expect(resolveExistingVariableValue(multi({ suggesterConfig: { returnArray: true } }), "a, b")).toEqual(["a, b"]);
		expect(resolveExistingVariableValue(multi({ suggesterConfig: { returnArray: true } }), "")).toEqual([]);
	});

	it("joins an array variable with the field's separator", () => {
		expect(resolveExistingVariableValue(multi(), ["a", "b"])).toBe("a, b");
		expect(resolveExistingVariableValue(multi({ suggesterConfig: { separator: " | " } }), ["a", "b"])).toBe("a | b");
	});

	it("formats pre-existing non-string picks through displayOptions when joining into a string", () => {
		const ada = { name: "Ada" };
		const grace = { name: "Grace" };
		expect(resolveExistingVariableValue(multi({
			options: [ada, grace],
			displayOptions: (person: { name: string }) => person.name,
			suggesterConfig: { separator: " | " },
		}), [grace, ada])).toBe("Grace | Ada");
		expect(resolveExistingVariableValue(multi({
			options: [ada, grace],
			displayOptions: ["Ada", "Grace"],
			suggesterConfig: { returnArray: false },
		}), [grace, ada])).toBe("Grace, Ada");
		expect(resolveExistingVariableValue(multi({
			options: [ada, grace],
			displayOptions: (person: { name: string }) => person.name,
			suggesterConfig: { separator: "; " },
		}), ada)).toBe("Ada");
	});

	it("keeps an object variable for a field with object options", () => {
		const ada = { name: "Ada" };
		expect(resolveExistingVariableValue({ id: "p", type: "suggester", options: [ada] }, ada)).toBe(ada);
	});

	it("turns other variables into text, as before", () => {
		expect(resolveExistingVariableValue({ id: "n", type: "number" }, 5)).toBe("5");
	});
});
