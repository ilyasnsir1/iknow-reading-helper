"""Download identities shipped inside the signed application release.

Browser requests select an ID only. They never provide URLs, checksums, paths,
commands or catalog entries. Future model versions are delivered as app updates.
"""
from __future__ import annotations

CATALOG_VERSION = "2026-10-29.1"
WHISPER_BASE = "https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/"


def artifact(name, url, sha256, target, *, root="cache", size=None, maximum=None, archive=None, legacy=()):
    return dict(name=name, url=url, sha256=sha256, target=target, root=root,
                size=size, maximum=maximum or size, archive=archive, legacy=list(legacy))


COMPONENTS = {
    "language": {
        "id": "language", "title": "German & meaning colors", "version": "qwen35-9b-q4km-b11669",
        "description": "Local language model and runtime for course preparation.",
        "downloadBytes": 5_800_000_000, "sizeIsEstimate": True, "requirements": None,
        "artifacts": [
            artifact("Qwen3.5-9B", "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5/Qwen3.5-9B-Q4_K_M.gguf?download=true",
                     "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8", "models/Qwen3.5-9B-Q4_K_M.gguf", maximum=7_000_000_000),
            artifact("Local language runtime", "https://github.com/ggml-org/llama.cpp/releases/download/b11669/llama-b11669-bin-win-vulkan-x64.zip",
                     "2c07574e7bde71321cb785282b20cc821e951132149eeceeea32ddebdbf0598e", "runtime/llama", maximum=350_000_000, archive="zip", legacy=("downloads/llama-b11669-vulkan.zip",)),
        ],
    },
    "audio": {
        "id": "audio", "title": "Sentence audio timings", "version": "whisper-small-536b066",
        "description": "Local speech model for highlighting words in original sentence recordings.",
        "downloadBytes": 486_212_372, "sizeIsEstimate": True, "requirements": "requirements.txt",
        "artifacts": [
            artifact(name, WHISPER_BASE + name, sha, "models/whisper-small/" + name, size=size)
            for name, size, sha in (
                ("config.json", 2370, "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828"),
                ("model.bin", 483546902, "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"),
                ("tokenizer.json", 2203239, "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"),
                ("vocabulary.txt", 459861, "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"),
            )
        ],
    },
    "voices": {
        "id": "voices", "title": "Mao Plain & Nise", "version": "aivis-1.0.0-mao-nise",
        "description": "Female and male word voices, including their shared local engine and language resources.",
        "downloadBytes": 2_000_000_000, "sizeIsEstimate": True, "requirements": "neural-voice-requirements.txt",
        "artifacts": [
            artifact("Word voice engine", "https://github.com/Aivis-Project/AivisSpeech-Engine/releases/download/1.0.0/AivisSpeech-Engine-Windows-x64-1.0.0.7z.001",
                     "ae0a52d58bc5423451229fb2f3348693c9a1121c83f0542bfb826c6e68a4fc0d", "neural/runtime", maximum=220_000_000, archive="7z", legacy=("downloads/AivisSpeech-Engine-Windows-x64-1.0.0.7z",)),
            artifact("Mao Plain", "https://api.aivis-project.com/v1/aivm-models/a59cb814-0083-4369-8542-f51a29e72af7/download?model_type=AIVMX",
                     "f87ccea2e8e2de0e0bfe52e803945af903b4086bf25621a015111628f00e4119", "Models/a59cb814-0083-4369-8542-f51a29e72af7.aivmx", root="aivis", maximum=300_000_000),
            artifact("Nise", "https://api.aivis-project.com/v1/aivm-models/6d11c6c2-f4a4-4435-887e-23dd60f8b8dd/download?model_type=AIVMX",
                     "6ff7eaa61c24d37434e2c6ab672fc3ba189ecc9118c08918a486ed5316e5c9d3", "Models/6d11c6c2-f4a4-4435-887e-23dd60f8b8dd.aivmx", root="aivis", maximum=300_000_000),
        ],
    },
}
