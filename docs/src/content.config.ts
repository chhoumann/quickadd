import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
				/**
				 * Offer a ready-made package for this page's workflow. The value is
				 * a folder name under `docs/packages/`; the page then renders a
				 * "Get this workflow" card above its content (see
				 * `src/components/PackageCard.astro`).
				 */
				package: z
					.string()
					.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "package ids are kebab-case")
					.optional(),
			}),
		}),
	}),
};
