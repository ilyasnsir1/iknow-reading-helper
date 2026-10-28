# Japanese word voices · 1.28.6

The selected production voices are **Female · Mao Plain** and **Male · Nise**. Clicked words use these local neural voices. The original iKnow sentence speaker remains available separately.

## Use the selected voices

1. Load the unpacked extension in Brave, then double-click `helper/Setup.cmd`. Choose **2 — Voices only**, or **1 — Complete** to install course preparation and both voices together.
2. Wait for **Setup complete.** and **Created by ilyasnsir1**. Reload the extension and the iKnow page.
3. In the popup, enable **Click words to listen**.
4. Choose **Voice → Female · Mao Plain** or **Male · Nise**.

The voice and speed selection are remembered. Word audio is an explicit setting. Selecting a voice does not synthesize a whole course or start course preparation. A word request generates that word locally and caches it; a later request for the same voice, word, and speed reuses the cache. First use can take longer while the downloaded engine and selected voice load into memory. The audition preview played previously generated files, so it did not include this generation wait. The owned engine now remains ready for twenty minutes after its last local request instead of two.

For an existing or interrupted installation, use **3 — Check / repair** in the same setup menu. It repairs the capabilities previously installed or selected; it does not add the large course models to a voices-only installation. On a fresh PC, choose 1 or 2 first. Older `Setup-neural-voice.cmd` instructions remain compatible, but no separate voice installer is needed for the current setup flow.

The written Japanese word is used with its known iKnow reading. Topic/object particles retain spoken wa/o readings. The helper checks analyzed readings before synthesis. This is independent speech generation; it does not cut syllables out of iKnow's sentence MP3. It can speak supported short particles and inflected words without needing an exact standalone dictionary recording.

The engine uses neutral pitch and intonation, the requested speed, and output headroom. It adds no denoising filter. Version1.25.1 retains the engine's44.1kHz PCM samples unchanged, matching the audition format; earlier1.25.0 playback downsampled to24kHz. Previously cached24kHz files are regenerated on demand under a new cache identity. Synthetic pronunciation and pitch accent can still be imperfect, especially for isolated short forms. The original iKnow sentence speaker remains available for a human pronunciation reference.

## Prepare course words in advance

The **Prepare word audio** page is optional. Its Course link or ID field lets you select a course; **Load course** only checks readings and saved status. **Prepare words** or **Resume preparation** starts the local work. Its purpose is to avoid first-click generation waits for new words. If you skip it, clicking words on an iKnow course still generates and caches them as needed.

In **Local neural voice** mode, the popup's **Prepare course words** opens a dedicated page for the current course. Choose the voice and speed, then explicitly start preparation. Merely opening a course, loading this page, or selecting a voice does not generate speech. The original sentence player and the three course-preparation modules are independent.

The helper generates distinct vocabulary words and sentence word forms from iKnow's published readings, with the same particle/counter handling used by word clicks. Repeated forms are generated once for the selected voice and speed. Preparation takes time once; afterward the normal word player reads those cached files. A course can contain several hundred distinct forms even when it has only200 sentences.

The preparation page shows progress and an estimated remaining time after enough words have been measured. Pause retains completed recordings; reopening and resuming prepares only missing forms. Explicitly started work can continue after the page is closed. Switching voice or speed needs its own recordings. The bounded neural cache can retain up to512MiB/8000 recordings; status checks count actual files so an evicted course is reported as partly available rather than falsely complete.

## Voices and sources

| Setting | Published model and selected style | Model source |
| --- | --- | --- |
| Female · Mao Plain | まお, version 1.2.0, `ふつー` | [Mao by Oz Chat / Trippy / ねゆたろ](https://hub.aivis-project.com/aivm-models/a59cb814-0083-4369-8542-f51a29e72af7?owner=ozchat) |
| Male · Nise | にせ, version 1.0.0, `ノーマル` | [Nise / MAHOPROGRAM](https://hub.aivis-project.com/aivm-models/6d11c6c2-f4a4-4435-887e-23dd60f8b8dd?owner=MAHOPROGRAM) |

Both model pages list **ACML 1.0**. Model files are downloaded from their publisher and verified against their published SHA-256. See [sources, attribution, and license notices](helper/NEURAL-VOICE-LICENSES.md).

The local Windows runtime is [AivisSpeech Engine](https://github.com/Aivis-Project/AivisSpeech-Engine), pinned to the tested 1.0.0 build. The engine and selected models require about 2 GB of initial downloads including shared language resources. Unpacked programs and generated-word caches take additional space. Voice generation has no API usage charge and uses no Aivis Cloud API account.

## Sentence audio and word highlighting

The original iKnow sentence speaker plays the recorded sentence. **Audio timings** preparation powers its word highlighting when **Follow sentence audio** is enabled. It is not required for Mao Plain/Nise word synthesis. Older alternative word-playback modes are no longer offered in the popup.

## Audition history

The comparison preview at `http://127.0.0.1:52326/voices.html`, while its local server is running, contains individual words and complete sentences from the audition models. It is a separate review page; choosing a model there does not change the installed extension. The earlier Aida, Morioki, and other candidates were comparisons, not the final production choices. Full sentences were synthesized intact rather than assembled from word files.

The development audition files remain under `work/neural-voice-lab` in the project workspace and are excluded from the lean friend-sharing folder. The friend needs the application, setup scripts, and documentation rather than the audition runtime or generated comparison media.
