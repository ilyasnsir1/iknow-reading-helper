# Share iKnow! Reading Helper with a friend

This guide is for **Windows 11 and Brave**. Your friend does not need Codex, Tampermonkey, Git, a paid API account, or your browser profile.

Send the complete application folder, or download the latest release from https://github.com/ilyasnsir1/iknow-reading-helper/releases/latest . GitHub sign-in, Git commands and repository invitations are not required. The first installation is the same either way.

## 1. Send the application folder

Send the prepared, unpacked **`outputs/iknow-reading-helper-share`** folder. It contains the application and documentation without the development screenshots, review videos, or audition files. Keep its contents together:

```text
iknow-reading-helper-share/
  extension/
    manifest.json
    ...
  helper/
    Setup.cmd
    ...
  START-HERE.md
  SHARE-WITH-A-FRIEND.md
  ...
```

Use a private file transfer, a USB drive, or a shared private folder. The application can stay unpacked. If your transfer service requires a ZIP, your friend must extract the complete folder before installing it.

Send this share folder only. Your Codex workspace, `.codex` directory, Brave profiles, Windows registry entries, `%LOCALAPPDATA%\iKnowLesehilfe` cache, and `%APPDATA%\AivisSpeech-Engine` models are not part of the handover. The setup downloads and registers the required components on your friend's own PC. Keep the license notices in `helper/` with the application.

## 2. Choose a permanent location

Your friend should copy the folder to a location they will keep, for example:

```text
D:\Apps\iKnowReadingHelper
```

The `extension` and `helper` folders should be directly inside that location. Avoid running it from a ZIP, a temporary folder, or a folder that will be renamed after installation.

## 3. Load the extension in Brave

1. Open Brave and enter **`brave://extensions`** in the address bar.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the **`extension`** folder inside the permanent application folder. This is the folder containing `manifest.json`.
5. Confirm that **iKnow! Reading Helper** appears and is enabled.
6. Optionally pin it from Brave's Extensions menu so the settings are easy to reach.

Romaji and the regular iKnow sentence speaker can already be used at this point. Extra course preparation is optional.

## 4. Run the central setup

The same setup menu handles a full installation, the two selected word voices, and later repairs:

1. Open the application's **`helper`** folder in File Explorer.
2. Double-click **`Setup.cmd`**.
3. Enter **1** for **Complete** or **2** for **Voices only**. Keep the setup window open while the selected components download and install.
4. Wait for **Setup complete.**, followed by **Created by ilyasnsir1**. If the window shows an error, keep the error text and fix that step before proceeding.
5. Return to **`brave://extensions`** and click the extension's **Reload** button.
6. Reload any iKnow course page that was already open.

**No shell commands need to be typed in CMD or PowerShell, and an administrator terminal is not normally required.** Your friend only enters a menu number. The `.cmd` file runs the included setup script. Load the extension before running setup so setup can find its local extension ID.

| Menu choice | What it does | Approximate fresh downloads |
| --- | --- | --- |
| **1 — Complete** | Installs course-preparation models and runtimes, plus both Mao Plain and Nise voices | **8 GB** |
| **2 — Voices only** | Installs both selected voices, their engine and shared language resources, plus the local helper connection | **2 GB** |
| **3 — Check / repair** | Repairs capabilities already installed or selected in an earlier interrupted setup | Only missing or invalid required components |
| **0 — Exit** | Leaves setup without installing anything | None |

Voices only does not install the large translation or Whisper models. To add them later, reopen the same **Setup.cmd** and choose **Complete**. No second installer is needed. Check / repair keeps a voices-only installation voices-only and can finish capabilities selected before an interrupted setup. On a fresh PC, choose 1 or 2 first.

Initial setup needs an internet connection. Compatible downloads are reused; unpacked programs and caches also use disk space. Neural speech is generated on the PC and has no per-word API charge. See [neural voice sources and licenses](helper/NEURAL-VOICE-LICENSES.md).

## 5. Choose the voice

Open the extension popup in Brave:

1. Enable **Click words to listen**.
2. Under **Voice**, choose **Female · Mao Plain** or **Male · Nise**.
3. Click a Japanese word or its Romaji on an iKnow course page.

The chosen voice is saved. The original iKnow sentence speaker remains available alongside word playback. The first word can take longer while the local engine and voice load; later requests reuse them. Speech already generated for that voice is cached locally.

To prepare words before studying, open a course and choose **Prepare course words** in the extension popup while Local neural voice is selected. On the preparation page, choose the voice and speed, then **Prepare words**. Progress, estimated time, Pause and Resume are shown there. This optional preparation can continue after the page is closed. It prepares only that selected voice and speed; Audio timings is separate. Opening a course does not start this job automatically.

## Optional: German, colors, and audio highlighting

Only install the larger course-preparation runtime if your friend wants to prepare additional courses with these features:

| Feature | What it does | Setup needed |
| --- | --- | --- |
| Romaji | Shows the reading supplied by iKnow | Extension only |
| Local neural voice | Speaks clicked words using Mao Plain or Nise | `Setup.cmd` → Complete or Voices only |
| German | Prepares German sentence translations and word meanings | `Setup.cmd` → Complete |
| Meaning colors | Prepares related Japanese and English meaning groups | `Setup.cmd` → Complete |
| Audio timings | Prepares timestamps for highlighting words during original sentence playback | `Setup.cmd` → Complete |

If Complete was selected in step 4, these capabilities are already installed. Otherwise, reopen **`helper\Setup.cmd`**, choose **1 — Complete**, let it finish, then reload the extension and iKnow page. It adds the missing course-preparation components and reuses the selected voices and other compatible downloads.

Afterward, open a course, choose the missing modules you want, and explicitly click **Prepare selection**. On a series page, choose the courses and modules first, then start their preparation. Opening a course or selecting a checkbox does not start preparation automatically. Progress is saved, so completed work does not need to be prepared again.

**Audio timings and word voices are separate.** Audio timings power **Follow sentence audio**, which highlights words as the original iKnow sentence recording plays. They do not install Mao Plain or Nise and are not required to synthesize individual words in **Local neural voice** mode.

Course preparation runs through one local queue. A different series does not inherit its progress or time estimate; use **Open queue** to manage the existing job. Pausing saves completed language and audio work before releasing the course model. Resume computes missing additions. A finished job with omissions remains explicitly partial and retryable. Initial local AI work still uses substantial RAM and its speed depends on the PC; the saved check and Romaji do not run these models. The word-voice engine has a separate idle lifetime.

The helper appears on individual course and series pages. It stays off the general Japanese content overview. The series checks saved data once on opening; later download checkpoints update its counts quietly. **Check saved data** explicitly shows progress again.

In **Choose courses**, click a Step title to open that course in a new tab. The checkbox selects preparation independently. Saved courses and a locked preparation selection still permit opening the course link.

Progress includes earlier saved results. Refreshing the course page or closing its tab does not restart the model job while Brave stays open. Browser/extension restart preserves completed checkpoints but requires explicit resume. Connectivity failures pause instead of exhausting the remaining series; reconnect and resume. iKnow itself still requires internet for uncached pages/sources/recordings. See [DOWNLOADS-AND-RECOVERY.md](DOWNLOADS-AND-RECOVERY.md).

Some reviewed course data is included in the application. Your own subsequently prepared courses and settings are stored in your local extension installation; copying the application folder does not automatically transfer those personal caches to your friend.

## Downloading from GitHub

Open [the latest release](https://github.com/ilyasnsir1/iknow-reading-helper/releases/latest) and download the **iKnow-Reading-Helper-VERSION.zip** release asset. Extract the complete archive to a permanent folder and follow the setup steps above. Use the release asset rather than GitHub's automatically generated Source code archives.

The public project includes application code, reviewed seed data, setup scripts and license notices. It does not include installed models, generated speech, prepared personal caches, browser profiles, diagnostics exports or publisher signing keys. Those remain on their respective PCs.

## Updating an existing installation

**One-time migration from version 1.33.1 or older:** pause active preparation and word preparation, copy the complete new release into the same permanent application folder, and reload the existing extension at **brave://extensions**. Keep the extension entry; removing it can remove its browser storage. The new helper is included in this folder update. At the same path, no model download or full setup is needed. Reload open iKnow pages.

**Later compatible updates:** open the extension popup → **Updates** → **Check for updates** → **Install update**. No GitHub account is needed. The helper verifies the publisher signature and package hashes, keeps a rollback copy, and replaces managed application files in the same folder. The extension reloads after installation, then refreshes open iKnow pages automatically once preparation/audio are inactive. A manual page-refresh action remains if a refresh is interrupted. Pin the extension icon to see NEW when automatic discovery finds a release.

Finish or pause course preparation and word preparation before installing. Changed local application files cause the updater to stop instead of overwriting them. Models, settings, prepared courses, generated speech and unrelated files are retained. A failed or interrupted installation has a recovery status; see [UPDATES.md](UPDATES.md).

Application updates do not silently run setup or download different voice models. If a release requires new runtime dependencies or voice files, its notes must say so; run **helper/Setup.cmd → Check / repair** or the explicitly requested setup choice. Compatible installed components are reused.

If the application folder moves, Brave must load the extension from the new `extension` folder. Then run **`Setup.cmd` → Check / repair** to update the local helper connection. An unpacked extension ID can differ between PCs or paths; setup registers the ID on the receiving PC. Do not copy someone else's native-host registration or edit their ID into your own files.

Older **`Setup-neural-voice.cmd`** and **`Einrichten.cmd`** entry points remain for compatibility with earlier instructions. The current installation needs only **`Setup.cmd`**.

## If something does not work

Reproduce the issue, open the extension popup → **Diagnostics** → **Export diagnostics**, and keep the downloaded JSON report together with a short description of what happened. It contains available version/status/error information and bounded redacted helper logs. It still downloads a partial report if the local helper is unavailable. Inspect it under View report before sharing; nothing is uploaded automatically. See [DIAGNOSTICS.md](DIAGNOSTICS.md).

| Symptom | Next step |
| --- | --- |
| Brave cannot load the extension | Select the folder containing `manifest.json`, not the parent application folder. Extract a ZIP completely first. |
| Setup cannot find the extension | Load it in Brave first, then rerun setup using the same Windows account. |
| Neural word audio says the helper is unavailable | Open `Setup.cmd` and choose Check / repair, then reload both the extension and course page. On a fresh PC, install Complete or Voices only first. |
| A setup download fails | Keep the error text, reopen `Setup.cmd` and choose Check / repair. The earlier selection is remembered. Do not delete successful downloads or the entire cache to retry one failed step. |
| Clicked words do not play | Enable **Click words to listen**, choose a voice and finish Setup.cmd Complete or Voices only. |
| Word audio works, but sentence highlighting does not | Prepare **Audio timings** for that course and enable **Follow sentence audio**. |
| A script or component is blocked by Windows | Read the exact Windows message and verify the source file. Do not disable antivirus or change the system-wide execution policy as a general workaround. |

The friend uses their own iKnow access. Course pages, original iKnow recordings, and initial downloads still need the relevant internet services; local voice generation itself runs on their PC.
