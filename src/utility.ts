export function waitFor(ms: number): Promise<unknown> {
	return new Promise((res) => setTimeout(res, ms));
}

export function getLinesInString(input: string) {
	const lines: string[] = [];
	let tempString = input;

	while (tempString.includes("\n")) {
		const lineEndIndex = tempString.indexOf("\n");
		lines.push(tempString.slice(0, lineEndIndex));
		tempString = tempString.slice(lineEndIndex + 1);
	}

	lines.push(tempString);

	return lines;
}

// https://stackoverflow.com/questions/3115150/how-to-escape-regular-expression-special-characters-using-javascript
export function escapeRegExp(text: string) {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}