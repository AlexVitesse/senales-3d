// banda.js — transportadoras 1D cinemáticas, sin física. Cada pieza vive en una banda con una distancia s (m, frente de la
// pieza medido desde el inicio). Por paso avanza velocidad·dt, pero nunca más allá de la cola de la pieza de adelante menos
// el hueco (gap), de un tope cerrado o del final: así se forma la fila detrás de una pieza detenida y se suelta sola.
// La lógica no importa three (se prueba en Node); dibujarLinea(THREE, linea) pinta las piezas con un InstancedMesh.

/**
 * @param {{ senales?: object }} [op] bus de senales.js: marcha, topes y fuentes leen señales; sensores y sumideros escriben.
 */
export function crearLinea({ senales } = {}) {
  const bandas = new Map(), fuentes = [], sensores = [], topes = [], sumideros = new Map();
  let sigId = 1;
  const lee = (n) => senales?.valor(n);
  const escribe = (n, v) => { if (n) senales?.set(n, v); };
  const banda = (id) => { const b = bandas.get(id); if (!b) throw new Error(`banda '${id}' no existe`); return b; };
  const cola = (b) => b.piezas[b.piezas.length - 1]; // la de más atrás

  const L = {
    bandas,
    /** desde/hasta: [x, y, z] para dibujar (largo sale de ahí si no se da). siguiente: id de la banda que alimenta. */
    banda(id, { largo, desde, hasta, velocidad = 0.5, gap = 0.05, senalMarcha, siguiente } = {}) {
      largo ??= desde && hasta ? Math.hypot(hasta[0] - desde[0], hasta[1] - desde[1], hasta[2] - desde[2]) : NaN;
      if (!(largo > 0)) throw new Error(`banda '${id}': falta largo o desde/hasta`);
      const b = { id, largo, desde, hasta, velocidad, gap, senalMarcha, siguiente, piezas: [] };
      bandas.set(id, b); return b; // velocidad es mutable: b.velocidad = 0.8
    },
    /** Genera piezas al inicio de la banda cada cadaSeg segundos y/o en cada flanco de subida de senal. Espera si no cabe. */
    fuente(id, { banda: bid, cadaSeg, senal, largoPieza = 0.3, alto, ancho } = {}) {
      const f = { id, banda: banda(bid), cadaSeg, senal, largoPieza, alto: alto ?? largoPieza * 0.8, ancho: ancho ?? largoPieza * 0.8, t: 0, previo: false, pendiente: 0, creadas: 0 };
      fuentes.push(f); return f;
    },
    /** Al final de la banda: la pieza que llega desaparece y se cuenta (senal = conteo). */
    sumidero(id, { banda: bid, senal } = {}) { const s = { id, banda: banda(bid), senal, conteo: 0 }; sumideros.set(bid, s); return s; },
    /** true mientras alguna pieza ocupe [en, en + largo]; escribe senal solo al cambiar. */
    sensor(id, { banda: bid, en, largo = 0, senal } = {}) { const s = { id, banda: banda(bid), en, largo, senal, ocupado: false }; sensores.push(s); return s; },
    /** Detiene en s = en las piezas que aún no lo pasan. abierto mutable o senalAbierto. */
    tope(id, { banda: bid, en, senalAbierto, abierto = false } = {}) { const t = { id, banda: banda(bid), en, senalAbierto, abierto }; topes.push(t); return t; },

    piezas: (bid) => banda(bid).piezas,
    conteo: (id) => [...sumideros.values()].find((s) => s.id === id)?.conteo ?? 0,

    paso(dt) {
      for (const t of topes) if (t.senalAbierto) t.abierto = !!lee(t.senalAbierto);
      // de la última banda a la primera: la de adelante ya se movió cuando la de atrás calcula su límite
      for (const b of [...bandas.values()].reverse()) {
        const v = b.senalMarcha == null || lee(b.senalMarcha) ? b.velocidad : 0, sig = b.siguiente != null ? banda(b.siguiente) : null;
        const sum = sumideros.get(b.id), cerrados = topes.filter((t) => t.banda === b && !t.abierto);
        b.piezas.forEach((p, i) => {
          let lim;
          if (i > 0) { const a = b.piezas[i - 1]; lim = a.s - a.largo - b.gap; }
          else if (sum) lim = Infinity;
          else if (sig) { const c = cola(sig); lim = b.largo + (c ? c.s - c.largo - sig.gap : Infinity); } // la fila sigue en la banda de adelante
          else lim = b.largo;
          for (const t of cerrados) if (p.s <= t.en + 1e-9) lim = Math.min(lim, t.en);
          p.s = Math.max(p.s, Math.min(p.s + v * dt, lim));
        });
        while (sum && b.piezas[0]?.s >= b.largo) { b.piezas.shift(); sum.conteo++; escribe(sum.senal, sum.conteo); }
        while (sig && b.piezas[0]?.s > b.largo) { const p = b.piezas.shift(); p.s -= b.largo; sig.piezas.push(p); }
      }
      for (const f of fuentes) {
        if (f.cadaSeg > 0 && (f.t += dt) >= f.cadaSeg) { f.t -= f.cadaSeg; f.pendiente = 1; }
        if (f.senal) { const on = !!lee(f.senal); if (on && !f.previo) f.pendiente = 1; f.previo = on; }
        const c = cola(f.banda);
        if (f.pendiente && (!c || c.s - c.largo - f.banda.gap >= f.largoPieza)) {
          f.banda.piezas.push({ id: sigId++, s: f.largoPieza, largo: f.largoPieza, alto: f.alto, ancho: f.ancho });
          f.pendiente = 0; f.creadas++;
        }
      }
      for (const s of sensores) {
        const o = s.banda.piezas.some((p) => p.s >= s.en && p.s - p.largo <= s.en + s.largo);
        if (o !== s.ocupado) { s.ocupado = o; escribe(s.senal, o); }
      }
    },
  };
  return L;
}

/**
 * Pinta todas las piezas de las bandas que tienen desde/hasta con un solo InstancedMesh (una caja por pieza).
 * @returns {{ mesh: object, actualizar: () => void }} llama actualizar() después de linea.paso(dt).
 */
export function dibujarLinea(THREE, linea, { max = 500, geometria, material } = {}) {
  const geo = geometria ?? new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // origen en la base: se apoya sobre la banda
  const mesh = new THREE.InstancedMesh(geo, material ?? new THREE.MeshStandardMaterial({ color: 0xc8a165, roughness: 0.8 }), max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), esc = new THREE.Vector3(), a = new THREE.Vector3(), dir = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  return {
    mesh,
    actualizar() {
      let n = 0;
      for (const b of linea.bandas.values()) {
        if (!b.desde || !b.hasta) continue;
        a.fromArray(b.desde); dir.fromArray(b.hasta).sub(a).normalize(); q.setFromUnitVectors(X, dir);
        for (const p of b.piezas) {
          if (n >= max) break; // ponytail: piezas de más no se dibujan; sube max si la línea es larga
          pos.copy(dir).multiplyScalar(p.s - p.largo / 2).add(a);
          m.compose(pos, q, esc.set(p.largo, p.alto, p.ancho)); mesh.setMatrixAt(n++, m);
        }
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
