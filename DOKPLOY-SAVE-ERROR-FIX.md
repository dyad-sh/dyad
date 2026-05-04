# Dokploy "Error saving the deployment" Fix

This error happens before Docker builds. It is usually a Dokploy form/source issue, not a Dyad code issue.

## Safest save test

1. Create a new app/resource.
2. Select Dockerfile.
3. Do not add domain yet.
4. Do not add environment variables yet.
5. Do not fill build-time arguments or build-time secrets.
6. Disable Create Environment File.
7. Use:

Build Path: .
Dockerfile Path: Dockerfile
Port: 8080
Publish Directory: empty

8. Save.

If save works, add domain and env vars after.

## If Dockerfile app still cannot save

Use Compose instead with:

Compose file path: docker-compose.dokploy.yml

This file uses root context and root Dockerfile, avoiding nested path problems.

## If upload source still cannot save

Dokploy upload mode may be the problem. Use GitHub source instead:

1. Create a private GitHub repo.
2. Upload/push this dyad folder.
3. Connect Dokploy to GitHub.
4. Deploy with Dockerfile or Compose.
