# Design QA — Codex-style tabs and modern overlays

## Evidence

- Source visual truth:
  - `/var/folders/vn/p7prypys0s729ltdcmw0rbb40000gn/T/codex-clipboard-dfc2c091-75be-4071-8783-89cb6802e89b.png` — Codex tab reference, 1730 × 96 px.
  - `/var/folders/vn/p7prypys0s729ltdcmw0rbb40000gn/T/codex-clipboard-e2f3d687-8066-4a57-bbc6-9d299d6c130d.png` — original Tasks state, 1476 × 1876 px.
  - `/var/folders/vn/p7prypys0s729ltdcmw0rbb40000gn/T/codex-clipboard-222397cd-e2a5-4f5d-a85e-265d2b9b00e3.png` — original search modal, 1878 × 1914 px.
- Rendered implementation:
  - `/private/tmp/second-brain-tasks-theme.png` — corrected live shell, tabs, and Tasks empty state.
  - `/private/tmp/second-brain-search-theme.png` — corrected live Knowledge search modal.
- Implementation captures: 3600 × 2338 px, approximately 1800 × 1169 CSS points at device scale factor 2.
- State: light application theme with Codex-style tab geometry; Tasks/Today empty state; Knowledge search open and focused.
- Density normalization: no resampling. References are differently cropped source captures, so comparison used visible component proportions, color hierarchy, spacing, and state rather than absolute full-frame pixel alignment.

## Full-view comparison

The live shell now uses the Codex tab structure across the resource and utility columns while retaining the selected application theme. Active tabs are compact rounded pills, inactive labels are subdued, plus/close controls use the same low-contrast icon treatment, and the blue underline/rectangular-tab language is gone.

The Tasks view keeps the same content and form behavior but replaces the outlined filter buttons with the shared dark tab treatment. Its empty state is now a compact, solid, top-aligned panel rather than a large dashed region consuming most of the viewport.

The Knowledge search overlay is centered, theme-aware, and structured. Header, close icon, input, action, and empty copy have clear spacing and contrast; the close action is aligned to the top-right instead of falling below the heading.

## Focused comparison

- Tab chrome: compared the Codex strip directly with both live resource and utility strips. Radius, spacing, active/inactive hierarchy, and icon-adjacent actions are consistent; color intentionally follows the application's selected theme.
- Planner tabs and empty state: compared the original Tasks crop with the live Tasks surface. The live result has substantially lower visual weight and more deliberate vertical rhythm.
- Search dialog: compared the original modal crop with the live open modal. The missing header/form layout is resolved, and the dark surface now matches the selected tab language.

## Required fidelity surfaces

- Fonts and typography: retained the product's Inter/system stack; active labels use compact 11–12 px UI weights, headings remain legible, and long search-result text truncates rather than overflowing.
- Spacing and layout rhythm: tab wells use 5 px insets, 3 px gaps, 34 px controls, 8–9 px radii, and aligned close/add targets. Planner and dialog spacing is compact and regular.
- Colors and visual tokens: shared tab and overlay tokens derive from the active theme. Light mode stays light; dark mode uses the existing dark-theme palette without introducing a hardcoded black scheme.
- Image quality and assets: no raster assets were introduced. Handcrafted tab SVGs and text glyph controls were replaced with the installed Lucide icon set for consistent rendering.
- Copy and content: application copy and task/search behavior remain unchanged.

## Comparison history

1. Initial findings:
   - P1: multiple live tab systems used unrelated light rectangles and blue underlines instead of the supplied Codex treatment.
   - P1: the Knowledge search header and form lacked active layout rules, leaving the close action misplaced and hierarchy unclear.
   - P2: the Tasks empty state was oversized and visually heavy.
2. Fixes made:
   - Added shared tab tokens and applied the Codex geometry to resource, utility, terminal, inspector, planner, and editor-mode tabs.
   - Added complete overlay/header/form/result styling for Knowledge search, Command Palette, and shared dialogs.
   - Added focus trapping/restoration and Lucide close/add icons.
   - Compacted the planner form and empty state.
3. Correction after review:
   - Finding: the first implementation copied the Codex reference color as well as its design, making light-mode tabs and overlays black.
   - Fix: changed all new tab and overlay tokens to derive from `--surface`, `--text`, and related active-theme tokens; retained only the rounded-pill layout and interaction design.
4. Post-fix evidence:
   - `/private/tmp/second-brain-tasks-theme.png`
   - `/private/tmp/second-brain-search-theme.png`
   - No actionable P0, P1, or P2 visual mismatch remains in the compared states.

## Follow-up polish

- P3: the blue primary action in the light planner remains intentionally semantic rather than being made monochrome.
- States outside the supplied references, such as populated search results and dense multi-terminal strips, were covered by shared rules and automated checks but were not part of the focused screenshot comparison.

final result: passed
