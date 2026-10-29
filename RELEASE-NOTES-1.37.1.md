# 1.37.1

- Find new releases automatically during normal browser activity with a 45-second interval, replacing the previous one-hour wait. Visible iKnow courses and series align their timer with the shared due time; opening the popup or clicking Check for updates is unnecessary. With the page visible and a responsive connection/helper, notices normally appear within about a minute.
- Read small signed public release files instead of polling GitHub's REST API continuously. Reuse only unchanged signature bytes and verify them again against the pinned publisher key; explicit installation retains full release-membership and archive checks.
- Continue lightweight update discovery during course and word preparation. Installing an update still requires an explicit action and paused preparation.
- Keep verified NEW notices stable through offline failures and browser worker restarts. Repeated failures back off instead of repeatedly starting the helper; successful checks restore the normal interval.
- Retain last check/result/error and retry timing in diagnostic exports. A backward PC clock correction cannot suppress checks for an hour.
- Preserve pending page-refresh completion when a later release is found or a concurrent metadata check fails, avoiding missed or duplicate page reloads.

Helper 1.21.0 is included automatically. Browser permissions, models and learning caches are unchanged. Automatic discovery depends on browser activity, an available local helper, connectivity and GitHub responsiveness; it is not an instant push notification or a hard delivery guarantee while offline/idle.
