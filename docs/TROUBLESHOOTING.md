# Troubleshooting Guide

This guide helps you diagnose and fix common issues with Dyad.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Runtime Issues](#runtime-issues)
- [Integration Issues](#integration-issues)
- [Performance Issues](#performance-issues)
- [Database Issues](#database-issues)
- [Getting Help](#getting-help)

## Installation Issues

### npm install fails

**Symptoms**: npm install fails with errors about native modules or Electron

**Solutions**:
1. Ensure you have Node.js 20 or higher: `node --version`
2. Clear npm cache: `npm cache clean --force`
3. Delete `node_modules` and `package-lock.json`, then run `npm install` again
4. On Windows, ensure you have build tools: `npm install --global windows-build-tools`
5. On macOS, ensure Xcode Command Line Tools are installed: `xcode-select --install`

### Electron fails to download

**Symptoms**: 403 Forbidden or network errors when installing Electron

**Solutions**:
1. Check your network connection and proxy settings
2. Try setting an Electron mirror: `export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
3. Download Electron manually and cache it

## Runtime Issues

### Application won't start

**Symptoms**: App crashes immediately or shows blank screen

**Solutions**:
1. Check the logs: `~/.config/dyad/logs/main.log` (macOS/Linux) or `%APPDATA%\dyad\logs\main.log` (Windows)
2. Clear application data and restart
3. Ensure your system meets minimum requirements
4. Try running in development mode: `npm start`

### Blank screen after launch

**Symptoms**: Application window opens but shows nothing

**Solutions**:
1. Check developer console: View → Toggle Developer Tools
2. Clear browser cache and restart
3. Check for JavaScript errors in console
4. Ensure graphics drivers are up to date

### Chat not streaming

**Symptoms**: Chat messages don't appear or stream slowly

**Solutions**:
1. Check your API key is valid
2. Verify network connectivity
3. Check API rate limits
4. Review logs for errors
5. Try a different AI provider

## Integration Issues

### GitHub Authentication Fails

**Symptoms**: Cannot connect to GitHub or clone repositories

**Solutions**:
1. Ensure GitHub is accessible from your network
2. Check GitHub status: https://www.githubstatus.com/
3. Revoke and re-authenticate in Settings
4. Verify SSH keys are set up correctly
5. Check firewall/proxy settings

### Supabase Connection Errors

**Symptoms**: Cannot connect to Supabase or execute queries

**Solutions**:
1. Verify project ID is correct
2. Check Supabase project is active
3. Ensure API keys are valid
4. Verify network connectivity to Supabase
5. Check Supabase project settings

### Vercel Deployment Fails

**Symptoms**: Cannot deploy to Vercel or deployment errors

**Solutions**:
1. Verify Vercel authentication
2. Check project configuration
3. Ensure build command is correct
4. Review Vercel deployment logs
5. Check for environment variable issues

### Neon Database Issues

**Symptoms**: Cannot connect to Neon or query fails

**Solutions**:
1. Verify Neon project credentials
2. Check connection string format
3. Ensure database exists
4. Verify network connectivity
5. Check Neon project status

## Performance Issues

### Slow app performance

**Symptoms**: UI is sluggish, operations take too long

**Solutions**:
1. Close unused apps and tabs
2. Clear application cache
3. Reduce context window size
4. Use Smart Context feature (Pro)
5. Check system resource usage

### Large bundle size

**Symptoms**: App takes long to load or download

**Solutions**:
1. Build in production mode: `npm run make`
2. Check bundle analysis
3. Remove unused dependencies
4. Enable code splitting (already configured)

### High memory usage

**Symptoms**: App uses too much RAM

**Solutions**:
1. Close unused chats
2. Limit number of open apps
3. Restart the application
4. Check for memory leaks in logs
5. Reduce Monaco editor instances

## Database Issues

### Database is locked

**Symptoms**: "Database is locked" error messages

**Solutions**:
1. Close all Dyad instances
2. Check for orphaned processes: `ps aux | grep dyad`
3. Remove lock file if safe: `~/.config/dyad/dyad.db-lock`
4. Restart the application

### Database corruption

**Symptoms**: App crashes with database errors

**Solutions**:
1. Restore from backup: `~/.config/dyad/backups/`
2. Run database integrity check
3. Export data and reimport
4. As last resort, delete database (will lose data)

### Migration failures

**Symptoms**: App fails to start after update with migration errors

**Solutions**:
1. Check migration logs
2. Restore from backup before migration
3. Manually run migrations: `npm run db:push`
4. Report issue with logs

## Development Issues

### TypeScript errors

**Symptoms**: Build fails with type errors

**Solutions**:
1. Run type check: `npm run ts`
2. Update TypeScript definitions: `npm update @types/*`
3. Clear TypeScript cache: `rm -rf node_modules/.cache`
4. Restart TypeScript server in editor

### E2E tests failing

**Symptoms**: Playwright tests fail locally

**Solutions**:
1. Install browsers: `npx playwright install`
2. Build test package: `npm run pre:e2e`
3. Check test server: `cd testing/fake-llm-server && npm start`
4. Review test logs
5. Run tests in headed mode: `npx playwright test --headed`

### Lint errors

**Symptoms**: Pre-commit hooks fail or CI lint fails

**Solutions**:
1. Run linter: `npm run lint`
2. Auto-fix issues: `npm run lint:fix`
3. Format code: `npm run prettier`
4. Check oxlint config

## MCP Server Issues

### MCP server won't start

**Symptoms**: MCP server fails to initialize

**Solutions**:
1. Check server configuration
2. Verify command path is correct
3. Review server logs
4. Check environment variables
5. Ensure server has execution permissions

### MCP tools not available

**Symptoms**: MCP tools don't appear in tool list

**Solutions**:
1. Verify server is enabled
2. Check server connection
3. Review tool consent settings
4. Restart MCP server
5. Check server logs for errors

## Getting Help

If you're still experiencing issues:

1. **Check Documentation**: Review our [full documentation](https://dyad.sh/docs)
2. **Search Issues**: Look for similar issues on [GitHub](https://github.com/dyad-sh/dyad/issues)
3. **Ask Community**: Join our [Discord](https://dyad.sh/discord) or [GitHub Discussions](https://github.com/dyad-sh/dyad/discussions)
4. **Report Bug**: Create a [new issue](https://github.com/dyad-sh/dyad/issues/new) with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Logs from `~/.config/dyad/logs/`
   - System information
   - Screenshots if applicable

### Log Locations

- **macOS**: `~/Library/Logs/dyad/`
- **Linux**: `~/.config/dyad/logs/`
- **Windows**: `%APPDATA%\dyad\logs\`

### Debug Mode

Enable debug mode for more detailed logs:

```bash
DEBUG=* npm start
```

Or for specific modules:

```bash
DEBUG=dyad:* npm start
```
