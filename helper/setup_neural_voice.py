"""Verified portable neural voice setup; no course/LLM preparation or cloud API."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

ENGINE_VERSION = "1.0.0"
ENGINE_HASH = "ae0a52d58bc5423451229fb2f3348693c9a1121c83f0542bfb826c6e68a4fc0d"
ENGINE_URL = "https://github.com/Aivis-Project/AivisSpeech-Engine/releases/download/1.0.0/AivisSpeech-Engine-Windows-x64-1.0.0.7z.001"
MODELS = [
    {"name":"Mao Plain", "uuid":"a59cb814-0083-4369-8542-f51a29e72af7", "hash":"f87ccea2e8e2de0e0bfe52e803945af903b4086bf25621a015111628f00e4119", "aliases":["mao.aivmx"]},
    {"name":"Nise", "uuid":"6d11c6c2-f4a4-4435-887e-23dd60f8b8dd", "hash":"6ff7eaa61c24d37434e2c6ab672fc3ba189ecc9118c08918a486ed5316e5c9d3", "aliases":["nise.aivmx"]},
]
SPEAKERS = {"e756b8e4-b606-4e15-99b1-3f9c6a1b2317":"ふつー", "bf56410a-d8e6-430d-a477-f789e16206d3":"ノーマル"}

def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()

def download(url, target, checksum, limit):
    if target.is_file() and digest(target) == checksum:
        print("Reusing", target.name, flush=True); return
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_suffix(target.suffix + ".part")
    offset = part.stat().st_size if part.exists() else 0
    if offset > limit: part.unlink(); offset = 0
    headers = {"User-Agent":"iKnow-Reading-Helper/1.25 local-voice-setup"}
    if offset: headers["Range"] = f"bytes={offset}-"
    print("Downloading", target.name, "(existing partial data is reused when supported)", flush=True)
    request = urllib.request.Request(url, headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=90)
    except urllib.error.HTTPError as error:
        if error.code == 416 and part.is_file() and digest(part) == checksum:
            part.replace(target); return
        raise
    with response:
        resume = response.status == 206 and offset > 0
        if resume and not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
            raise ValueError("Unexpected resumed download range")
        count = offset if resume else 0
        content_length = int(response.headers.get("Content-Length", "0"))
        if content_length + count > limit: raise ValueError("Unexpected download size")
        with part.open("ab" if resume else "wb") as output:
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                if count > limit: raise ValueError("Voice download exceeds its bounded size")
                output.write(chunk)
    if digest(part) != checksum:
        part.unlink(missing_ok=True)
        raise ValueError("Downloaded file failed its SHA256 check: " + target.name)
    part.replace(target)

def extract(archive, runtime):
    marker = runtime / ".verified-archive-sha256"
    if (runtime / "Windows-x64/run.exe").is_file() and (runtime / "Windows-x64/run.exe").stat().st_size > 0 and marker.is_file() and marker.read_text().strip() == ENGINE_HASH:
        print("Reusing the verified portable engine", flush=True); return
    runtime.mkdir(parents=True, exist_ok=True)
    listing = subprocess.run(["tar.exe", "-tf", str(archive)], check=True, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    if len(listing.stdout) > 3_000_000: raise ValueError("Unexpected archive listing")
    for name in listing.stdout.splitlines():
        destination = (runtime / name).resolve()
        if not destination.is_relative_to(runtime.resolve()): raise ValueError("Unsafe engine archive path")
    print("Unpacking the portable voice engine ...", flush=True)
    subprocess.run(["tar.exe", "-xf", str(archive), "-C", str(runtime)], check=True, creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    if not (runtime / "Windows-x64/run.exe").is_file(): raise ValueError("Engine executable is missing")
    marker.write_text(ENGINE_HASH, encoding="ascii")

def get_json(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open("http://127.0.0.1:10103" + path, timeout=3) as response:
        payload = response.read(2_000_001)
        if len(payload) > 2_000_000: raise ValueError("Oversized local engine reply")
        return json.loads(payload)

def ready():
    try:
        if get_json("/version") != ENGINE_VERSION: return False
        speakers = get_json("/speakers")
        return all(any(value.get("speaker_uuid") == identifier and any(style.get("name") == name for style in value.get("styles",[])) for value in speakers) for identifier,name in SPEAKERS.items())
    except (OSError, ValueError): return False

def warm_engine(cache, engine):
    if ready(): print("Selected local voices are already loaded", flush=True); return
    import socket
    with socket.socket() as probe:
        probe.settimeout(.5)
        if probe.connect_ex(("127.0.0.1",10103)) == 0:
            raise RuntimeError("Port10103 is occupied by a different or incomplete voice engine. Close it and retry.")
    environment = dict(os.environ)
    environment.update({"HF_HOME":str(cache / "neural/huggingface"), "HF_HUB_DISABLE_TELEMETRY":"1", "HF_HUB_DISABLE_SYMLINKS_WARNING":"1"})
    environment.pop("HF_HUB_OFFLINE",None); environment.pop("TRANSFORMERS_OFFLINE",None)
    stdout = (cache / "neural/setup-engine.stdout.log").open("wb")
    stderr = (cache / "neural/setup-engine.stderr.log").open("wb")
    print("Loading shared language resources (first use downloads about1.3GB) ...", flush=True)
    child = subprocess.Popen([str(engine),"--host","127.0.0.1","--port","10103","--output_log_utf8"],cwd=engine.parent,env=environment,stdout=stdout,stderr=stderr,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    try:
        start = time.monotonic(); next_message = start + 20
        while time.monotonic() - start < 900:
            if child.poll() is not None: raise RuntimeError("Voice engine exited. See neural/setup-engine.stderr.log.")
            if ready(): print("Shared language resources and both model identities are ready.",flush=True); return
            if time.monotonic() >= next_message:
                print("Still loading/download progress is in neural/setup-engine.stderr.log ...",flush=True); next_message += 20
            time.sleep(.5)
        raise TimeoutError("Initial voice engine setup timed out; completed downloads are retained.")
    finally:
        if child.poll() is None:
            child.terminate()
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=5)
        stdout.close(); stderr.close()

def prepare(cache):
    cache = Path(cache).resolve()
    if len(str(cache)) < 12 or cache == Path(cache.anchor): raise ValueError("Invalid cache directory")
    root = cache / "neural"; root.mkdir(parents=True,exist_ok=True)
    archive = cache / "downloads/AivisSpeech-Engine-Windows-x64-1.0.0.7z"
    download(ENGINE_URL,archive,ENGINE_HASH,220_000_000)
    runtime = root / "runtime"; extract(archive,runtime)
    models = Path(os.environ["APPDATA"]) / "AivisSpeech-Engine/Models"
    models.mkdir(parents=True,exist_ok=True)
    for model in MODELS:
        candidates = [models / (model["uuid"] + ".aivmx"), *[models / value for value in model["aliases"]]]
        prior = next((path for path in candidates if path.is_file() and digest(path) == model["hash"]),None)
        if prior: print("Reusing",model["name"],flush=True); continue
        url = f"https://api.aivis-project.com/v1/aivm-models/{model['uuid']}/download?model_type=AIVMX"
        download(url,candidates[0],model["hash"],300_000_000)
    installation = {"schemaVersion":1,"engineVersion":ENGINE_VERSION,"voices":["female","male"],"models":MODELS,"installedAt":datetime.now(timezone.utc).isoformat()}
    (root / "installation.json").write_text(json.dumps(installation,indent=2),encoding="utf-8")
    warm_engine(cache,runtime / "Windows-x64/run.exe")
    print("Local neural voice files are installed. No course model was downloaded.",flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--cache-root",type=Path,required=True)
    parser.add_argument("--check-audio",action="store_true")
    args = parser.parse_args()
    if args.check_audio:
        try:
            import av, numpy
            if av.__version__ != "19.0.2" or numpy.__version__ != "2.5.4":
                raise ImportError("Pinned audio library versions are not installed")
            print("Audio libraries ready.",flush=True)
        except (ImportError, OSError):
            sys.exit(1)
    else:
        prepare(args.cache_root)
