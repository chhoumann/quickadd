/**
 * QuickAdd docs MCP server - stateless Streamable HTTP transport at /mcp.
 *
 * Runs as a Cloudflare Pages Function on the same deployment as the docs.
 * Exposes two tools over the Model Context Protocol so AI clients (Claude,
 * Cursor, etc.) can search the docs and fetch pages as markdown:
 *
 *   search_quickadd_docs({ query })  -> ranked pages with snippets
 *   get_quickadd_doc({ slug })       -> full page as markdown
 *
 * Data comes from build artifacts served by this same deployment:
 * /docs-index.json (manifest) and /<slug>.md (raw markdown per page).
 * No SDK dependency: the protocol subset needed by a stateless tools-only
 * server is small enough to implement directly.
 */

interface ManifestPage {
	slug: string;
	url: string;
	markdownUrl: string;
	title: string;
	description: string;
	headings: string[];
	text: string;
}

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: JsonRpcId;
	method: string;
	params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = new Set(["2025-06-18"]);

const TOOLS = [
	{
		name: "search_quickadd_docs",
		description:
			"Search the QuickAdd (Obsidian plugin) documentation. Returns the most relevant pages with title, URL, and a snippet. Use get_quickadd_doc to read a full page.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						"Search terms, e.g. 'capture to daily note' or 'VDATE format token'",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "get_quickadd_doc",
		description:
			"Fetch a QuickAdd documentation page as markdown by its slug (as returned by search_quickadd_docs), e.g. 'docs/FormatSyntax' or 'docs/Choices/CaptureChoice'.",
		inputSchema: {
			type: "object",
			properties: {
				slug: {
					type: "string",
					description: "Page slug, e.g. 'docs/QuickAddAPI'",
				},
			},
			required: ["slug"],
		},
	},
] as const;

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
	"Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return Response.json(body, {
		...init,
		headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
	});
}

function rpcResult(id: JsonRpcId, result: unknown) {
	return { jsonrpc: "2.0" as const, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
	return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function textResult(id: JsonRpcId, text: string, isError = false) {
	return rpcResult(id, { content: [{ type: "text", text }], isError });
}

async function loadManifest(
	request: Request,
	env: { ASSETS: { fetch: (r: Request | string) => Promise<Response> } },
): Promise<ManifestPage[]> {
	const url = new URL("/docs-index.json", request.url);
	const res = await env.ASSETS.fetch(url.toString());
	if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
	const data = (await res.json()) as { pages: ManifestPage[] };
	return data.pages;
}

function scorePage(page: ManifestPage, terms: string[]): number {
	let score = 0;
	const title = page.title.toLowerCase();
	const headings = page.headings.join(" ").toLowerCase();
	const description = page.description.toLowerCase();
	const text = page.text.toLowerCase();
	for (const term of terms) {
		if (title.includes(term)) score += 8;
		if (headings.includes(term)) score += 4;
		if (description.includes(term)) score += 3;
		const occurrences = text.split(term).length - 1;
		score += Math.min(occurrences, 5);
	}
	return score;
}

function snippetFor(page: ManifestPage, terms: string[]): string {
	const text = page.text;
	const lower = text.toLowerCase();
	for (const term of terms) {
		const at = lower.indexOf(term);
		if (at >= 0) {
			const start = Math.max(0, at - 120);
			const end = Math.min(text.length, at + 180);
			return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
		}
	}
	return page.description;
}

async function handleToolCall(
	id: JsonRpcId,
	params: Record<string, unknown>,
	request: Request,
	env: { ASSETS: { fetch: (r: Request | string) => Promise<Response> } },
) {
	const name = params.name as string;
	const args = (params.arguments ?? {}) as Record<string, unknown>;
	const origin = new URL(request.url).origin;

	if (name === "search_quickadd_docs") {
		const query = String(args.query ?? "").trim();
		if (!query) return textResult(id, "Missing 'query' argument.", true);
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const pages = await loadManifest(request, env);
		const ranked = pages
			.map((page) => ({ page, score: scorePage(page, terms) }))
			.filter(({ score }) => score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 5);
		if (ranked.length === 0) {
			return textResult(
				id,
				`No pages matched "${query}". Try broader terms; topics include choices (template/capture/macro/multi), format syntax tokens, the scripting API, and examples.`,
			);
		}
		const lines = ranked.map(
			({ page }) =>
				`## ${page.title}\nslug: ${page.slug}\nurl: ${origin}${page.url}\n${snippetFor(page, terms)}`,
		);
		return textResult(id, lines.join("\n\n"));
	}

	if (name === "get_quickadd_doc") {
		const slug = String(args.slug ?? "")
			.trim()
			.replace(/^\/+|\/+$/g, "");
		if (!slug) return textResult(id, "Missing 'slug' argument.", true);
		const pages = await loadManifest(request, env);
		const page = pages.find((p) => p.slug.toLowerCase() === slug.toLowerCase());
		if (!page) {
			return textResult(
				id,
				`No page found for slug "${slug}". Use search_quickadd_docs to find valid slugs.`,
				true,
			);
		}
		const res = await env.ASSETS.fetch(new URL(page.markdownUrl, origin).toString());
		if (!res.ok) return textResult(id, `Failed to load "${page.slug}" (${res.status}).`, true);
		return textResult(id, await res.text());
	}

	return rpcError(id, -32602, `Unknown tool: ${name}`);
}

async function handleRpc(
	message: JsonRpcRequest,
	request: Request,
	env: { ASSETS: { fetch: (r: Request | string) => Promise<Response> } },
) {
	const id = message.id ?? null;
	switch (message.method) {
		case "initialize": {
			const requested = String(
				(message.params as Record<string, unknown> | undefined)?.protocolVersion ?? "",
			);
			return rpcResult(id, {
				protocolVersion: SUPPORTED_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: {
					name: "quickadd-docs",
					title: "QuickAdd Documentation",
					version: "1.0.0",
				},
				instructions:
					"Documentation for QuickAdd, the Obsidian plugin for templates, captures, macros, and AI workflows. Search first, then fetch full pages by slug.",
			});
		}
		case "ping":
			return rpcResult(id, {});
		case "tools/list":
			return rpcResult(id, { tools: TOOLS });
		case "tools/call":
			return handleToolCall(id, message.params ?? {}, request, env);
		default:
			return rpcError(id, -32601, `Method not found: ${message.method}`);
	}
}

export const onRequest = async (context: {
	request: Request;
	env: { ASSETS: { fetch: (r: Request | string) => Promise<Response> } };
}): Promise<Response> => {
	const { request, env } = context;

	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	if (request.method === "GET") {
		// This server never initiates messages, so the spec-defined GET/SSE
		// stream is unsupported; SSE probes must get 405, not JSON.
		if ((request.headers.get("Accept") ?? "").includes("text/event-stream")) {
			return new Response("SSE not supported", {
				status: 405,
				headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" },
			});
		}
		return jsonResponse({
			name: "quickadd-docs",
			description:
				"MCP server for the QuickAdd (Obsidian plugin) documentation. Connect an MCP client to this URL (Streamable HTTP transport) for search_quickadd_docs and get_quickadd_doc tools.",
			endpoint: "/mcp",
			docs: "https://quickadd.obsidian.guide/",
		});
	}

	if (request.method !== "POST") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { ...CORS_HEADERS, Allow: "GET, POST, OPTIONS" },
		});
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonResponse(rpcError(null, -32700, "Parse error"), { status: 400 });
	}

	// Streamable HTTP posts exactly one JSON-RPC message per request.
	if (Array.isArray(body) || typeof body !== "object" || body === null || !("method" in body)) {
		return jsonResponse(rpcError(null, -32600, "Expected a single JSON-RPC message"), {
			status: 400,
		});
	}

	const message = body as JsonRpcRequest;

	// Notifications (no id), e.g. notifications/initialized: acknowledge.
	if (!("id" in message)) return new Response(null, { status: 202, headers: CORS_HEADERS });

	return jsonResponse(await handleRpc(message, request, env));
};
