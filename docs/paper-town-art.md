# Paper town art and layout

## Direction

The town is a flat paper illustration with front-facing, thick white-edged character stickers. There is no attempt to put the characters into a perspective scene. Printed scenery uses muted colored contours; only actionable characters, the entrance, their name tabs and UI controls use white cut edges. Decorative houses and trees have no pointer targets, labels, or hover behavior.

## Sources

- `assets/runtime/ui/town/paper-town-wide.svg`: new original code-native vector illustration, composed at 1200 × 660
- `assets/runtime/ui/town/paper-town-narrow.svg`: separately composed original vector illustration at 800 × 1100; selected at ≤680 CSS px
- Existing character `*-idle.png` and `*-hover.png`: reused unchanged from the repository. The design keeps all six established identities, costumes, colors and frontal sticker treatment
- Existing `entrance-idle.png`: reused for both resting and highlighted states. Highlight uses a warm CSS halo instead of swapping to the materially different previous portal frame
- No character raster was regenerated, repainted, stretched to a new ratio, or cropped. The old painted `town-map.png` remains available to the pre-existing menu; the in-game town no longer displays it

## Layout and motion

- The scenery and hit targets occupy a single aspect-ratio canvas. The background uses `contain`, never `cover`; mobile has its own composition and matching target coordinates
- Heading and expedition controls are in normal flow above/below the canvas. Short screens scroll vertically rather than crop the map, detach hit targets or place controls over characters
- Each character button has one fixed square media frame. Both poses are absolutely overlaid, fading opacity without a layout-height change
- Breathing and hover scale share the bottom-center image foot line (96.67% for 300 px source canvases). The existing pose artwork is preserved, including gesture/foot-placement differences inside its frame
- White edge reinforcement and shallow paper shadow are CSS filters. Hover is a restrained 3.5% lift in scale rather than the old 8% full-button zoom; name tabs remain stationary
- System reduced-motion and the game's reduced-motion setting disable idle motion. Keyboard focus visibly outlines the white name tab; all UI controls meet a 42–49 px minimum control height
- `btnTownBag` is the new explicit town backpack control. Existing IDs and `data-action` mappings remain intact for gameplay integration

## Verification

- Both SVG files parse as valid XML and were rendered with Inkscape for pixel inspection
- A vector composition check rendered the unchanged raster stickers over both scene compositions, including a 390 px-wide narrow preview. Faces, six character silhouettes, white edges and name tabs remain distinct at that thumbnail size
- Static coordinate validation confirms seven square image frames are inside each scene and do not overlap at either breakpoint
- Real browser screenshots, responsive DOM geometry, keyboard/touch flows and hover integration are verified by the lead's browser regression/CI. Local Chromium launch was blocked by the execution environment, so the static rendering above is not a claim of browser verification

Browser acceptance sizes: 1440×900, 1280×720, 390×844, 320×640 and 844×390. Check scene/background registration, no horizontal overflow, no target overlap, expedition controls below the scene, and fixed media geometry while hovering/focusing. Short mobile and landscape screens may scroll vertically.
