Objetivo: datos correctos, reproducibles y con su verificación.

1. Descarga los datos de entrada a /root/.automaton/work/<plataforma>/tasks/<id>/input y anota tamaño, formato y codificación.
2. Escribe un script (Python o Node) que haga TODA la transformación; no edites datos a mano ni con el modelo. El script es parte de la entrega.
3. Valida con código: conteo de filas antes/después, nulos, duplicados, tipos y rangos. Guarda el resumen de validación.
4. Para tareas repetitivas o grandes, procesa por lotes y nunca pegues el dataset completo en el contexto: inspecciona con head, wc, jq o pandas.
5. Entrega: archivo de salida en el formato pedido + script + resumen de validación (qué se limpió, cuántos registros, supuestos).

Si el formato de salida es ambiguo, elige el más estándar (CSV UTF-8 con cabecera, o JSON Lines) y dilo explícitamente.
