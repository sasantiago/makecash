# Vigilante del agente: se ejecuta al iniciar sesión y cada 30 minutos.
# - Arranca Docker Desktop si no está corriendo.
# - Levanta el contenedor si no está en marcha (docker compose up -d).
# - Avisa con una notificación de Windows si tuvo que intervenir o si falla.
#
# Para mantener el agente apagado a propósito, crea el archivo agent.paused
# en la raíz del repo; bórralo para reactivarlo.

param(
    [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [int]$DockerStartTimeoutSec = 240
)

# PowerShell 5.1 trata el stderr de docker (avisos inofensivos) como error con
# "Stop"; se usa "Continue" y se comprueba $LASTEXITCODE explícitamente.
$ErrorActionPreference = "Continue"
$logDir = Join-Path $env:USERPROFILE "automaton-backups"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "watchdog.log"

function Write-Log([string]$msg) {
    "$(Get-Date -Format s)  $msg" | Out-File -FilePath $log -Append -Encoding utf8
}

function Show-Toast([string]$title, [string]$body) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
            [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $texts = $xml.GetElementsByTagName("text")
        $texts.Item(0).AppendChild($xml.CreateTextNode($title)) | Out-Null
        $texts.Item(1).AppendChild($xml.CreateTextNode($body)) | Out-Null
        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show(
            [Windows.UI.Notifications.ToastNotification]::new($xml))
    } catch {
        Write-Log "no se pudo mostrar la notificación: $($_.Exception.Message)"
    }
}

function Test-Docker { docker info *> $null; return ($LASTEXITCODE -eq 0) }

try {
    if (Test-Path (Join-Path $RepoDir "agent.paused")) {
        Write-Log "pausado (agent.paused existe); no se hace nada"
        exit 0
    }

    if (-not (Test-Docker)) {
        Write-Log "Docker no responde; arrancando Docker Desktop"
        Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        $deadline = (Get-Date).AddSeconds($DockerStartTimeoutSec)
        while (-not (Test-Docker)) {
            if ((Get-Date) -gt $deadline) { throw "Docker Desktop no arrancó en $DockerStartTimeoutSec s" }
            Start-Sleep -Seconds 5
        }
        Write-Log "Docker listo"
    }

    Set-Location $RepoDir
    $state = (docker inspect -f "{{.State.Status}} {{.State.ExitCode}} {{.RestartCount}}" automaton 2>$null)
    if ($LASTEXITCODE -ne 0) { $state = "missing" }

    if ($state -notlike "running*") {
        Write-Log "contenedor no está corriendo ($state); levantándolo"
        docker compose up -d *> $null
        if ($LASTEXITCODE -ne 0) { throw "docker compose up -d falló" }
        Show-Toast "Agente reiniciado" "El contenedor estaba '$state'. Revisa: docker compose logs automaton"
    }
    elseif ([int]($state.Split(" ")[2]) -ge 5) {
        Show-Toast "Agente inestable" "Lleva $($state.Split(' ')[2]) reinicios. Revisa: docker compose logs automaton"
        Write-Log "muchos reinicios: $state"
    }
}
catch {
    Write-Log "ERROR $($_.Exception.Message)"
    Show-Toast "Problema con el agente" $_.Exception.Message
    exit 1
}
