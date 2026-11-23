import type { QuickAddPackageAsset } from "../types/packages/QuickAddPackage";
import { decodeFromBase64 } from "../utils/base64";
import { hasTemplateExtension } from "../utils/templateFolderUtils";
import { detectUserScriptSecretOptions } from "../utils/userScriptSecrets";
import { log } from "../logger/logManager";

export function packageSecretOptionNames(
	assets: QuickAddPackageAsset[],
	operation: "import" | "export",
): Map<string, ReadonlySet<string> | null> {
	const secretOptionNamesByPath = new Map<string, ReadonlySet<string> | null>();

	for (const asset of assets) {
		if (asset.kind !== "user-script") continue;

		try {
			const detection = detectUserScriptSecretOptions(
				decodeFromBase64(asset.content),
				asset.originalPath,
			);
			secretOptionNamesByPath.set(
				asset.originalPath,
				detection.foundSecretOptions && detection.names.size === 0
					? null
					: detection.names,
			);
		} catch (error) {
			log.logWarning(
				`QuickAdd ${operation} could not inspect user-script settings '${asset.originalPath}': ${(error as Error)?.message ?? error
				}`,
			);
		}
	}

	return secretOptionNamesByPath;
}

/**
 * Whether the formatter resolves `{{TEMPLATE:...}}` includes in this asset at
 * run time: a template-kind asset at a `.md`, `.canvas` or `.base` path. A
 * script's body (even a `.md` note-script) never has its includes resolved.
 * `path` defaults to the asset's own; import passes the path it writes to.
 */
export function isScannableTemplateAsset(
	asset: Pick<QuickAddPackageAsset, "kind" | "originalPath">,
	path: string = asset.originalPath,
): boolean {
	return (
		(asset.kind === "template" || asset.kind === "capture-template") &&
		hasTemplateExtension(path)
	);
}
