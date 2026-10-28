# Preparation, progress and recovery

Preparation starts only after you choose courses/additions and explicitly start it. Completed validated results are saved incrementally. Resume reuses compatible saved work; it does not intentionally delete successful results or start a whole course from zero.

The course step's sentence count and progress bar show **saved, source-validated results**, including results from earlier runs. They do not count mere attempts as successes. For example,79 saved audio timings out of187 show79/187 in both the step and Audio status. German+colors progress requires both German and its color links on the same sentence. Word meanings are counted separately when still missing. The time beside the course bar estimates **this step**, using newly saved results; it resets after pause/stage changes/cache jumps and is approximate.

| What happens | Behavior and next action |
| --- | --- |
| Refresh the course page | The page reconnects to the existing background job. Completed data stays saved; refresh alone does not start another model job. |
| Close the course tab while Brave stays open | The background preparation can continue. Open the course/queue again to see it. |
| Close/restart Brave or reload the extension | The local work is interrupted. Completed browser and helper checkpoints remain. The series queue restores paused; choose Resume. For an individual course, select the missing additions and prepare/resume them. |
| Lose internet before fetching the next course | The queue stops at that course with a connection message instead of failing all later courses. Reconnect and choose Resume. |
| Lose internet during audio preparation | A new recording request has bounded retries. Repeated connectivity failure pauses and flushes completed work. Reconnect and Resume; compatible completed recordings are reused. |
| One recording returns HTTP404 | That recording is unavailable. Other recordings can continue; the missing result remains visible and retryable rather than being counted as saved. |
| Local translation/color work already has its course source and installed models | That calculation can run without an internet service. Audio preparation additionally needs the original recordings; uncached recordings require a connection. |
| Open iKnow from scratch with no internet | The extension is not an offline copy of iKnow. The original page and uncached course sources/recordings may be unavailable even though preparation checkpoints remain on disk. |
| A recording or generated mapping cannot be validated | It remains missing/partial. Retry missing targets the omissions; failed attempts do not become ready results. |

Keep the same extension entry and application folder when updating. Clearing extension storage, removing the extension, deleting helper caches or moving the installation is different from refreshing a page and can remove availability or require reconnecting the helper. Ordinary recovery does not require those actions.

If a job cannot resume, keep its saved data and export **Diagnostics** from the popup. Share the report with the course URL, selected additions and the step that stopped. There is no need to keep a terminal open during normal preparation.
