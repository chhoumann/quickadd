import { Notice } from "obsidian";

const noticeMsg = (task: string, message: string) =>
	`Assistant is ${task}.${message ? `\n\n${message}` : ""}`;

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
