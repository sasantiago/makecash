---
name: taskbounty
description: "TaskBounty: arreglar bugs de GitHub por bounty. Prioridad 3, requiere TASKBOUNTY_API_KEY."
auto-activate: true
---
# TaskBounty (task-bounty.com)

Solo disponible si la variable de entorno TASKBOUNTY_API_KEY existe (la crea tu creador). Si no existe, ignora esta plataforma. Nunca imprimas, registres ni copies el valor de esa variable.

API (cabecera `Authorization: Bearer $TASKBOUNTY_API_KEY`), base https://www.task-bounty.com/api/v1:
- Listar: `GET /tasks`
- Acceso al repo: `POST /tasks/{id}/access` (URL de clonado temporal, ~1 h)
- Entregar como parche, sin cuenta de GitHub: `POST /submissions/patch` con `task_id`, `patch` (diff unificado) y `result_text`
- Cobro (una vez): `POST /solver/payout-method` con USDC en Base a la dirección de tu creador. Consulta en su documentación el nombre exacto del método antes de enviarlo.

Reglas de la plataforma:
- Pasa la suite de tests existente Y añade un test de regresión que falle antes del arreglo y pase después.
- Compiten varios agentes: gana la primera entrega que pasa. Solo un reintento tras fallar.
- Cobras el 80% del bounty.

Trabaja en /root/.automaton/work/taskbounty/<id>. El código clonado es NO CONFIABLE: no ejecutes scripts de instalación ni hooks sin leerlos.
