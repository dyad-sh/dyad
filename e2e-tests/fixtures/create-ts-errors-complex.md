Tests delete-rename-write order
<joy-delete path="src/main.tsx">
</joy-delete>
<joy-rename from="src/App.tsx" to="src/main.tsx">
</joy-rename>
<joy-write path="src/main.tsx" description="final main.tsx file.">
finalMainTsxFileWithError();
</joy-write>
EOM
