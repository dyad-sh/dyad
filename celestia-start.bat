@echo off
REM Quick start for Celestia node (WSL)
echo Starting Celestia Light Node in WSL...
wsl celestia light start --core.ip consensus-full.celestia-bootstrap.net --p2p.network celestia --rpc.addr 0.0.0.0 --rpc.port 26658
