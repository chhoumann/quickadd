import type { QuickAddPackageAsset } from "../types/packages/QuickAddPackage";
import { decodeFromBase64 } from "../utils/base64";
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
