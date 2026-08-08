# Custom Chat Message Indicators

The `<dyad-status>` tag in chat messages renders as a collapsible status indicator box. Use it for system messages like compaction notifications:

```
<dyad-status title="My Title" state="finished">
Content here
</dyad-status>
```

Valid states: `"finished"`, `"in-progress"`, `"aborted"`

- Renderer unit tests that import `DyadMarkdownParser` should mock `../preview_panel/FileEditor`; otherwise the `DyadWrite` import initializes Monaco and Happy DOM may try to fetch `cdn.jsdelivr.net`, causing offline `ENOTFOUND` failures.
