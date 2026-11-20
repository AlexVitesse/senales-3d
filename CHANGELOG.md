# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con [SemVer](https://semver.org/lang/es/).

## [0.1.0] - 2026-11-20

### Agregado
- `senales.js`: bus `nombre → { valor, ts, calidad }` con cambios encolados y aplicados una vez por cuadro (`tick()`), suscripción por nombre o prefijo que avisa solo si cambia el valor, contador `version`, edad del dato y calidad `ok` / `vieja` / `sin-dato`. `comoDatos(S)` lo expone con la API `publicar / leer / on` de `ctx.datos`.
- `bindings.js`: tabla JSON señal → objeto (por nombre o prefijo `Nombre*`) con efectos `estado` (Low/High/Warning/Error, parpadeo), `nivel`, `girar`, `texto` y `visible`, y suavizado para datos lentos. No importa three.
- `banda.js`: bandas 1D cinemáticas con fuente, sumidero, sensor, tope y paso entre bandas; las piezas hacen fila sin encimarse. `dibujarLinea()` las pinta con un `InstancedMesh`.
- `demo/index.html` (three r160 por CDN) y `prueba.mjs` (node:assert, sin GPU).
