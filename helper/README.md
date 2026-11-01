# Local helper · 1.16.0

The helper supports local neural word playback and optional course preparation. Romaji and exact iKnow word recordings do not require it. Opening a course and checking saved-module status do not launch model work.

The popup can explicitly check for and install signed updates from the configured public GitHub release channel without a GitHub login. Updates verify the pinned publisher signature and every package file, wait until preparation and playback are idle, and replace managed application files in the same folder with a rollback backup. Locally modified managed files stop the update instead of being overwritten. Browser settings, downloaded models and prepared learning data are retained. The first update-ready version must be copied into the existing folder manually; an older helper has no update command.

Course preparation flushes completed sentence and audio checkpoints before acknowledging a pause. Resuming reuses valid checkpoints. The course model is owned by its native host and released on completion, pause, failure or host exit. Processing uses bounded threads, below-normal Windows priority and smaller inference batches to leave capacity for Brave. The separate word-voice engine retains its own idle policy.

Repeated connection failures while fetching a recording now pause the course after one bounded retry sequence. Completed recordings remain stored, and Resume retries missing work after reconnection. A missing individual HTTP404 recording remains an explicit per-recording exclusion; it does not imply that the whole internet connection is unavailable.

## Install only what you need

First load `extension/` as an unpacked Brave extension. Then double-click **`Setup.cmd`** and choose from its menu:

- **1 — Complete** installs the course-preparation runtime and both neural voices: Qwen3.5-9B Q4_K_M, Whisper small, portable Python, llama.cpp, audio libraries, the legacy compact Mei voice, AivisSpeech Engine, Mao Plain, Nise and shared language resources. Fresh downloads are approximately **8 GB**.
- **2 — Voices only** installs private Python when missing, the portable AivisSpeech Engine, Mao Plain, Nise and shared language resources. Fresh downloads are approximately **2 GB**. It connects the loaded extension and checks both selected voice identities, without installing Qwen or Whisper.
- **3 — Check / repair** checks and repairs the capabilities already installed or selected during a previous interrupted setup. A voices-only installation remains voices-only; a previous complete installation can repair all its components. On a fresh PC, choose 1 or 2 first. A failed setup retains its selected capabilities so this option can finish the installation.
- **0 — Exit** closes setup without installing anything.

You only enter a menu number; no shell commands need to be typed. Wait for **Setup complete.** and the **Created by ilyasnsir1** banner. Existing compatible downloads are reused. Setup uses Windows PowerShell 5.1, registers the host for the current Windows user, and normally needs no administrator rights. It passes Python steps as files so paths containing spaces or Unicode characters work. The wrapper's execution-policy setting applies to its process rather than changing the system-wide policy.

After setup succeeds, reload the extension and iKnow page. In the popup, enable **Click words to listen**, set **Word playback** to **Local neural voice**, then choose **Female · Mao Plain** or **Male · Nise**. The original sentence speaker still plays iKnow's recording. Neural generation starts only on a word request, not for every sentence on the page.

To update at the same location, replace application files and reload the extension and course. Existing models and completed results remain. Use **Check / repair** if setup or connection checks are needed. To add course preparation after voices-only installation, choose **Complete** in the same menu. After moving the folder, load its new `extension/` path and rerun setup to update registration. Setup recognizes both the old German and current English extension names. `Setup-neural-voice.cmd` and `Einrichten.cmd` remain compatible entry points for older instructions; the current guide requires only `Setup.cmd`.

## Neural word voices

The selected voices are **Mao Plain** (`ふつー`) and **Nise** (`ノーマル`). Written Japanese and the known reading are checked together before synthesis; contextual particle readings are preserved. A requested word is generated independently instead of being cut out of the sentence. Natural speed and neutral pitch are retained unless the user selects another playback speed; there is no noise-suppression filter.

The pinned AivisSpeech Engine 1.0.0 runs on loopback `127.0.0.1:10103`. The helper starts its own process when needed and stops it after inactivity. It does not terminate an unrelated process already using that port. Cached words are reused for the selected voice and speed. First use after the engine has stopped can take longer than a cached request. No cloud synthesis endpoint or API key is used.

Version1.25.1 retains the source44.1kHz PCM samples without downsampling or gain adjustment. A versioned cache avoids replaying earlier24kHz output. The maximum eight-second mono16-bit reply remains below Chromium's1MiB native-message limit. The owned engine's idle timeout is twenty minutes; local cached word requests refresh its activity without starting a stopped engine.

Voice files and dependency checksums are in `setup_neural_voice.py`. The engine binary is downloaded unchanged from the official release. [NEURAL-VOICE-LICENSES.md](NEURAL-VOICE-LICENSES.md) identifies engine, voice, and language-resource sources and licenses. Neural speech can still contain pronunciation, accent, or naturalness errors.

## Optional preparation of clicked words

The extension's **Prepare course words** page explicitly submits published word readings for one course, voice and speed. `word_voice_jobs.py` saves these into the same exact neural cache used by normal word playback, without importing Qwen or Whisper. Preparing is independent of the three German/colors/audio-timing modules. Status and loading a course never start generation.

A hidden worker continues explicitly started work after the native connection closes. It checkpoints each word, supports pause after the current word, resumes missing files and reports measured ETA. One background word job runs at a time and yields between words for foreground clicks. Job identity includes source descriptor keys, voice version and speed. Status recounts retained WAV files before reporting a finished job as complete; eviction is reported as partial availability. Requests are accepted only from the extension's own preparation page.

The shared word cache is bounded at512MiB or8000 WAVs. Job requests/checkpoints are under `neural/course-jobs/`; they contain local pronunciation descriptors and small progress states, not course-model jobs. Setup does not synthesize every course or both voices automatically.

## Course preparation and audio timings

The browser sends a course ID, source data, and a boolean `{german, colors, audio}` mask. The extension always sends an explicit selection; legacy direct callers without a mask retain their all-modules behavior. German and meaning-color jobs use the large language model. Audio-only preparation does not launch it.

**Audio timings** are measured word timestamps from the original recording. They drive **Follow sentence audio** highlighting and the optional original-phrase/exact-cut modes. They are not the Mao/Nise voice download. Standalone iKnow word recordings also need no timing preparation. Original cuts can still sound abrupt because the recording contains connected speech.

Good existing and new sentences are sent as partial packs. Existing work survives adding another module. Individual errors are recorded under `failures/` with sentence IDs and reasons. Global model or connection failures are reported. The extension manages explicit course/series selection, saved-module status, source retrieval, queue persistence, and estimated time remaining.

HTTPS iKnow asset MP3s with valid query timestamps are accepted. Unambiguous reading-boundary differences use Kana anchors; word times are measured from the recording. Ambiguous mappings are omitted. Step 7's earlier nine missing mappings were repaired and its 200 recordings technically validated; this does not mean every boundary was human-listened.

## Protocol and storage

The Native Messaging name remains `de.iknow.lesehilfe`. Only locally registered extension IDs may connect. Setup creates the current user's connection files and registry entry; another PC runs its own setup rather than copying these entries.

The main storage root remains **`%LOCALAPPDATA%\iKnowLesehilfe`**:

| Location | Contents |
| --- | --- |
| `runtime/`, `python-packages/` | Private Python and preparation programs/libraries |
| `neural/` | Portable neural engine, generated-word cache, installation state, and logs |
| `models/` | Course-preparation language and Whisper models |
| `courses/`, `records/`, `words/` | Prepared course data |
| `audio/`, `audio-alignments/` | Original audio and timing results |
| `jobs/`, `failures/`, `logs/` | Preparation progress, individual failures, and logs |
| `native/` | Local browser connection files |

The official Aivis engine also uses **`%APPDATA%\AivisSpeech-Engine`** for voice models and its shared language-resource cache. This is separate from the main local helper directory. Neither cache belongs in a friend-sharing folder or source repository. Browser settings and prepared extension packs live in Brave's local extension storage.

Language processing uses a private llama.cpp process on a random loopback port with a key, then exits. No Windows service or startup task is created. Translation text and clicked words are not sent to an external AI service. Initial downloads and the original iKnow website/audio still use their internet sources. The helper protocol version can differ from the UI release version.

## Remove

`Remove.cmd` disconnects the host from Brave and retains downloaded models and prepared courses. `Entfernen.cmd` remains compatible. Removing the extension itself at `brave://extensions` clears its browser storage. Advanced `install.ps1 -RegisterOnly` reconnects an existing private Python installation without downloading the full runtime; `-SetupOnly` installs the full preparation runtime without registering a browser ID.

## Upstream projects

- [AivisSpeech Engine and selected voice licenses](NEURAL-VOICE-LICENSES.md)
- [Python 3.12.10](https://www.python.org/downloads/release/python-31210/)
- [llama.cpp b11669](https://github.com/ggml-org/llama.cpp/releases/tag/b11669)
- [Pinned Qwen3.5-9B GGUF](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/tree/3885219b6810b007914f3a7950a8d1b469d598a5)
- [Pinned Whisper small](https://huggingface.co/Systran/faster-whisper-small/tree/536b0662742c02347bc0e980a01041f333bce120)

Their respective license terms apply.
