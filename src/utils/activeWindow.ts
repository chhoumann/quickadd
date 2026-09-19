export function getOwnerDocument(node: Node): Document {
	if (node.nodeType === Node.DOCUMENT_NODE) {
		return node as Document;
	}
	const ownerDocument = node.ownerDocument;
	if (!ownerDocument) {
		throw new Error("Unable to resolve owner document for DOM node.");
	}
	return ownerDocument;
}

export function getOwnerWindow(node: Node): Window {
	const ownerWindow = getOwnerDocument(node).defaultView;
	if (!ownerWindow) {
		throw new Error("Unable to resolve owner window for DOM node.");
	}
	return ownerWindow;
}

export function createOwnedElement<K extends keyof HTMLElementTagNameMap>(
	owner: Node,
	tagName: K,
): HTMLElementTagNameMap[K] {
	// eslint-disable-next-line no-restricted-syntax -- Native helpers use the global document; this element must be detached in its owner document.
	return getOwnerDocument(owner).createElement(tagName);
}

export function createOwnedTextNode(owner: Node, text: string): Text {
	return getOwnerDocument(owner).createTextNode(text);
}
