# Bright cartoon RPG stage assets

## Layers and visual hierarchy

`town-stage-16x10.png` is the final environment background: a bright, detailed, softly shaded cartoon village. It has no drawn contour/sticker border treatment, baked text, UI, characters, or portal. Foreground characters, enemies, collectible items, and interactive props keep their existing white sticker border. Do not apply a page tint, desaturation veil, paper/noise overlay, or outline shader to the background.

The background has a natural 1586 × 992 composition (approximately 16:10). Use full-bleed cover within the game stage. The rich scenic edges and quieter paths are intentional; keep foreground UI sparse and physical, not in a containing white website card.

The original character PNGs are unchanged. For a 16:10 stage, suggested sticker feet anchors (percent) are ChatGPT (27, 53), Claude (49, 44), Harness (65, 58), Kimi (21, 77), DeepSeek (44, 80), GLM (79, 78), and entrance (78, 37). Top-left banner and top-right tool props sit above the scene. Mobile may reflow these positions rather than shrinking the full stage to an unreadable thumbnail.

## Reusable UI assets

All SVGs are transparent and have a warm-white die-cut rim to indicate an interactive game object. The palette is clean cream, sea blue, mint, bright brass, and warm leather. The inside region stays quiet for runtime labels and controls.

| Asset | Source size | Safe content region |
| --- | --- | --- |
| town-banner.svg | 420 × 132 | x 66–352, y 36–88 |
| name-tag.svg | 250 × 86 | x 35–214, y 25–60 |
| dialogue-frame.svg | 1200 × 360 | x 65–1135, y 58–303 |
| inventory-board.svg | 620 × 780 | x 113–501, y 123–677 |
| route-map.svg | 980 × 640 | x 68–807, y 73–457 |
| hud-vitals.svg | 530 × 132 | portrait circle at (71,67), right content x 144–480, y 40–95 |
| skill-slot.svg | 104 × 104 | x 25–79, y 25–78 |
| action-pennant.svg | 380 × 100 | x 45–315, y 28–69 |
| bag-sticker.svg | 120 × 120 | icon only |
| map-sticker.svg | 120 × 120 | icon only |
| guide-sticker.svg | 120 × 120 | icon only |

Preserve the banner's 3.18:1 ratio. Inventory edges depict an open satchel: content must not cover the outer leather flap or lower buckles. For tall dialogue layouts, use a nine-slice/border-image treatment rather than stretching corner tabs; suggested source slice top 90, right 78, bottom 85, left 78 with center fill. Runtime text and interactive choices remain DOM, not image text.

## Provenance and verification

- Background created with the built-in ImageGen tool using the existing character art as the initial style reference. Final revision uses bright material colors and soft volume with no background contour drawing.
- SVG UI drawn as editable, code-native vector assets and rendered through Inkscape for visual verification.
- All UI remains independent from the background. Neither the character sprites nor their existing idle/hover artwork were modified by this art pass.

Final image prompt intent: “Transform the town into bright, detailed, softly shaded 3D-cartoon RPG environment art without any outlines; preserve the complete composition and winding open paths; distinguish buildings, vegetation, roof tiles and rocks by material color, lighting and volume; no ink contours, white rims, characters, text, UI, buttons, portal, or placeholder circles; cheerful miniature architecture, fresh greenery, blue sky, turquoise water, coral and blue roofs.”
