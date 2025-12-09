# Guide d'Utilisation de Dyad

## 🎯 Vue d'ensemble

Dyad est une application **desktop Electron** qui vous permet de créer des applications web (React/Next.js) grâce à l'IA. Ce guide explique comment utiliser Dyad dans ses deux modes :

1. **Mode Electron (Desktop)** : L'application principale pour créer et gérer vos apps
2. **Mode Web** : Les applications React/Next.js générées par Dyad

---

## 📦 Mode 1 : Dyad Electron (Application Desktop)

### Installation

#### Option A : Télécharger la version précompilée (RECOMMANDÉ)

1. Allez sur https://github.com/dyad-sh/dyad/releases
2. Téléchargez la dernière version pour Windows :
   - `dyad-${version}-win-x64.exe` (installeur)
   - Ou `dyad-${version}-win-x64.zip` (version portable)
3. Installez ou extrayez l'application
4. Lancez `dyad.exe`

**Avantages** :
- ✅ Pas besoin de Visual Studio ou d'outils de compilation
- ✅ Installation en un clic
- ✅ Tous les binaires natifs (better-sqlite3) sont précompilés
- ✅ Prêt à l'emploi immédiatement

#### Option B : Compiler depuis les sources (AVANCÉ)

**⚠️ Prérequis** :
- Node.js v20 ou v22+ (PAS v21)
- Visual Studio Build Tools 2022 (pour better-sqlite3)
- Windows SDK

```powershell
# Cloner le repo
git clone https://github.com/dyad-sh/dyad.git
cd dyad

# Installer les dépendances
npm install

# Créer le dossier userData
mkdir userData

# Appliquer les migrations de base de données
npm run db:generate
npm run db:push

# Lancer en mode développement
npm start

# OU compiler pour production
npm run make
```

### Utilisation de Dyad Desktop

Une fois Dyad lancé :

1. **Configurer votre provider IA** :
   - OpenAI (API Key requise)
   - Anthropic Claude (API Key requise)
   - Azure OpenAI
   - Ollama (local, gratuit)
   - LM Studio (local, gratuit)

2. **Créer une nouvelle app** :
   - Cliquez sur "New App" ou "Create App"
   - Décrivez votre application à l'IA
   - Exemple : "Crée-moi un dashboard avec graphiques et tableau de données"

3. **L'IA génère le code** :
   - React + Vite
   - Shadcn/ui + Radix UI
   - TailwindCSS
   - TypeScript

4. **Prévisualiser en temps réel** :
   - La preview iframe affiche votre app
   - Modifications en direct pendant que l'IA code

5. **Exporter l'application** :
   - Toutes vos apps sont dans : `~/dyad-apps/nom-de-votre-app/`
   - Chaque app est un projet React indépendant

---

## 🌐 Mode 2 : Applications Web générées par Dyad

### Structure d'une app Dyad

Chaque app créée par Dyad est un projet React standard :

```
~/dyad-apps/
└── mon-app/
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── components/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── tsconfig.json
```

### Lancer une app web générée

#### Méthode 1 : Depuis Dyad Desktop

1. Ouvrez votre app dans Dyad
2. Cliquez sur l'icône de preview
3. L'app se compile automatiquement
4. Accessible dans l'iframe de prévisualisation

#### Méthode 2 : Manuellement en ligne de commande

```powershell
# Naviguer vers votre app
cd ~/dyad-apps/mon-app

# Installer les dépendances (première fois seulement)
npm install --legacy-peer-deps

# Lancer le serveur de développement
npm run dev

# Votre app est maintenant sur http://localhost:5173 (ou autre port)
```

#### Méthode 3 : Builder pour production

```powershell
# Builder l'app
npm run build

# Prévisualiser le build
npm run preview

# Déployer sur :
# - Vercel (npm install -g vercel && vercel)
# - Netlify (netlify deploy)
# - GitHub Pages
# - Votre propre serveur (copier le dossier dist/)
```

### Exemple : Template scaffold

Le dossier `scaffold/` est le template utilisé par Dyad. Vous pouvez le tester :

```powershell
cd c:\Users\amine\dyad-1\scaffold

# Installer les dépendances
npm install --legacy-peer-deps

# Lancer le serveur dev
npm run dev

# Ouvrir http://localhost:8080
```

---

## 🔧 Serveur MCP pour Dyad

Le serveur MCP (`mcp-server/`) expose les fonctionnalités de Dyad via le Model Context Protocol.

### Installation du serveur MCP

```powershell
cd c:\Users\amine\dyad-1\mcp-server

# Installer les dépendances
npm install

# Compiler TypeScript
npm run build

# Tester le serveur
node dist/index.js
```

### Configuration avec Claude Desktop

Ajoutez dans `claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "dyad": {
      "command": "node",
      "args": [
        "c:\\Users\\amine\\dyad-1\\mcp-server\\dist\\index.js"
      ]
    }
  }
}
```

### Outils MCP disponibles

Le serveur expose 13 outils :

**Apps** :
- `list_apps` : Lister toutes les apps
- `get_app` : Détails d'une app
- `search_apps` : Rechercher des apps
- `get_app_structure` : Structure de fichiers

**Chats** :
- `list_chats` : Lister les conversations
- `get_chat` : Détails d'un chat
- `search_chats` : Rechercher dans les chats
- `create_chat` : Créer une nouvelle conversation

**Fichiers** :
- `read_app_file` : Lire un fichier d'app
- `list_app_files` : Lister les fichiers

**Version Control** :
- `get_git_status` : Status Git
- `get_git_log` : Historique Git

### Utilisation avec Claude

Une fois configuré, vous pouvez demander à Claude :

```
"Liste toutes mes apps Dyad"
"Montre-moi le code de src/App.tsx dans mon-app"
"Quel est l'historique Git de cette app ?"
```

---

## 🚀 Workflow complet

### Scénario : Créer et déployer une app dashboard

1. **Créer l'app dans Dyad Desktop** :
   ```
   Prompt : "Crée un dashboard avec :
   - Un graphique de statistiques (Chart.js)
   - Un tableau de données
   - Des cartes de métriques
   - Mode sombre/clair"
   ```

2. **Tester localement** :
   ```powershell
   cd ~/dyad-apps/mon-dashboard
   npm install --legacy-peer-deps
   npm run dev
   # Ouvrir http://localhost:5173
   ```

3. **Utiliser le MCP pour explorer** :
   ```
   Claude : "Liste les fichiers de mon-dashboard"
   Claude : "Montre-moi le composant Chart"
   ```

4. **Builder et déployer** :
   ```powershell
   npm run build
   vercel deploy
   # Ou : netlify deploy
   ```

---

## 🔍 Dépannage

### Problème : npm install échoue

**Solution** : Utilisez `--legacy-peer-deps`
```powershell
npm install --legacy-peer-deps
```

### Problème : better-sqlite3 ne compile pas

**Solution** : Téléchargez la version précompilée de Dyad depuis GitHub Releases

### Problème : Node.js v21 warnings

**Solution** : Passez à Node.js v20 LTS ou v22+
```powershell
nvm install 20
nvm use 20
```

### Problème : Port déjà utilisé

**Solution** : Changez le port dans `vite.config.ts`
```ts
export default {
  server: {
    port: 3000 // Au lieu de 5173
  }
}
```

---

## 📚 Ressources

- **Repo GitHub** : https://github.com/dyad-sh/dyad
- **Reddit** : https://www.reddit.com/r/dyadbuilders
- **Documentation MCP** : `mcp-server/README.md`
- **Guide français MCP** : `mcp-server/GUIDE-FR.md`

---

## 🎓 Résumé

| Aspect | Dyad Electron | Apps Web générées |
|--------|---------------|-------------------|
| **Type** | Application desktop | Applications web React |
| **Plateforme** | Windows/macOS/Linux | Navigateur web |
| **But** | Créer et gérer des apps | Apps finales utilisables |
| **Technologie** | Electron + SQLite | React + Vite + Shadcn |
| **Installation** | Télécharger .exe | npm install |
| **Lancement** | dyad.exe | npm run dev |
| **Déploiement** | N/A (app desktop) | Vercel/Netlify/GitHub Pages |

**En résumé** :
- **Dyad Electron** = Votre atelier de création (l'IDE IA)
- **Apps web générées** = Vos créations finales (les produits)
- **Serveur MCP** = Pont entre Claude et vos apps Dyad
