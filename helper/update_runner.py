"""Copied, trusted transaction runner; never execute code from a new archive."""
from __future__ import annotations

import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import updater


def run(stage):
    stage = Path(stage).resolve()
    transaction = updater.read_json(stage / "transaction.json") or {}
    cache = Path(transaction["cacheRoot"]).resolve()
    app_root = Path(transaction["appRoot"]).resolve()
    expected = updater.update_root(cache, app_root)
    if not stage.is_relative_to(expected) or stage.name != "stage-" + transaction.get("operation", ""):
        raise updater.UpdateError("The update transaction directory is invalid.")
    guard = updater.FileLock(expected / "operation.lock")
    activity = []
    try:
        deadline = time.monotonic() + 40
        while not (stage / "ready").exists():
            if time.monotonic() > deadline:
                raise updater.UpdateError("The update installation did not finish staging.")
            time.sleep(.05)
        # Wait only for the exact launching process. Never enumerate/kill other
        # Python, terminal, browser or model processes on the user's computer.
        while updater.pid_alive(transaction.get("parentPid")):
            if time.monotonic() > deadline:
                raise updater.UpdateError("Close the update connection and try installing again.")
            time.sleep(.05)
        while not guard.acquire():
            if time.monotonic() > deadline:
                raise updater.UpdateError("Another application update is still running.")
            time.sleep(.05)
        state = updater.read_json(updater.state_path(cache, app_root)) or {}
        if state.get("operation") != transaction["operation"]:
            raise updater.UpdateError("A newer update transaction has replaced this one.")
        updater.save_state(cache, {**state, "ownerPid": os.getpid(), "runnerPid": os.getpid(), "status": "installing", "message": "Installing the verified update …", "progress": .98}, app_root)
        activity = updater.activity_locks(cache)
        manifest = updater.transaction_apply(stage)
        updater.save_state(cache, {"status": "complete", "currentVersion": manifest["version"], "latestVersion": manifest["version"],
                                   "message": "Update installed. Reloading the extension …", "progress": 1}, app_root)
    except Exception as error:
        state = updater.read_json(updater.state_path(cache, app_root)) or {}
        if state.get("operation") == transaction.get("operation"):
            text = str(error) if isinstance(error, updater.UpdateError) else "The update failed. Previous application files were restored; try again."
            updater.save_state(cache, {**state, "status": "error", "message": text}, app_root)
        return 1
    finally:
        for lock in reversed(activity):
            lock.release()
        guard.release()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run(sys.argv[1]))
    except (IndexError, KeyError, ValueError, OSError):
        sys.exit(2)
