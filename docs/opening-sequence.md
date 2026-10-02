# Opening: a light into the labyrinth

The opening uses the same blue-haired whale-maid as the game's player action
atlas. The selected full-character illustration was supplied for this project;
no new character design, generated image, audio, third-party font, or remote
runtime dependency is introduced. The supplied art is not relabeled as CC0.
Reference sheets and source-library materials are deliberately not published.

## Storyboard

| Time | Shot | Materials and motion |
| --- | --- | --- |
| 0–3 s | A lantern finds light in the dark | Existing lantern, dark teal field, fine diamond outlines, warm radial light; a slow 7-degree sway |
| 2.5–6.8 s | The traveller approaches a doorway | Three simple, textured stone arches; existing ruins floor, player back-view sprite, a restrained camera push |
| 6.4–12 s | The journey opens onto the title | Supplied full-character illustration on ivory paper, map lines and a brass compass mark; 迷宫 / MYSTERY DUNGEON title |

The title composition becomes vertical on narrow screens. The art remains
unmodified; its white paper is composited with CSS onto the ivory background.
Motion is intentionally limited to transforms and opacity. Decorative motes
are capped at 12, with no per-frame JavaScript or WebGL renderer.

## Integration

Load `css/opening.css` and `js/opening.js`, then call
`await MDOpening.play({ locale: MD.locale, reducedMotion: false })` after the
real startup resources are ready and before displaying the start menu.
`copy` can optionally override the named localized strings for an embedding UI.
No art requests are made by loading the script alone; assets are requested when
the opening mounts. Its chosen PNG lives in `assets/runtime/opening/` so the
existing build and PNG/LFS checks include it.

The returned promise always resolves with a `reason`. Clicking anywhere,
Escape, Enter, or Space skips immediately. A wall-clock timer completes it after
12 seconds even when images fail or animation events never fire. Reduced motion
renders a static title for 800 ms; bootstrap may elect to bypass the opening
entirely for that preference. Failed full art yields the geometric title card.
Playback is silent and never requests audio autoplay.

`MDOpening.skip()` is safe before/after playback and on repeated calls.
Concurrent calls to `play()` share one active promise. Completed playback
removes its DOM and all listeners/timers and restores previous focus, allowing
the caller to then focus the start menu. It never initializes a run, reads or
writes saves, or mutates game state.

## Verification

Run `node --test tests/opening.test.cjs` for the isolated lifecycle, asset and
failure tests. The integration browser suite owns visual and real-input checks.
Useful screenshot checkpoints are 1.5, 4.5 and 9 seconds, including one narrow
viewport. Unit tests do not replace visual review of those frames.
