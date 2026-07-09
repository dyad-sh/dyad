# Safe Storage

- On macOS, Electron/Chromium `safeStorage` stores the os_crypt password as a generic Keychain item whose service is `"<product> Safe Storage"` and whose account is `"<product> Key"`. Do not query the account as only the product name; `security find-generic-password -s "dyad Safe Storage" -a "dyad"` misses the real item, which is under `dyad Key`.
