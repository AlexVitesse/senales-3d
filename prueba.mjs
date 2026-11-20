// Autoprueba sin GPU ni dependencias: node prueba.mjs
import assert from 'node:assert/strict';
import { crearSenales, comoDatos } from './senales.js';
import { crearBindings, nivelDe, COLORES } from './bindings.js';
import { crearLinea } from './banda.js';

// ---- senales.js
{ let reloj = 1000; const S = crearSenales({ viejaMs: 100, ahora: () => reloj });
  const vistos = [], pre = [];
  S.on('bomba', (v, n) => vistos.push([n, v])); const fuera = S.on('pt/*', (v, n) => pre.push(n));
  assert.equal(S.get('bomba').calidad, 'sin-dato');
  S.set('bomba', 0); S.set('bomba', 1); // último gana, y nada se aplica hasta tick()
  assert.equal(S.valor('bomba'), undefined);
  assert.deepEqual(S.tick(), ['bomba']); assert.deepEqual(vistos, [['bomba', 1]]); assert.equal(S.version, 1);
  reloj = 1050; S.set('bomba', 1); assert.deepEqual(S.tick(), [], 'mismo valor: no avisa');
  assert.equal(S.version, 1); assert.equal(S.get('bomba').ts, 1050, 'pero refresca la edad');
  reloj = 1200; assert.equal(S.get('bomba').calidad, 'vieja'); assert.equal(S.get('bomba').edadMs, 150);
  S.lote({ 'pt/presion': 3000, 'pt/temp': { valor: -150, ts: 1190 }, ct: 2 }); S.tick();
  assert.deepEqual(pre, ['pt/presion', 'pt/temp']); assert.equal(S.get('pt/temp').ts, 1190); assert.equal(S.version, 4);
  fuera(); S.set('pt/presion', 1); S.tick(); assert.equal(pre.length, 2, 'desuscrito');
  S.on('*', () => { throw new Error('roto'); }); const ce = console.error; console.error = () => {};
  S.set('bomba', 0); S.tick(); assert.deepEqual(vistos.at(-1), ['bomba', 0], 'un suscriptor roto no corta a los demás');
  S.set('x', null); S.tick(); console.error = ce; assert.equal(S.calidad('x'), 'sin-dato'); }

// ---- comoDatos: reemplazo de ctx.datos (publicar/leer/on por zona)
{ const S = crearSenales(), datos = comoDatos(S), zonas = [], todas = [];
  datos.on('gas', (d) => zonas.push(d.kpis[0].v)); datos.on('*', (d, z) => todas.push(z));
  datos.publicar('gas', { kpis: [{ id: 'nivel', v: 62 }] });
  assert.deepEqual(zonas, [62]); assert.deepEqual(todas, ['gas'], "'*' recibe zonas, no KPIs sueltos");
  assert.equal(datos.leer('gas').kpis[0].v, 62); assert.ok(datos.leer('gas').t > 0);
  assert.equal(S.valor('gas/nivel'), 62, 'cada KPI queda como señal zona/id'); }

// ---- bindings.js con objetos falsos (sin three)
const color = () => ({ hex: 0, setHex(h) { this.hex = h; } });
const mat = () => ({ color: color(), emissive: color(), emissiveIntensity: 0, clone() { return mat(); } });
const obj = (name) => ({ name, material: mat(), scale: { x: 1, y: 2, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, visible: true, userData: {} });
{ const compartido = mat(), m1 = obj('motor'), m2 = obj('lamp_1'), m3 = obj('lamp_2'), tq = obj('tanque'), et = { ...obj('etq'), element: { textContent: '' } };
  m2.material = m3.material = compartido;
  const raiz = { traverse(f) { [m1, m2, m3, tq, et].forEach(f); } };
  let reloj = 0; const S = crearSenales({ viejaMs: 1e3, ahora: () => reloj });
  const B = crearBindings({ raiz, senales: S, tabla: [
    { senal: 'falla', objeto: 'lamp_*', efecto: 'estado', mapa: { 0: 'Low', 2: 'Warning', 3: 'Error' }, parpadeo: true },
    { senal: 'nivel', objeto: 'tanque', efecto: 'nivel', min: 0, max: 100 },
    { senal: 'rpm', objeto: 'motor', efecto: 'girar', eje: 'z', velocidad: 1, suavizado: 1 },
    { senal: 'nivel', objeto: 'etq', efecto: 'texto', formato: '{v} %' },
    { senal: 'ok', objeto: 'motor', efecto: 'visible', invertir: true },
    { senal: 'x', objeto: 'no-existe', efecto: 'visible' },
  ] });
  assert.deepEqual(B.faltantes, ['no-existe']);
  assert.throws(() => crearBindings({ raiz, senales: S, tabla: [{ senal: 'a', efecto: 'bailar' }] }), /inválido/);
  assert.equal(nivelDe({}, true), 'High'); assert.equal(nivelDe({}, 0), 'Low'); assert.equal(nivelDe({ mapa: { 1: 'High' } }, 7), 'Error');
  assert.equal(nivelDe({}, 1, 'vieja'), 'sin-dato');
  S.lote({ falla: 3, nivel: 25, rpm: 2, ok: true }); S.tick(); B.actualizar(0.1);
  assert.equal(B.estadoDe('lamp_1'), 'Error'); assert.equal(m2.material.color.hex, COLORES.Error);
  assert.notEqual(m2.material, m3.material, 'material clonado por objeto'); assert.equal(compartido.color.hex, 0, 'el compartido no se toca');
  assert.equal(m2.material.emissiveIntensity, 0.6); B.actualizar(0.25); assert.equal(m2.material.emissiveIntensity, 0, 'Error parpadea a 2 Hz');
  assert.equal(tq.scale.y, 0.5, 'nivel 25 % sobre escala base 2'); assert.equal(et.element.textContent, '25 %');
  assert.equal(m1.visible, false, 'invertir');
  assert.ok(Math.abs(m1.rotation.z - 0.7) < 1e-9, 'primer dato sin rampa: 2 rad/s · 0.35 s');
  S.set('rpm', 0); S.tick(); B.actualizar(1); assert.ok(m1.rotation.z > 0.7 + 0.5, 'suavizado: sigue girando mientras frena');
  S.set('falla', 0); S.tick(); B.actualizar(0.1); assert.equal(B.estadoDe('lamp_2'), 'Low');
  reloj = 5e3; B.actualizar(0.1); assert.equal(B.estadoDe('lamp_2'), 'sin-dato', 'dato viejo'); assert.equal(m3.material.color.hex, COLORES['sin-dato']); }

// ---- banda.js: fila sin encimarse, tope, sensor, sumidero y paso entre bandas
{ const S = crearSenales(), L = crearLinea({ senales: S });
  L.banda('a', { largo: 3, velocidad: 1, gap: 0.1, siguiente: 'b' }); L.banda('b', { largo: 2, velocidad: 1, gap: 0.1, senalMarcha: 'marcha' });
  L.fuente('f', { banda: 'a', cadaSeg: 0.2, largoPieza: 0.3 }); const t = L.tope('t', { banda: 'b', en: 1.5 });
  L.sensor('s', { banda: 'b', en: 1.4, largo: 0.1, senal: 'b.sensor' }); L.sumidero('fin', { banda: 'b', senal: 'b.conteo' });
  const sinEncimar = () => { for (const b of L.bandas.values()) b.piezas.forEach((p, i, a) => { if (i) assert.ok(a[i - 1].s - a[i - 1].largo - p.s >= b.gap - 1e-9, `encimadas en ${b.id}`); }); };
  S.set('marcha', 1); S.tick();
  for (let k = 0; k < 600; k++) { L.paso(1 / 60); S.tick(); sinEncimar(); } // 10 s con el tope cerrado
  const b = L.piezas('b');
  assert.equal(b[0].s, 1.5, 'la primera se detiene en el tope'); assert.equal(S.valor('b.sensor'), true);
  assert.ok(L.piezas('a').length > 3, 'la fila llega hasta la banda a'); assert.equal(L.conteo('fin'), 0);
  const cuantas = L.piezas('a').length + b.length;
  for (let k = 0; k < 120; k++) { L.paso(1 / 60); S.tick(); }
  assert.equal(L.piezas('a').length + L.piezas('b').length, cuantas, 'llena: la fuente espera');
  t.abierto = true; for (let k = 0; k < 300; k++) { L.paso(1 / 60); S.tick(); sinEncimar(); }
  assert.ok(L.conteo('fin') > 5, 'abre el tope: salen por el sumidero'); assert.equal(S.valor('b.conteo'), L.conteo('fin'));
  S.set('marcha', 0); S.tick(); const s0 = L.piezas('b').map((p) => p.s); L.paso(1); assert.deepEqual(L.piezas('b').map((p) => p.s), s0, 'sin marcha no avanza'); }

{ const S = crearSenales(), L = crearLinea({ senales: S }); L.banda('c', { desde: [0, 0, 0], hasta: [3, 0, 4], velocidad: 1 });
  assert.equal(L.bandas.get('c').largo, 5); L.fuente('f', { banda: 'c', senal: 'pulso' });
  L.paso(0.1); assert.equal(L.piezas('c').length, 0);
  S.set('pulso', 1); S.tick(); L.paso(0.1); L.paso(0.1); assert.equal(L.piezas('c').length, 1, 'un flanco = una pieza');
  for (let k = 0; k < 100; k++) L.paso(0.1); assert.equal(L.piezas('c')[0].s, 5, 'sin sumidero se queda al final'); }

console.log('prueba senales-3d: ok');
