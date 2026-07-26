import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import FormatTokenHint from "./FormatTokenHint.svelte";
import { DOCS_URLS } from "../../../docs";

const hint = (container: HTMLElement) =>
	container.querySelector(".qa-token-hint");

/**
 * Issue #1542, ask 1. The token autocomplete opens on `{{` and nothing said so.
 */
describe("FormatTokenHint", () => {
	it("names the two characters that open the autocomplete", async () => {
		const { container } = render(FormatTokenHint, { props: { value: "" } });
		await tick();

		const text = hint(container as HTMLElement)?.textContent ?? "";
		expect(text).toContain("{{");
		expect(text).toContain("to insert a token");
	});

	it("links the format syntax reference", async () => {
		const { container } = render(FormatTokenHint, { props: { value: "" } });
		await tick();

		const link = container.querySelector("a.quickadd-docs-link");
		expect(link?.getAttribute("href")).toBe(DOCS_URLS.formatSyntax);
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
	});

	it("stays out of the way once the field uses a token", async () => {
		const { container } = render(FormatTokenHint, {
			props: { value: "- [ ] {{VALUE}}" },
		});
		await tick();
		expect(hint(container as HTMLElement)).toBeNull();
	});

	it("shows again if the user removes every token", async () => {
		const { container, rerender } = render(FormatTokenHint, {
			props: { value: "{{DATE}}" },
		});
		await tick();
		expect(hint(container as HTMLElement)).toBeNull();

		await rerender({ value: "plain text" });
		await tick();
		expect(hint(container as HTMLElement)).not.toBeNull();
	});
});
