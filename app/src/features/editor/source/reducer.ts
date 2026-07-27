import type {
  EditorState,
  EditorTabState,
  FileReadResult,
  FileWriteResult,
  ViewState,
} from "./types";

export type EditorAction =
  | { type: "openRequested"; tab: EditorTabState }
  | {
      type: "openSucceeded";
      resourceId: string;
      request: number;
      file: FileReadResult;
    }
  | { type: "openFailed"; resourceId: string; request: number }
  | { type: "contentChanged"; resourceId: string; content: string }
  | { type: "saveRequested"; resourceId: string }
  | {
      type: "saveSucceeded";
      resourceId: string;
      file: FileWriteResult;
      content: string;
    }
  | {
      type: "saveConflict";
      resourceId: string;
      externalChange: EditorTabState["externalChange"];
    }
  | {
      type: "externalChanged";
      resourceId: string;
      kind: EditorTabState["externalChange"];
    }
  | { type: "renamed"; resourceId: string; relativePath: string }
  | { type: "viewChanged"; resourceId: string; viewState: ViewState }
  | { type: "activate"; resourceId: string }
  | { type: "close"; resourceId: string }
  | { type: "reopen"; resourceId: string };

export const initialEditorState: EditorState = {
  tabs: {},
  order: [],
  closed: [],
};

function updateTab(
  state: EditorState,
  resourceId: string,
  update: (tab: EditorTabState) => EditorTabState,
): EditorState {
  const tab = state.tabs[resourceId];
  if (!tab) return state;
  return { ...state, tabs: { ...state.tabs, [resourceId]: update(tab) } };
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "openRequested": {
      const existing = state.tabs[action.tab.resourceId];
      if (existing)
        return { ...state, activeResourceId: action.tab.resourceId };
      return {
        ...state,
        tabs: { ...state.tabs, [action.tab.resourceId]: action.tab },
        order: [...state.order, action.tab.resourceId],
        activeResourceId: action.tab.resourceId,
      };
    }
    case "openSucceeded":
      return updateTab(state, action.resourceId, (tab) => {
        if (tab.openRequest !== action.request) return tab;
        return {
          ...tab,
          content: action.file.content,
          baseContent: action.file.content,
          baseHash: action.file.contentHash,
          baseRevisionId: action.file.revisionId,
          encoding: action.file.encoding,
          eol: action.file.eol,
          status: "clean",
          externalChange: "none",
        };
      });
    case "openFailed":
      return updateTab(state, action.resourceId, (tab) =>
        tab.openRequest === action.request
          ? { ...tab, status: "conflict" }
          : tab,
      );
    case "contentChanged":
      return updateTab(state, action.resourceId, (tab) => ({
        ...tab,
        content: action.content,
        status: action.content === tab.baseContent ? "clean" : "dirty",
      }));
    case "saveRequested":
      return updateTab(state, action.resourceId, (tab) =>
        tab.status === "dirty" || tab.status === "conflict"
          ? { ...tab, status: "saving" }
          : tab,
      );
    case "saveSucceeded":
      return updateTab(state, action.resourceId, (tab) => ({
        ...tab,
        content: action.content,
        baseContent: action.content,
        baseHash: action.file.contentHash,
        baseRevisionId: action.file.revisionId,
        status: "clean",
        externalChange: "none",
      }));
    case "saveConflict":
      return updateTab(state, action.resourceId, (tab) => ({
        ...tab,
        status: "conflict",
        externalChange: action.externalChange,
      }));
    case "externalChanged":
      return updateTab(state, action.resourceId, (tab) => ({
        ...tab,
        externalChange: action.kind,
        status: tab.status === "clean" ? "clean" : tab.status,
      }));
    case "renamed":
      return updateTab(state, action.resourceId, (tab) => ({
        ...tab,
        relativePath: action.relativePath,
        externalChange: "renamed",
      }));
    case "viewChanged":
      return updateTab(state, action.resourceId, (tab) => ({
        ...tab,
        viewState: action.viewState,
      }));
    case "activate":
      return state.tabs[action.resourceId]
        ? { ...state, activeResourceId: action.resourceId }
        : state;
    case "close": {
      const tab = state.tabs[action.resourceId];
      if (!tab) return state;
      const tabs = Object.fromEntries(
        Object.entries(state.tabs).filter(
          ([resourceId]) => resourceId !== action.resourceId,
        ),
      );
      const order = state.order.filter(
        (resourceId) => resourceId !== action.resourceId,
      );
      const activeResourceId =
        state.activeResourceId === action.resourceId
          ? order.at(-1)
          : state.activeResourceId;
      const nextState = {
        ...state,
        tabs,
        order,
        closed: [tab, ...state.closed].slice(0, 20),
      };
      return activeResourceId === undefined
        ? nextState
        : { ...nextState, activeResourceId };
    }
    case "reopen": {
      const tab = state.closed.find(
        (candidate) => candidate.resourceId === action.resourceId,
      );
      if (!tab || state.tabs[tab.resourceId]) return state;
      return {
        ...state,
        tabs: { ...state.tabs, [tab.resourceId]: tab },
        order: [...state.order, tab.resourceId],
        activeResourceId: tab.resourceId,
        closed: state.closed.filter(
          (candidate) => candidate.resourceId !== action.resourceId,
        ),
      };
    }
  }
}
