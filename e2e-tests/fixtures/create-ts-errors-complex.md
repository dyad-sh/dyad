Tests delete-rename-write order
<coney-delete path="src/main.tsx">
</coney-delete>
<coney-rename from="src/App.tsx" to="src/main.tsx">
</coney-rename>
<coney-write path="src/main.tsx" description="final main.tsx file.">
finalMainTsxFileWithError();
</coney-write>
EOM
