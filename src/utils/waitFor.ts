export function waitFor(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
