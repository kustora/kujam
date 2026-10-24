---
'@kujam/export': patch
---

PDF export, one frame per page (BOARD-1705): `exportPDF(board, options?)` writes every frame of the page as one PDF page, in `board.frames.list()` order (or the frames in `frameIds`, in that order). A page without frames becomes a one-page PDF of all its content. Each page is the frame's PNG export, sized like the frame (one board unit is 0.75 pt), with an invisible text layer taken from the SVG export's recorded text, so text stays selectable and searchable. Text the standard PDF font cannot encode (outside Windows-1252) stays visible in the image and is reported with the new `text-not-selectable` warning. `pdf-lib` (MIT) is a new dependency loaded with a dynamic `import()`, so it is not part of the main bundle. The playground export lab gains a PDF format.
