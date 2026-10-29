# Vocabulary controls below translations

The vocabulary action row now follows the German gloss when one is available,
and otherwise follows the original English gloss. Language visibility remains
CSS-driven; the controls are not recreated when the selected language changes.
German glosses arriving later are inserted before the existing action row.

The isolated Brave learning-workspace regression exercises the production
content scripts with explicit source/cache fixtures. It checks DOM and visual
placement in Both, English and German modes, removes and restores German data,
and checks that the two controls remain unique and functional. The Both-mode
screenshot was visually reviewed. The same suite covers vocabulary/sentence
bookmarks, practice tabs, recording cleanup and explicit component preparation.

The study-store checks and all ten publisher checks pass. A separately staged,
signed 1.40.4 package passes the exact 1.40.3-to-1.40.4 update fixture, verifying
154 managed files and retaining cache sentinels. No new permission, model or
helper change is included. Registered and Desktop installations are retained
for explicit popup adoption; no development sync is performed.
