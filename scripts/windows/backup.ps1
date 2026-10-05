# Respaldo diario del agente: wallet, configuración, base de datos e
# identidades de las plataformas. Guarda los últimos $KeepDays días.
#
# Uso manual:  powershell -ExecutionPolicy Bypass -File scripts\windows\backup.ps1
# Restaurar:   ver scripts\windows\README.md
#
# OJO: el respaldo contiene la clave privada del wallet y tu API key de
# Anthropic en claro. No pongas la carpeta destino en OneDrive/Drive.

param(
    [string]$Destination = (Join-Path $env:USERPROFILE "automaton-backups"),
    [int]$KeepDays = 14,
    [string]$Image = "conway-automaton:local"
)

# PowerShell 5.1 trata el stderr de docker (avisos inofensivos) como error con
# "Stop"; se usa "Continue" y se comprueba $LASTEXITCODE explícitamente.
$ErrorActionPreference = "Continue"
$log = Join-Path $Destination "backup.log"
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

function Write-Log([string]$msg) {
    "$(Get-Date -Format s)  $msg" | Out-File -FilePath $log -Append -Encoding utf8
}

try {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw "Docker no está corriendo" }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $file = "automaton-$stamp.tgz"

    # La lógica vive en scripts/backup-volume.sh dentro de la imagen:
    # PowerShell 5.1 rompe las comillas de argumentos complejos a docker.
    docker run --rm `
        -v automaton_automaton-home:/root `
        -v automaton_automaton-state:/root/.automaton `
        -v "${Destination}:/backup" `
        --entrypoint /app/scripts/backup-volume.sh $Image $file *> $null
    if ($LASTEXITCODE -ne 0) { throw "falló el contenedor de respaldo (código $LASTEXITCODE)" }

    $path = Join-Path $Destination $file
    if (-not (Test-Path $path) -or (Get-Item $path).Length -eq 0) { throw "no se generó $file" }
    $size = [math]::Round((Get-Item $path).Length / 1KB)
    Write-Log "OK $file ($size KB)"

    Get-ChildItem $Destination -Filter "automaton-*.tgz" |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
        ForEach-Object { Remove-Item $_.FullName -Force -Confirm:$false; Write-Log "borrado antiguo $($_.Name)" }
}
catch {
    Write-Log "ERROR $($_.Exception.Message)"
    exit 1
}
