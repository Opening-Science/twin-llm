import { type PanelTab } from "./body-panel";

/**
 * The body panel's search, tab, hovered row and the open state of the
 * "no value" section. They live in the viewer, not the panel: the panel moves
 * between the rail and its standalone place when a scan with a mesh is swapped
 * for one without, and that move remounts it.
 *
 * A changed search or tab clears the hover. A hovered row that the search
 * filters out never gets its mouseleave, so it would keep lighting the canvas.
 */
export type PanelState = Readonly<{
  query: string;
  /** null until the person picks a tab; the default then follows the data. */
  tab: PanelTab | null;
  hoverId: string | null;
  otherOpen: boolean;
}>;

export type PanelAction =
  | Readonly<{ type: "query"; query: string }>
  | Readonly<{ type: "tab"; tab: PanelTab }>
  | Readonly<{ type: "hover"; id: string | null }>
  | Readonly<{ type: "other"; open: boolean }>;

export const initialPanel: PanelState = {
  query: "",
  tab: null,
  hoverId: null,
  otherOpen: false,
};

export const panelReducer = (state: PanelState, action: PanelAction): PanelState => {
  switch (action.type) {
    case "query":
      return { ...state, query: action.query, hoverId: null };
    case "tab":
      return { ...state, tab: action.tab, hoverId: null };
    case "hover":
      return state.hoverId === action.id ? state : { ...state, hoverId: action.id };
    case "other":
      return { ...state, otherOpen: action.open };
  }
};
