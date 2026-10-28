Discover new releases without manually checking, and finish installation automatically.

- Show NEW on the extension icon for a verified newer release, with the available version in its tooltip. Pin Reading Helper in Brave to see it directly.
- Check automatically at browser startup and during use, with one persisted hourly cooldown shared across popups, worker restarts and activity signals. A visible iKnow course also sends a lightweight periodic presence signal. No continuous native connection or extra browser permission is used.
- Keep a known available notice steady through quiet offline checks; retry prior errors after the cooldown. Installation still requires the user's Install update action.
- After the actual installed target version loads, refresh open iKnow pages automatically. Preparation and audible iKnow playback defer the refresh; unrelated websites are untouched.
- Persist per-tab completion so normal worker restarts do not repeatedly reload pages. Failed or ambiguous interrupted refreshes retain a manual retry.

Includes unchanged helper 1.19.0 and existing native Windows signature verification. Settings, models, voices and saved course data are retained. Pause preparation before installing. The new behavior starts once this version is adopted; an older installed version may still require its existing Check for updates action to obtain it.
