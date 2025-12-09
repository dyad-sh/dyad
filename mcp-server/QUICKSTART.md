# QUICKSTART - Serveur MCP Dyad

## Installation en 3 étapes

### 1️⃣ Build
```bash
cd c:\Users\amine\dyad-1\mcp-server
npm install
npm run build
```

### 2️⃣ Configuration Claude Desktop

Éditez : `%APPDATA%\Claude\claude_desktop_config.json`

Ajoutez :
```json
{
  "mcpServers": {
    "dyad": {
      "command": "node",
      "args": ["C:\\Users\\amine\\dyad-1\\mcp-server\\dist\\index.js"]
    }
  }
}
```

### 3️⃣ Redémarrer Claude Desktop

Fermez complètement Claude et relancez.

## Test rapide

Dans Claude, demandez :

> "Liste mes applications Dyad"

> "Montre-moi la structure de l'app 1"

> "Lis le fichier package.json de l'app 1"

## Outils disponibles (13 au total)

### Apps (4)
- `dyad_list_apps` - Liste toutes les apps
- `dyad_get_app` - Détails d'une app
- `dyad_search_apps` - Recherche par nom
- `dyad_get_app_structure` - Structure de fichiers

### Chats (4)
- `dyad_list_chats` - Liste les conversations
- `dyad_get_chat` - Détails d'un chat
- `dyad_search_chats` - Recherche de chats
- `dyad_get_chat_messages` - Messages d'un chat

### Fichiers (2)
- `dyad_read_file` - Lit un fichier
- `dyad_list_files` - Liste les fichiers (avec filtres)

### Git (2)
- `dyad_get_git_status` - Statut Git
- `dyad_get_git_log` - Historique des commits

## Sécurité

✅ Lecture seule uniquement  
✅ Pas d'écriture de fichiers  
✅ Pas d'exécution de code  
✅ Protection path traversal

## Documentation complète

- Guide français détaillé : `GUIDE-FR.md`
- Documentation complète : `README.md`

## Support

- Issues Dyad : https://github.com/dyad-sh/dyad/issues
- Documentation MCP : https://modelcontextprotocol.io
