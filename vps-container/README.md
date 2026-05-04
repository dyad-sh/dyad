# Dyad VPS Container Version

This folder adds a **VPS-friendly container wrapper** for the current Dyad desktop app.

It runs:

- Dyad Electron app inside a virtual XFCE desktop
- noVNC so you can open Dyad in your browser
- File Browser so you can manage folders/files under `/data`
- nginx on port `8080` as the single HTTP entrypoint
- persistent Docker volume for Dyad settings and generated apps

## What this is

This is a practical VPS version of Dyad using containers.

It is suitable when you want to open Dyad from a browser on a VPS at a domain such as:

```text
https://dyad.ngcolabs.co.za
```

## What this is not

This is **not** a full native web rewrite of Dyad. Dyad is still an Electron desktop app. The container makes it accessible through a browser-based remote desktop.

## URLs

After deployment:

| URL | Purpose |
|---|---|
| `/` | Opens noVNC desktop with Dyad |
| `/vnc.html?autoconnect=true&resize=remote` | Direct noVNC URL |
| `/files/` | Browser file/folder manager |
| `/health` | Health check |

## Persistent folders

Inside the container:

| Path | Purpose |
|---|---|
| `/data/apps` | Dyad generated apps/workspaces |
| `/data/userData` | Dyad settings, SQLite database, app config |
| `/data/cache` | Cache/temp files |
| `/data/downloads` | Download/import staging area |

These are stored in the Docker volume named `dyad_data` by default.

## Local test

From the repository root:

```bash
cd vps-container
docker compose up --build
```

Then open:

```text
http://YOUR_SERVER_IP:8080
```

File manager:

```text
http://YOUR_SERVER_IP:8080/files/
```

noVNC will ask for the `VNC_PASSWORD` you configured.

Default file manager credentials:

```text
Username: admin
Password: change-me-now
```

Change the password before production.

## Dokploy deployment

In Dokploy:

1. Create a new project.
2. Create a Compose application.
3. Use this repo as the source.
4. Set compose file path to:

```text
vps-container/docker-compose.yml
```

5. Add environment variables:

```text
FILEBROWSER_USER=admin
FILEBROWSER_PASSWORD=your-long-secure-password
VNC_PASSWORD=your-long-secure-vnc-password
VNC_GEOMETRY=1440x900
VNC_DEPTH=24
```

6. Set the domain:

```text
dyad.ngcolabs.co.za
```

7. Set internal port:

```text
8080
```

8. Enable HTTPS/SSL.

## DNS

Create this DNS record:

| Type | Name | Value |
|---|---|---|
| A | dyad | Your VPS public IP |

## Security warning

This setup exposes a full desktop session through the browser. Use it only behind HTTPS and strong access control.

Recommended protections:

- Strong Dokploy/app password if available
- Cloudflare Access, Authelia, Basic Auth, or Tailscale
- Strong File Browser password
- Strong VNC password
- Do not expose Docker socket to this container
- Do not use this as a public multi-user SaaS

## Generated apps

Generated apps should be stored under:

```text
/data/apps
```

You can access and download/edit them at:

```text
https://dyad.ngcolabs.co.za/files/files/apps
```

Depending on File Browser routing, you may also see them under `/files/` as the `apps` folder.


## Admin security layer

This VPS container now includes an nginx Basic Auth admin layer in front of both Dyad/noVNC and File Browser.

Read:

```text
vps-container/docs/SECURITY-AND-RUN-GUIDE.md
```
