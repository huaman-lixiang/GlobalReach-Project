# S077 GitHub Auth Script
# Handles interactive gh auth login prompts
$gh = "C:\Users\Administrator\AppData\Local\gh\bin\gh.exe"

Write-Host "[S077] Starting GitHub Web Authentication..." -ForegroundColor Cyan

# Create input file with pre-configured answers
# Flow: GitHub.com -> HTTPS -> Y (git creds) -> wait for code -> enter to open browser
$inputAnswers = @"
github.com
https
Y
"@

# Write temp input file
$tempInput = Join-Path $env:TEMP "gh_auth_input.txt"
$inputAnswers | Out-File -FilePath $tempInput -Encoding ASCII

Write-Host "[S077] Input prepared. Running gh auth login..." -ForegroundColor Green
Write-Host "[S077] NOTE: You will need to:" -ForegroundColor Yellow
Write-Host "  1. Copy the one-time code shown" -ForegroundColor Yellow
Write-Host "  2. Open the browser URL (or press Enter)" -ForegroundColor Yellow
Write-Host "  3. Paste the code on GitHub and authorize" -ForegroundColor Yellow
Write-Host ""
Write-Host "[S077] Starting authentication process..." -ForegroundColor Cyan

Get-Content $tempInput | & $gh auth login --web --git-protocol https 2>&1

# Cleanup
Remove-Item $tempInput -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "[S077] Verifying auth status..." -ForegroundColor Cyan
& $gh auth status 2>&1
