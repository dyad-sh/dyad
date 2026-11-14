param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$visualStudio = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.VC.ATL -property installationPath
if (!$visualStudio) {
    throw 'Install Visual Studio 2022 C++ build tools, including ATL and a Windows 10/11 SDK, to build the guarded Windows installer.'
}
$msbuild = Join-Path $visualStudio 'MSBuild\Current\Bin\MSBuild.exe'
$project = Join-Path $SourceDirectory 'src\Setup\Setup.vcxproj'
& $msbuild $project /t:Rebuild /p:Configuration=Release /p:Platform=Win32 /p:PlatformToolset=v143 /p:WindowsTargetPlatformVersion=10.0 /verbosity:minimal /nologo
if ($LASTEXITCODE -ne 0) { throw "Squirrel Setup build failed: $LASTEXITCODE" }
Copy-Item -LiteralPath (Join-Path $SourceDirectory 'build\Release\Win32\Setup.exe') -Destination (Join-Path $OutputDirectory 'Setup.exe')

# Compile the same guard into a disposable executable used by the CI tests.
& $msbuild (Join-Path $PSScriptRoot 'guard-probe.vcxproj') /t:Rebuild /p:Configuration=Release /p:Platform=Win32 /verbosity:minimal /nologo
if ($LASTEXITCODE -ne 0) { throw "Installer guard probe build failed: $LASTEXITCODE" }
