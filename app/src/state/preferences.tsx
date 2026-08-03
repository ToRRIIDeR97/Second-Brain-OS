import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type PreferencesContextValue = {
  editorAutosave: boolean;
  setEditorAutosave: (enabled: boolean) => void;
};

const storageKey = "second-brain-os.preferences.v1";
const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function storedAutosave() {
  if (typeof window === "undefined") return false;
  try {
    const value = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as {
      editorAutosave?: unknown;
    };
    return value.editorAutosave === true;
  } catch {
    return false;
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [editorAutosave, setAutosaveState] = useState(storedAutosave);
  const setEditorAutosave = (enabled: boolean) => {
    setAutosaveState(enabled);
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ editorAutosave: enabled }),
    );
  };
  const value = useMemo(
    () => ({ editorAutosave, setEditorAutosave }),
    [editorAutosave],
  );
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
