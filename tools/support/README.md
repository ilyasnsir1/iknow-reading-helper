# Read-only update check

Use this separate support folder when an older installed extension reports a
publisher-signature error and cannot install a newer diagnostic version.

1. Keep `Check-update.cmd` and `check_update.py` together in a writable folder.
2. Double-click `Check-update.cmd`. It uses the existing Reading Helper Python
   runtime. No additional setup or administrator rights are required.
3. Share the new `iKnow-update-check-*.json` file from this support folder.

The check reads Brave's native-helper registration and the installed public
update configuration. It downloads only public release metadata and signatures,
then checks them with both the exact legacy Windows verifier and the newer CNG
verifier. It does not download an application ZIP, execute downloaded code,
install an update, alter registration, or touch course/model caches.

The report contains public SHA-256 fingerprints, version numbers, verifier exit
codes and bounded exception types/HResults. It excludes file paths, extension
IDs, key XML, private keys, raw messages and logs. Review it before sharing.

If automatic registration lookup is unavailable, run the existing Python runtime
with `check_update.py --helper "PATH TO THE APPLICATION OR HELPER FOLDER"`.
The explicit folder is read but is never included in the report.
