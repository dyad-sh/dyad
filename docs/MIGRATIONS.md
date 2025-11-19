# Migration Guide

This guide helps you migrate between major versions of Dyad and handle breaking changes.

## Table of Contents

- [General Migration Process](#general-migration-process)
- [Version-Specific Migrations](#version-specific-migrations)
- [Database Migrations](#database-migrations)
- [Troubleshooting Migrations](#troubleshooting-migrations)

## General Migration Process

### Before Upgrading

1. **Backup your data**
   ```bash
   # Backup location (automatic)
   ~/.config/dyad/backups/

   # Manual backup
   cp -r ~/.config/dyad ~/dyad-backup-$(date +%Y%m%d)
   ```

2. **Note your current version**
   - Check Help → About Dyad
   - Or check `package.json` version

3. **Review release notes**
   - Read CHANGELOG.md
   - Check GitHub releases
   - Review breaking changes

### During Upgrade

1. **Download new version**
   - macOS: Download DMG from releases
   - Windows: Download installer
   - Linux: Download AppImage

2. **Install new version**
   - macOS: Drag to Applications (replace existing)
   - Windows: Run installer
   - Linux: Replace AppImage

3. **Database migration**
   - Happens automatically on first launch
   - Progress shown in UI
   - Backup created before migration

### After Upgrade

1. **Verify functionality**
   - Check all apps load
   - Test chat functionality
   - Verify integrations work

2. **Review new features**
   - Check release notes
   - Explore new UI elements
   - Try new features

3. **Report issues**
   - File bugs on GitHub
   - Include migration logs
   - Provide backup if needed

## Version-Specific Migrations

### v0.27.0 - Performance & Code Quality Release

**Breaking Changes:**
- Updated OpenAI SDK from v4 to v6
- Updated Zod from v3 to v4
- Updated several major dependencies

**Migration Steps:**

1. **Update API calls** (if using OpenAI SDK directly):
   ```typescript
   // Old (v4)
   const response = await openai.chat.completions.create({
     messages: [{ role: "user", content: "Hello" }],
     model: "gpt-4",
   });

   // New (v6) - mostly compatible, but check docs
   const response = await openai.chat.completions.create({
     messages: [{ role: "user", content: "Hello" }],
     model: "gpt-4",
   });
   ```

2. **Update Zod schemas** (if extending Dyad):
   ```typescript
   // Check Zod v4 migration guide for any breaking changes
   // Most schemas should work without changes
   ```

3. **Database migrations** (automatic):
   - New indexes added for performance
   - No schema changes
   - Migrations run automatically

**New Features:**
- Code splitting for better performance
- IPC handler auto-discovery system
- Database indexes for faster queries
- Comprehensive documentation
- Improved test coverage

### Future Versions

*Migration guides for future versions will be added here*

## Database Migrations

### How Migrations Work

Dyad uses Drizzle ORM for database migrations:

1. **Schema changes** defined in `src/db/schema.ts`
2. **Migrations generated** with `npm run db:generate`
3. **Migrations applied** automatically on app start
4. **Backups created** before each migration

### Manual Migration

If automatic migration fails:

```bash
# Generate migrations
npm run db:generate

# Apply migrations (use with caution)
npm run db:push
```

### Rollback Migration

If migration causes issues:

1. **Restore from backup**:
   ```bash
   # Find latest backup
   ls -lt ~/.config/dyad/backups/

   # Restore
   cp ~/.config/dyad/backups/dyad-TIMESTAMP.db ~/.config/dyad/dyad.db
   ```

2. **Downgrade app version**:
   - Install previous version
   - Skip problematic version

3. **Report issue**:
   - Include migration logs
   - Provide database schema
   - Share error messages

### Migration Logs

Located at:
- macOS: `~/Library/Logs/dyad/main.log`
- Linux: `~/.config/dyad/logs/main.log`
- Windows: `%APPDATA%\dyad\logs\main.log`

## Settings Migration

### Export Settings

```typescript
// From DevTools console
const settings = await window.electronAPI.invoke("get-settings");
console.log(JSON.stringify(settings, null, 2));
```

### Import Settings

```typescript
// From DevTools console
await window.electronAPI.invoke("update-settings", {
  // Your settings object
});
```

## Data Migration

### Export Apps

```typescript
// From DevTools console
const apps = await window.electronAPI.invoke("get-apps");
console.log(JSON.stringify(apps, null, 2));
```

### Export Chats

```typescript
// From DevTools console
const chats = await window.electronAPI.invoke("get-chats", appId);
console.log(JSON.stringify(chats, null, 2));
```

### Export Messages

```typescript
// From DevTools console
const messages = await window.electronAPI.invoke("get-messages", chatId);
console.log(JSON.stringify(messages, null, 2));
```

## Integration Migrations

### GitHub

**Re-authentication may be required:**

1. Go to Settings → Integrations
2. Disconnect GitHub
3. Reconnect GitHub
4. Verify access

### Supabase

**Project connections preserved:**

- Access tokens are refreshed automatically
- Re-auth only if token refresh fails
- Check Settings → Integrations

### Vercel

**Deployments continue working:**

- Existing deployments unaffected
- New deployments use updated API
- Re-auth if deployment fails

### Neon

**Database connections maintained:**

- Connection strings unchanged
- Branches preserved
- Re-auth if connection fails

## Troubleshooting Migrations

### Migration fails

**Symptoms**: App crashes on startup after upgrade

**Solutions**:
1. Check migration logs
2. Restore from backup
3. Try clean install
4. Report issue with logs

### Data loss after migration

**Symptoms**: Apps, chats, or messages missing

**Solutions**:
1. Check backup folder
2. Restore from backup
3. Verify database integrity
4. Report issue immediately

### Performance degradation

**Symptoms**: App slower after upgrade

**Solutions**:
1. Clear cache and restart
2. Run database vacuum
3. Check resource usage
4. Review performance guide

### Integration issues

**Symptoms**: GitHub/Vercel/Supabase not working

**Solutions**:
1. Re-authenticate service
2. Check service status
3. Verify API keys
4. Review integration logs

## Best Practices

1. **Always backup before upgrading**
2. **Test on non-critical apps first**
3. **Read release notes thoroughly**
4. **Keep multiple backups**
5. **Report issues promptly**
6. **Don't skip versions if possible**
7. **Verify integrations after upgrade**
8. **Document any custom changes**

## Compatibility Matrix

| Dyad Version | Node.js | Electron | macOS | Windows | Linux |
|-------------|---------|----------|-------|---------|-------|
| v0.27.0     | 20+     | 38.2.2   | 12+   | 10+     | ⚠️    |
| v0.26.x     | 20+     | 38.x     | 12+   | 10+     | ⚠️    |
| v0.25.x     | 20+     | 37.x     | 11+   | 10+     | ⚠️    |

⚠️ = Experimental support

> **Note:** Linux support is experimental and may have the following limitations:
> - Some features (such as system tray integration and notifications) may not work reliably.
> - There may be issues with certain desktop environments or distributions.
> - Performance and stability are not guaranteed; production use is not recommended.
> - Please report any Linux-specific issues to help improve support.
## Emergency Procedures

### Complete Reset

**⚠️ WARNING: This will delete all data**

```bash
# Backup first!
cp -r ~/.config/dyad ~/dyad-backup-emergency

# Remove all data
rm -rf ~/.config/dyad

# Restart Dyad (will create fresh database)
```

### Recovery Mode

If app won't start:

1. Hold Shift while launching
2. Select "Safe Mode"
3. Disable problematic features
4. Report issue

## Getting Help

If migration fails:

1. **Check troubleshooting guide**
   - [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

2. **Search existing issues**
   - [GitHub Issues](https://github.com/dyad-sh/dyad/issues)

3. **Ask for help**
   - [Discord](https://dyad.sh/discord)
   - [GitHub Discussions](https://github.com/dyad-sh/dyad/discussions)

4. **Report migration bug**
   - Include version numbers
   - Attach migration logs
   - Describe steps taken
   - Share error messages

## Related Documentation

- [Architecture](./architecture.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
- [Performance](./PERFORMANCE.md)
- [Contributing](../CONTRIBUTING.md)
