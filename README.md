# Mole Racing Track Builder – Prototype 35

Prototype 35 is a visual-only refresh inspired by the Mole Racing rulebook. It
adds a warm textured sand canvas, a subtle alignment grid, brown barriers, the
matching green palette for Start / Finish barriers and Fuel Tokens, a warm dark
toolbar, and a rulebook-style barrier counter. Editor behavior and export
precision are unchanged.

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

## Multi-selection

- Shift-click a barrier to add it to or remove it from the current selection.
- Drag any selected barrier to move the entire selection together.
- Relative positions and rotations are preserved during group movement.
- Placement Assist is bypassed while multiple barriers are moved.
- Delete or Backspace removes every selected barrier.
- Clicking empty canvas space clears the complete selection.
- The most recently selected barrier remains active for the angle field and rotation handle.

## Marquee selection

- Click and drag on empty canvas space to draw a blue selection rectangle.
- Every barrier touched by the rectangle is selected.
- Shift-drag adds touched barriers to the existing selection.
- Dragging without Shift replaces the previous selection.
- The behavior is identical in every drag direction.

## Group rotation

- Multiple selected barriers now receive one shared bounding box and rotation handle.
- Drag the shared handle to rotate the complete selection around its center.
- Relative positions and individual barrier angles are preserved within the rotating group.
- Hold Shift while rotating to snap the group rotation to 15-degree increments.
- Placement Assist is bypassed during group rotation.

## Group angle input

- The angle field now rotates the complete selection when several barriers are selected.
- The entered value becomes the angle of the active barrier.
- Every selected barrier rotates by the same difference around the group center.
- Relative positions and relative angles are preserved.

## Keyboard shortcuts

Mac shortcuts use Command. Windows shortcuts use Ctrl.

- Command/Ctrl + Z: Undo
- Shift + Command + Z or Ctrl + Y: Redo
- Command/Ctrl + C: Copy the selected barriers
- Command/Ctrl + V: Paste and select the copies
- Command/Ctrl + A: Select all barriers
- Command/Ctrl + D: Duplicate the selected barriers
- Escape: Clear the selection
- Delete or Backspace: Delete the selection
- Arrow keys: Move the selection by 1 mm
- Shift + Arrow keys: Move the selection by 10 mm
- Q / E: Rotate by 5 degrees
- Shift + Q / E: Rotate by 15 degrees

Copy and paste preserve the complete selected group. Each repeated paste is offset
a further 20 mm diagonally so the copies remain visible.

## Barrier counter

The toolbar now displays a live count of:

- Long barriers
- Short barriers
- Start / Finish barriers

The counter updates immediately when barriers are added, deleted, pasted,
duplicated, loaded, undone, or redone.

## Fuel Tokens

- Added **+ Fuel Token**.
- Fuel Tokens support selection, dragging, marquee selection, copy/paste,
  duplicate, delete, undo/redo, save/load and SVG export.
- Added a live Fuel counter.
- Placement Assist ignores Fuel Tokens.
- A single Fuel Token has no rotation handle.

## Fuel Token refinement

- Reduced the visual and physical size of Fuel Tokens in the editor.
- Removed the inner frame and extra decorative detail.
- Fuel Tokens now display only a centered cross.
- The same simplified shape is used in SVG export.
