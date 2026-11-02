import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("android_gradle_version", Path(__file__).resolve().parents[1] / "android-gradle-version.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GradleVersionTest(unittest.TestCase):
    def test_wrapper_update_changes_selected_version(self):
        for version in ["9.3.1", "9.8.2", "10.0"]:
            with self.subTest(version=version):
                self.assertEqual(module.read_version(f"distributionUrl=https\\://services.gradle.org/distributions/gradle-{version}-bin.zip"), version)

    def test_comments_crlf_and_other_properties(self):
        self.assertEqual(module.read_version("# distributionUrl=ignored\r\ndistributionBase=GRADLE_USER_HOME\r\n distributionUrl=https\\://services.gradle.org/distributions/gradle-9.3.1-bin.zip\r\n"), "9.3.1")

    def test_all_distribution_and_unescaped_https(self):
        self.assertEqual(module.read_version("distributionUrl=https://services.gradle.org/distributions/gradle-9.3.1-all.zip"), "9.3.1")

    def test_missing_and_duplicate_properties_fail(self):
        url = "distributionUrl=https://services.gradle.org/distributions/gradle-9.3.1-bin.zip"
        for text in ["", "# " + url, url + "\n" + url,
                     url + "\ndistributionUrl = other", url + "\ndistributionUrl:other"]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                module.read_version(text)

    def test_unsupported_urls_and_aliases_fail_without_fallback(self):
        for value in ["current", "9.3.1", "https://example.com/gradle-9.3.1-bin.zip",
                      "http://services.gradle.org/distributions/gradle-9.3.1-bin.zip",
                      "https://services.gradle.org/distributions/gradle-9.3.1-rc-1-bin.zip",
                      "https://services.gradle.org/distributions/gradle-9.3.1-bin.zip?other=1"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.read_version("distributionUrl=" + value)


if __name__ == "__main__":
    unittest.main()
