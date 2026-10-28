"""Probe the embedded interpreter and standard library without network access."""
import json
from pathlib import Path
import ssl
import sys
import zipfile

if sys.version_info[:3] != (3, 12, 10):
    raise RuntimeError("Unexpected private Python version")
