"""Register only a unique test native-host name; never the installed host."""
import argparse
from pathlib import Path
import re
import winreg

parser = argparse.ArgumentParser()
parser.add_argument("action", choices=["register", "remove"])
parser.add_argument("name")
parser.add_argument("manifest", type=Path)
args = parser.parse_args()
if not re.fullmatch(r"de\.iknow\.test\.components\.t[a-f0-9]{16}", args.name):
    raise ValueError("Only the isolated test namespace is permitted")
for browser in (r"Software\BraveSoftware\Brave-Browser", r"Software\Google\Chrome"):
    key_path = browser + "\\NativeMessagingHosts\\" + args.name
    if args.action == "register":
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path):
                raise ValueError("The unique fixture key unexpectedly exists")
        except FileNotFoundError:
            pass
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(args.manifest.resolve(strict=True)))
    else:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            if winreg.QueryValueEx(key, "")[0] != str(args.manifest.resolve()):
                raise ValueError("The fixture registration changed unexpectedly")
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key_path)
