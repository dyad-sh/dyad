# Serveur MCP Dyad

Ce répertoire contient un serveur [Model Context Protocol](https://modelcontextprotocol.io) pour Dyad, permettant aux assistants IA d'interagir avec vos applications Dyad.

## 🚀 Démarrage rapide

```bash
cd mcp-server
npm install
npm run build
```

Puis configurez votre client MCP (ex: Claude Desktop) en ajoutant dans `claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "dyad": {
      "command": "node",
      "args": ["CHEMIN_COMPLET/dyad-1/mcp-server/dist/index.js"]
    }
  }
}
```

## 📚 Documentation

- **[QUICKSTART.md](./mcp-server/QUICKSTART.md)** - Guide de démarrage rapide
- **[GUIDE-FR.md](./mcp-server/GUIDE-FR.md)** - Guide complet en français
- **[README.md](./mcp-server/README.md)** - Documentation complète en anglais

## 🛠️ Fonctionnalités

Le serveur MCP expose **13 outils** pour :
- 📱 Gérer les applications (liste, recherche, structure)
- 💬 Explorer les conversations et messages
- 📁 Lire et lister les fichiers
- 🔄 Consulter le statut Git et l'historique

## 🔒 Sécurité

Le serveur est **en lecture seule** :
- ✅ Pas d'écriture de fichiers
- ✅ Pas d'exécution de code
- ✅ Accès limité aux apps Dyad
- ✅ Protection contre le path traversal

## 💡 Exemples d'usage

Avec Claude Desktop configuré, vous pouvez demander :

> "Liste mes applications Dyad"

> "Montre-moi la structure de l'app blog"

> "Lis le fichier src/index.ts de l'app 3"

> "Quel est le statut Git de mon app ?"

## 🏗️ Architecture

```
mcp-server/
├── src/
│   ├── index.ts          # Point d'entrée du serveur
│   ├── database.ts       # Accès à la base de données Dyad
│   ├── schema.ts         # Schéma de la base de données
│   └── tools/            # Implémentation des outils MCP
│       ├── app-tools.ts      # Outils de gestion des apps
│       ├── chat-tools.ts     # Outils de gestion des chats
│       ├── file-tools.ts     # Outils de lecture de fichiers
│       └── version-tools.ts  # Outils Git
├── dist/                 # Code compilé (généré)
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 Développement

```bash
# Mode watch
npm run dev

# Build
npm run build

# Test avec l'inspecteur MCP
npm run inspector
```

## 📦 Dépendances principales

- `@modelcontextprotocol/sdk` - SDK MCP officiel
- `drizzle-orm` - ORM pour SQLite
- `isomorphic-git` - Opérations Git
- `zod` - Validation des schémas

## 🤝 Contribution

Ce serveur MCP fait partie du projet Dyad. Les contributions sont les bienvenues en suivant les [guidelines de contribution](../CONTRIBUTING.md) de Dyad.

## 📄 Licence

MIT - Compatible avec les licences du projet Dyad principal
