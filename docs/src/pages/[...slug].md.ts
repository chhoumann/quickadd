import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";

/**
 * Raw markdown for every docs page at `<page-url>.md`
 * (e.g. /docs/FormatSyntax.md) - for LLMs, coding agents, and the
 * copy-as-markdown button.
 */
export const getStaticPaths = (async () => {
	const docs = await getCollection("docs");
	return docs.map((entry) => ({
		params: { slug: entry.id },
		props: { entry },
	}));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => {
	const { entry } = props;
	const header = `# ${entry.data.title}\n\n> ${entry.data.description ?? ""}\n\n`;
	return new Response(header + (entry.body ?? ""), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
};
