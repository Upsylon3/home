"""Select CI proof by changed ownership/dependencies; unknown paths fail closed."""
import argparse
import json
import os
import subprocess
from pathlib import PurePosixPath

FRONTENDS = ['apps/' + name for name in ['home', 'homecloud', 'homemedia', 'homenotes', 'hometasks', 'homemonitor', 'homevault']]
BACKENDS = ['homecore', 'packages/homecore-client'] + ['apps/' + name + '-backend' for name in ['homecloud', 'homemedia', 'homenotes', 'homesync', 'homevault', 'hometasks', 'homemonitor']] + ['services/homebridge']
WORKSPACES = BACKENDS + FRONTENDS
ANDROID_UPSTREAM = {'homecore', 'packages/homecore-client', 'apps/homecloud-backend', 'apps/homesync-backend'}
DEPENDANTS = {
    'homecore': set(BACKENDS), 'packages/homecore-client': set(BACKENDS),
    'apps/homecloud-backend': {'apps/homemedia-backend', 'apps/homenotes-backend', 'apps/homesync-backend', 'services/homebridge'},
    'apps/homenotes-backend': {'services/homebridge'}, 'apps/hometasks-backend': {'services/homebridge'}, 'apps/homemonitor-backend': {'services/homebridge'},
}

def git_json(ref, path):
    result = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True)
    if result.returncode:
        return {}
    return json.loads(result.stdout)

def runtime_entries(lock):
    return {key: {k: v for k, v in entry.items() if k != 'devDependencies'}
            for key, entry in lock.get('packages', {}).items()
            if key and not entry.get('dev') and not entry.get('link')}

def fixture_entries(lock):
    packages = lock.get('packages', {})
    found = {}
    pending = list(ANDROID_UPSTREAM)
    while pending:
        key = pending.pop()
        if key in found or key not in packages:
            continue
        entry = packages[key]
        found[key] = {k: v for k, v in entry.items() if k != 'devDependencies'}
        if entry.get('link'):
            pending.append(entry['resolved'])
        for name in set(entry.get('dependencies', {})) | set(entry.get('optionalDependencies', {})) | set(entry.get('peerDependencies', {})):
            parent = PurePosixPath(key)
            candidates = [str(p / 'node_modules' / name) for p in [parent, *parent.parents] if p.name != 'node_modules']
            for candidate in candidates:
                if candidate in packages:
                    pending.append(candidate)
                    break
    return found

def select(paths, before=None, after=None, event='pull_request'):
    before, after = before or {}, after or {}
    result = {key: False for key in ['node', 'native', 'audit', 'gateway', 'docker', 'windows', 'backup', 'android', 'emulator', 'demo']}
    tests, builds = set(), set()
    reasons = []
    def full(reason):
        tests.update(WORKSPACES); builds.update(FRONTENDS)
        result.update({key: True for key in result})
        reasons.append(reason)
    def backend(workspace):
        tests.add(workspace); tests.update(DEPENDANTS.get(workspace, set()))
        result['docker'] = True
        if workspace in ANDROID_UPSTREAM:
            result['android'] = result['emulator'] = True
        if workspace in {'apps/homecloud-backend', 'apps/homemedia-backend'}:
            result['windows'] = True
    if event in {'workflow_dispatch', 'schedule'}:
        full('Full manual/weekly regression')
    for path in paths:
        if not path or path.endswith('.md'):
            continue
        if path in {'scripts/ci-scope.py', '.github/workflows/ci.yml'} or path.startswith('scripts/test/test_ci_'):
            full('CI selection policy changed')
        elif path.startswith('server/portal/'):
            result['demo'] = True
        elif path.startswith('server/') or path == '.github/workflows/server.yml':
            if not path.startswith('server/test/') and path != '.github/workflows/server.yml':
                result['docker'] = True
        elif path.startswith('demo/') or path in {'.github/workflows/demo.yml', '.github/workflows/demo-deploy.yml'} or path.startswith('scripts/demo-') or path.startswith('scripts/test/test_demo_') or path.startswith('scripts/test/demo-'):
            result['demo'] = True
        elif path == '.github/workflows/android.yml' or path.startswith('scripts/android-') or path == 'scripts/test/test_android_gradle_version.py':
            result['android'] = result['emulator'] = True
        elif path.startswith('apps/homesync-android/'):
            result['android'] = True
            if not path.startswith('apps/homesync-android/app/src/main/res/') or '/res/xml/' in path or '/res/raw/' in path:
                result['emulator'] = True
        elif path in {'package.json', 'package-lock.json'}:
            # Assess these together below. Root demo scripts/dev tooling are not Android fixture dependencies.
            continue
        elif path.startswith('design/'):
            tests.update(FRONTENDS); builds.update(FRONTENDS); result['demo'] = True
        elif path.startswith('gateway/'):
            result['gateway'] = result['docker'] = True
        elif path.startswith('docker-compose') or path == '.dockerignore':
            result['docker'] = True
        elif path.startswith('services/backup/'):
            result['backup'] = result['docker'] = True
        elif any(path == w or path.startswith(w + '/') for w in WORKSPACES):
            workspace = next(w for w in WORKSPACES if path == w or path.startswith(w + '/'))
            if workspace in FRONTENDS:
                tests.add(workspace)
                if '/test/' not in path:
                    builds.add(workspace); result['demo'] = True
                if path.endswith(('Dockerfile', 'nginx.conf')):
                    result['docker'] = True
            elif '/test/' in path:
                tests.add(workspace)
                if workspace in {'apps/homecloud-backend', 'apps/homemedia-backend'}:
                    result['windows'] = True
            elif '/test-support/' in path and not path.endswith('android-fixture.cjs'):
                tests.add(workspace); result['docker'] = True
            else:
                backend(workspace)
            if path.endswith('package.json'):
                result['audit'] = True
        elif path in {'.gitignore', '.githooks/commit-msg', '.github/PULL_REQUEST_TEMPLATE.md', '.github/workflows/conventions.yml', 'scripts/check-commit-message.mjs', 'LICENSE'}:
            pass
        else:
            full('Unclassified path: ' + path)
    if {'package.json', 'package-lock.json'} & set(paths):
        old_package, new_package = before.get('package.json', {}), after.get('package.json', {})
        old_lock, new_lock = before.get('package-lock.json', {}), after.get('package-lock.json', {})
        result['audit'] = True
        if not old_package or not new_package or not old_lock or not new_lock:
            full('Dependency baseline unavailable')
        else:
            runtime_keys = ['dependencies', 'optionalDependencies', 'engines', 'workspaces', 'allowScripts']
            root_runtime = any(old_package.get(k) != new_package.get(k) for k in runtime_keys)
            if root_runtime or runtime_entries(old_lock) != runtime_entries(new_lock):
                tests.update(WORKSPACES); builds.update(FRONTENDS)
                result['docker'] = result['windows'] = result['gateway'] = result['backup'] = result['demo'] = True
            elif old_lock != new_lock or old_package.get('devDependencies') != new_package.get('devDependencies'):
                tests.update(FRONTENDS); builds.update(FRONTENDS); result['demo'] = True
            scripts = set(old_package.get('scripts', {})) | set(new_package.get('scripts', {}))
            changed_scripts = {k for k in scripts if old_package.get('scripts', {}).get(k) != new_package.get('scripts', {}).get(k)}
            if any('demo' not in name for name in changed_scripts):
                tests.update(WORKSPACES); builds.update(FRONTENDS)
            if any('demo' in name for name in changed_scripts):
                result['demo'] = True
            if old_package.get('version') != new_package.get('version'):
                result['android'] = True
            if root_runtime or fixture_entries(old_lock) != fixture_entries(new_lock):
                result['android'] = result['emulator'] = True
    result['tests'], result['builds'] = sorted(tests), sorted(builds)
    result['node'] = bool(tests or builds or result['backup'])
    result['native'] = bool(tests & set(BACKENDS)) or result['backup']
    result['reasons'] = reasons or ['Checks selected from changed apps and runtime dependencies']
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default=os.environ.get('BASE_SHA', ''))
    parser.add_argument('--head', default=os.environ.get('HEAD_SHA', 'HEAD'))
    parser.add_argument('--event', default=os.environ.get('EVENT_NAME', 'workflow_dispatch'))
    args = parser.parse_args()
    if args.event in {'workflow_dispatch', 'schedule'} or not args.base or set(args.base) == {'0'}:
        result = select([], event='workflow_dispatch')
    else:
        # Three-dot diff matches the PR's actual changes if main advanced meanwhile.
        paths = subprocess.check_output(['git', 'diff', '--name-only', '-z', args.base + '...' + args.head]).decode().strip('\0').split('\0')
        before = {name: git_json(args.base, name) for name in ['package.json', 'package-lock.json']}
        after = {name: git_json(args.head, name) for name in ['package.json', 'package-lock.json']}
        result = select(paths, before, after, args.event)
    print(json.dumps(result, indent=2))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            for key, value in result.items():
                if key != 'reasons':
                    output.write(f'{key}={json.dumps(value, separators=(",", ":"))}\n')

if __name__ == '__main__':
    main()
