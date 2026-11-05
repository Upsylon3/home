import copy
import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('scope', Path(__file__).parents[1] / 'ci-scope.py')
scope = importlib.util.module_from_spec(spec); spec.loader.exec_module(scope)

class ScopeTests(unittest.TestCase):
    def test_backup_proof_installs_the_native_sqlite_binding(self):
        selected = scope.select(['services/backup/export.py'])
        self.assertTrue(selected['backup'])
        self.assertTrue(selected['native'])
        self.assertTrue(selected['node'])
        self.assertFalse(selected['android'])

    def test_server_portal_and_runtime_have_separate_checks(self):
        portal = scope.select(['server/portal/portal.mjs'])
        self.assertTrue(portal['demo']); self.assertFalse(portal['docker']); self.assertFalse(portal['android'])
        runtime = scope.select(['server/runtime.mjs'])
        self.assertTrue(runtime['docker']); self.assertFalse(runtime['demo']); self.assertFalse(runtime['android'])
        self.assertFalse(scope.select(['server/test/setup.test.mjs'])['docker'])

    def baseline(self):
        lock = {'packages': {'': {}, 'homecore': {'dependencies': {'express': '1', 'better-sqlite3': '1'}}, 'apps/homecloud-backend': {}, 'apps/homesync-backend': {}, 'packages/homecore-client': {}, 'node_modules/express': {'version': '1', 'dependencies': {'send': '1'}}, 'node_modules/send': {'version': '1'}, 'node_modules/better-sqlite3': {'version': '1'}, 'node_modules/playwright': {'version': '1', 'dev': True}}}
        return {'package.json': {'version': '1.6.2', 'workspaces': scope.WORKSPACES, 'scripts': {}, 'devDependencies': {'playwright': '1'}}, 'package-lock.json': lock}
    def test_demo_only_never_builds_android_or_docker(self):
        selected = scope.select(['demo/api.mjs', '.github/workflows/demo.yml', 'docs/BROWSER_DEMO.md'])
        self.assertTrue(selected['demo'])
        for key in ['android','emulator','docker','windows','gateway','node']: self.assertFalse(selected[key], key)
    def test_frontend_only_builds_affected_app_without_native_installs(self):
        selected = scope.select(['apps/homenotes/src/pages/NoteEditor.jsx'])
        self.assertEqual(selected['tests'], ['apps/homenotes']); self.assertEqual(selected['builds'], ['apps/homenotes'])
        self.assertTrue(selected['demo']); self.assertFalse(selected['native']); self.assertFalse(selected['docker']); self.assertFalse(selected['android'])
    def test_backend_dependencies_expand_to_real_consumers(self):
        selected = scope.select(['apps/homecloud-backend/src/files.js'])
        for workspace in ['apps/homecloud-backend','apps/homemedia-backend','apps/homenotes-backend','apps/homesync-backend','services/homebridge']: self.assertIn(workspace, selected['tests'])
        self.assertTrue(selected['native']); self.assertTrue(selected['docker']); self.assertTrue(selected['windows']); self.assertTrue(selected['emulator'])
    def test_unrelated_backend_does_not_run_android(self):
        selected = scope.select(['apps/hometasks-backend/src/tasks.js'])
        self.assertEqual(selected['tests'], ['apps/hometasks-backend','services/homebridge']); self.assertFalse(selected['android'])
    def test_demo_dev_dependency_does_not_trigger_android(self):
        old = self.baseline(); new = copy.deepcopy(old)
        new['package.json']['devDependencies']['playwright'] = '2'
        new['package-lock.json']['packages']['node_modules/playwright']['version'] = '2'
        selected = scope.select(['package.json','package-lock.json'], old, new)
        self.assertTrue(selected['audit']); self.assertTrue(selected['demo']); self.assertFalse(selected['docker']); self.assertFalse(selected['android']); self.assertFalse(selected['native'])
    def test_transitive_fixture_dependency_runs_emulator(self):
        old = self.baseline(); new = copy.deepcopy(old)
        new['package-lock.json']['packages']['node_modules/send']['version'] = '2'
        selected = scope.select(['package-lock.json'], old, new)
        self.assertTrue(selected['emulator']); self.assertTrue(selected['windows']); self.assertTrue(selected['docker'])
    def test_root_demo_script_is_demo_only(self):
        old = self.baseline(); new = copy.deepcopy(old); new['package.json']['scripts']['build:demo'] = 'node demo/build.mjs'
        selected = scope.select(['package.json'], old, new)
        self.assertTrue(selected['demo']); self.assertFalse(selected['android']); self.assertFalse(selected['node'])
    def test_android_resources_build_without_emulator_but_worker_changes_run_it(self):
        resource = scope.select(['apps/homesync-android/app/src/main/res/values/strings.xml'])
        worker = scope.select(['apps/homesync-android/app/src/main/java/BackupWorker.kt'])
        self.assertTrue(resource['android']); self.assertFalse(resource['emulator']); self.assertTrue(worker['emulator']); self.assertFalse(worker['node'])
    def test_test_only_changes_do_not_start_stack_or_emulator(self):
        selected = scope.select(['apps/homecloud-backend/test/files.test.js'])
        self.assertEqual(selected['tests'], ['apps/homecloud-backend']); self.assertFalse(selected['docker']); self.assertFalse(selected['android']); self.assertTrue(selected['windows'])
        frontend = scope.select(['apps/homevault/test/crypto.test.js'])
        self.assertEqual(frontend['tests'], ['apps/homevault']); self.assertEqual(frontend['builds'], []); self.assertFalse(frontend['demo'])
    def test_android_network_resources_and_design_images_keep_their_proof(self):
        self.assertTrue(scope.select(['apps/homesync-android/app/src/main/res/xml/network_security_config.xml'])['emulator'])
        self.assertTrue(scope.select(['design/logo.png'])['demo'])
    def test_missing_baselines_unknown_paths_and_policy_edits_fail_closed(self):
        for paths in [['package-lock.json'], ['future-app/server.js'], ['scripts/ci-scope.py']]:
            selected = scope.select(paths)
            self.assertTrue(selected['docker']); self.assertTrue(selected['emulator']); self.assertEqual(set(selected['tests']), set(scope.WORKSPACES))
    def test_docs_do_not_select_heavy_jobs_and_manual_weekly_stay_full(self):
        self.assertFalse(scope.select(['README.md'])['node'])
        for event in ['workflow_dispatch','schedule']:
            selected = scope.select([], event=event)
            self.assertTrue(selected['docker']); self.assertTrue(selected['emulator']); self.assertEqual(set(selected['builds']), set(scope.FRONTENDS))

if __name__ == '__main__': unittest.main()
