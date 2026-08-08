Tests delete-rename-write order
<dyad-delete path="src/main.tsx">
</dyad-delete>
<dyad-rename from="src/App.tsx" to="src/main.tsx">
</dyad-rename>
<dyad-write path="src/main.tsx" description="final main.tsx file.">
finalMainTsxFileWithError();
</dyad-write>
EOM
