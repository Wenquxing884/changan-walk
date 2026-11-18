param([string]$Repository = 'changan-walk')
$ErrorActionPreference = 'Stop'
$owner = 'Wenquxing884'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$branch = git branch --show-current
if ($LASTEXITCODE -ne 0 -or -not $branch) { throw 'Run from the prepared source package.' }
$remote = "https://github.com/$owner/$Repository.git"
$existing = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0 -and $existing -ne $remote) { throw "Existing origin differs; left unchanged: $existing" }
if ($LASTEXITCODE -ne 0) { git remote add origin $remote }
Write-Host "The private GitHub repository must already exist and be empty: $remote"
Read-Host 'Press Enter after creating it on GitHub'
$env:GCM_INTERACTIVE = 'auto'
git push -u origin $branch
Write-Host "Uploaded: https://github.com/$owner/$Repository"
