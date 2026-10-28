# Preparation, progress and recovery

Series and queue progress includes work inside the current course, with an
explicit percentage alongside the processed-course count. A new queue restores
the selected modules' saved checkpoints before model work starts. A processed
sentence is not necessarily a complete saved result when an addition failed.

Remaining time uses measured processing speeds. While only German/meaning
processing has been measured, its remaining time is labelled separately and
audio is marked as awaiting its first measurements. Once all remaining steps
have measured speeds, the estimate covers the full queue. Future course sizes
that have not been loaded yet use the current typical size, so estimates can
change as their actual source becomes available.

Preparation starts only after you choose courses/additions and explicitly start it. Completed validated results are saved incrementally. Resume reuses compatible saved work; it does not intentionally delete successful results or start a whole course from zero.

The course step's sentence count and progress bar show **saved, source-validated results**, including results from earlier runs. They do not count mere attempts as successes. For example,79 saved audio timings out of187 show79/187 in both the step and Audio status. German+colors progress requires both German and its color links on the same sentence. Word meanings are counted separately when still missing. The time beside the course bar estimates **this step**, using newly saved results; it resets after pause/stage changes/cache jumps and is approximate.

| What happens | Behavior and next action |
| --- | --- |
| Refresh the course page | The page reconnects to the existing background job. Completed data stays saved; refresh alone does not start another model job. |
| Close the course tab while Brave stays open | The background preparation can continue. Open the course/queue again to see it. |
| Close/restart Brave or reload the extension | The local work is interrupted. Completed browser and helper checkpoints remain. The series queue restores paused; choose Resume. For an individual course, select the missing additions and prepare/resume them. |
| Lose internet before fetching the next course | The queue stops at that course with a connection message instead of failing all later courses. Reconnect and choose Resume. |
| Lose internet during audio preparation | A new recording request has bounded retries. Repeated connectivity failure pauses and flushes completed work. Reconnect and Resume; compatible completed recordings are reused. |
| The shared local language model times out, disconnects, or cannot start | The queue interrupts at the current course instead of failing subsequent courses. The last validated additions are kept in browser and helper storage. Address the reported issue, then choose Resume to retry the missing work in that course. |
| One recording returns HTTP404 | That recording is unavailable. Other recordings can continue; the missing result remains visible and retryable rather than being counted as saved. |
| Local translation/color work already has its course source and installed models | That calculation can run without an internet service. Audio preparation additionally needs the original recordings; uncached recordings require a connection. |
| Open iKnow from scratch with no internet | The extension is not an offline copy of iKnow. The original page and uncached course sources/recordings may be unavailable even though preparation checkpoints remain on disk. |
| A recording or generated mapping cannot be validated | It remains missing/partial. Retry missing targets the omissions; failed attempts do not become ready results. |

Keep the same extension entry and application folder when updating. Clearing extension storage, removing the extension, deleting helper caches or moving the installation is different from refreshing a page and can remove availability or require reconnecting the helper. Ordinary recovery does not require those actions.

If a job cannot resume, keep its saved data and export **Diagnostics** from the popup. Share the report with the course URL, selected additions and the step that stopped. There is no need to keep a terminal open during normal preparation.

The model connection is loopback-only and bypasses Windows/environment proxies.
Loading remains bounded; one inference response may take up to 15 minutes on a
slow CPU. While the response is pending, a liveness message appears every ten
seconds without inventing completed sentences. Pause still stops the model
process promptly. A longer timeout improves reliability, not processing speed;
the measured estimate depends on the computer and selected additions.
