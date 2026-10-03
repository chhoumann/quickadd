export function waitFor(ms: number): Promise<unknown> {
	return new Promise((res) => window.setTimeout(res, ms));
}

export function getLinesInString(input: string) {
	return input.split("\n");
}
