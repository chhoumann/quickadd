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

export const GET: APIRoute = ({ props, site }) => {
	const { entry } = props;
	const header = `# ${entry.data.title}\n\n> ${entry.data.description ?? ""}\n\n`;
	// The package card is rendered by a component, so tell markdown readers
	// (agents included) where the ready-made package lives. The link is
	// absolute because this markdown is read outside the site.
	const packageUrl = entry.data.package
		? new URL(`/packages/${entry.data.package}.quickadd.json`, site).href
		: "";
	const packageNote = packageUrl
		? `> Ready-made QuickAdd package for this workflow: [package JSON](${packageUrl}). Copy its contents and import them in Obsidian via **Settings → QuickAdd → Import package…**.\n\n`
		: "";
	return new Response(header + packageNote + (entry.body ?? ""), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
};
