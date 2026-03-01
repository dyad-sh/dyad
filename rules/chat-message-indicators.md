# Custom Chat Message Indicators

The `<coney-status>` tag in chat messages renders as a collapsible status indicator box. Use it for system messages like compaction notifications:

```
<coney-status title="My Title" state="finished">
Content here
</coney-status>
```

Valid states: `"finished"`, `"in-progress"`, `"aborted"`
