#!/usr/bin/env python3
"""Validate disposable emulator Wi-Fi against the local fixture, not public DNS."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import time
import urllib.request

HOST = 'http://127.0.0.1:18083'
PROBE = 'http://10.0.2.2:18083/__fixture__/network-204'

def validated_wifi(dump):
    return any('NetworkAgentInfo' in line and 'WIFI' in line and 'VALIDATED' in line and 'NOT_METERED' in line for line in dump.splitlines())

def ready(dump, initial_probes, current_probes):
    return validated_wifi(dump) and current_probes > initial_probes

def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Disposable GitHub runner only'
    def shell(*args):
        return subprocess.check_output(['adb', 'shell', shlex.join(args)], text=True, timeout=15).strip()
    assert shell('getprop', 'ro.kernel.qemu') == '1', 'An emulator is required'
    assert shell('getprop', 'ro.build.version.sdk') == '34', 'The disposable API-34 fixture is required'
    proof = Path(os.environ['RUNNER_TEMP']) / 'homesync-proof'
    proof.mkdir(exist_ok=True)
    with urllib.request.urlopen(HOST + '/__fixture__/network-204', timeout=5) as response:
        assert response.status == 204 and response.read() == b'', 'Invalid local connectivity probe'
    def probes():
        with urllib.request.urlopen(HOST + '/__fixture__/network-status', timeout=5) as response:
            return json.load(response)['probes']
    initial = probes()
    # These settings affect only this disposable emulator, not the app or a developer's network.
    # Keep validation enabled and require a genuine HTTP-204 probe to the same local LAN fixture.
    for key, value in [('captive_portal_mode', '1'), ('captive_portal_use_https', '0'),
                       ('captive_portal_http_url', PROBE), ('captive_portal_fallback_url', PROBE),
                       ('captive_portal_other_fallback_urls', PROBE)]:
        shell('settings', 'put', 'global', key, value)
    shell('device_config', 'put', 'connectivity', 'captive_portal_use_https', '0')
    shell('svc', 'wifi', 'disable')
    shell('svc', 'wifi', 'enable')
    deadline = time.monotonic() + 60
    dump = ''
    while time.monotonic() < deadline:
        dump = shell('dumpsys', 'connectivity')
        count = probes()
        if ready(dump, initial, count):
            (proof / 'network-readiness.txt').write_text(f'Local probe: {PROBE}\nNetworkMonitor probes: {count - initial}\n' + dump, encoding='utf-8')
            print('ok real unmetered Wi-Fi validation against local HTTP-204 fixture; no public DNS required')
            return
        time.sleep(1)
    (proof / 'network-readiness.txt').write_text(dump, encoding='utf-8')
    raise RuntimeError('Emulator Wi-Fi did not validate against the local fixture; refusing to start backup tests')

if __name__ == '__main__':
    main()
