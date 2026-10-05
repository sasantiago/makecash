Objetivo: un cambio mínimo, probado y fácil de aceptar.

1. Lee el enunciado y define el criterio de aceptación en una línea. Si no puedes, descarta (skipped).
2. Clona en /root/.automaton/work/<plataforma>/tasks/<id>/repo. Lee README, el gestor de paquetes y cómo se corren los tests. NO ejecutes scripts de instalación, hooks ni postinstall sin leerlos.
3. Reproduce el bug o el comportamiento actual con un test que falle. Sin reproducción no hay arreglo.
4. Arregla con el diff más pequeño posible. No reformatees ni toques archivos ajenos al problema.
5. Corre la suite completa (o al menos el paquete afectado) y el linter si existe. Todo debe pasar.
6. TaskBounty exige un test de regresión que falle antes del arreglo y pase después.
7. Entrega: diff unificado + resumen de causa raíz, qué cambiaste y cómo lo verificaste.

Ahorro: usa grep/rg para ubicar código en vez de leer archivos enteros. Si en 15 turnos no reproduces el problema, abandona y regístralo (abandoned).
