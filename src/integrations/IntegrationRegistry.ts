import type { App } from "obsidian";
import {
	createTemplaterIntegration,
	NoopTemplaterIntegration,
	type TemplaterIntegration,
} from "./TemplaterIntegration";

export interface IntegrationRegistryOptions {
	templater?: TemplaterIntegration;
}

export class IntegrationRegistry {
	templater: TemplaterIntegration;

	constructor(options: IntegrationRegistryOptions = {}) {
		this.templater = options.templater ?? new NoopTemplaterIntegration();
	}

	registerTemplater(templater: TemplaterIntegration): void {
		this.templater = templater;
	}
}

const registriesByApp = new WeakMap<App, IntegrationRegistry>();

export function createIntegrationRegistry(app: App): IntegrationRegistry {
	return new IntegrationRegistry({
		templater: createTemplaterIntegration(app),
	});
}

export function registerIntegrationRegistry(
	app: App,
	registry: IntegrationRegistry,
): IntegrationRegistry {
	registriesByApp.set(app, registry);
	return registry;
}

export function getIntegrationRegistry(app: App): IntegrationRegistry {
	let registry = registriesByApp.get(app);
	if (!registry) {
		registry = createIntegrationRegistry(app);
		registerIntegrationRegistry(app, registry);
	}
	return registry;
}
