"""Select CI's Gradle from HomeSync's committed wrapper properties."""
from pathlib import Path
import re


def read_version(properties):
    declarations = [line.strip() for line in properties.splitlines()
                    if re.match(r"\s*distributionUrl(?:\s|[=:]|$)", line)]
    if len(declarations) != 1:
        raise ValueError("Expected exactly one distributionUrl in wrapper properties.")
    if not declarations[0].startswith("distributionUrl="):
        raise ValueError("Use the canonical distributionUrl= declaration.")
    url = declarations[0].split("=", 1)[1].strip().replace(r"\:", ":")
    match = re.fullmatch(
        r"https://services\.gradle\.org/distributions/gradle-([1-9]\d*\.\d+(?:\.\d+)?)-(?:bin|all)\.zip",
        url,
    )
    if not match:
        raise ValueError("Expected an official stable Gradle distribution URL; review other formats explicitly.")
    return match[1]


if __name__ == "__main__":
    wrapper = Path(__file__).resolve().parents[1] / "apps/homesync-android/gradle/wrapper/gradle-wrapper.properties"
    print(f"version={read_version(wrapper.read_text(encoding='utf-8'))}")
