# Beginner Dokploy Guide for Dyad VPS Container

## 1. Push this repository to your GitHub

Commit the new `vps-container` folder and push to GitHub.

## 2. Create DNS record

Add an A record:

| Type | Name | Value |
|---|---|---|
| A | dyad | your VPS IP |

## 3. Create Dokploy Compose app

In Dokploy:

- New Project
- New Compose App
- Source: GitHub repo
- Compose file: `vps-container/docker-compose.yml`

## 4. Set domain

Domain:

```text
dyad.ngcolabs.co.za
```

Port:

```text
8080
```

Enable SSL.

## 5. Set environment variables

Use a strong password:

```text
FILEBROWSER_USER=admin
FILEBROWSER_PASSWORD=put-a-long-random-password-here
VNC_PASSWORD=put-a-long-random-vnc-password-here
VNC_GEOMETRY=1440x900
VNC_DEPTH=24
```

## 6. Deploy

Click Deploy.

First build may take a long time because it installs Node 24, desktop packages, Electron dependencies, and packages Dyad.

## 7. Open Dyad

Open:

```text
https://dyad.ngcolabs.co.za
```

You should see the remote desktop. Dyad should start automatically.

## 8. Manage files

Open:

```text
https://dyad.ngcolabs.co.za/files/
```

Use the File Browser login.

The most important folder is:

```text
/data/apps
```
