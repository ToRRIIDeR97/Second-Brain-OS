import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { PreferencesProvider, usePreferences } from "./preferences";

function Harness() {
  const preferences = usePreferences();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          preferences.setEditorAutosave(true);
        }}
      >
        autosave {String(preferences.editorAutosave)}
      </button>
      <button
        type="button"
        onClick={() => {
          preferences.setFormatOnSave(true);
        }}
      >
        format {String(preferences.formatOnSave)}
      </button>
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

test("persists editor preferences without dropping sibling settings", () => {
  render(
    <PreferencesProvider>
      <Harness />
    </PreferencesProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "autosave false" }));
  fireEvent.click(screen.getByRole("button", { name: "format false" }));

  expect(
    JSON.parse(
      window.localStorage.getItem("second-brain-os.preferences.v1") ?? "{}",
    ),
  ).toEqual({ editorAutosave: true, formatOnSave: true });
});
