/** `text` with every CRLF and lone CR line ending turned into LF. */
export function toLF(text: string): string {
	return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}
