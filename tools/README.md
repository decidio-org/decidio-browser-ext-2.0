# tools

## makeicon.py

Regenerates `src/images/default_logo.png` and `active_logo.png` — the toolbar
icon in its two states.

The mark is "d." set in Neue Haas Grotesk Display 75 Bd on a rounded plate,
which is the same thing the in-page floating toggle button draws with CSS
(`ui.js`), so the tab icon and the button on the page are one mark at two
sizes. Keep them in step: a change to one belongs in the other.

Needs `fontTools` (with `brotli`, for the woff2) and `Pillow`:

    python3 -m venv venv
    ./venv/bin/pip install fonttools brotli pillow
    ./venv/bin/python tools/makeicon.py src/images src/fonts/NHaasGroteskDSStd-75Bd.woff2

Rendered at 4x and downsampled, so the corner and the glyph stay clean at
every size the browser asks for.
