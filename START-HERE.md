# Start here · Windows11 and Brave

1. Keep this complete folder in a permanent location, for example `Documents/iKnowReadingHelper`.
2. In `brave://extensions`, enable **Developer mode**, click **Load unpacked**, and select this folder's **extension** subfolder.
3. Double-click **helper/Setup.cmd**. Enter **1 — Complete** (approximately8GB on a fresh PC) or **2 — Voices only** (approximately2GB). Wait for **Setup complete.** and the **Created by ilyasnsir1** banner. No shell commands, paid API key or administrator terminal is needed.
4. Reload the extension in Brave, then reload the iKnow course page.
5. Open the extension popup: enable **Click words to listen**, then choose **Voice → Female · Mao Plain** or **Male · Nise**.

Words are generated when clicked and cached for the chosen voice. The original iKnow sentence speaker remains available. Romaji and original recordings need no model setup.

Complete includes German translations, meaning colors, sentence-audio highlighting and the selected word voices. Voices only skips the course models. To add them later, open the same **helper/Setup.cmd** and choose **1 — Complete**. There is no second installer to run. Course preparation still starts only when you select modules and start it on the course or series page.

Use **3 — Check / repair** to check and repair an existing or interrupted installation. It remembers previously selected components and keeps a voices-only installation voices-only. **0 — Exit** leaves setup without downloading anything. Existing compatible downloads and saved courses are retained.

For later updates, open the extension popup → Updates → Check for updates → Install update. Finish or pause preparation first. After an update, reload open iKnow pages. Keep the same application folder and extension entry. This first version with the updater must be copied into an older installation manually, then the extension reloaded. Models and prepared courses are retained. See UPDATES.md for dependency changes and recovery.

See [SHARE-WITH-A-FRIEND.md](SHARE-WITH-A-FRIEND.md) for detailed instructions and troubleshooting. Voice sources and licenses are in [helper/NEURAL-VOICE-LICENSES.md](helper/NEURAL-VOICE-LICENSES.md).

Choose Alignment → Meaning groups or Word detail in the course toolbar or extension popup. See ALIGNMENT-MODES.md for the conservative matching rules and source-correction behavior.

Move into a Meaning explanation to select/copy its text. Pin keeps it visible; Shift-click a colored group pins without audio. Unpin or Escape releases it.

If something fails, open the popup → Diagnostics → Export diagnostics, inspect the JSON report and share it together with a short description. See DIAGNOSTICS.md.

For saved-progress counts, refresh/restart and lost connection recovery, see DOWNLOADS-AND-RECOVERY.md.
