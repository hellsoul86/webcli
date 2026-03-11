import type { TextElement } from "./TextElement";
export type UserMessageEvent = {
    message: string;
    /**
     * Image URLs sourced from `UserInput::Image`. These are safe
     * to replay in legacy UI history events and correspond to images sent to
     * the model.
     */
    images: Array<string> | null;
    /**
     * Local file paths sourced from `UserInput::LocalImage`. These are kept so
     * the UI can reattach images when editing history, and should not be sent
     * to the model or treated as API-ready URLs.
     */
    local_images: Array<string>;
    /**
     * UI-defined spans within `message` used to render or persist special elements.
     */
    text_elements: Array<TextElement>;
};
//# sourceMappingURL=UserMessageEvent.d.ts.map