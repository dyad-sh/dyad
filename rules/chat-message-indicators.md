# Custom Chat Message Indicators

The `<dyad-status>` tag in chat messages renders as a collapsible status indicator box. Use it for system messages like compaction notifications:

```
<dyad-status title="My Title" state="finished">
Content here
</dyad-status>
```

Valid states: `"finished"`, `"in-progress"`, `"warning"`, `"error"`, `"aborted"`

- Renderer unit tests that import chat components can initialize Monaco through the file editor tree, leading to Happy DOM errors like `moduleId: 'vs/editor/editor.main'` or offline `cdn.jsdelivr.net` failures. For pure helper logic, extract the helper into a small `.ts` module and test that directly; when testing `DyadMarkdownParser`, mock `../preview_panel/FileEditor`.
- When asserting `<dyad-status>` body XML, remember `escapeXmlContent` escapes element text such as `<`/`>` but leaves quote characters unchanged. Expect `&lt;tag attr="value"&gt;`, not `&lt;tag attr=&quot;value&quot;&gt;`, unless the value was escaped as an XML attribute.
