/** Copy for the full-screen environment, kept in one place so `lint:claims` sees it. */
export const ENTER_ENVIRONMENT = "Enter environment";
export const EXIT_ENVIRONMENT = "Exit environment";
export const ENVIRONMENT_LABEL = "Body twin environment";
export const PRESET_LABEL = "Environment";
export const PRESET_TEXT = { studio: "Studio", outdoors: "Outdoors, abstract" } as const;
export const FOLLOW_TIME = "Follow local time";
export const ABSTRACT_NOTE = "An abstract space, not a real place. Esc exits.";
export const LIGHT_FOLLOWS_CLOCK = "Light follows this device's clock.";
export const LIGHT_AT_MIDDAY = "Light fixed at midday.";
export const PANEL_TEXT = {
  scene: "Scene",
  anatomy: "Anatomy",
  details: "Details",
} as const;
export const HOW_TO_MOVE = "How to move";
export const WALK_HINT =
  "With the 3D view focused, W A S D or the arrow keys walk and Enter selects what is in the middle. On touch, two fingers drag to walk. Select an organ for details.";
export const VIEW_LABEL =
  "3D view. W A S D or arrow keys walk; Enter or Space selects what is in the middle.";
export const pickedLabel = (name: string): string => `Picked: ${name}`;
export const CARD_ATLAS_NOTE = "Reference anatomy from a donor atlas, not this body.";
export const BODY_CARD_TITLE = "Body outline";
export const BODY_CARD_NOTE = "Move the depth slider to see muscle, skeleton and organs.";
export const LINKED_BIOMARKERS = "Linked biomarkers";
export const NO_LINKED_BIOMARKERS = "No Anchor biomarker is linked to this part.";
export const CLOSE_CARD = "Close";
