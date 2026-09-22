# Local preview addresses

Each app uses an `app-<id>.localhost` address so its new browser cookies and
storage are separate from other apps. Open in browser uses this same address.
If your browser cannot load it, use Chrome or Firefox. Older Safari/macOS
versions may not resolve these addresses; WebKit reports that support was
added in macOS 26 ([WebKit issue 160504](https://bugs.webkit.org/show_bug.cgi?id=160504)).

Recording clears the selected app's storage and cookies. Shared `localhost`
domain cookies from older Dyad versions are preserved because deleting them
could sign other apps out. They can still apply to a preview, so sign out in
that app before recording if a legacy session remains.

For linked Supabase projects, Dyad adds the actual preview origin and its
`/**` callback pattern to Authentication → URL Configuration → Redirect URLs.
It preserves Site URL and every existing entry. These callbacks remain after
disconnecting or deleting an app. A fallback proxy port may add another pair.
Project administrators can remove addresses they no longer use in Supabase.

Dyad does not infer ownership from an `app-<id>.localhost` hostname: IDs are
local to each installation, and another teammate may use the same hostname
on a different port against the same project. Automatically removing those
entries could break another active preview or an explicitly configured callback.
