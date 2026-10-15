# App icons

Each channel folder (`dev`, `beta`, `prod`) holds the icon set that
`scripts/copy-icons.ts` copies into `resources/icons` before packaging.

The source is the Tenon Workbench mark in `tenon-mark.svg`: two halves whose
tabs and slots interlock, on a rounded tile, drawn on a 120-unit grid.
`scripts/render-icons.py`
renders every PNG, `icon.ico` and `icon.icns` in the three channel folders, and
the web favicons in `packages/app/public`, from the same geometry:

- `prod` and `dev`: accent blue tile (`#3b5cf6`) with a white mark.
- `beta`: light tile (`#ecf1fe`) with a blue mark.
- `dock.png` and `icon.icns` use the macOS Big Sur inset (824/1024 tile).

Run it from the repository root after changing the mark (requires Python 3
with Pillow):

```sh
python opencode/packages/desktop/scripts/render-icons.py .
```

Keep the SVG and the script's geometry in sync.
