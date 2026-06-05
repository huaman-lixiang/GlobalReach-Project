# Register GlobalReach Daily Backup Scheduled Task
$scriptPath = "C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project\scripts\s079-backup.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At "02:00"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName "GlobalReach-DailyBackup" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "GlobalReach V2.0 Daily Backup (PG+Redis+Config+Git)" `
    -Force

Write-Host "[OK] Scheduled task 'GlobalReach-DailyBackup' registered successfully!" -ForegroundColor Green
Get-ScheduledTask -TaskName "GlobalReach-DailyBackup" | Format-List TaskName, State, Description
