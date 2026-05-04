# Dokploy Quick Settings

Use the root Dockerfile setup. This avoids nested Dockerfile path problems.

## Build

| Field | Value |
|---|---|
| Build Type | Dockerfile |
| Build Path | `.` |
| Dockerfile Path | `Dockerfile` |
| Publish Directory | empty |
| Port | `8080` |

## Environment Settings

Add only these runtime variables:

```text
ADMIN_USER=admin
ADMIN_PASSWORD=Admin123456789
VNC_PASSWORD=Vnc123456789
FILEBROWSER_USER=admin
FILEBROWSER_PASSWORD=Files123456789
VNC_GEOMETRY=1440x900
VNC_DEPTH=24
```

Leave these empty:

```text
Build-time Arguments: empty
Build-time Secrets: empty
```

Disable:

```text
Create Environment File: OFF
```

## Domain

```text
dyad.ngcolabs.co.za
```

Internal port:

```text
8080
```
