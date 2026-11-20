# senales-3d

Tres módulos ES sin dependencias para darle datos a un gemelo three.js (r160, import maps, sin bundler):

| Módulo | Qué hace |
|---|---|
| `senales.js` | Bus de señales `nombre → { valor, ts, calidad }`, aplicado una vez por cuadro. |
| `bindings.js` | Tabla JSON que conecta señales con objetos de la escena (color de estado, nivel, giro, texto, visible). |
| `banda.js` | Bandas transportadoras 1D cinemáticas (fuente, sumidero, sensor, tope), dibujadas con `InstancedMesh`. |

Diseño propio, escrito desde cero. `bindings.js` y la lógica de `banda.js` no importan three (solo tocan propiedades de los objetos), así que se prueban en Node sin GPU; `dibujarLinea()` recibe `THREE` como parámetro. three r160 es *peer*: lo pone la página con su import map.

## Probar

```sh
node prueba.mjs                         # lógica del bus, bindings con objetos falsos y la fila de la banda
python -m http.server 8000              # o cualquier servidor estático, desde esta carpeta
# abre http://localhost:8000/demo/
```

## senales.js

```js
import { crearSenales, comoDatos } from './senales.js';
const S = crearSenales({ viejaMs: 120e3 }); // pasado viejaMs sin dato nuevo, calidad = 'vieja'

S.set('bomba', 1, ts);                      // encola (último gana); ts en epoch ms, opcional
S.lote({ presion: 3010, temp: { valor: -150, ts } });
S.tick();                                   // 1 vez por cuadro: aplica y avisa; devuelve los nombres que cambiaron
S.get('bomba');                             // { valor, ts, calidad: 'ok'|'vieja'|'sin-dato', edadMs }
S.valor('bomba', 0); S.calidad('bomba'); S.nombres(); S.version;
const off = S.on('pt/*', (valor, nombre, entrada) => {}); // nombre exacto, prefijo 'x*' o '*'
```

- Solo avisa si el valor cambió (`Object.is`). El mismo valor con un `ts` más nuevo refresca la edad sin avisar ni subir `version`.
- `version` sube una vez por señal cambiada: un tablero puede revisar `S.version` cada 200 ms y repintar solo si se movió.
- Un suscriptor que lanza error no corta a los demás.

**Reemplazo de `ctx.datos`** (los gemelos con soluciones `sol-*.js`): `ctx.datos = comoDatos(S)` mantiene `publicar(zona, obj)`, `leer(zona)` y `on(zona | '*', fn)`; además cada KPI queda como señal `zona/id` (por ejemplo `gas/nivel`), lista para un binding. `publicar()` aplica de inmediato (llama a `tick()`).

## bindings.js

```js
import { crearBindings } from './bindings.js';
const B = crearBindings({ raiz: scene, senales: S, tabla: await (await fetch('bindings.json')).json() });
// en el bucle, después de S.tick():
B.actualizar(dt);
B.estadoDe('Bomba_01');   // 'Low'|'High'|'Warning'|'Error'|'sin-dato'
B.faltantes;              // objetos de la tabla que no se encontraron (también sale un console.warn)
```

Cada entrada: `{ "senal", "objeto", "efecto", ...opciones }`. `objeto` es un nombre exacto o `Prefijo*`; para otro criterio pasa `buscar(sel, raiz) → objetos[]`.

| efecto | opciones | qué hace |
|---|---|---|
| `estado` | `mapa` (`{"0":"Low","2":"Warning","3":"Error"}`), `defecto` (`"Error"`), `parpadeo` | Color tipo ISA-101 en `color` y `emissive` (gris / azul / ámbar / rojo). Sin `mapa`: verdadero = High. Warning parpadea a 1 Hz y Error a 2 Hz. Dato viejo o sin dato = gris oscuro. Clona el material del objeto la primera vez. |
| `nivel` | `min`, `max`, `eje` (`y`) | Escala el eje de 0 a 1 según la señal. El pivote del objeto va en su base. |
| `girar` | `eje` (`y`), `velocidad` (rad/s por unidad, `2π`) | Gira proporcional a la señal. |
| `texto` | `formato` (`"{v} %"`), `dec` | Escribe en `obj.element` (CSS2DObject) o llama a `texto(obj, txt, b)`. |
| `visible` | `invertir` | Muestra u oculta. |

`suavizado` (segundos) en cualquier efecto numérico: filtro exponencial hacia el último valor, para que un dato que llega cada 40 s no salte. El escalado vive en el binding, nunca en el bus.

## banda.js

```js
import { crearLinea, dibujarLinea } from './banda.js';
const L = crearLinea({ senales: S });
L.banda('b1', { desde: [-3, .8, 0], hasta: [3, .8, 0], velocidad: .6, gap: .05, senalMarcha: 'motor.marcha', siguiente: 'b2' });
L.fuente('f1', { banda: 'b1', cadaSeg: 1.2, senal: 'pulso', largoPieza: .3 });  // por tiempo y/o por flanco de subida
L.sensor('s1', { banda: 'b1', en: 4, largo: .02, senal: 'b1.sensor' });          // escribe true/false al cambiar
L.tope('t1', { banda: 'b1', en: 4.5, senalAbierto: 'b1.tope' });                 // o t.abierto = true
L.sumidero('fin', { banda: 'b2', senal: 'salidas' });                            // cuenta y borra al final
const dib = dibujarLinea(THREE, L, { max: 500 }); scene.add(dib.mesh);
// por cuadro:  S.tick(); L.paso(dt); S.tick(); B.actualizar(dt); dib.actualizar();
L.piezas('b1'); L.conteo('fin');
```

Cada pieza es `{ s, largo }` sobre su banda (s = frente de la pieza). Por paso avanza `velocidad·dt` hasta la cola de la de adelante menos `gap`, un tope cerrado o el final (o la fila de la banda `siguiente`). Sin física ni colisiones 3D. Las bandas se declaran en el orden del flujo; curvas = varias bandas cortas encadenadas.

## Plan (fuera de esta versión)

- **Servidor → navegador por SSE.** El servidor del gemelo (Node sin dependencias) sondea su fuente y empuja por `text/event-stream`: evento `snapshot` al conectar y `delta` con lo que cambió, heartbeat cada 25 s. El navegador hace `S.set(nombre, valor, ts)` por cada entrada. `EventSource` reconecta solo.
- **MQTT.** Un cliente MQTT 3.1.1 mínimo en el servidor (CONNECT, SUBSCRIBE, PUBLISH QoS 0, PINGREQ sobre `net`/`tls`, sin dependencias), reconexión con backoff 0.5 s → 30 s, un tópico por señal. Alimenta el mismo SSE; el navegador no se entera del protocolo. OPC UA, Modbus o S7 van en un puente aparte (Node-RED, Telegraf o el gateway del cliente) que publique a MQTT.
- **Escritura hacia el PLC.** Solo lectura por defecto. Cuando haga falta: `POST /api/senales/escribir { nombre, valor }` con llave propia por encabezado, lista blanca de señales escribibles, guarda anti-eco (no reenviar lo que acaba de llegar del PLC) y bitácora con quién, qué y cuándo.
- **Re-aplicar nivel al reconectar**, un secuenciador simple para demos sin PLC y una paleta de estados común 2D/3D cuando un proyecto los pida.

## Licencia

MIT. Ver `LICENSE`.
