export function waitFor(ms: number): Promise<unknown> {
	return new Promise((res) => setTimeout(res, ms));
}

export function getLinesInString(input: string) {
	return input.split("\n");
}

// https://stackoverflow.com/questions/3115150/how-to-escape-regular-expression-special-characters-using-javascript
export function escapeRegExp(text: string) {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}
