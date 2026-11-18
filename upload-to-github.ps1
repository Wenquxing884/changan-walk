param([string]$Repository = 'changan-walk')
$ErrorActionPreference = 'Stop'
$owner = 'Wenquxing884'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
if (-not (git rev-parse --verify HEAD 2>$null)) { throw 'Run from the prepared source package with a Git commit.' }
git remote remove origin 2>$null
$remote = "https://github.com/$owner/$Repository.git"
git remote add origin $remote
Write-Host "Repository must exist and be empty: $remote"
Write-Host 'If needed, create it as a private repository on GitHub, then press Enter to push.'
Read-Host
$env:GCM_INTERACTIVE = 'auto'
git push -u origin main
Write-Host "Uploaded: https://github.com/$owner/$Repository"
