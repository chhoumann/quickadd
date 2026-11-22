import { beforeEach, describe, expect, it, vi } from "vitest";

const { NoticeMock, noticeSetMessageMock, noticeHideMock } = vi.hoisted(
	() => {
		const noticeSetMessageMock = vi.fn();
		const noticeHideMock = vi.fn();
		const NoticeMock = vi.fn(function NoticeMock() {
			return {
				setMessage: noticeSetMessageMock,
				hide: noticeHideMock,
			};
		});

		return {
			NoticeMock,
			noticeSetMessageMock,
			noticeHideMock,
		};
	},
);

vi.mock("obsidian", () => ({
	Notice: NoticeMock,
}));

import { makeNoticeHandler } from "./makeNoticeHandler";

describe("makeNoticeHandler", () => {
	beforeEach(() => {
		NoticeMock.mockClear();
		noticeSetMessageMock.mockClear();
		noticeHideMock.mockClear();
	});

	it("returns no-op handler when assistant messages are disabled", () => {
		const handler = makeNoticeHandler(false);

		handler.setMessage("prompting", "Using custom prompt.");
		handler.setMessage("prompting", "Using custom prompt. (0.10s)");
		handler.hide();

		expect(NoticeMock).not.toHaveBeenCalled();
		expect(noticeSetMessageMock).not.toHaveBeenCalled();
		expect(noticeHideMock).not.toHaveBeenCalled();
	});

	it("uses Notice when assistant messages are enabled", () => {
		const handler = makeNoticeHandler(true);

		handler.setMessage("prompting", "Using custom prompt.");
		handler.hide();

		expect(NoticeMock).toHaveBeenCalledTimes(1);
		expect(noticeSetMessageMock).toHaveBeenCalledTimes(1);
		expect(noticeHideMock).toHaveBeenCalledTimes(1);
	});

	it("renders the failure status as a clear headline with the detail after it", () => {
		const handler = makeNoticeHandler(true);

		handler.setMessage("dead", "Request failed (HTTP 401): invalid api key");

		const rendered = noticeSetMessageMock.mock.calls.at(-1)?.[0] as string;
		expect(rendered).not.toContain("Assistant is dead.");
		expect(rendered).toContain("AI request failed.");
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
