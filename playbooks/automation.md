Objetivo: algo que funcione solo, con instrucciones para correrlo.

1. Identifica entradas, salidas, frecuencia y credenciales necesarias. Si requiere credenciales del cliente, entrega el código parametrizado por variables de entorno; nunca pidas ni uses claves de terceros.
2. Prefiere herramientas estándar: scripts Node/Python, cron, GitHub Actions, Docker Compose. Evita dependencias raras.
3. Escribe el código en /root/.automaton/work/<plataforma>/tasks/<id>/ con un README de uso y un ejemplo de configuración.
4. Prueba de punta a punta con datos de ejemplo o mocks. Maneja errores y reintentos en las llamadas de red.
5. Entrega: código + README + evidencia de ejecución (salida del test o del dry run).

Descarta (skipped) si exige desplegar en infraestructura que no controlas, saltarse límites de uso o términos de servicio, o automatizar spam.
