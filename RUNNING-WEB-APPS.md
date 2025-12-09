# 🌐 Exécuter des applications web créées par Dyad

Ce guide explique comment les applications générées par Dyad peuvent être exécutées comme des applications web dans votre navigateur.

## 📋 Vue d'ensemble

Dyad génère de **vraies applications web modernes** qui utilisent :
- ⚛️ **React** + TypeScript
- ⚡ **Vite** (build tool rapide)
- 🎨 **Tailwind CSS** + **shadcn/ui**
- 🚀 Prêtes pour le déploiement (Vercel, Netlify, etc.)

## 🏗️ Structure des applications Dyad

Quand Dyad crée une application, elle génère :

```
mon-app/
├── src/
│   ├── App.tsx          # Composant principal
│   ├── main.tsx         # Point d'entrée
│   └── components/      # Composants React
├── public/              # Assets statiques
├── package.json         # Dépendances
├── vite.config.ts       # Configuration Vite
└── index.html           # HTML principal
```

## 🚀 Méthode 1 : Exécuter le template de base

Le dossier `scaffold/` contient le template React + Vite utilisé par Dyad :

### Installation
```bash
cd c:\Users\amine\dyad-1\scaffold
pnpm install
# ou
npm install
```

### Lancer en mode développement
```bash
pnpm dev
# ou
npm run dev
```

L'application sera accessible sur **http://localhost:5173** 🎉

### Build de production
```bash
pnpm build
# ou
npm run build
```

Les fichiers compilés seront dans `dist/` et prêts pour le déploiement.

## 🎯 Méthode 2 : Créer une nouvelle app avec Dyad

### Étapes :

1. **Lancer Dyad** (application desktop)
2. **Créer une nouvelle app**
3. **Dyad génère l'application React**
4. **Trouver le chemin de l'app** (généralement dans `%APPDATA%/dyad/apps/`)
5. **Ouvrir un terminal dans ce dossier**
6. **Lancer l'app** :
   ```bash
   npm install
   npm run dev
   ```

## 🌍 Méthode 3 : Déployer sur le web

Les applications Dyad peuvent être déployées gratuitement sur :

### Vercel (recommandé)
```bash
npm install -g vercel
vercel
```

### Netlify
```bash
npm install -g netlify-cli
netlify deploy
```

### GitHub Pages
```bash
npm run build
# Puis push le dossier dist/ vers gh-pages
```

## 📦 Application de démonstration

Créons une application de démonstration simple basée sur le template Dyad :

### Structure minimale
```typescript
// src/App.tsx
import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-2xl">
        <h1 className="text-3xl font-bold mb-4">
          Application Dyad 🚀
        </h1>
        <p className="mb-4">
          Ceci est une application web React générée par Dyad
        </p>
        <button
          onClick={() => setCount(count + 1)}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Clics : {count}
        </button>
      </div>
    </div>
  )
}

export default App
```

## 🎨 Fonctionnalités disponibles

Les apps Dyad incluent par défaut :

- ✅ **React 19** avec TypeScript
- ✅ **Tailwind CSS** pour le styling
- ✅ **shadcn/ui** - Composants UI modernes
- ✅ **React Hook Form** - Gestion de formulaires
- ✅ **Zod** - Validation de schémas
- ✅ **Date-fns** - Manipulation de dates
- ✅ **Lucide React** - Icônes
- ✅ **Recharts** - Graphiques
- ✅ **Hot Module Replacement** - Rechargement instantané

## 🔧 Configuration Vite

Le fichier `vite.config.ts` est préconfiguré pour :
- Build optimisé
- Support TypeScript
- React Fast Refresh
- Chemins absolus (@/)

## 📱 Test sur mobile

Pour tester sur votre réseau local :

```bash
npm run dev -- --host
```

Puis accédez depuis votre mobile : `http://[VOTRE-IP]:5173`

## 🚀 Commandes utiles

```bash
# Développement
npm run dev              # Lance le serveur de dev (port 5173)

# Production
npm run build            # Build pour production
npm run preview          # Prévisualise le build

# Qualité du code
npm run lint             # Vérifie le code

# Types TypeScript
npx tsc --noEmit        # Vérifie les types
```

## 🌟 Exemple complet de workflow

### 1. Préparer le template
```bash
cd c:\Users\amine\dyad-1\scaffold
npm install
```

### 2. Lancer en développement
```bash
npm run dev
```

### 3. Accéder dans le navigateur
Ouvrir : **http://localhost:5173**

### 4. Modifier le code
Éditer `src/App.tsx` - les changements sont instantanés !

### 5. Build pour production
```bash
npm run build
```

### 6. Tester le build
```bash
npm run preview
```

## 🎓 Apprendre plus

- **React** : https://react.dev
- **Vite** : https://vitejs.dev
- **Tailwind CSS** : https://tailwindcss.com
- **shadcn/ui** : https://ui.shadcn.com

## 💡 Conseils

1. **Hot Reload** : Sauvegardez vos fichiers pour voir les changements instantanément
2. **DevTools** : Utilisez React DevTools dans Chrome/Firefox
3. **TypeScript** : Les erreurs TypeScript s'affichent dans le terminal
4. **Port occupé** : Si le port 5173 est utilisé, Vite choisira automatiquement le suivant

## 🆘 Résolution de problèmes

### Port déjà utilisé
```bash
# Spécifier un autre port
npm run dev -- --port 3000
```

### Problème de cache
```bash
rm -rf node_modules/.vite
npm run dev
```

### Erreurs TypeScript
```bash
npx tsc --noEmit
```

---

**Les applications Dyad sont de vraies applications web professionnelles prêtes pour la production !** 🎉
