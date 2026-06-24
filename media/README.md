# Project media

Drop your own clips and stills here and they show up automatically in the
**Project Media** panel in the sidebar (no rebuild needed in dev — Vite watches
this folder).

```
media/
  videos/   ← .mp4 .webm .mov .m4v .ogv .ogg
  images/   ← .jpg .jpeg .png .gif .webp .avif .bmp
```

Clicking a tile loads the file through the normal tracking pipeline:
videos load paused on frame 0 (press Play), images track immediately.

The actual media files are gitignored (they're large / personal); only the
folder structure and this README are committed. Enumeration is done with
`import.meta.glob` in [`src/mediaLibrary.js`](../src/mediaLibrary.js).
