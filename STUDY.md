# Your study space

On an iKnow course, bookmark a word or sentence to save it. The practice icon
saves and opens that item directly. The popup also links to Study library &
speaking practice. Search and filter by course or item type. Removing an item
affects this library only, not its prepared translations, colors or timings.

Romaji starts concealed. Reveal individual tokens or all readings. **Romaji
style** in the popup's Reading section or the course toolbar controls both
course and Study displays. **Source spelling** is the default and preserves
iKnow's original Latn, including ha/he/wo where provided. **Pronunciation**
shows confirmed sentence particles as wa/e/o instead. It does not change
ordinary words, vowel lengths or the Japanese/Kana text. Word playback uses
spoken Japanese readings in either mode.

Saved Romaji stays in its original form; changing the display does not
regenerate course data or recordings. New bookmarks retain iKnow's Japanese
segmentation to distinguish particles from words such as 歯 (ha, tooth).
Ambiguous or older entries without enough source information retain their
original spelling. Saving such an item again from its course supplies the
current source metadata. An old, retired pronunciation preference does not
automatically enable the new mode.

**Listen. Pause. Say it.** repeats the complete original recording with a chosen
pause for you to speak. Repeats, pause length and playback speed are selectable.
Changing items, Stop, hiding or leaving the page stops the loop. iKnow-hosted
recordings must remain accessible; this is not an offline source-audio archive.

**Listen and compare** requests the microphone only after Record my voice is
clicked. Record up to twenty seconds, stop, then listen to your take and the
original. Takes stay in page memory, are never uploaded or added to the saved
library, and are discarded on target changes or navigation. Microphone tracks
stop after recording, cancellation, hiding or navigation, including permission
that arrives after cancellation. No extra manifest permission is introduced.
Discard and Reveal remain padded transparent text actions in every theme.

## Pronunciation assessment postponed

The experimental pitch graph and its analysis controls are not part of the
current Study page. The prototype and local recognition research are archived
outside the shipped application for possible later work. No pronunciation
grade, word-error diagnosis, recognition-model download or assessment service
is enabled. Existing recording is for listening comparison only.

Matching a recognized transcript is not proof of correct pronunciation, vowel
length or Japanese pitch accent. A future assessor must be validated against
human judgments on both correct and intentionally incorrect learner recordings,
and must abstain when uncertain. The isolated initial model experiment did not
meet that requirement. See the official [Whisper model card](https://github.com/openai/whisper/blob/main/model-card.md),
[Japanese pitch-accent study](https://www.isca-archive.org/interspeech_2024/masudakatsuse24_interspeech.pdf)
and [assessment limitations](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/pronunciation-assessment/characteristics-and-limitations-pronunciation-assessment).
