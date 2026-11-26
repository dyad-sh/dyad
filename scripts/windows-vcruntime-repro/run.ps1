# Real-Windows reproduction for #5079: load the MustardScript addon inside
# mcr.microsoft.com/windows/servercore:ltsc2022, which ships no vcruntime140.dll.
#   1. Without the DLL, require("mustardscript") must fail with the loader's
#      AggregateError, caused by an unresolvable DLL import.
#   2. With a genuine vcruntime140.dll next to the addon, it must load.
# Needs Docker in Windows-container mode on a Windows Server 2022 host.
param(
  # Folder holding node_modules/mustardscript and node_modules/@mustardscript.
  [Parameter(Mandatory = $true)] [string] $ModulesRoot,
  # A genuine vcruntime140.dll (VS redist), e.g. the host's System32 copy.
  [Parameter(Mandatory = $true)] [string] $Vcruntime,
  [string] $NodeVersion = "v24.13.1",
  [string] $Image = "mcr.microsoft.com/windows/servercore:ltsc2022",
  [string] $WorkDir = (Join-Path $env:TEMP "vcruntime-repro")
)
$ErrorActionPreference = "Stop"

Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $WorkDir | Out-Null
Copy-Item -Recurse (Join-Path $ModulesRoot "node_modules") (Join-Path $WorkDir "node_modules")
Copy-Item (Join-Path $PSScriptRoot "probe.cjs") $WorkDir

$zip = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
if (-not (Test-Path $zip)) {
  Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" -OutFile $zip
}
Expand-Archive $zip -DestinationPath $WorkDir -Force
$node = "C:\work\node-$NodeVersion-win-x64\node.exe"
$binding = Join-Path $WorkDir "node_modules\@mustardscript\binding-win32-x64-msvc"
Remove-Item (Join-Path $binding "vcruntime140.dll") -ErrorAction SilentlyContinue

function Invoke-Probe([string] $expectation) {
  Write-Host "=== probe: $expectation"
  # Out-Host keeps docker's output out of the function's return value.
  docker run --rm --isolation process -v "${WorkDir}:C:\work" $Image $node C:\work\probe.cjs $expectation | Out-Host
  return $LASTEXITCODE
}

docker pull $Image
if ($LASTEXITCODE -ne 0) { throw "docker pull failed" }

$fail = Invoke-Probe "fail"
Copy-Item $Vcruntime (Join-Path $binding "vcruntime140.dll")
$load = Invoke-Probe "load"

Write-Host "RESULT fail=$fail load=$load (0 = expectation held, 1 = did not, 2 = inconclusive)"
if ($fail -ne 0 -or $load -ne 0) { exit 1 }
Write-Host "PASS: fails without vcruntime140.dll, loads with it beside the addon"
