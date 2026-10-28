"""Installer steps invoked as files for Windows PowerShell 5.1 compatibility."""
from __future__ import annotations

import argparse
from pathlib import Path


WHISPER_REPOSITORY = "Systran/faster-whisper-small"
WHISPER_REVISION = "536b0662742c02347bc0e980a01041f333bce120"
WHISPER_FILES = [
    "config.json", "model.bin", "tokenizer.json", "vocabulary.txt",
    "preprocessor_config.json",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    steps = parser.add_subparsers(dest="step", required=True)
    steps.add_parser("check-audio")
    whisper = steps.add_parser("prepare-whisper")
    whisper.add_argument("--model-directory", type=Path, required=True)
    args = parser.parse_args()
    if args.step == "check-audio":
        import numpy, av, ctranslate2, faster_whisper, huggingface_hub
        print("Audio libraries are ready.", flush=True)
    else:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=WHISPER_REPOSITORY,
            revision=WHISPER_REVISION,
            local_dir=str(args.model_directory),
            allow_patterns=WHISPER_FILES,
        )
        print("Audio model is ready.", flush=True)


if __name__ == "__main__":
    main()
