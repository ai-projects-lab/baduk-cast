# Baduk Cast

Personal two-screen viewer for awesomebaduk.com lessons: the TV shows the board (and optionally the teacher video), the phone keeps the lesson page for controls and problems.

- `index.html` – install page with the bookmarklet code (open it on the phone).
- `sender.js` – runs inside the logged-in lesson page on the phone (via the bookmarklet). Copies the board SVG, lesson title, problem text and the Vimeo position to the TV; mutes the phone video while casting.
- `tv.html` – the page shown on the TV (Chrome Presentation API → Chromecast). Renders a sanitised copy of the board and plays the same public Vimeo clip, kept in sync with the phone (seek if > 1.5 s apart).

No AwesomeBaduk servers or account data are touched; the TV page receives only what the phone page shows.

Desktop test: run `py -3 -m http.server 8765` here, set `window.__badukCastBase='http://127.0.0.1:8765/sender.js'`, paste `sender.js` into the console of a lesson page and call `__badukCast.test()` (opens the TV page as a window).
