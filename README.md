# Mole Racing Track Builder – Prototype 26

Open `index.html` directly in your browser.

## Track files

- **New Track** starts a blank track.
- **Save Track…** downloads the current editable track as a `.moleracing` file.
- **Load Track…** opens a saved `.moleracing` file.
- The current track is autosaved in the browser and restored on the next visit.

## SVG export

- **Export SVG…** creates a clean vector drawing of the track.
- The SVG contains only the barriers and their feet.
- Grid, selection, handles, placement guides, and other editor UI are excluded.
- Every barrier is its own named SVG group.
- Each barrier has one visible combined `Outline` path for quick selection and recoloring.
- A hidden `Construction` subgroup preserves the separate body and foot/feet elements.
- Standard barriers export in black; Start / Finish barriers export in green.
- The background is transparent.
- The artwork is cropped to the track with a 10 mm margin.
- Physical dimensions are preserved: a 15 cm barrier is 15 cm at 100% scale.
- The exported filename uses the track name.

Note: Adobe InDesign places an SVG as one linked graphic. The internal barrier groups remain available when the SVG is edited in Illustrator, but individual barriers cannot be selected directly on the InDesign page.

## Illustrator compatibility

- Barrier rotation and position are baked directly into the exported coordinates.
- No SVG `transform` attributes are used for barriers.
- The SVG root no longer sets `fill="none"`.
- Visible outlines use absolute path coordinates for more reliable Adobe Illustrator import.

## Adobe compatibility revision

- The exported `viewBox` now always starts at `0 0`.
- All artwork coordinates are normalized to positive document coordinates.
- Inkscape-specific namespace and layer attributes have been removed.
- Hidden construction geometry has been removed from the export.
- Each barrier remains a separate named group containing one combined outline path.
