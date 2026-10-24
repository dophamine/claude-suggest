"""Draws the animated feature demos in assets/demo-*.svg. Run: python3 scripts/demo-svgs.py [out_dir]"""

import os
import sys
from xml.sax.saxutils import escape

CW = 8.4  # monospace cell width at 14px
FS = 14
W = 800
X0 = 20
C = dict(
    bg='#232323', bar='#2e2e2e', border='#3a3a3a', row='#303030',
    fg='#d6d6d6', bright='#ececec', dim='#8a8a8a', faint='#5e5e5e',
    blue='#7ea6dc', caret='#5b7aa6', orange='#d77757', pink='#f06bb5',
)
FONT = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"DejaVu Sans Mono",monospace'


def col(c):
    return X0 + c * CW


class Scene:
    def __init__(self, title, T, H):
        self.title, self.T, self.H = title, T, H
        self.css, self.body, self.n = [], [], 0

    # -- animation plumbing -------------------------------------------------
    def kf(self, frames, extra=''):
        """frames: [(t, 'css decls', timing-or-None)]; returns a class name."""
        self.n += 1
        name = f'k{self.n}'
        steps = []
        for t, decl, timing in frames:
            pct = max(0.0, min(100.0, t / self.T * 100))
            tf = f'animation-timing-function:{timing};' if timing else ''
            steps.append(f'{pct:.3f}%{{{decl};{tf}}}')
        self.css.append(f'@keyframes {name}{{{"".join(steps)}}}')
        self.css.append(f'.{name}{{animation:{name} {self.T}s linear infinite;{extra}}}')
        return name

    def show(self, inner, t_in=0, t_out=None, fade=0.12):
        t_out = self.T + 1 if t_out is None else t_out
        if t_in <= 0 and t_out > self.T:
            self.body.append(inner)
            return
        fr = [(0, 'opacity:0' if t_in > 0 else 'opacity:1', None)]
        if t_in > 0:
            fr += [(t_in, 'opacity:0', None), (t_in + fade, 'opacity:1', None)]
        if t_out <= self.T:
            fr += [(t_out, 'opacity:1', None), (t_out + fade, 'opacity:0', None)]
        fr.append((self.T, 'opacity:1' if t_out > self.T else 'opacity:0', None))
        self.body.append(f'<g class="{self.kf(fr)}">{inner}</g>')

    # -- drawing primitives ---------------------------------------------------
    @staticmethod
    def text(c, y, s, fill=C['fg'], bold=False, italic=False, x=None):
        attrs = f'x="{col(c) if x is None else x:.1f}" y="{y}" fill="{fill}"'
        if bold:
            attrs += ' font-weight="700"'
        if italic:
            attrs += ' font-style="italic"'
        return (f'<text {attrs} textLength="{len(s) * CW:.1f}" '
                f'lengthAdjust="spacingAndGlyphs">{escape(s)}</text>')

    @staticmethod
    def rowbg(y, fill=C['row']):
        return f'<rect x="10" y="{y - 15}" width="{W - 20}" height="22" fill="{fill}"/>'

    def prompt(self, y, s, t_in=0, t_out=None, glyph='❯', glyph_fill=C['fg']):
        self.show(self.rowbg(y) + self.text(0, y, glyph, glyph_fill) + self.text(2, y, s), t_in, t_out)

    def reply(self, y, lines, t_in=0, t_out=None, spin_from=None):
        if spin_from is not None:
            self.spinner(y, spin_from, t_in)
        out = self.text(0, y, '●', C['bright'])
        for i, line in enumerate(lines):
            out += self.text(2, y + i * 20, line)
        self.show(out, t_in, t_out)

    def spinner(self, y, t_in, t_out, word='Brewing…'):
        glyphs = '·✢✳✶✻✽'
        n = int((t_out - t_in) / 0.15)
        inner = ''
        for i in range(max(n, 1)):
            g = glyphs[i % len(glyphs)]
            a = t_in + i * 0.15
            fr = [(0, 'opacity:0', None), (a, 'opacity:1', None), (a + 0.15, 'opacity:0', None), (self.T, 'opacity:0', None)]
            inner += f'<g class="{self.kf(fr)}">{self.text(0, y, g, C["orange"])}</g>'
        inner += self.text(2, y, word, C['orange'])
        self.show(inner, t_in, t_out, fade=0.05)

    def button(self, y, label, t_in, t_out=None, engine=False, hover=None, hover_edit=None):
        b = f'[ {label} ]'
        out = (self.text(0, y, '✻', C['dim']) if engine else '') + self.text(2, y, b, C['bright'], bold=True)
        out += self.text(3 + len(b), y, '✎', C['faint'])
        self.show(out, t_in, t_out)
        if hover:
            self.show(self.rowbg(y, C['bg']) + (self.text(0, y, '✻', C['dim']) if engine else '')
                      + self.text(2, y, b, C['blue'], bold=True) + self.text(3 + len(b), y, '✎', C['faint']),
                      hover[0], hover[1], fade=0.08)
        if hover_edit:
            self.show(f'<rect x="{col(3 + len(b)) - 2:.1f}" y="{y - 15}" width="{CW + 4:.1f}" height="22" fill="{C["bg"]}"/>'
                      + self.text(3 + len(b), y, '✎', C['blue'], bold=True), hover_edit[0], hover_edit[1], fade=0.08)

    def btn_x(self, label, edit=False):
        """Pointer target for a button's label, or for its ✎."""
        b = f'[ {label} ]'
        return col(3 + len(b)) + 3 if edit else col(2) + min(len(b), 14) * CW / 2

    def typing(self, c, y, s, t0, cps, bg, fill=C['fg'], caret=True):
        """Text revealed one cell at a time by sliding a cover (with the caret on its left edge)."""
        n = len(s)
        t1 = t0 + n / cps
        slide = self.kf([(0, 'transform:translateX(0px)', None),
                         (t0, 'transform:translateX(0px)', f'steps({n},end)'),
                         (t1, f'transform:translateX({n * CW:.1f}px)', None),
                         (self.T, f'transform:translateX({n * CW:.1f}px)', None)])
        cover = f'<rect x="{col(c):.1f}" y="{y - 15}" width="{(n + 1) * CW + 2:.1f}" height="22" fill="{bg}"/>'
        if caret:
            cover += f'<rect x="{col(c):.1f}" y="{y - 14}" width="{CW:.1f}" height="19" fill="{C["caret"]}"/>'
        return self.text(c, y, s, fill) + f'<g class="{slide}">{cover}</g>', t1

    def caret(self, c, y):
        return f'<rect x="{col(c):.1f}" y="{y - 14}" width="{CW:.1f}" height="19" fill="{C["caret"]}"/>'

    def pointer(self, waypoints, clicks=()):
        """waypoints: [(t, x, y)]; the pointer glides between them."""
        fr = []
        for i, (t, x, y) in enumerate(waypoints):
            fr.append((t, f'transform:translate({x:.1f}px,{y:.1f}px)', 'cubic-bezier(.45,0,.25,1)'))
        fr = [(0, fr[0][1], None)] + fr + [(self.T, fr[-1][1], None)]
        arrow = ('<path d="M0,0 L0,17 L4.6,12.6 L7.6,19.4 L10.4,18.2 L7.4,11.6 L13.2,11.6 Z" '
                 'fill="#f4f4f4" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/>')
        rip = ''
        for t, x, y in clicks:
            k = self.kf([(0, 'opacity:0;transform:scale(.2)', None), (t, 'opacity:.9;transform:scale(.2)', 'ease-out'),
                         (t + 0.45, 'opacity:0;transform:scale(1.5)', None), (self.T, 'opacity:0;transform:scale(1.5)', None)],
                        extra='transform-box:fill-box;transform-origin:center;')
            rip += f'<circle class="{k}" cx="{x:.1f}" cy="{y:.1f}" r="12" fill="none" stroke="{C["blue"]}" stroke-width="2"/>'
        self.top = rip + f'<g class="{self.kf(fr)}">{arrow}</g>'

    # -- frame --------------------------------------------------------------
    def input_box(self, glyph_fill=None):
        """Static input chrome; scenes draw its contents at self.in_y."""
        y1, y2 = self.H - 72, self.H - 36
        self.in_y = y1 + 23
        line = lambda y, c: f'<line x1="10" y1="{y}" x2="{W - 10}" y2="{y}" stroke="{c}" stroke-width="1"/>'
        return (line(y1, '#5a5a5a') + line(y2, '#5a5a5a')
                + self.text(0, self.H - 14, '? for shortcuts', C['faint']))

    def render(self):
        top = getattr(self, 'top', '')
        loop = self.kf([(0, 'opacity:0', None), (0.35, 'opacity:1', None),
                        (self.T - 0.45, 'opacity:1', None), (self.T, 'opacity:0', None)])
        return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{self.H}" viewBox="0 0 {W} {self.H}" role="img" aria-label="{escape(self.title)}">
<style>text{{font-family:{FONT};font-size:{FS}px;white-space:pre}}{"".join(self.css)}</style>
<rect x=".5" y=".5" width="{W - 1}" height="{self.H - 1}" rx="10" fill="{C['bg']}" stroke="{C['border']}"/>
<path d="M.5,32 V10.5 a10,10 0 0 1 10,-10 H{W - 10.5} a10,10 0 0 1 10,10 V32 Z" fill="{C['bar']}"/>
<circle cx="20" cy="16" r="5.5" fill="#ff5f57"/><circle cx="38" cy="16" r="5.5" fill="#febc2e"/><circle cx="56" cy="16" r="5.5" fill="#28c840"/>
<text x="{W / 2}" y="21" fill="{C['dim']}" text-anchor="middle" style="font-size:13px">{escape(self.title)}</text>
{self.chrome}
<g class="{loop}">
{chr(10).join(self.body)}
{top}
</g>
</svg>
'''


# ---------------------------------------------------------------------------

def scene_send():
    s = Scene('Suggest · click a reply to send it', T=12.5, H=380)
    s.chrome = s.input_box()
    iy = s.in_y
    s.prompt(64, 'Help me pick a weekend side project. Ask me one short question at a time.')
    s.reply(98, ['Do you want to build something useful for yourself, or something purely for fun?'], 2.0, spin_from=0.4)
    s.button(132, 'Something useful for myself', 2.2, 5.7, engine=True)
    s.show(s.text(2, 162, 'more suggestions…', C['dim']), 2.3, 3.5)
    s.button(162, 'Purely for fun', 3.6, 5.7, hover=(4.9, 5.7))
    s.button(192, 'A bit of both', 3.6, 5.7)
    s.show(s.text(0, 132, '› Prompt from the suggest plugin', C['faint']), 5.8)
    s.prompt(154, 'Purely for fun', 5.8)
    s.reply(188, ['Something visual, like games or art, or something that runs in the terminal?'], 7.5, spin_from=6.1)
    s.button(222, 'Visual, like games or art', 7.7, engine=True)
    s.show(s.text(2, 252, 'more suggestions…', C['dim']), 7.8, 8.9)
    s.button(252, 'Something for the terminal', 9.0)
    s.button(282, 'Surprise me', 9.0)
    # input: caret, plus Claude Code's own suggestion in dim
    s.show(s.text(0, iy, '❯', C['fg']) + s.caret(2, iy))
    s.show(s.text(2, iy, 'Something useful for myself', C['dim']), 2.2, 5.7)
    s.show(s.text(2, iy, 'Visual, like games or art', C['dim']), 7.7)
    tx, ty = s.btn_x('Purely for fun'), 157
    s.pointer([(0, 620, 300), (4.0, 620, 300), (4.9, tx, ty), (6.0, tx, ty), (7.0, 560, 310)], [(5.4, tx + 1, ty + 1)])
    return s


def scene_edit():
    s = Scene('Suggest · ✎ puts a reply in the input to edit first', T=13.5, H=340)
    s.chrome = s.input_box()
    iy = s.in_y
    s.prompt(64, 'Add a dark mode toggle to the settings page.')
    s.reply(98, ['Done: the toggle is in Settings › Appearance and saves to localStorage.',
                 'Should it follow the system theme by default?'], 2.0, spin_from=0.4)
    label = 'Yes, follow the system theme'
    s.button(152, label, 2.2, 8.6, engine=True, hover_edit=(4.6, 5.2))
    s.show(s.text(2, 182, 'more suggestions…', C['dim']), 2.3, 3.3)
    s.button(182, 'No, keep it manual', 3.4, 8.6)
    s.button(212, 'Run the tests first', 3.4, 8.6)
    s.prompt(152, 'Yes, follow the system theme, but keep the toggle as an override', 8.7)
    s.reply(186, ['Done. It follows the system theme until you flip the toggle.'], 10.1, spin_from=8.9)
    s.button(220, 'Run the tests', 10.3, engine=True)
    # input
    s.show(s.text(0, iy, '❯', C['fg']))
    s.show(s.caret(2, iy), 0, 2.2)
    s.show(s.caret(2, iy) + s.text(2, iy, label, C['dim']), 2.2, 5.0, fade=0.05)
    typed, t1 = s.typing(2 + len(label), iy, ', but keep the toggle as an override', 5.7, 16, C['bg'])
    s.show(s.text(2, iy, label) + typed, 5.0, 8.6, fade=0.05)
    s.show(s.caret(2, iy), 8.6)
    ex = s.btn_x(label, edit=True)
    s.pointer([(0, 600, 290), (3.8, 600, 290), (4.6, ex, 145), (5.5, ex, 145), (6.4, 610, 300)], [(4.95, ex + 1, 146)])
    return s


def scene_slash():
    s = Scene('Suggest · a slash command runs when clicked', T=11, H=360)
    s.chrome = s.input_box()
    iy = s.in_y
    s.prompt(64, 'Thanks, that fixed it.')
    s.reply(98, ['Glad it works. The conversation is getting long: run /compact before',
                 'the next task, or keep going?'], 1.8, spin_from=0.4)
    s.button(152, 'Keep going', 2.0, 4.9, engine=True)
    s.show(s.text(2, 182, 'more suggestions…', C['dim']), 2.1, 3.0)
    s.button(182, '/compact', 3.1, 4.9, hover=(4.3, 4.9))
    s.button(212, '/clear', 3.1, 4.9)
    s.prompt(152, '/compact', 5.0)
    s.spinner(176, 5.3, 7.4, word='Compacting conversation…')
    s.show(s.text(2, 176, '⎿  Compacted (ctrl+o to see full summary)', C['dim']), 7.4)
    s.show(s.text(0, iy, '❯', C['fg']) + s.caret(2, iy))
    s.show(s.text(2, iy, 'Keep going', C['dim']), 2.0, 4.9)
    tx = s.btn_x('/compact')
    s.pointer([(0, 600, 280), (3.5, 600, 280), (4.3, tx, 177), (5.3, tx, 177), (6.2, 600, 290)], [(4.7, tx + 1, 178)])
    return s


def scene_shell():
    s = Scene('Suggest · a shell command lands in the input, ready for !', T=12, H=360)
    s.chrome = ''  # drawn below so it can turn pink in shell mode
    y1, y2 = s.H - 72, s.H - 36
    iy = y1 + 23
    line = lambda y, c: f'<line x1="10" y1="{y}" x2="{W - 10}" y2="{y}" stroke="{c}"/>'
    s.show(line(y1, '#5a5a5a') + line(y2, '#5a5a5a'))
    s.show(line(y1, C['pink']) + line(y2, C['pink']), 6.4, 7.5)
    s.show(s.text(0, s.H - 14, '? for shortcuts', C['faint']), 0, 6.4)
    s.show(s.text(0, s.H - 14, '! for bash mode', C['pink']), 6.4, 7.5)
    s.show(s.text(0, s.H - 14, '? for shortcuts', C['faint']), 7.5)
    s.prompt(64, 'Why does the build fail on CI but not locally?')
    s.reply(98, ['CI installs with npm ci, and the lockfile pins an older esbuild.',
                 'Want to reinstall from the lockfile and see if it reproduces?'], 1.8, spin_from=0.4)
    s.button(152, 'Yes, try it', 2.0, 7.5, engine=True)
    s.show(s.text(2, 182, 'more suggestions…', C['dim']), 2.1, 3.0)
    s.button(182, '!npm ci', 3.1, 7.5, hover=(4.3, 4.9))
    s.button(212, 'Update esbuild in the lockfile', 3.1, 7.5)
    s.prompt(152, 'npm ci', 7.6, glyph='!', glyph_fill=C['pink'])
    s.show(s.text(2, 174, '⎿  added 214 packages, and audited 215 packages in 3s', C['dim']), 8.6)
    s.show(s.text(2, 194, '⎿  found 0 vulnerabilities', C['dim']), 8.7)
    # input
    s.show(s.text(0, iy, '❯', C['fg']), 0, 6.4)
    s.show(s.text(0, iy, '!', C['pink'], bold=True), 6.4, 7.5, fade=0.05)
    s.show(s.text(0, iy, '❯', C['fg']), 7.5)
    s.show(s.caret(2, iy), 0, 4.8)
    s.show(s.text(2, iy, 'Yes, try it', C['dim']), 2.0, 4.8)
    s.show(s.caret(2, iy) + s.text(2, iy, 'npm ci')
           + s.text(8, iy, '  (add ! at the beginning to run it in your shell, or press Enter to ask Claude)',
                    C['dim'], italic=True), 4.9, 6.4, fade=0.05)
    s.show(s.caret(2, iy) + s.text(2, iy, 'npm ci'), 6.4, 7.5, fade=0.05)
    s.show(s.caret(2, iy), 7.5)
    tx = s.btn_x('!npm ci')
    s.pointer([(0, 600, 280), (3.5, 600, 280), (4.3, tx, 177), (5.0, tx, 177), (5.9, 640, 240)], [(4.7, tx + 1, 178)])
    return s


def scene_hint():
    s = Scene('Suggest · /suggest <hint> steers the replies', T=13, H=360)
    s.chrome = s.input_box()
    iy = s.in_y
    s.prompt(64, 'Split the parser into smaller functions.')
    s.reply(98, ['Done: parse() now calls tokenize(), readBlock() and readInline().',
                 'Want me to do the same for the formatter?'], 1.8, spin_from=0.4)
    s.button(152, 'Yes, do the formatter', 2.0, 6.3, engine=True)
    s.show(s.text(2, 182, 'more suggestions…', C['dim']), 2.1, 3.0)
    s.button(182, 'Same approach for the formatter', 3.1, 6.3)
    s.button(212, 'Not yet, let me review first', 3.1, 6.3)
    s.show(s.text(2, 152, 'suggesting replies…', C['dim']), 6.4, 8.0)
    s.button(152, 'Add tests for tokenize() first', 8.1)
    s.button(182, 'Run the suite before touching the formatter', 8.1)
    s.button(212, 'Snapshot-test the parser output', 8.1)
    s.show(s.text(0, iy, '❯', C['fg']))
    s.show(s.caret(2, iy) + s.text(2, iy, 'Yes, do the formatter', C['dim']), 0, 4.0, fade=0.05)
    s.show(s.caret(2, iy), 0, 2.0)
    typed, t1 = s.typing(2, iy, '/suggest about testing', 4.1, 15, C['bg'])
    s.show(typed, 4.0, 6.3, fade=0.05)
    s.show(s.caret(2, iy), 6.3)
    return s


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'assets')
    for name, fn in [('send', scene_send), ('edit', scene_edit), ('slash', scene_slash),
                     ('shell', scene_shell), ('hint', scene_hint)]:
        with open(f'{out}/demo-{name}.svg', 'w') as f:
            f.write(fn().render())
        print('wrote', os.path.normpath(f'{out}/demo-{name}.svg'))
