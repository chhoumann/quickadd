import { visit } from "unist-util-visit";

const ID_RE = /\s*\{#([A-Za-z0-9_–—-]+)\}\s*$/;

/**
 * Docusaurus-style custom heading IDs: `## Heading {#custom-id}`.
 * Sets the id on the heading element and strips the marker from the text,
 * preserving anchors that inbound links and the old site rely on.
 *
 * Astro's smartypants pass runs before user remark plugins and rewrites
 * `--`/`---` inside the marker to en/em dashes, so those are matched and
 * mapped back to the hyphens the author wrote.
 */
export default function remarkHeadingId() {
	return (tree) => {
		visit(tree, "heading", (node) => {
			const last = node.children.at(-1);
			if (!last || last.type !== "text") return;
			const match = last.value.match(ID_RE);
			if (!match) return;
			last.value = last.value.replace(ID_RE, "");
			if (last.value === "") node.children.pop();
			const id = match[1].replaceAll("—", "--").replaceAll("–", "--");
			node.data ??= {};
			node.data.hProperties = { ...node.data.hProperties, id };
		});
	};
}
