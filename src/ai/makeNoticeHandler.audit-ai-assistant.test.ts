import { beforeEach, describe, expect, it, vi } from "vitest";

const { NoticeMock, noticeSetMessageMock, noticeHideMock } = vi.hoisted(() => {
	const noticeSetMessageMock = vi.fn();
	const noticeHideMock = vi.fn();
	const NoticeMock = vi.fn(function NoticeMock() {
		return {
			setMessage: noticeSetMessageMock,
			hide: noticeHideMock,
		};
	});

	return { NoticeMock, noticeSetMessageMock, noticeHideMock };
});

vi.mock("obsidian", () => ({
	Notice: NoticeMock,
}));

import { makeNoticeHandler } from "./makeNoticeHandler";

// Finding: ai-assistant-show-assistant-messages — the failure status ("dead")
// previously rendered as "Assistant is dead." which is jarring and unhelpful.
// The error surface should read with clear failure wording instead.
describe("makeNoticeHandler error wording", () => {
	beforeEach(() => {
		NoticeMock.mockClear();
		noticeSetMessageMock.mockClear();
		noticeHideMock.mockClear();
	});

	it("renders the failure status as a clear headline, not 'Assistant is dead.'", () => {
		const handler = makeNoticeHandler(true);

		handler.setMessage("dead", "Request failed (HTTP 401): invalid api key");

		const rendered = noticeSetMessageMock.mock.calls.at(-1)?.[0] as string;
		expect(rendered).not.toContain("Assistant is dead.");
		expect(rendered).toContain("AI request failed.");
		// The detail message is still appended after the headline.
		expect(rendered).toContain("invalid api key");
	});

	it("keeps the gerund wording for normal status updates", () => {
		const handler = makeNoticeHandler(true);

		handler.setMessage("prompting", "Using custom prompt.");

		const rendered = noticeSetMessageMock.mock.calls.at(-1)?.[0] as string;
		expect(rendered).toContain("Assistant is prompting.");
		expect(rendered).toContain("Using custom prompt.");
	});
});
