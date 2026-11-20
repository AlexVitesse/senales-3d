// bindings.js — tabla declarativa (JSON) señal → objeto three.js. Un solo evaluador por cuadro: actualizar(dt).
// No importa three: solo toca propiedades de los objetos (material.color, scale, rotation, visible), así corre en Node sin GPU.
//
// Entrada de la tabla:
//   { "senal": "bomba", "objeto": "Bomba_01" | "Bomba_*", "efecto": "estado" | "nivel" | "girar" | "texto" | "visible", ...opciones }
// Opciones comunes:  suavizado (s, constante de tiempo para datos lentos; 0 = directo)
//   estado:  mapa { "0": "Low", "1": "High", "2": "Warning", "3": "Error" } (sin mapa: verdadero = High, falso = Low),
//            defecto (nivel para valores fuera del mapa, por defecto "Error"), parpadeo (true: Warning 1 Hz, Error 2 Hz)
//   nivel:   min, max (rango de la señal → 0–1), eje ("y"). El pivote del objeto debe estar en su base.
//   girar:   eje ("y"), velocidad (rad/s por unidad de señal; por defecto 2π: 1 = una vuelta por segundo)
//   texto:   formato ("{v} %"), dec (decimales). Objeto con .element (CSS2DObject) o callback texto(obj, txt, b)
//   visible: invertir (true = visible cuando la señal es falsa)

export const NIVELES = ['Low', 'High', 'Warning', 'Error', 'sin-dato'];
// tono tipo ISA-101: gris = normal/apagado, azul = activo, ámbar = aviso, rojo = alarma, gris oscuro = sin dato
export const COLORES = { Low: 0x8a9099, High: 0x3d8bfd, Warning: 0xf3b740, Error: 0xff5b4e, 'sin-dato': 0x4a4e54 };
export const PARPADEO_HZ = { Warning: 1, Error: 2 };
const EFECTOS = new Set(['estado', 'nivel', 'girar', 'texto', 'visible']);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const num = (v) => (typeof v === 'boolean' ? +v : Number(v));

/** Nivel de estado para un valor. Pura (se prueba sin escena). */
export function nivelDe(b, valor, calidad = 'ok') {
  if (calidad !== 'ok' || valor == null) return 'sin-dato'; // dato viejo: no se pinta como si estuviera corriendo
  if (b.mapa) return b.mapa[String(typeof valor === 'boolean' ? +valor : valor)] ?? b.defecto ?? 'Error';
  return valor ? 'High' : 'Low';
}

/**
 * @param {{ raiz: object, senales: object, tabla: object[], buscar?: (sel: string, raiz: object) => object[],
 *           texto?: (obj: object|null, txt: string, b: object) => void, colores?: object }} op
 *   raiz: escena o grupo donde se buscan los objetos por nombre ("Nombre" exacto o "Prefijo*").
 *   buscar: selector propio (por ejemplo por userData) en lugar del nombre.
 */
export function crearBindings({ raiz, senales, tabla, buscar, texto, colores = COLORES }) {
  const porNombre = (sel) => {
    const out = [], pre = sel.endsWith('*') ? sel.slice(0, -1) : null;
    raiz.traverse((o) => { if (pre != null ? o.name?.startsWith(pre) : o.name === sel) out.push(o); });
    return out;
  };
  const faltantes = [], lista = [];
  for (const def of tabla) {
    if (!def?.senal || !EFECTOS.has(def.efecto)) throw new Error(`binding inválido: ${JSON.stringify(def)} (efectos: ${[...EFECTOS].join(', ')})`);
    const objs = def.objeto ? (buscar ? buscar(def.objeto, raiz) : porNombre(def.objeto)) : [];
    if (def.objeto && !objs.length) { faltantes.push(def.objeto); continue; }
    lista.push({ ...def, objs, base: objs.map((o) => o.scale?.clone?.() ?? { ...o.scale }), mostrado: null, nivel: null, txt: null });
  }
  if (faltantes.length) console.warn('[bindings] objetos no encontrados:', faltantes.join(', '));

  // material propio por objeto: cambiar el color no debe pintar a otras piezas que comparten material
  const propio = (o) => { if (o.material && !o.userData?.__matPropio) { o.material = o.material.clone(); (o.userData ??= {}).__matPropio = true; } return o.material; };
  let t = 0;

  function pintaEstado(b, encendido) {
    const c = colores[b.nivel] ?? colores['sin-dato'];
    for (const o of b.objs) {
      const m = propio(o); if (!m) continue;
      m.color?.setHex(c);
      if (m.emissive) { m.emissive.setHex(c); m.emissiveIntensity = encendido ? 0.6 : 0; }
    }
  }

  return {
    lista, faltantes,
    /** Nivel actual de estado del primer binding 'estado' del objeto (por nombre). */
    estadoDe: (nombre) => lista.find((b) => b.efecto === 'estado' && b.objs.some((o) => o.name === nombre))?.nivel ?? null,

    actualizar(dt) {
      t += dt;
      for (const b of lista) {
        const e = senales.get(b.senal);
        if (b.efecto === 'estado') {
          const nv = nivelDe(b, e.valor, e.calidad), hz = b.parpadeo ? PARPADEO_HZ[nv] : 0;
          const encendido = !hz || Math.floor(t * hz * 2) % 2 === 0;
          if (nv !== b.nivel || encendido !== b.encendido) { b.nivel = nv; b.encendido = encendido; pintaEstado(b, encendido); }
          continue;
        }
        if (b.efecto === 'visible') { const v = !!e.valor !== !!b.invertir; for (const o of b.objs) o.visible = v; continue; }
        // numéricos: suavizado exponencial hacia el objetivo (para Ubidots ~40 s: suavizado ≈ 3–5 s)
        let obj = num(e.valor);
        if (!Number.isFinite(obj)) { if (b.efecto !== 'texto' || b.txt === '—') continue; obj = null; }
        if (obj != null) b.mostrado = b.mostrado == null || !b.suavizado ? obj : b.mostrado + (obj - b.mostrado) * (1 - Math.exp(-dt / b.suavizado));
        const v = b.mostrado, eje = b.eje || 'y';
        if (b.efecto === 'nivel') {
          const k = Math.max(1e-3, clamp01((v - (b.min ?? 0)) / ((b.max ?? 1) - (b.min ?? 0))));
          b.objs.forEach((o, i) => { o.scale[eje] = b.base[i][eje] * k; });
        } else if (b.efecto === 'girar') {
          for (const o of b.objs) o.rotation[eje] += v * (b.velocidad ?? 2 * Math.PI) * dt;
        } else { // texto
          const txt = obj == null ? '—' : (b.formato ?? '{v}').replace('{v}', v.toFixed(b.dec ?? 0));
          if (txt === b.txt) continue;
          b.txt = txt;
          if (!b.objs.length) texto?.(null, txt, b);
          for (const o of b.objs) { if (o.element) o.element.textContent = txt; else texto?.(o, txt, b); }
        }
      }
    },
  };
}
