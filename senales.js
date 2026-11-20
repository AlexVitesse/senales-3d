// senales.js — bus de señales para gemelos three.js: nombre → { valor, ts, calidad }.
// Lo que llega por red se guarda en "pendientes" y se aplica todo junto con tick() (una vez por cuadro):
// así la escena nunca ve un estado a medias. Solo se avisa a los suscriptores si el valor cambió.
// Sin dependencias; funciona igual en el navegador y en Node (para las pruebas).

/**
 * @param {{ viejaMs?: number, ahora?: () => number }} [op]
 *   viejaMs: edad a partir de la cual un dato pasa a calidad 'vieja' (por defecto 120 s: Ubidots publica cada ~40 s).
 *   ahora: reloj inyectable (pruebas).
 */
export function crearSenales({ viejaMs = 120e3, ahora = () => Date.now() } = {}) {
  const actual = new Map(), pendientes = new Map(), subs = [];
  let version = 0;

  const coincide = (patron, nombre) => patron === nombre || (patron.endsWith('*') && nombre.startsWith(patron.slice(0, -1)));
  const calidadDe = (e) => (e == null || e.valor == null ? 'sin-dato' : ahora() - e.ts > viejaMs ? 'vieja' : 'ok');

  const S = {
    get version() { return version; },

    /** Encola un valor; se aplica en el próximo tick(). Último gana. ts en epoch ms (por defecto, ahora). */
    set(nombre, valor, ts = ahora()) { pendientes.set(nombre, { valor, ts }); },

    /** Varios a la vez: { nombre: valor | { valor, ts } }. */
    lote(cambios, ts = ahora()) {
      for (const [n, x] of Object.entries(cambios)) {
        if (x && typeof x === 'object' && 'valor' in x) S.set(n, x.valor, x.ts ?? ts); else S.set(n, x, ts);
      }
    },

    /** Aplica los pendientes y avisa a los suscriptores de los que cambiaron. Devuelve los nombres cambiados. */
    tick() {
      if (!pendientes.size) return [];
      const cambiados = [];
      for (const [n, x] of pendientes) {
        const e = actual.get(n);
        if (e && Object.is(e.valor, x.valor)) { e.ts = Math.max(e.ts, x.ts); continue; } // mismo valor: solo refresca la edad
        actual.set(n, x); cambiados.push(n);
      }
      pendientes.clear();
      version += cambiados.length;
      // ponytail: recorre todos los suscriptores por cambio (O(subs × cambios)); un índice por prefijo si llegan a miles
      for (const n of cambiados) {
        const e = S.get(n);
        for (const s of subs.slice()) if (coincide(s.patron, n)) {
          try { s.cb(e.valor, n, e); } catch (err) { console.error(`senales '${n}':`, err); } // un suscriptor roto no corta a los demás
        }
      }
      return cambiados;
    },

    /** { valor, ts, calidad: 'ok'|'vieja'|'sin-dato', edadMs } (siempre devuelve objeto). */
    get(nombre) {
      const e = actual.get(nombre);
      return e ? { valor: e.valor, ts: e.ts, calidad: calidadDe(e), edadMs: ahora() - e.ts } : { valor: undefined, ts: null, calidad: 'sin-dato', edadMs: Infinity };
    },
    valor: (nombre, def) => actual.get(nombre)?.valor ?? def,
    calidad: (nombre) => calidadDe(actual.get(nombre)),
    nombres: () => [...actual.keys()],

    /** Suscribe a un nombre exacto, a un prefijo ('pt/*') o a todo ('*'). cb(valor, nombre, entrada). Devuelve desuscribir. */
    on(patron, cb) {
      const s = { patron, cb }; subs.push(s);
      return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
    },
  };
  return S;
}

/**
 * Adaptador al bus `ctx.datos` de los gemelos existentes: publicar(zona, objeto) / leer(zona) / on(zona | '*', fn).
 * Cada publicación guarda la zona como señal (valor = el objeto) y cada KPI como señal 'zona/id' (valor = kpi.v),
 * así un binding puede apuntar a 'clima/ocup' sin tocar la solución que publica. publicar() aplica de inmediato (hace tick).
 */
export function comoDatos(S) {
  return {
    publicar(zona, d) {
      S.set(zona, { ...d, t: Date.now() });
      for (const k of d?.kpis || []) if (k?.id != null) S.set(`${zona}/${k.id}`, k.v);
      S.tick();
    },
    leer: (zona) => S.valor(zona),
    on(zona, fn) { return S.on(zona, (v, n) => { if (zona !== '*' || !n.includes('/')) fn(v, n); }); }, // '*' = solo zonas, no KPIs sueltos
  };
}
