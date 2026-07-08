import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

/**
 * Machine-readable manifest of every docs page. Consumed by the /mcp
 * server (functions/mcp.ts) for search and retrieval.
 */
export const GET: APIRoute = async () => {
	const docs = await getCollection("docs");
	const pages = docs
		.map((entry) => ({
			slug: entry.id,
			url: `/${entry.id}/`,
			markdownUrl: `/${entry.id}.md`,
			title: entry.data.title,
			description: entry.data.description ?? "",
			headings: [...(entry.body ?? "").matchAll(/^#{2,3}\s+(.+?)\s*(?:\{#[^}]*\})?\s*$/gm)].map(
				(m) => m[1],
			),
			text: (entry.body ?? "")
				.replace(/```[\s\S]*?```/g, " ")
				.replace(/\s+/g, " "),
		}))
		.sort((a, b) => a.slug.localeCompare(b.slug));
	return new Response(JSON.stringify({ generated: "build", pages }), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
};
