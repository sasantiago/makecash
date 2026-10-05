# Registra en el Programador de tareas de Windows (solo para tu usuario,
# sin permisos de administrador):
#   - "Automaton Watchdog": al iniciar sesión y cada 30 minutos
#   - "Automaton Backup":   todos los días a las 03:00
#
# Instalar:     powershell -ExecutionPolicy Bypass -File scripts\windows\install-tasks.ps1
# Desinstalar:  powershell -ExecutionPolicy Bypass -File scripts\windows\install-tasks.ps1 -Uninstall

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$names = @("Automaton Watchdog", "Automaton Backup")

foreach ($name in $names) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
    }
}
if ($Uninstall) { "Tareas eliminadas."; exit 0 }

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$user = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

function New-PsAction([string]$script) {
    New-ScheduledTaskAction -Execute "powershell.exe" -WorkingDirectory $repo `
        -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$repo\scripts\windows\$script`""
}

$every30 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30)
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
Register-ScheduledTask -TaskName "Automaton Watchdog" -Action (New-PsAction "watchdog.ps1") `
    -Trigger @($atLogon, $every30) -Principal $principal -Settings $settings `
    -Description "Mantiene Docker Desktop y el agente automaton en marcha" | Out-Null

$daily = New-ScheduledTaskTrigger -Daily -At "03:00"
Register-ScheduledTask -TaskName "Automaton Backup" -Action (New-PsAction "backup.ps1") `
    -Trigger $daily -Principal $principal -Settings $settings `
    -Description "Respaldo diario del wallet y estado del agente automaton" | Out-Null

Get-ScheduledTask -TaskName $names | Select-Object TaskName, State
