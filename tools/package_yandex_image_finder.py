#!/usr/bin/env python3
"""Build a CS-Cart installable package for yandex_image_finder.

Important: do not use PowerShell Compress-Archive for CS-Cart add-ons.
It stores ZIP entries with backslashes on Windows, while CS-Cart 4.17
looks for app/addons/<addon>/addon.xml using forward slashes.
"""

from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ADDON_ID = "yandex_image_finder"

RUNTIME_FILES = [
    "app/addons/yandex_image_finder/addon.xml",
    "app/addons/yandex_image_finder/config.php",
    "app/addons/yandex_image_finder/func.php",
    "app/addons/yandex_image_finder/init.php",
    "app/addons/yandex_image_finder/controllers/backend/yandex_image_finder.php",
    "app/addons/yandex_image_finder/schemas/permissions/admin.post.php",
    "app/addons/yandex_image_finder/schemas/products/page_configuration.post.php",
    "design/backend/templates/addons/yandex_image_finder/hooks/addons/addon_settings.post.tpl",
    "design/backend/templates/addons/yandex_image_finder/hooks/index/styles.post.tpl",
    "design/backend/templates/addons/yandex_image_finder/hooks/products/tabs_extra.post.tpl",
    "design/backend/templates/addons/yandex_image_finder/hooks/products/update_detailed_images.post.tpl",
    "design/backend/templates/addons/yandex_image_finder/views/yandex_image_finder/product_tab.tpl",
    "design/backend/templates/addons/yandex_image_finder/views/yandex_image_finder/components/results.tpl",
    "design/backend/templates/addons/yandex_image_finder/views/yandex_image_finder/components/test_connection_result.tpl",
    "design/backend/css/addons/yandex_image_finder/styles.less",
]


def build_package(repo_root: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()

    with ZipFile(output_path, "w", ZIP_DEFLATED) as archive:
        for relative_path in RUNTIME_FILES:
            source = repo_root / relative_path
            if not source.is_file():
                raise FileNotFoundError(relative_path)
            archive.write(source, relative_path)

    with ZipFile(output_path) as archive:
        names = archive.namelist()

    if f"app/addons/{ADDON_ID}/addon.xml" not in names:
        raise RuntimeError("Package does not contain the required addon.xml path")
    if any("\\" in name for name in names):
        raise RuntimeError("Package contains Windows backslashes in ZIP entries")
    if any("/tests/" in name or name.endswith(("MANUAL_QA.md", "PR_SUMMARY.md")) for name in names):
        raise RuntimeError("Package contains non-runtime QA or PR files")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    output_path = repo_root / "outputs" / f"{ADDON_ID}.zip"
    build_package(repo_root, output_path)
    print(output_path)


if __name__ == "__main__":
    main()
