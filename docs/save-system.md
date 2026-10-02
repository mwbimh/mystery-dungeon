# Journey saves and startup

## Player flow

Startup shows real configuration, script and texture preparation, then a skippable
12-second opening and the start menu. New Game chooses one of **10 journey slots**.
Each slot owns its warehouse, bag, skill capacities and journey; Continue opens the
latest compatible checkpoint and Load lists all slots. Menu / Saves pauses a run
without returning to town or changing death/clear outcomes. Existing entrance and
new-adventure controls continue to begin a run inside the selected journey.

Settings are global, separately stored in `md-settings-v1`: opening playback,
reduced motion, and 3D/2D renderer preference (effective on next reload). The URL's
`flat=1` explicitly selects 2D. Audio is not implemented and has no pretend setting.
Reduced motion skips startup OP and shortens actor action transitions.

## Storage and slots

The standard browser IndexedDB database `mystery-dungeon-saves` contains ten slots.
**Ten is a product/UI choice, not a browser limit.** A slot transaction stores the
new full checkpoint and its previous valid checkpoint atomically. No server, cloud
account, cookie, or extra filesystem permission is involved. Browser origin and
profile isolation applies: private preview and production do not share saves.

Autosave occurs after stable turns, floor transitions, inventory/warehouse/skill
changes and town selection. An in-progress animation settles before menu opening;
queued direction/dash input is cancelled. Snapshots include dungeon/floor, map and
rooms, player/enemy state, statuses, items/charges, bag/equipment/warehouse, explored
cells, monster-house triggers, turn/spawn counters, outcome, play time and exact
state of the gameplay RNG. Renderer state and held keys are reconstructed.

Quotas vary by browser/device and available disk. An individual imported/exported
file is bounded to 8 MiB for parsing safety; inventory is never silently truncated.
A failed quota/transaction write retains the previous commit and shows a warning.
If IndexedDB cannot initially open, the UI explicitly labels **temporary memory
only**, with download available; it never silently changes to another persistent
backend mid-session. Closing/refreshing before a pending write finishes warns the
player, but browsers can still terminate a page, so occasional file backups matter.
Clearing site data, browser eviction, private browsing and profile/device changes
can lose local saves. No unlimited-retention claim or artificial quota guarantee.

Every write uses an optimistic revision check within the same transaction. A
second tab cannot silently overwrite a newer checkpoint: the stale tab stops
saving and offers its current memory snapshot for download. Reload the desired
stored journey after preserving the other tab's snapshot. Deletion leaves only a
revision tombstone, so stale tabs cannot recreate an old deleted journey.

## Import, recovery and compatibility

Downloads are versioned UTF-8 JSON (`mystery-dungeon-save`, schema version 1).
Uploads parse locally, reject malformed or oversized JSON, unsafe keys, invalid
ranges/grids/coordinates/entity IDs and impossible actor layouts, then verify a
content checksum. The checksum detects accidental edits/corruption; it is **not** a
cryptographic authenticity signature or an anti-cheat system. A user can own and
edit their own saves, but arbitrary script content is never evaluated.

A gameplay configuration fingerprint detects unsupported changes before applying
any state. Translated labels, colors and other purely presentational changes remain
compatible; changed rules, content IDs or dungeon configurations may require an
older build. No silent reset, lossy migration, or fallback dungeon. Bad slots are
isolated and visibly marked; a compatible prior checkpoint can be restored.
Occupied-slot new/import/recovery/delete actions require explicit confirmation.

The pre-save-system `md_warehouse_v1`, `md-skill-meta`, `md-expedition-v1` localStorage
keys remain untouched. Load offers an explicit migration to an empty slot, labeled
as a legacy journey. Only warehouse/skill capacity/dungeon choice existed before;
no old map or turn can be recovered. Unknown/removed legacy items block migration
with a visible explanation rather than being dropped. Original keys are retained.
Designer URLs bypass opening/menu persistence and continue their existing isolated
seeded-playtest behavior without reading/writing normal saves or preferences.

## Verification

`npm test` includes storage, complete-game snapshot, menu and OP lifecycle tests;
`npm run test:browser` covers actual Chromium IndexedDB/reload, multiple dungeons,
slot independence, file downloads/uploads, cancellation and settings. The VM and
transaction fake tests are deliberately distinguished from real browser tests.
Run all aggregate checks after editing and build from the six source workbooks.
