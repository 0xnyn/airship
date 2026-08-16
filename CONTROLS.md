<!-- Generated from packages/overlay/src/keys/catalog.ts by scripts/gen-controls.mjs. Do not edit. -->

# Controls

Every keyboard shortcut and pointer gesture in the Airship editor.

Press `?` in the editor for the same list with whatever is live right now
highlighted, or `⌘K` to search the commands and run one.

A shortcut never fires while you are typing, with one exception: a field's
own `⌘↵`. On Safari the browser keeps `⌘+` and `⌘-` for its own zoom, so
the editor also answers to a plain `+` and `-`.

## Edit

| Command | macOS | Windows / Linux | Where | |
| --- | --- | --- | --- | --- |
| Undo | ⌘Z | Ctrl+Z | edit mode | Step back through your pending direct-manipulation edits. |
| Redo | ⌘⇧Z or ⌘Y | Ctrl+Shift+Z or Ctrl+Y | edit mode | Step forward again through edits you have undone. |
| Delete element | ⌫ or Del | Backspace or Del | edit mode | Remove the selected element. |
| Duplicate | ⌘D | Ctrl+D | edit mode | Copy the selected element in place. |
| Edit text | ↩ or T | Enter or T | edit mode | Edit the selected element's text in place. |
| Nudge | ← → ↑ ↓ | ← → ↑ ↓ | edit mode | Move the selected element one pixel. |
| Nudge by ten | ⇧ ← → ↑ ↓ | ⇧ ← → ↑ ↓ | edit mode | Move the selected element ten pixels. |

## Selection

| Command | macOS | Windows / Linux | Where | |
| --- | --- | --- | --- | --- |
| Deselect | Esc | Esc | edit mode | Clear the selection. |
| Move | V | V | edit mode | Hover highlights and clicks select. The default. |
| Inspect | I | I | edit mode | Hover reads out an element's specs instead of selecting it. |

## View

| Command | macOS | Windows / Linux | Where | |
| --- | --- | --- | --- | --- |
| Zoom in | ⌘= or = | Ctrl+= or = | canvas only | Zoom in a step, centred on the canvas. On Safari, use + rather than ⌘+. |
| Zoom out | ⌘- or - | Ctrl+- or - | canvas only | Zoom out a step. On Safari, use − rather than ⌘−. |
| Zoom to 100% | ⌘0 or ⇧0 | Ctrl+0 or Shift+0 | canvas only | Return the canvas to actual size. |
| Zoom to fit | ⇧1 | Shift+1 | canvas only | Fit every frame on screen. |
| Zoom to selection | ⇧2 | Shift+2 | canvas only | Fill the canvas with the current selection. |
| Hand tool | H | H | view mode, canvas only | Drag anywhere to move the canvas, leaving the page beneath untouched. |
| Put the Hand down | Esc | Esc | view mode, canvas only | Put the Hand down and go back to pointing. |

## Frames

| Command | macOS | Windows / Linux | Where | |
| --- | --- | --- | --- | --- |
| Add a frame | F | F | canvas only | Open the device picker and place a new frame on the canvas. |
| Delete frame | ⌫ or Del | Backspace or Del | view mode, canvas only | Remove the active frame from the canvas. |
| Bring frame forward | ↑ | ↑ | on a frame's handle | Move the frame up the stack, so it covers the ones it overlaps. |
| Send frame backward | ↓ | ↓ | on a frame's handle | Move the frame down the stack, behind the ones it overlaps. |

## Agent

| Command | macOS | Windows / Linux | Where | |
| --- | --- | --- | --- | --- |
| Send | ⌘↩ | Ctrl+Enter | anywhere | Send the description and the pending edits to the agent. |
| Add comment | ⌘↩ | Ctrl+Enter | in a comment | Attach the comment to the diff line it is anchored on. |
| Next change | → | → | on the change strip | Move to the next pending change on the composer's strip. |
| Previous change | ← | ← | on the change strip | Move to the previous pending change. |
| First change | Home | Home | on the change strip | Jump to the first pending change. |
| Last change | End | End | on the change strip | Jump to the last pending change. |
| Drop the change you are on | ⌫ or Del | Backspace or Del | on the change strip | Discard the pending change you are on. |

## Help

| Command | macOS | Windows / Linux | Where | |
| --- | --- | --- | --- | --- |
| Keyboard shortcuts | ? | ? | anywhere | Every shortcut and gesture, grouped, with what is live right now. |
| Command palette | ⌘K | Ctrl+K | anywhere | Search everything the editor can do right now, and run it. |

## Menus

| Command | macOS | Windows / Linux | Where | |
| --- | --- | --- | --- | --- |
| Close the menu | Esc | Esc | in an open menu | Close the open menu. |
| Next option | ↓ | ↓ | in an open menu | Move down the open menu. |
| Previous option | ↑ | ↑ | in an open menu | Move up the open menu. |
| First option | Home | Home | in an open menu | Jump to the first option. |
| Last option | End | End | in an open menu | Jump to the last option. |
| Choose option | ↩ | Enter | in an open menu | Take the option you are on. |
| Close the device menu | Esc | Esc | in the device menu | Close the frame's device menu. |
| Next result | ↓ | ↓ | in the command palette | Move down the results. |
| Previous result | ↑ | ↑ | in the command palette | Move up the results. |
| Run result | ↩ | Enter | in the command palette | Run the result you are on. |
| Close the palette | Esc | Esc | in the command palette | Clear the search, then close. |

## Mouse and trackpad

| Gesture | macOS | Windows / Linux | Where | |
| --- | --- | --- | --- | --- |
| Pan the canvas | Wheel / two-finger | Wheel / two-finger | canvas only | Two fingers or a wheel move the canvas under you. |
| Zoom at the cursor | ⌘-wheel / pinch | Ctrl-wheel / pinch | canvas only | Zooms toward the pointer, not the middle of the screen. |
| Pan without the Hand | Space-drag | Space-drag | canvas only | Hold space and drag, from anywhere, without changing tool. |
| Pan with the middle button | Middle-drag | Middle-drag | canvas only | The middle button pans, whatever tool is armed. |
| Scroll a frame | Wheel over the selected frame | Wheel over the selected frame | view mode, canvas only | A selected frame keeps the wheel to its own ends, so the canvas never lurches sideways. |
| Select an element | Click | Click | edit mode | Hover highlights, click selects. |
| Marquee-select | Drag from empty space | Drag from empty space | edit mode | Drag from empty space to band-select several elements. |
| Edit text in place | Double-click | Double-click | edit mode | Opens the caret in the element itself, not in a field beside it. |
| Open the element menu | Right-click | Right-click | edit mode | Verbs for the element you clicked, which it selects first. |
| Measure spacing | ⌥-hover | Alt-hover | edit mode | Hold Alt and hover to read the distance to the element under the pointer. |
| Move or resize a frame | Drag the title or a grip | Drag the title or a grip | view mode, canvas only | Drag a frame by its title; drag a grip to resize it. |
| Restack frames | Drag a row in the frame list | Drag a row in the frame list | view mode, canvas only | Drag a row in the frame list to change which frame is in front. |
| Jump the camera | Press or drag the minimap | Press or drag the minimap | view mode, canvas only | Press anywhere on the minimap to jump there, and keep dragging to keep moving. |
| Scrub a number | Drag a field's glyph | Drag a field's glyph | edit mode | Drag a field's glyph sideways. Shift for ten at a time, Alt for a tenth. |
| Re-dock a panel | Double-click a panel header | Double-click a panel header | anywhere | Double-click a floating panel's header to put it back against the edge. |
| Scroll the pending changes | Wheel over the strip | Wheel over the strip | anywhere | A vertical wheel scrolls the strip sideways, because a mouse has no sideways. |

## In any field

- Enter commits the field you are in; Esc reverts it.
- ↑ and ↓ step a number field. Shift for ten at a time, Alt for a tenth.
- A shortcut never fires while you are typing, except a field's own submit — ⌘↵ on a Mac, Ctrl+Enter elsewhere.
