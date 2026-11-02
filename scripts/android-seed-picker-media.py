#!/usr/bin/env python3
"""Seed two foreign-owned photos on the disposable GitHub emulator only."""
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time
import urllib.request

assert os.environ.get("GITHUB_ACTIONS") == "true", "Disposable GitHub runner only"
proof = Path(os.environ["RUNNER_TEMP"]) / "homesync-proof"
proof.mkdir(exist_ok=True)

def adb(*args):
    return subprocess.check_output(["adb", *args], text=True).strip()

def shell(*args):
    return adb("shell", shlex.join(args))

assert shell("getprop", "ro.kernel.qemu") == "1", "An emulator is required"
shell("mkdir", "-p", "/sdcard/DCIM/HomeSyncPicker")
collection = "content://media/external/images/media"
ids = {}
for kind, taken in [("unselected", 1767312000000), ("selected", 1767312060000)]:
    name = f"homesync-picker-{kind}.png"
    with urllib.request.urlopen(f"http://127.0.0.1:18083/__fixture__/picker-{kind}.png", timeout=10) as response:
        (proof / name).write_bytes(response.read())
    path = f"/sdcard/DCIM/HomeSyncPicker/{name}"
    adb("push", str(proof / name), path)
    shell("am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", f"file://{path}")
    for attempt in range(30):
        row = shell("content", "query", "--uri", collection, "--projection", "_id:_display_name:owner_package_name", "--where", f"_display_name='{name}'")
        if "_id=" in row:
            break
        time.sleep(1)
    assert name in row and "owner_package_name=" in row, row
    assert "owner_package_name=com.homeecosystems.homesync" not in row, row
    ids[kind] = int(re.search(r"_id=(\d+)", row).group(1))
    shell("content", "update", "--uri", f"{collection}/{ids[kind]}", "--bind", f"datetaken:l:{taken}")
    row = shell("content", "query", "--uri", f"{collection}/{ids[kind]}", "--projection", "_id:_display_name:owner_package_name:datetaken")
    assert f"datetaken={taken}" in row, row
    print(row)
    (proof / f"picker-{kind}-id.txt").write_text(str(ids[kind]))
(proof / "picker-seed.json").write_text(json.dumps(ids))
assert len(set(ids.values())) == 2, ids
print("Seeded two distinct photos outside HomeSync ownership; selected is newest by date_taken.")
