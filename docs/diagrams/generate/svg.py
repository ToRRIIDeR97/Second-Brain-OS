# Shared SVG helpers for docs/diagrams. Output is script-free and follows prefers-color-scheme.
"""Tiny SVG builder for the docs/diagrams set. Script-free, theme-aware output."""
from xml.sax.saxutils import escape

STYLE = """
<style>
  .bg{fill:#ffffff}
  text{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-size:13px;fill:#1f2328}
  .t{font-weight:600}
  .s{font-size:11.5px;fill:#57606a}
  .h{font-size:16px;font-weight:600}
  .lbl{font-size:11px;fill:#424a53}
  .lblbg{fill:#ffffff;opacity:.92}
  .box{fill:#f6f8fa;stroke:#57606a;stroke-width:1.2}
  .sub{fill:#ffffff;stroke:#8c959f;stroke-width:1}
  .store{fill:#fff8e5;stroke:#9a6700;stroke-width:1.2}
  .ext{fill:#ddf4ff;stroke:#0969da;stroke-width:1.2}
  .proc{fill:#fbefff;stroke:#8250df;stroke-width:1.2}
  .zone{fill:none;stroke:#8c959f;stroke-width:1.2;stroke-dasharray:7 5}
  .zonet{font-size:12px;font-weight:600;fill:#57606a}
  .gapz{fill:#fff1f0;stroke:#cf222e;stroke-width:1.2}
  .e{fill:none;stroke:#57606a;stroke-width:1.3}
  .d{stroke-dasharray:5 4}
  .r{stroke:#cf222e}
  .sens{stroke:#bc4c00;stroke-width:2}
  .ah{fill:#57606a}
  .ahr{fill:#cf222e}
  .ahs{fill:#bc4c00}
  .life{stroke:#8c959f;stroke-width:1;stroke-dasharray:4 4}
  .act{fill:#eaeef2;stroke:#57606a;stroke-width:1}
  .frag{fill:none;stroke:#8c959f;stroke-width:1}
  .fragt{fill:#eaeef2;stroke:#8c959f;stroke-width:1}
  .dot{fill:#1f2328}
  .ring{fill:none;stroke:#1f2328;stroke-width:1.5}
  .dia{fill:#ffffff;stroke:#57606a;stroke-width:1.2}
  .bar{fill:#1f2328}
  @media (prefers-color-scheme: dark){
    .bg{fill:#0d1117}
    text{fill:#e6edf3}
    .s{fill:#9198a1} .lbl{fill:#c9d1d9} .lblbg{fill:#0d1117}
    .box{fill:#161b22;stroke:#8b949e} .sub{fill:#0d1117;stroke:#6e7681}
    .store{fill:#2b2111;stroke:#d29922} .ext{fill:#0c2d4a;stroke:#4493f8}
    .proc{fill:#271a3d;stroke:#ab7df8}
    .zone{stroke:#6e7681} .zonet{fill:#9198a1}
    .gapz{fill:#3a1517;stroke:#f85149}
    .e{stroke:#9198a1} .r{stroke:#f85149} .sens{stroke:#f0883e}
    .ah{fill:#9198a1} .ahr{fill:#f85149} .ahs{fill:#f0883e}
    .life{stroke:#6e7681} .act{fill:#21262d;stroke:#8b949e}
    .frag{stroke:#6e7681} .fragt{fill:#21262d;stroke:#6e7681}
    .dot{fill:#e6edf3} .ring{stroke:#e6edf3} .dia{fill:#0d1117;stroke:#8b949e} .bar{fill:#e6edf3}
  }
</style>
<defs>
  <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z"/></marker>
  <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="ahr" d="M0,0 L10,5 L0,10 z"/></marker>
  <marker id="as" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="ahs" d="M0,0 L10,5 L0,10 z"/></marker>
  <marker id="o" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path class="e" d="M0,0 L10,5 L0,10"/></marker>
  <marker id="dm" viewBox="0 0 12 12" refX="1" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path class="bar" d="M1,6 L6,1 L11,6 L6,11 z"/></marker>
</defs>
"""


class SVG:
    def __init__(self, w, h, title, desc):
        self.w, self.h = w, h
        self.parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-labelledby="title desc">',
            f"<title id=\"title\">{escape(title)}</title>",
            f"<desc id=\"desc\">{escape(desc)}</desc>",
            STYLE,
            f'<rect class="bg" x="0" y="0" width="{w}" height="{h}"/>',
        ]
        self.labels = []

    def text(self, x, y, s, cls="", anchor="start"):
        c = f' class="{cls}"' if cls else ""
        self.parts.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}"{c}>{escape(s)}</text>')

    def heading(self, s, sub=None):
        self.text(20, 28, s, "h")
        if sub:
            self.text(20, 46, sub, "s")

    def box(self, x, y, w, h, title, lines=(), cls="box", stereo=None, rx=6, center=False):
        self.parts.append(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>')
        ty = y + 18
        cx = x + w / 2
        anc = "middle" if center else "start"
        tx = cx if center else x + 10
        if stereo:
            self.text(tx, ty, f"«{stereo}»", "s", anc)
            ty += 16
        self.text(tx, ty, title, "t", anc)
        for ln in lines:
            ty += 16
            self.text(tx, ty, ln, "s", anc)

    def zone(self, x, y, w, h, title, cls="zone"):
        self.parts.append(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="10"/>')
        self.text(x + 10, y + 16, title, "zonet")

    def edge(self, pts, label=None, at=None, cls="", head="a", tail=None, lanchor="middle"):
        d = "M" + " L".join(f"{px},{py}" for px, py in pts)
        mk = f' marker-end="url(#{head})"' if head else ""
        if tail:
            mk += f' marker-start="url(#{tail})"'
        self.parts.append(f'<path class="e {cls}" d="{d}"{mk}/>')
        if label:
            if at is None:
                (x1, y1), (x2, y2) = pts[len(pts) // 2 - 1], pts[len(pts) // 2]
                at = ((x1 + x2) / 2, (y1 + y2) / 2 - 4)
            self.label(at[0], at[1], label, lanchor)

    def label(self, x, y, s, anchor="middle"):
        lines = s.split("\n")
        for i, ln in enumerate(lines):
            w = len(ln) * 5.9 + 6
            lx = x - w / 2 if anchor == "middle" else (x - 3 if anchor == "start" else x - w + 3)
            ly = y + i * 13
            self.labels.append(f'<rect class="lblbg" x="{lx:.1f}" y="{ly - 10:.1f}" width="{w:.1f}" height="13" rx="2"/>')
            self.labels.append(f'<text class="lbl" x="{x}" y="{ly}" text-anchor="{anchor}">{escape(ln)}</text>')

    def raw(self, s):
        self.parts.append(s)

    # activity / state primitives
    def start(self, x, y):
        self.raw(f'<circle class="dot" cx="{x}" cy="{y}" r="8"/>')

    def final(self, x, y):
        self.raw(f'<circle class="ring" cx="{x}" cy="{y}" r="10"/><circle class="dot" cx="{x}" cy="{y}" r="6"/>')

    def decision(self, x, y, r=14):
        self.raw(f'<path class="dia" d="M{x},{y - r} L{x + r},{y} L{x},{y + r} L{x - r},{y} z"/>')

    def node(self, x, y, w, h, s, sub=None, cls="act"):
        self.raw(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{min(h / 2, 14)}"/>')
        if sub:
            self.text(x + w / 2, y + h / 2 - 2, s, "t", "middle")
            self.text(x + w / 2, y + h / 2 + 13, sub, "s", "middle")
        else:
            self.text(x + w / 2, y + h / 2 + 4, s, "", "middle")

    # sequence primitives
    def lifelines(self, parts, top, bottom, w=150):
        for name, x, stereo in parts:
            self.box(x - w / 2, top, w, 44 if stereo else 30, name, [stereo] if stereo else [], cls="box", center=True)
            self.raw(f'<line class="life" x1="{x}" y1="{top + (44 if stereo else 30)}" x2="{x}" y2="{bottom}"/>')

    def msg(self, x1, x2, y, s, reply=False, cls="", head=None):
        if x1 == x2:
            self.edge([(x1, y), (x1 + 40, y), (x1 + 40, y + 16), (x1 + 2, y + 16)], cls=cls, head=head or "a")
            self.label(x1 + 46, y + 11, s, "start")
            return
        self.edge([(x1, y), (x2, y)], cls=("d " if reply else "") + cls, head=head or ("o" if reply else "a"))
        self.label((x1 + x2) / 2, y - 5, s)

    def frag(self, x, y, w, h, kind, guard=None, dividers=()):
        self.raw(f'<rect class="frag" x="{x}" y="{y}" width="{w}" height="{h}"/>')
        tw = len(kind) * 7.5 + 16
        self.raw(f'<path class="fragt" d="M{x},{y} h{tw} v12 l-8,8 h-{tw - 8} z"/>')
        self.text(x + 6, y + 14, kind, "t")
        if guard:
            self.text(x + tw + 8, y + 15, guard, "s")
        for dy, g in dividers:
            self.raw(f'<line class="frag d" x1="{x}" y1="{dy}" x2="{x + w}" y2="{dy}" style="stroke-dasharray:6 4"/>')
            self.text(x + 8, dy + 15, g, "s")

    def save(self, path):
        out = "\n".join(self.parts + self.labels + ["</svg>\n"])
        with open(path, "w") as f:
            f.write(out)
