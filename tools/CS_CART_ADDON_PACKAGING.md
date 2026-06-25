# CS-Cart add-on packaging note

For CS-Cart 4.17.2.SP3 add-on uploads, the archive must contain this path with forward slashes:

```text
app/addons/yandex_image_finder/addon.xml
```

Do not build the install ZIP with PowerShell `Compress-Archive` on Windows. It stores entries like `app\addons\...`, and CS-Cart's `fn_extract_addon_package()` searches with `/`, so the admin upload reports:

```text
Invalid add-on structure. The uploaded package cannot be installed.
```

Build this add-on with:

```powershell
python tools/package_yandex_image_finder.py
```

The script uses Python `zipfile`, writes forward-slash ZIP entries, excludes tests/docs, and checks that `app/addons/yandex_image_finder/addon.xml` is present.
