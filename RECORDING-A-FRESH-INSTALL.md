# Recording a fresh installation

You can demonstrate the complete installation without erasing your working setup. The clearest option is a separate Windows user account used only for the recording. A separate Brave profile by itself does not reset the downloaded helper, models or voices belonging to the same Windows user.

## Recommended recording setup

1. Finish or pause preparation in your usual account. Sign out of that Windows account before recording; do not leave its voice engine running in another signed-in session. The neural engine uses the machine's loopback port 10103, so simultaneous sessions can interfere with a clean demonstration.
2. Sign in to a separate Windows account that has not installed Reading Helper. Use its own Brave profile without importing the existing extension or syncing your working browser data.
3. Copy the complete unpacked application folder into a permanent folder inside that account, for example `Documents/iKnowReadingHelper`. Keep `extension`, `helper` and the included documentation together.
4. Start recording. In Brave, open `brave://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the application's **extension** subfolder. This step comes **before** setup: setup needs the locally installed extension ID.
5. Double-click **helper/Setup.cmd**. Choose **1 — Complete** to demonstrate all features. This downloads approximately 8 GB on a fresh installation; extracted programs, caches and generated results need additional disk space. **2 — Voices only** is approximately 2 GB and omits German/colors/audio-timing preparation models.
6. Keep the setup window open until **Setup complete.** and **Created by ilyasnsir1** appear. Reload the extension in Brave, then reload the iKnow page.
7. Open the extension popup, enable **Click words to listen**, then choose **Voice → Female · Mao Plain** or **Male · Nise**.
8. To demonstrate preparation, open a course or series, select the additions and courses, then explicitly start preparation. Setup installs the capabilities; it does not prepare every course or every word automatically.

Your usual Windows account keeps its own helper data, browser settings and prepared results. The separate account performs a real installation with its own downloads. Do not copy your existing helper/model caches into it if you want the video to show an actual first download.

A fresh virtual machine is another option if you already have one. Windows Sandbox can be suitable where available, but its availability depends on the Windows edition and configuration, and the environment is temporary. No new account, VM, Sandbox or reset has been created automatically.

## Where installation and personal data live

The paths below use the environment of the Windows user who launches setup. The application folder alone is not the whole installation.

| Location | Contents |
| --- | --- |
| Application `extension/` and `helper/` folders | Extension code, setup scripts and included reviewed course data |
| `%LOCALAPPDATA%\iKnowLesehilfe` | Private Python, language/audio models, portable neural engine, downloads, generated word recordings, prepared course results, setup state and logs |
| `%APPDATA%\AivisSpeech-Engine` | Aivis voice models and engine-managed data; this location can also be used by other Aivis applications |
| Brave profile's extension storage | Personal settings, prepared extension packs, selections, saved fold states and queue state |
| Current user's Native Messaging registry entries | Brave/Chrome connection to `de.iknow.lesehilfe`, in the 32-bit and 64-bit registry views |

Some third-party download tools can also retain per-user download caches. A genuinely new Windows account avoids having to identify and clear those caches individually. Included reviewed course data remains part of the application even in a fresh account, so some courses may already show included results; this does not mean the new installation reused your personal data.

## If you later want to reset your usual installation

A complete reset is possible, but it is a separate operation requiring a backup and an explicit decision about what should be lost. No personal data has been deleted for this guide.

- Back up the application and the personal data you want to retain before changing anything.
- Pause active preparation and stop the installation's running helper/voice processes before modifying its files.
- **Remove.cmd** only disconnects the local helper from Brave. It deliberately keeps models and prepared courses, so it is not a factory reset.
- Removing the extension in Brave clears that extension installation's browser storage. Simply deleting its source folder does not reliably reset the helper or its models.
- Resetting the helper's local storage is a separate step from resetting Brave. Resetting voices additionally involves the Aivis location above, which may contain unrelated voices or data and must not be deleted indiscriminately.
- A non-destructive backup/rename plan can be prepared for the exact current paths before any reset. The next installation can then download into clean locations while the old data remains recoverable.

For recording the ordinary beginner workflow, use the separate account instead of resetting your working installation. For an installation/update demonstration without showing the initial downloads, the existing installation can simply run **Setup.cmd → Check / repair**; the video should explain that it reuses previously downloaded components.
