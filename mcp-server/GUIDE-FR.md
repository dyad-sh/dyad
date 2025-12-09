# Guide d'utilisation du serveur MCP Dyad

## 🎯 Vue d'ensemble

Le serveur MCP Dyad permet aux assistants IA (comme Claude Desktop, Cline, ou d'autres clients MCP) d'interagir avec vos applications Dyad via le protocole Model Context Protocol.

## 📋 Prérequis

- Node.js >= 20
- Dyad installé et configuré
- Un client MCP (Claude Desktop, etc.)

## 🚀 Installation rapide

### 1. Build du serveur

```bash
cd c:\Users\amine\dyad-1\mcp-server
npm install
npm run build
```

### 2. Configuration Claude Desktop

Fichier de configuration : `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dyad": {
      "command": "node",
      "args": [
        "C:\\Users\\amine\\dyad-1\\mcp-server\\dist\\index.js"
      ]
    }
  }
}
```

### 3. Redémarrer Claude Desktop

Fermez complètement Claude Desktop et relancez-le pour charger le serveur MCP.

## 🛠️ Outils disponibles

### 📱 Gestion des applications

#### `dyad_list_apps`
Liste toutes les applications Dyad.

**Exemple** : "Montre-moi toutes mes apps Dyad"

#### `dyad_get_app`
Obtient les détails d'une application spécifique.

**Paramètres** :
- `appId` (number) : ID de l'application

**Exemple** : "Donne-moi les détails de l'app 5"

#### `dyad_search_apps`
Recherche des applications par nom.

**Paramètres** :
- `query` (string) : Terme de recherche

**Exemple** : "Trouve les apps qui contiennent 'blog'"

#### `dyad_get_app_structure`
Obtient la structure de fichiers d'une application.

**Paramètres** :
- `appId` (number) : ID de l'application
- `maxDepth` (number, optionnel) : Profondeur maximale (défaut: 5)

**Exemple** : "Quelle est la structure de l'app 3 ?"

### 💬 Gestion des conversations

#### `dyad_list_chats`
Liste toutes les conversations, optionnellement filtrées par app.

**Paramètres** :
- `appId` (number, optionnel) : Filtrer par ID d'app

**Exemple** : "Montre-moi les conversations de l'app 2"

#### `dyad_get_chat`
Obtient les détails d'une conversation avec ses messages.

**Paramètres** :
- `chatId` (number) : ID de la conversation
- `includeMessages` (boolean, optionnel) : Inclure les messages (défaut: true)

**Exemple** : "Affiche la conversation 10 avec tous ses messages"

#### `dyad_search_chats`
Recherche des conversations par titre.

**Paramètres** :
- `query` (string) : Terme de recherche
- `appId` (number, optionnel) : Filtrer par app

**Exemple** : "Trouve les chats qui parlent de 'auth'"

#### `dyad_get_chat_messages`
Obtient tous les messages d'une conversation.

**Paramètres** :
- `chatId` (number) : ID de la conversation
- `limit` (number, optionnel) : Nombre maximal de messages

**Exemple** : "Donne-moi les 5 derniers messages du chat 8"

### 📁 Opérations sur les fichiers

#### `dyad_read_file`
Lit le contenu d'un fichier dans une application.

**Paramètres** :
- `appId` (number) : ID de l'application
- `filePath` (string) : Chemin relatif du fichier

**Exemple** : "Montre-moi le contenu de src/index.ts dans l'app 3"

#### `dyad_list_files`
Liste les fichiers d'une application ou d'un répertoire.

**Paramètres** :
- `appId` (number) : ID de l'application
- `directory` (string, optionnel) : Répertoire (défaut: racine)
- `recursive` (boolean, optionnel) : Récursif (défaut: true)
- `extensions` (string[], optionnel) : Filtrer par extensions (ex: ['.ts', '.tsx'])

**Exemple** : "Liste tous les fichiers TypeScript de l'app 1"

### 🔄 Contrôle de version (Git)

#### `dyad_get_git_status`
Obtient le statut Git d'une application.

**Paramètres** :
- `appId` (number) : ID de l'application

**Retourne** : Branche courante, commit, fichiers modifiés/ajoutés/supprimés

**Exemple** : "Quel est le statut Git de l'app 4 ?"

#### `dyad_get_git_log`
Obtient l'historique des commits.

**Paramètres** :
- `appId` (number) : ID de l'application
- `limit` (number, optionnel) : Nombre de commits (défaut: 20)

**Exemple** : "Montre-moi les 10 derniers commits de l'app 2"

## 💡 Exemples d'utilisation

### Exploration d'une application

```
Utilisateur: Quelles sont mes applications Dyad ?
Claude: [Appelle dyad_list_apps] Voici vos 3 applications...

Utilisateur: Montre-moi la structure de la première app
Claude: [Appelle dyad_get_app_structure avec appId=1] Voici l'arborescence...

Utilisateur: Lis le fichier package.json de cette app
Claude: [Appelle dyad_read_file avec appId=1, filePath="package.json"]
```

### Analyse de conversations

```
Utilisateur: Quels sont les derniers chats de mon app blog ?
Claude: [Appelle dyad_list_chats avec recherche d'app "blog"]

Utilisateur: Montre-moi les messages du chat 15
Claude: [Appelle dyad_get_chat_messages avec chatId=15]
```

### Inspection du code

```
Utilisateur: Liste tous les fichiers React de l'app 3
Claude: [Appelle dyad_list_files avec appId=3, extensions=['.jsx', '.tsx']]

Utilisateur: Montre-moi le contenu de App.tsx
Claude: [Appelle dyad_read_file avec appId=3, filePath="src/App.tsx"]
```

### Contrôle de version

```
Utilisateur: Y a-t-il des changements non commités dans l'app 2 ?
Claude: [Appelle dyad_get_git_status avec appId=2]

Utilisateur: Montre-moi l'historique des commits
Claude: [Appelle dyad_get_git_log avec appId=2]
```

## 🔧 Développement

### Mode watch
```bash
npm run dev
```

### Test avec l'inspecteur MCP
```bash
npm run inspector
```

### Build
```bash
npm run build
```

## 🔒 Sécurité

Le serveur MCP Dyad est conçu avec la sécurité en tête :

- ✅ **Accès en lecture seule** : Aucune opération d'écriture n'est autorisée
- ✅ **Protection contre le path traversal** : Les accès sont limités aux répertoires des apps
- ✅ **Pas d'exécution de code** : Le serveur ne peut pas exécuter de commandes
- ✅ **Isolation des données** : Accès uniquement aux données Dyad

## ⚠️ Limitations actuelles

1. **Lecture seule** : Le serveur ne peut pas créer ou modifier des apps
2. **Pas d'exécution** : Impossible de lancer ou arrêter des apps
3. **Pas de streaming** : Les réponses de chat ne peuvent pas être streamées en temps réel
4. **Base de données** : Nécessite que Dyad ait été lancé au moins une fois

## 🐛 Dépannage

### Le serveur ne démarre pas
- Vérifiez que Node.js >= 20 est installé
- Vérifiez que le build a réussi (`npm run build`)
- Vérifiez le chemin dans la configuration MCP

### Base de données introuvable
- Lancez Dyad au moins une fois pour créer la base de données
- Vérifiez l'emplacement : `%APPDATA%\dyad\dyad.db` (Windows)

### Les outils ne sont pas visibles dans Claude
- Redémarrez complètement Claude Desktop
- Vérifiez la configuration dans `claude_desktop_config.json`
- Consultez les logs de Claude Desktop

## 📚 Ressources

- [Documentation Dyad](https://dyad.sh/docs)
- [Spécification MCP](https://modelcontextprotocol.io)
- [Guide MCP pour Claude Desktop](https://modelcontextprotocol.io/docs/clients/claude-desktop)

## 🤝 Contribution

Les contributions sont les bienvenues ! Suivez les guidelines de contribution de Dyad.

## 📄 Licence

MIT - Compatible avec la licence Apache 2.0 de Dyad
