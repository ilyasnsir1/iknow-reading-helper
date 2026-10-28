# Updates

The first installation still uses the unpacked extension and `helper/Setup.cmd`.
Keep the complete folder in a permanent location. Existing users need to adopt
the updater-enabled version once before in-app updates are available.

Open the extension popup and choose **Check for updates**. When a version is
available, choose **Install update**. Public release downloads require no GitHub
account. Updates are installed only after this explicit action. Complete or
pause course preparation and word-audio preparation first.

Opening the popup can check the release metadata at most once per day. A new
version is announced near the top of the popup; failed background checks stay
quiet. The manual check remains available. Neither type of check downloads a
model, starts course preparation or installs an update automatically.

The local helper checks the release signature against the publisher key pinned
in the installed package, checks the archive and each managed file, and updates
the same installation folder. It keeps a backup and rolls back a failed file
transaction. Unexpected local modifications are preserved and reported instead
of silently overwritten. Settings, saved course additions and model downloads
remain in their existing locations.

After installation, the extension reloads. Reload open iKnow pages to use the new
content scripts. If the helper is missing, run the existing setup. An update that
requires a new runtime dependency or model may require its matching setup step;
ordinary extension/helper updates do not download the existing models again.
An update that expands browser permissions requires manual installation so its
new access can be reviewed. Dependency/setup scripts are never run silently by
the updater.

If a download or verification fails, the current installation remains usable.
Retry from the popup. Never download a replacement from an unexpected address or
move the installation folder during an update. Diagnostics can help identify a
failed update without sending data automatically.

The project and public releases are currently published under
`ilyasnsir1/iknow-reading-helper`. Downloaded extension/helper files are
inspectable. The requested `ilyasnsir1` creator credit remains in the application.
Moving distribution to a separate organization later requires a reviewed update
configuration change; existing users should update before the old release
address is retired.
