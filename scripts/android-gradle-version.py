"""Select CI's Gradle from HomeSync's committed wrapper properties."""
from pathlib import Path
import re


def read_version(properties):
    urls = [line.split("=", 1)[1].strip().replace(r"\:", ":")
            for line in properties.splitlines()
            if line.strip().startswith("distributionUrl=")]
    if len(urls) != 1:
        raise ValueError("Expected exactly one distributionUrl in wrapper properties.")
    match = re.fullmatch(
        r"https://services\.gradle\.org/distributions/gradle-([1-9]\d*\.\d+(?:\.\d+)?)-(?:bin|all)\.zip",
        urls[0],
    )
    if not match:
        raise ValueError("Expected an official stable Gradle distribution URL; review other formats explicitly.")
    return match[1]


if __name__ == "__main__":
    wrapper = Path(__file__).resolve().parents[1] / "apps/homesync-android/gradle/wrapper/gradle-wrapper.properties"
    print(f"version={read_version(wrapper.read_text(encoding='utf-8'))}")
