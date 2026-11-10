# Skins

Each folder here is one skin. RetroTune lists every folder that contains a
`theme.json`, so adding a skin needs no code changes.

```
themes/
  my-skin/
    theme.json   { "name": "My Skin", "order": 5 }
    theme.css    variable overrides + any decoration
```

`theme.css` is loaded after `../base.css`. Start by overriding the CSS
variables declared at the top of `base.css` (fonts, window, title bar, button
bevels, display, list, sliders, visualizer colours), then add extra rules for
decoration. Avoid changing sizes that affect layout height unless you check
the compact and menu bar layouts too.

Preview a skin without launching the app (uses mock data):

```
node scripts/shots.js /tmp/shots     # PNGs of every skin
```
