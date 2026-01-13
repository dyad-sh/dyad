# 🚀 Dyad Pro - Mode Développement

Ce guide explique comment activer **toutes les fonctionnalités Dyad Pro** en mode développement local, sans nécessiter de clé API Pro payante.

## ⚡ Activation rapide

### Option 1 : Script PowerShell (Recommandé)

```powershell
# Activer Dyad Pro en mode dev
.\enable-pro-dev.ps1

# Désactiver quand terminé
.\disable-pro-dev.ps1
```

### Option 2 : Lancement avec variable d'environnement

```powershell
# Démarrer Dyad avec Pro activé
npm run start:pro-dev

# OU manuellement
$env:DYAD_DEV_PRO_BYPASS = "true"
npm start
```

### Option 3 : Docker Compose

```powershell
# Le fichier docker-compose.dev.yml active automatiquement Pro
docker-compose -f docker-compose.dev.yml up
```

## 🎯 Fonctionnalités débloquées

Une fois activé, vous aurez accès à :

| Fonctionnalité | Description | Status |
|----------------|-------------|--------|
| **Turbo Edits v2** | Édition rapide avec search & replace | ✅ Actif |
| **Smart Context Deep** | Sélection intelligente approfondie des fichiers | ✅ Actif |
| **Smart Context Balanced** | Sélection équilibrée des fichiers | ✅ Actif |
| **Web Search** | Recherche web intégrée dans les prompts | ✅ Actif |
| **Visual Editing** | Édition visuelle des composants UI | ✅ Actif |
| **Agent Local complet** | Tous les outils de l'agent disponibles | ✅ Actif |

## 🔧 Comment ça fonctionne

### Vérification originale

```typescript
// Avant : Nécessite une clé API Pro valide
export function isDyadProEnabled(settings: UserSettings): boolean {
  return settings.enableDyadPro === true && hasDyadProKey(settings);
}
```

### Vérification modifiée (Dev Mode)

```typescript
// Après : Bypass en mode développement
export function isDyadProEnabled(settings: UserSettings): boolean {
  // Force enable in dev mode
  if (process.env.DYAD_DEV_PRO_BYPASS === 'true' || settings.isTestMode) {
    return settings.enableDyadPro === true;
  }
  
  // Mode production normal
  return settings.enableDyadPro === true && hasDyadProKey(settings);
}
```

## 📋 Configuration manuelle

Si vous préférez configurer manuellement :

### 1. Modifier `.env`

```env
# Activer le bypass Dyad Pro
DYAD_DEV_PRO_BYPASS=true
```

### 2. Modifier les settings JSON

Localisation : `%APPDATA%\dyad\settings.json`

```json
{
  "enableDyadPro": true,
  "isTestMode": true,
  "providerSettings": {
    "auto": {
      "apiKey": {
        "value": "dev-bypass-key"
      }
    }
  }
}
```

### 3. Redémarrer Dyad

Les changements seront appliqués au redémarrage.

## ✅ Vérification

### Dans l'interface Dyad

1. **Badge "Pro"** apparaît en haut à droite (vert au lieu de gris)
2. **Icône ⚡** (Sparkles) dans le chat input
3. **Pro modes disponibles** dans le sélecteur :
   - Turbo Edits: Off / Classic / Search & replace
   - Smart Context: Off / Balanced / Deep
   - Web Access: Toggle disponible

### Dans les logs

```
[INFO] Running in DEV mode - Pro features enabled without key
Using Dyad Pro API key for model: ...
```

### Test des fonctionnalités

```bash
# Test Turbo Edits v2
1. Ouvrir un chat
2. Cliquer sur l'icône ⚡
3. Activer "Search & replace" sous Turbo Edits
4. Envoyer un prompt de modification de code
5. Vérifier que l'édition utilise search & replace

# Test Smart Context Deep
1. Ouvrir Pro modes (⚡)
2. Activer "Deep" sous Smart Context
3. Envoyer un prompt complexe
4. Vérifier dans les logs que Smart Context est actif
```

## ⚠️ Important

### Usage légitime

Ce mode de développement est **uniquement** pour :
- ✅ Développement local
- ✅ Tests et debugging
- ✅ Contribution au projet open-source
- ✅ Recherche et apprentissage

### NON autorisé pour :
- ❌ Production commerciale
- ❌ Service SaaS concurrent
- ❌ Revente des fonctionnalités
- ❌ Usage commercial sans licence

### Licence

- Code hors `/src/pro` : **Apache 2.0** (Open Source)
- Code dans `/src/pro` : **FSL 1.1** (Fair Source)

Pour un usage commercial légitime, obtenez une licence officielle sur [dyad.sh/pro](https://dyad.sh/pro)

## 🔐 Sécurité

### Ne commitez JAMAIS

```gitignore
# Déjà dans .gitignore
.env
.env.local
.env.development
settings.json
*.backup
```

### Désactiver avant production

```powershell
# Toujours désactiver le mode dev avant déploiement
.\disable-pro-dev.ps1

# Ou supprimer la variable
Remove-Item Env:\DYAD_DEV_PRO_BYPASS
```

## 🐛 Dépannage

### Pro n'apparaît pas comme actif

```powershell
# Vérifier la variable d'environnement
echo $env:DYAD_DEV_PRO_BYPASS

# Doit afficher: true

# Relancer le script
.\enable-pro-dev.ps1
```

### Fonctionnalités ne marchent pas

1. Vérifier que `enableDyadPro: true` dans settings
2. Redémarrer complètement Dyad
3. Vérifier les logs pour "DEV mode"
4. S'assurer d'avoir des clés AI valides (OpenAI, Anthropic, etc.)

### Erreur "Dyad Pro is not enabled"

```powershell
# Forcer la réactivation
.\enable-pro-dev.ps1

# Vérifier le fichier .env
cat .env | Select-String "DYAD_DEV_PRO_BYPASS"

# Doit afficher: DYAD_DEV_PRO_BYPASS=true
```

## 📚 Ressources

- [Documentation Dyad](https://dyad.sh/docs)
- [Guide d'architecture](./docs/architecture.md)
- [Dyad Pro features](https://dyad.sh/pro)
- [Contribution guide](./CONTRIBUTING.md)

## 🤝 Contribution

Si vous améliorez les fonctionnalités Pro, n'oubliez pas :

1. Tester en mode dev d'abord
2. S'assurer que les vérifications de sécurité restent actives en prod
3. Documenter les changements
4. Suivre la licence FSL 1.1 pour le code dans `/src/pro`

---

**Happy coding! 🚀**
