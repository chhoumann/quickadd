import { Notice } from "obsidian";

const noticeMsg = (task: string, message: string) => {
	// The "dead" status is the failure surface; "Assistant is dead." reads as a
	// jarring, unhelpful headline, so use clear failure wording instead.
	const headline =
		task === "dead" ? "AI request failed." : `Assistant is ${task}.`;
	return `${headline}${message ? `\n\n${message}` : ""}`;
};

interface NoticeHandler {
    setMessage: (status: string, msg: string) => void;
    hide: () => void;
}
export function makeNoticeHandler(showMessages: boolean): NoticeHandler {
    if (showMessages) {
        const n = new Notice(noticeMsg("starting", ""), 1000000);

        return {
            setMessage: (status: string, msg: string) => {
                n.setMessage(noticeMsg(status, msg));
            },
            hide: () => n.hide(),
        };
    }

    return {
        setMessage: () => { },
        hide: () => { },
    };
}
