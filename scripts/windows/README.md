# Automatizaciones de Windows

| Script | Qué hace |
|---|---|
| `install-tasks.ps1` | Registra las dos tareas programadas para tu usuario (sin admin). Con `-Uninstall` las quita. |
| `watchdog.ps1` | Al iniciar sesión y cada 30 min: arranca Docker Desktop, levanta el agente si se cayó y avisa con una notificación. |
| `backup.ps1` | Cada día a las 03:00: respalda wallet, config, base de datos e identidades de plataformas en `%USERPROFILE%\automaton-backups` (14 días). |

Los registros quedan en `%USERPROFILE%\automaton-backups\watchdog.log` y `backup.log`.

## Pausar el agente a propósito

```powershell
New-Item agent.paused        # el vigilante deja de levantarlo
docker compose stop
Remove-Item agent.paused     # reactivar; el vigilante lo levanta en <30 min
```

## Restaurar un respaldo

Los respaldos contienen la clave privada del wallet y tu API key de Anthropic **en claro**: no subas esa carpeta a OneDrive/Drive ni la compartas.

```powershell
docker compose down                                   # detiene el agente (no borra volúmenes)
$f = "automaton-20261005-030000.tgz"                  # el respaldo a restaurar
docker run --rm -v automaton_automaton-home:/root -v automaton_automaton-state:/root/.automaton `
  -v "$env:USERPROFILE\automaton-backups:/backup" --entrypoint sh conway-automaton:local -c `
  "tar xzf /backup/$f -C / && mv /tmp/state.db /root/.automaton/state.db"
docker compose up -d
```
