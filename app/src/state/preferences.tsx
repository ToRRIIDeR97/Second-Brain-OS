import { createContext, useContext, useState, type ReactNode } from "react";

type PreferencesContextValue = {
  editorAutosave: boolean;
  setEditorAutosave: (enabled: boolean) => void;
  formatOnSave: boolean;
  setFormatOnSave: (enabled: boolean) => void;
};

const storageKey = "second-brain-os.preferences.v1";
const PreferencesContext = createContext<PreferencesContextValue | null>(null);

type StoredPreferences = {
  editorAutosave?: unknown;
  formatOnSave?: unknown;
};

function storedPreferences(): StoredPreferences {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as StoredPreferences;
  } catch {
    return {};
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const stored = storedPreferences();
  const [editorAutosave, setAutosaveState] = useState(
    stored.editorAutosave === true,
  );
  const [formatOnSave, setFormatOnSaveState] = useState(
    stored.formatOnSave === true,
  );
  const persist = (next: StoredPreferences) => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ editorAutosave, formatOnSave, ...next }),
    );
  };
  const setEditorAutosave = (enabled: boolean) => {
    setAutosaveState(enabled);
    persist({ editorAutosave: enabled });
  };
  const setFormatOnSave = (enabled: boolean) => {
    setFormatOnSaveState(enabled);
    persist({ formatOnSave: enabled });
  };
  const value = {
    editorAutosave,
    setEditorAutosave,
    formatOnSave,
    setFormatOnSave,
  };
  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context)
    throw new Error("usePreferences must be used inside PreferencesProvider");
  return context;
}
