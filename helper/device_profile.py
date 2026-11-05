import csv
import ctypes
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import time


DAY = 86400000
TEXT = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._()+,-]{0,159}\Z")
VERSION = re.compile(r"[0-9]+(?:\.[0-9]+){1,3}\Z")


def text(value, maximum=160):
    if not isinstance(value, str):
        return None
    value = " ".join(value.replace("\x00", "").split())
    return value if len(value) <= maximum and TEXT.fullmatch(value) and not re.search(r"(?:[A-Za-z]:[/\\]|https?://|token|password|secret)", value, re.I) else None


def read_json(path, maximum=32768):
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(maximum + 1)
        return json.loads(raw) if len(raw) <= maximum else None
    except (OSError, ValueError, UnicodeError):
        return None


def valid_hardware(value):
    if not isinstance(value, dict) or set(value) != {"os", "cpu", "memory", "gpus", "checks"}:
        return False
    system = value["os"]
    if not isinstance(system, dict) or set(system) != {"name", "version", "architecture"} or not isinstance(system["name"], str) or system["name"] not in {"Windows", "Linux", "macOS", "unknown"} or not isinstance(system["architecture"], str) or system["architecture"] not in {"x64", "arm64", "x86", "unknown"} or not isinstance(system["version"], str) or text(system["version"], 80) != system["version"]:
        return False
    cpu = value["cpu"]
    if not isinstance(cpu, dict) or "logicalCores" not in cpu or set(cpu) - {"model", "logicalCores"} or type(cpu["logicalCores"]) is not int or not 1 <= cpu["logicalCores"] <= 1024 or "model" in cpu and (not isinstance(cpu["model"], str) or text(cpu["model"]) != cpu["model"]):
        return False
    memory = value["memory"]
    if not isinstance(memory, dict) or set(memory) - {"totalMiB"} or "totalMiB" in memory and (type(memory["totalMiB"]) is not int or not 1 <= memory["totalMiB"] <= 16777216):
        return False
    gpus = value["gpus"]
    if not isinstance(gpus, list) or len(gpus) > 8:
        return False
    for gpu in gpus:
        if not isinstance(gpu, dict) or "name" not in gpu or set(gpu) - {"name", "driverVersion", "vramMiB"} or not isinstance(gpu["name"], str) or text(gpu["name"]) != gpu["name"]:
            return False
        if "driverVersion" in gpu and (not isinstance(gpu["driverVersion"], str) or len(gpu["driverVersion"]) > 80 or not VERSION.fullmatch(gpu["driverVersion"])):
            return False
        if "vramMiB" in gpu and (type(gpu["vramMiB"]) is not int or not 1 <= gpu["vramMiB"] <= 16777216):
            return False
    checks = value["checks"]
    if not isinstance(checks, list) or len(checks) != 2:
        return False
    expected = {"gpu-inventory": "ok" if gpus else "unavailable", "system-memory": "ok" if memory else "unavailable"}
    return all(isinstance(check, dict) and set(check) == {"code", "status"} and isinstance(check.get("code"), str) and check["code"] in expected and check.get("status") == expected[check["code"]] for check in checks) and len({check["code"] for check in checks}) == 2


def registry_hardware():
    if os.name != "nt":
        return None, []
    import winreg
    cpu, gpus = None, []
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as key:
            cpu = text(winreg.QueryValueEx(key, "ProcessorNameString")[0])
    except OSError:
        pass
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}") as root:
            for index in range(min(winreg.QueryInfoKey(root)[0], 64)):
                name = winreg.EnumKey(root, index)
                if not re.fullmatch(r"\d{4}", name):
                    continue
                try:
                    with winreg.OpenKey(root, name) as key:
                        model = text(winreg.QueryValueEx(key, "DriverDesc")[0])
                        if not model or any(gpu["name"] == model for gpu in gpus):
                            continue
                        gpu = {"name": model}
                        try:
                            driver = winreg.QueryValueEx(key, "DriverVersion")[0]
                            if isinstance(driver, str) and len(driver) <= 80 and VERSION.fullmatch(driver):
                                gpu["driverVersion"] = driver
                        except OSError:
                            pass
                        gpus.append(gpu)
                except OSError:
                    pass
    except OSError:
        pass
    return cpu, gpus[:8]


def nvidia_gpus():
    if os.name != "nt":
        return []
    candidates = [Path(os.environ.get("WINDIR", "C:/Windows")) / "System32/nvidia-smi.exe", Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "NVIDIA Corporation/NVSMI/nvidia-smi.exe"]
    executable = next((path for path in candidates if path.is_file()), None)
    if executable is None:
        return []
    try:
        result = subprocess.run([str(executable), "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader,nounits"], capture_output=True, timeout=2, creationflags=subprocess.CREATE_NO_WINDOW, check=False)
        if result.returncode or len(result.stdout) > 8192:
            return []
        gpus = []
        for row in csv.reader(result.stdout.decode("utf-8", errors="replace").splitlines()[:8]):
            if len(row) != 3 or not text(row[0].strip()) or len(row[1].strip()) > 80 or not VERSION.fullmatch(row[1].strip()):
                continue
            gpu = {"name": text(row[0].strip()), "driverVersion": row[1].strip()}
            memory = row[2].strip()
            if memory.isdigit() and 1 <= int(memory) <= 16777216:
                gpu["vramMiB"] = int(memory)
            gpus.append(gpu)
        return gpus
    except (OSError, subprocess.TimeoutExpired):
        return []


def memory_total():
    if os.name == "nt":
        class Memory(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in ("total", "available", "page", "availablePage", "virtual", "availableVirtual", "extended")]
        try:
            status = Memory()
            status.length = ctypes.sizeof(status)
            if ctypes.WinDLL("kernel32", use_last_error=True).GlobalMemoryStatusEx(ctypes.byref(status)):
                return status.total // (1024 ** 2)
        except (OSError, AttributeError):
            pass
    else:
        try:
            return os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE") // (1024 ** 2)
        except (OSError, ValueError, AttributeError):
            pass
    return None


def hardware():
    system = {"Windows": "Windows", "Linux": "Linux", "Darwin": "macOS"}.get(platform.system(), "unknown")
    architecture = {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64", "arm64": "arm64", "x86": "x86", "i386": "x86", "i686": "x86"}.get(platform.machine().lower(), "unknown")
    cpu, adapters = registry_hardware()
    nvidia = nvidia_gpus()
    for gpu in nvidia:
        adapters = [other for other in adapters if other["name"].lower() != gpu["name"].lower()]
    gpus = (nvidia + adapters)[:8]
    model = cpu or text(platform.processor())
    memory = memory_total()
    total = {"totalMiB": memory} if type(memory) is int and 1 <= memory <= 16777216 else {}
    return {"os": {"name": system, "version": text(platform.version(), 80) or "unknown", "architecture": architecture}, "cpu": {"logicalCores": max(1, min(1024, os.cpu_count() or 1)), **({"model": model} if model else {})}, "memory": total, "gpus": gpus, "checks": [{"code": "gpu-inventory", "status": "ok" if gpus else "unavailable"}, {"code": "system-memory", "status": "ok" if total else "unavailable"}]}


def observed_runtime(cache):
    path = Path(cache) / "logs/llama.log"
    try:
        if path.is_symlink():
            return {}
        stat = path.stat()
        with path.open("rb") as stream:
            stream.seek(max(0, stat.st_size - 32768))
            lines = stream.read(32768).decode("utf-8", errors="replace").splitlines()
    except OSError:
        return {}
    devices, selected, cpu = {}, None, False
    for line in lines:
        match = re.search(r"ggml_vulkan:\s*(\d+)\s*=\s*(.+?)\s+\(", line)
        if match and text(match[2].strip()):
            devices["Vulkan" + match[1]] = match[2].strip()
        match = re.search(r"(?:load_tensors|llama_model_load):\s*(Vulkan\d{1,2}|CUDA\d{1,2}|CPU)\s+model buffer size\s*=\s*(\d{1,9}(?:\.\d{1,6})?)\s*(?:MiB|MB)\b", line)
        if match and 0 < float(match[2]) <= 16777216:
            if match[1] == "CPU":
                cpu = True
            else:
                selected = match[1]
    if selected is None and cpu:
        selected = "CPU"
    if selected is None:
        return {}
    backend = "vulkan" if selected.startswith("Vulkan") else "cuda" if selected.startswith("CUDA") else "cpu"
    return {"observedBackend": backend, "observedDevice": devices.get(selected, selected), "observedAt": max(0, min(int(stat.st_mtime * 1000), int(time.time() * 1000)))}


def runtime(cache, helper_version):
    result = {"helperVersion": helper_version if isinstance(helper_version, str) and len(helper_version) <= 40 and VERSION.fullmatch(helper_version) else "unknown"}
    if result["helperVersion"] == "unknown":
        try:
            with Path(__file__).with_name("native_host.py").open("rb") as stream:
                header = stream.read(128 * 1024).decode("utf-8", errors="replace")
            match = re.search(r'^HOST_VERSION = "([\d.]+)"$', header, re.M)
            if match and len(match[1]) <= 40:
                result["helperVersion"] = match[1]
        except OSError:
            pass
    config = read_json(Path(cache) / "runtime-config.json")
    layers = config.get("gpuLayers") if isinstance(config, dict) else None
    if type(layers) is int and 0 <= layers <= 1024 or layers == "auto":
        result["configuredGpuLayers"] = layers
    marker = read_json(Path(cache) / "neural/installation.json")
    voices = marker.get("voices", []) if isinstance(marker, dict) else []
    ready = isinstance(marker, dict) and isinstance(voices, list) and marker.get("engineVersion") == "1.0.0" and (Path(cache) / "neural/runtime/Windows-x64/run.exe").is_file()
    shared = Path(os.environ["APPDATA"]) / "AivisSpeech-Engine/Models" if os.environ.get("APPDATA") else None
    def voice_present(voice, filename, alias):
        return bool(ready and voice in voices and shared and any(not path.is_symlink() and path.is_file() for path in (shared / filename, shared / alias)))
    result["models"] = [{"id": "qwen35-9b-q4km", "installed": (Path(cache) / "models/Qwen3.5-9B-Q4_K_M.gguf").is_file()}, {"id": "whisper-small", "installed": (Path(cache) / "models/whisper-small/model.bin").is_file()}, {"id": "mao-plain", "installed": voice_present("female", "a59cb814-0083-4369-8542-f51a29e72af7.aivmx", "mao.aivmx")}, {"id": "nise", "installed": voice_present("male", "6d11c6c2-f4a4-4435-887e-23dd60f8b8dd.aivmx", "nise.aivmx")}]
    result.update(observed_runtime(cache))
    return result


def collect(cache, helper_version="unknown", force=False, cache_hardware=True):
    now = int(time.time() * 1000)
    saved = Path(cache) / "support/device-profile-cache.json"
    cached = read_json(saved)
    base = None
    if not force and isinstance(cached, dict) and set(cached) == {"at", "hardware"} and type(cached["at"]) is int and 0 <= now - cached["at"] < DAY:
        candidate = cached["hardware"]
        if valid_hardware(candidate):
            base = candidate
    if base is None:
        base = hardware()
        if cache_hardware:
            try:
                saved.parent.mkdir(parents=True, exist_ok=True)
                temporary = saved.with_suffix(".tmp-" + str(os.getpid()))
                temporary.write_text(json.dumps({"at": now, "hardware": base}, separators=(",", ":")), encoding="utf-8")
                os.replace(temporary, saved)
            except OSError:
                pass
    return {"schemaVersion": 1, "collectedAt": now, **base, "runtime": runtime(cache, helper_version)}
