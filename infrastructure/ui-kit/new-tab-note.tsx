/**
 * Words a screen reader says after a link that opens a new tab, so moving
 * to another tab is never a surprise. Hidden on screen; put it inside the
 * link, after its text.
 */

export const NEW_TAB_NOTE = " (opens in a new tab)";

export const NewTabNote = () => <span className="sr-only">{NEW_TAB_NOTE}</span>;
