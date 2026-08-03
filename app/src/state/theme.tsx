import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemeMode, "auto">;

type ThemeContextValue = {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
};

// v2 resets the redesigned workbench to its canonical light-first appearance.
const storageKey = "second-brain-os.theme.v2";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "auto" || value === "light" || value === "dark";
}

function storedThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const value = window.localStorage.getItem(storageKey);
  return isThemeMode(value) ? value : "light";
}

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  const matchMedia = Reflect.get(window, "matchMedia") as
    | ((query: string) => MediaQueryList)
    | undefined;
  return matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(storedThemeMode);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolvedTheme = mode === "auto" ? system : mode;

  useEffect(() => {
    const matchMedia = Reflect.get(window, "matchMedia") as
      | ((query: string) => MediaQueryList)
      | undefined;
    if (!matchMedia) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      setSystem(media.matches ? "dark" : "light");
    };
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, mode);
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [mode, resolvedTheme]);

  const value = useMemo(
    () => ({ mode, resolvedTheme, setMode }),
    [mode, resolvedTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// Hooks intentionally share their provider module to keep this state seam atomic.
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
