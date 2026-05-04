# Running Dyad + File Manager Securely on Dokploy

## Services

This container starts everything automatically:

| Service | URL | Protection |
|---|---|---|
| Dyad desktop through noVNC | `/` | Admin Basic Auth + VNC password |
| File manager | `/files/` | Admin Basic Auth + File Browser login |
| Health check | `/health` | Admin Basic Auth may still apply depending on reverse proxy |

## Required environment variables

Set these in Dokploy before deploying:

```text
ADMIN_USER=admin
ADMIN_PASSWORD=use-a-long-random-password
VNC_PASSWORD=use-a-different-long-random-password
FILEBROWSER_USER=admin
FILEBROWSER_PASSWORD=use-another-long-random-password
VNC_GEOMETRY=1440x900
VNC_DEPTH=24
```

## Login flow

When you open:

```text
https://dyad.ngcolabs.co.za
```

You will see:

1. Browser popup login from nginx Basic Auth.
2. noVNC password screen. Use `VNC_PASSWORD`.
3. Dyad desktop opens.

When you open:

```text
https://dyad.ngcolabs.co.za/files/
```

You will see:

1. Browser popup login from nginx Basic Auth.
2. File Browser login. Use `FILEBROWSER_USER` and `FILEBROWSER_PASSWORD`.

## Dokploy upload deployment

If using Dokploy upload folder/file:

1. Extract/upload the `dyad` folder.
2. In Dokploy create a Compose app.
3. Select or point to:

```text
vps-container/docker-compose.yml
```

4. Add domain:

```text
dyad.ngcolabs.co.za
```

5. Set internal port:

```text
8080
```

6. Enable HTTPS.
7. Add the environment variables above.
8. Deploy.

## Important

Do not leave any password as `change-me-now`.
Use HTTPS only.
For stronger security, also put Cloudflare Access, Tailscale, or Authelia in front.
