# Configuration du Serveur MCP dans Dyad

## 🎯 Vue d'ensemble

Le serveur MCP peut être configuré directement dans les paramètres de Dyad pour une intégration transparente avec l'application principale.

## 📋 Méthodes de Configuration

### Méthode 1 : Configuration via l'Interface Dyad (Recommandé)

#### Étapes :

1. **Ouvrir Dyad**
2. **Aller dans Settings** (⚙️)
3. **Section "MCP Servers"**
4. **Cliquer sur "Add MCP Server"**

#### Configuration :

```
Nom: Dyad MCP Server
Transport: stdio
Command: node
Args: <chemin-dyad>\mcp-server\dist\index.js
Working Directory: <chemin-dyad>\mcp-server
Environment Variables: (optionnel)
  - DYAD_IPC_ENABLED=true
Enabled: ✓
```

**Exemple Windows** :
```
Command: node
Args: C:\dyad-1\mcp-server\dist\index.js
Working Directory: C:\dyad-1\mcp-server
```

**Exemple macOS/Linux** :
```
Command: node
Args: /path/to/dyad-1/mcp-server/dist/index.js
Working Directory: /path/to/dyad-1/mcp-server
```

### Méthode 2 : Configuration Manuelle dans Claude Desktop

Si vous utilisez Claude Desktop directement (sans Dyad), ajoutez dans votre configuration :

**Fichier** : `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "dyad": {
      "command": "node",
      "args": [
        "C:\\dyad-1\\mcp-server\\dist\\index.js"
      ],
      "cwd": "C:\\dyad-1\\mcp-server",
      "env": {
        "DYAD_DB_PATH": "C:\\Users\\<username>\\AppData\\Roaming\\dyad\\sqlite.db"
      }
    }
  }
}
```

**Fichier** : `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

```json
{
  "mcpServers": {
    "dyad": {
      "command": "node",
      "args": [
        "/path/to/dyad-1/mcp-server/dist/index.js"
      ],
      "cwd": "/path/to/dyad-1/mcp-server",
      "env": {
        "DYAD_DB_PATH": "~/Library/Application Support/dyad/sqlite.db"
      }
    }
  }
}
```

### Méthode 3 : Configuration via Variables d'Environnement

Vous pouvez personnaliser le comportement du serveur MCP avec ces variables :

```bash
# Chemin personnalisé vers la base de données
DYAD_DB_PATH=/custom/path/to/sqlite.db

# Activer le mode IPC (quand lancé par Dyad)
DYAD_IPC_ENABLED=true

# Mode debug
DEBUG=dyad:*
```

## 🔧 Architecture d'Intégration

### Mode Standalone (Accès Direct DB)

```
┌─────────────────────────────────────┐
│     MCP Client (Claude Desktop)     │
└──────────────┬──────────────────────┘
               │ stdio
┌──────────────▼──────────────────────┐
│       Dyad MCP Server               │
│    (lecture seule SQLite)           │
└──────────────┬──────────────────────┘
               │ direct read
┌──────────────▼──────────────────────┐
│      SQLite Database                │
│      (sqlite.db)                    │
└─────────────────────────────────────┘
```

**Avantages** :
- ✅ Simple à configurer
- ✅ Pas besoin que Dyad soit lancé

**Inconvénients** :
- ⚠️ Lecture seule uniquement
- ⚠️ Possible conflit si Dyad modifie la DB

### Mode IPC (Future Implementation)

```
┌─────────────────────────────────────┐
│     MCP Client (Claude Desktop)     │
└──────────────┬──────────────────────┘
               │ stdio
┌──────────────▼──────────────────────┐
│       Dyad MCP Server               │
│      (lancé par Dyad)               │
└──────────────┬──────────────────────┘
               │ IPC
┌──────────────▼──────────────────────┐
│      Dyad Main Application          │
│      (Electron)                     │
└──────────────┬──────────────────────┘
               │ DB access
┌──────────────▼──────────────────────┐
│      SQLite Database                │
│      (sqlite.db)                    │
└─────────────────────────────────────┘
```

**Avantages** :
- ✅ Une seule source de vérité
- ✅ Pas de conflit de DB
- ✅ Accès sécurisé via Dyad
- ✅ Possibilité d'opérations d'écriture

**Inconvénients** :
- ⚠️ Nécessite que Dyad soit lancé
- ⚠️ Plus complexe à configurer

## 🚀 Utilisation dans Dyad

### Ajouter un Serveur MCP

1. Ouvrir Dyad
2. Settings → MCP Servers
3. Add Server :
   - **Nom** : Dyad Local Server
   - **Transport** : stdio
   - **Command** : `node`
   - **Args** : Chemin vers `mcp-server/dist/index.js`
   - **Enabled** : ✓

### Tester le Serveur

Une fois configuré, vous pouvez tester les outils MCP :

```bash
# Dans Dyad, ouvrir un chat et taper :
"Liste tous mes apps Dyad"
"Montre-moi la structure de l'app 5"
"Quel est le contenu de src/index.ts dans l'app 3?"
```

### Désactiver le Serveur

Si nécessaire, vous pouvez désactiver le serveur MCP :
1. Settings → MCP Servers
2. Trouver "Dyad Local Server"
3. Décocher "Enabled"

## 🔒 Sécurité et Permissions

### Permissions par Défaut

Le serveur MCP a accès en **lecture seule** à :
- ✅ Liste des applications
- ✅ Conversations et messages
- ✅ Fichiers dans les applications
- ✅ Historique Git

### Opérations Interdites

Le serveur MCP **ne peut pas** :
- ❌ Créer ou supprimer des apps
- ❌ Modifier des fichiers
- ❌ Envoyer des messages
- ❌ Modifier la base de données

### Consent Management

Dyad peut demander votre permission avant que le serveur MCP :
- Lise des fichiers sensibles (`.env`, `secrets`, etc.)
- Accède à l'historique Git
- Liste des informations d'apps

Configuration dans Settings → MCP → Tool Consents :
- **Always Allow** : Autorisation permanente
- **Ask Every Time** : Demander à chaque fois
- **Deny** : Bloquer l'outil

## 📊 Monitoring et Logs

### Voir les Logs du Serveur MCP

Les logs sont disponibles dans :
- **Windows** : `%APPDATA%\dyad\logs\mcp-server.log`
- **macOS** : `~/Library/Logs/dyad/mcp-server.log`
- **Linux** : `~/.local/share/dyad/logs/mcp-server.log`

### Activer le Mode Debug

```json
{
  "mcpServers": {
    "dyad": {
      "command": "node",
      "args": ["..."],
      "env": {
        "DEBUG": "dyad:*",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

## 🐛 Troubleshooting

### Problème : "Database not found"

**Cause** : Le serveur ne trouve pas la base de données Dyad.

**Solution** :
1. Vérifier que Dyad a été lancé au moins une fois
2. Vérifier le chemin : `%APPDATA%\dyad\sqlite.db`
3. Définir `DYAD_DB_PATH` si personnalisé

### Problème : "IPC not connected"

**Cause** : Le serveur tente d'utiliser l'IPC mais n'est pas lancé par Dyad.

**Solution** :
1. Lancer le serveur via Dyad Settings → MCP Servers
2. OU désactiver l'IPC en retirant `DYAD_IPC_ENABLED=true`

### Problème : "Permission denied"

**Cause** : Le serveur n'a pas accès au fichier ou répertoire.

**Solution** :
1. Vérifier les permissions du répertoire Dyad
2. Vérifier que l'utilisateur a accès au fichier `sqlite.db`
3. Vérifier les Tool Consents dans Dyad Settings

### Problème : "Server not responding"

**Cause** : Le serveur MCP a crashé ou est bloqué.

**Solution** :
1. Redémarrer Dyad ou Claude Desktop
2. Vérifier les logs : `%APPDATA%\dyad\logs\mcp-server.log`
3. Rebuilder le serveur : `npm run build`

## 📚 Ressources

- [Documentation MCP](https://modelcontextprotocol.io)
- [Dyad MCP Server README](./README.md)
- [Guide de Démarrage Rapide](./QUICKSTART.md)
- [Documentation Dyad IPC](../src/ipc/README.md)

## 🤝 Contribution

Pour contribuer à l'amélioration de l'intégration MCP :

1. Fork le repo Dyad
2. Créer une branche : `git checkout -b feature/mcp-improvement`
3. Commit : `git commit -m 'Improve MCP integration'`
4. Push : `git push origin feature/mcp-improvement`
5. Ouvrir une Pull Request

---

**Note** : L'intégration IPC complète est en cours de développement. Pour l'instant, le serveur MCP fonctionne en mode standalone avec accès direct à la base de données SQLite.
