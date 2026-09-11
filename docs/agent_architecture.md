# Agent Architecture

The former local-agent implementation was removed with the retired Pro source
tree. It is not an extension point in this repository.

Dyad's supported execution runtime is documented in
[Architecture Guide](./architecture.md). New execution behavior must be added
to the open-source runtime through its existing IPC contracts and main-process
services; do not reintroduce the removed agent implementation.
