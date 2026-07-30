import type { App } from "obsidian";

type MetadataTypeInfo = {
	expected?: { type?: string } | null;
	inferred?: { type?: string } | null;
};

type MetadataTypeManager = {
	getTypeInfo?: (key: string) => unknown;
};

const SET_LIKE_PROPERTY_TYPES = new Set([
	"aliases",
	"list",
	"multitext",
	"tags",
]);

const SET_LIKE_RESERVED_KEYS = new Set([
	"aliases",
	"cssclasses",
	"tags",
]);

/**
 * Reads Obsidian's effective property type for a frontmatter key.
 *
 * Obsidian has exposed the manager both directly on App and through
 * metadataCache.app, so keep the compatibility lookup in one place.
 */
export function resolveObsidianPropertyType(
	app: App | undefined,
	propertyKey: string | undefined,
): string | null {
	if (!app || !propertyKey) return null;

	const appWithManager = app as unknown as {
		metadataTypeManager?: MetadataTypeManager;
		metadataCache?: {
			app?: {
				metadataTypeManager?: MetadataTypeManager;
			};
		};
	};
	const manager =
		appWithManager.metadataTypeManager ??
		appWithManager.metadataCache?.app?.metadataTypeManager;

	if (!manager || typeof manager.getTypeInfo !== "function") {
		return null;
	}

	const info = manager.getTypeInfo(propertyKey) as MetadataTypeInfo | undefined;
	const type = info?.expected?.type ?? info?.inferred?.type;
	return typeof type === "string" ? type : null;
}

export function isSetLikeObsidianPropertyType(
	propertyType: string | null,
): boolean {
	return (
		propertyType !== null &&
		SET_LIKE_PROPERTY_TYPES.has(propertyType.toLowerCase())
	);
}

/**
 * Whether applying a template should add distinct values instead of treating
 * the entire property as one scalar conflict.
 *
 * Reserved keys stay additive even if an Obsidian build cannot expose its
 * property-type manager. This makes the core tags/aliases/cssclasses contract
 * reliable without guessing that every YAML array is set-like.
 */
export function isSetLikeObsidianProperty(
	app: App,
	propertyKey: string,
): boolean {
	return (
		SET_LIKE_RESERVED_KEYS.has(propertyKey.toLowerCase()) ||
		isSetLikeObsidianPropertyType(
			resolveObsidianPropertyType(app, propertyKey),
		)
	);
}
