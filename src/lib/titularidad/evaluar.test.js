/**
 * Tests del motor de titularidad (node:test).
 * Ejecutar: node --test src/lib/titularidad/evaluar.test.js
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { evaluar21803, evaluar21176 } = require('./evaluar')
const {
  ymKey,
  shiftYm,
  primerDiaHabilMarzo,
  horasVigentesEnCorte,
  cumpleReceso41Bis,
} = require('./timeline')

function rangoLiq(desdeYm, hastaYm) {
  const out = []
  let cur = desdeYm
  while (cur <= hastaYm) {
    out.push(cur)
    cur = shiftYm(cur, 1)
  }
  return out
}

describe('helpers CGR', () => {
  it('primer día hábil marzo 2026 = 02-03-2026', () => {
    assert.equal(primerDiaHabilMarzo(2026), '2026-03-02')
  })

  it('horas al corte suman actos distintos y no duplican el mismo', () => {
    const r = horasVigentesEnCorte(
      [
        { inicio: '2024-03-01', termino: '2026-02-28', calidad: 'CONTRATA', horas: 20, establecimiento: 'F-509', n_decreto: '100' },
        { inicio: '2024-03-01', termino: '2026-02-28', calidad: 'CONTRATA', horas: 20, establecimiento: 'F-509', n_decreto: '100' }, // dup
        { inicio: '2025-03-01', termino: '2026-02-28', calidad: 'CONTRATA', horas: 24, establecimiento: 'F-487', n_decreto: '200' },
        { inicio: '2025-03-01', termino: '2026-02-28', calidad: 'REEMPLAZANTE DOC.', horas: 10, establecimiento: 'F-509', n_decreto: '300' },
      ],
      '2025-07-31',
      (cal) => ['contrata', 'extension', 'otro', 'reemplazo'].includes(cal),
      { topeHoras: null }
    )
    assert.equal(r.horas, 44) // 20+24; reemplazo aparte
    assert.equal(r.horasReemplazo, 10)
    assert.equal(r.actos.length, 2)
  })

  it('sin tope: suma > 44 queda visible', () => {
    const r = horasVigentesEnCorte(
      [
        { inicio: '2024-03-01', termino: '2026-02-28', calidad: 'CONTRATA', horas: 30, establecimiento: 'A', n_decreto: '1' },
        { inicio: '2024-03-01', termino: '2026-02-28', calidad: 'CONTRATA', horas: 30, establecimiento: 'B', n_decreto: '2' },
      ],
      '2025-07-31',
      (cal) => cal === 'contrata',
      { topeHoras: null }
    )
    assert.equal(r.horas, 60)
  })

  it('receso 41 bis exige vigente 1-dic y >6 meses', () => {
    const ok = [
      { inicio: '2023-03-01', termino: '2023-12-31', calidad: 'CONTRATA', horas: 30 },
    ]
    assert.equal(cumpleReceso41Bis(ok, 2024, '2024-03-01'), true)
    const corto = [
      { inicio: '2023-10-01', termino: '2023-12-31', calidad: 'CONTRATA', horas: 30 },
    ]
    assert.equal(cumpleReceso41Bis(corto, 2024, '2024-03-01'), false)
  })
})

describe('Ley 21.803 transitorio', () => {
  it('contrata con 4 años continuos al 31-07-2025 → CUMPLE', () => {
    const data = {
      nombre: 'Docente Continuo',
      rut: '1-9',
      periodos: [
        {
          inicio: '2021-08-01',
          termino: '2026-12-31',
          calidad: 'CONTRATA DOCENTE',
          horas: 30,
          establecimiento: 'F-509',
        },
      ],
      liquidacionesYm: rangoLiq('2021-08', '2026-03'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'CUMPLE')
    assert.equal(r.horas, 30)
    assert.ok(r.metricas.mesesContinuosMax >= 48)
  })

  it('48 meses discontinuos pero corte en últimos 24 → NO CUMPLE', () => {
    const periodos = [
      { inicio: '2019-08-01', termino: '2023-12-31', calidad: 'CONTRATA', horas: 30 },
      { inicio: '2024-07-01', termino: '2026-12-31', calidad: 'CONTRATA', horas: 30 },
    ]
    const data = {
      periodos,
      liquidacionesYm: [
        ...rangoLiq('2019-08', '2023-12'),
        ...rangoLiq('2024-07', '2026-03'),
      ],
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'NO CUMPLE')
    assert.equal(r.metricas.cubreUltimos24Meses, false)
    assert.ok(r.motivos.some((m) => /2 años|interrupción|Hueco|continuidad/i.test(m)))
  })

  it('47 meses → NO CUMPLE con motivo claro', () => {
    const data = {
      periodos: [
        {
          inicio: '2021-09-01',
          termino: '2026-12-31',
          calidad: 'CONTRATA',
          horas: 28,
        },
      ],
      liquidacionesYm: rangoLiq('2021-09', '2026-03'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'NO CUMPLE')
    assert.ok(r.metricas.mesesTotalesVentana <= 47 || r.metricas.mesesContinuosMax <= 47)
    assert.ok(r.motivos.some((m) => /mes/i.test(m)))
  })

  it('recontratación cada marzo (día 1) con receso ene-feb → continuidad no se rompe (41 bis)', () => {
    const periodos = []
    for (let y = 2021; y <= 2025; y++) {
      periodos.push({
        inicio: `${y}-03-01`,
        termino: y === 2025 ? '2026-12-31' : `${y}-12-31`,
        calidad: 'CONTRATA',
        horas: 44,
      })
    }
    const data = {
      periodos,
      liquidacionesYm: [
        ...rangoLiq('2021-03', '2021-12'),
        ...rangoLiq('2022-03', '2022-12'),
        ...rangoLiq('2023-03', '2023-12'),
        ...rangoLiq('2024-03', '2024-12'),
        ...rangoLiq('2025-03', '2026-03'),
      ],
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.metricas.cubreUltimos24Meses, true)
    assert.notEqual(r.estado, 'NO CUMPLE')
  })

  it('receso sin 6 meses de servicio → NO CUMPLE', () => {
    const data = {
      periodos: [
        { inicio: '2023-10-01', termino: '2023-12-31', calidad: 'CONTRATA', horas: 30 },
        { inicio: '2024-03-01', termino: '2025-02-28', calidad: 'CONTRATA', horas: 30 },
        { inicio: '2025-03-01', termino: '2026-12-31', calidad: 'CONTRATA', horas: 30 },
      ],
      liquidacionesYm: rangoLiq('2023-10', '2026-03'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.metricas.cubreUltimos24Meses, false)
    assert.equal(r.estado, 'NO CUMPLE')
  })

  it('contrato 2024 desde el 5 de marzo → NO CUMPLE (CGR / OF196034)', () => {
    const data = {
      nombre: 'Cartes tipo',
      periodos: [
        { inicio: '2021-03-01', termino: '2021-12-31', calidad: 'CONTRATA', horas: 30 },
        { inicio: '2022-03-01', termino: '2022-12-31', calidad: 'CONTRATA', horas: 30 },
        { inicio: '2023-03-01', termino: '2023-12-31', calidad: 'CONTRATA', horas: 30 },
        { inicio: '2024-03-05', termino: '2024-12-31', calidad: 'CONTRATA', horas: 30 },
        { inicio: '2025-03-01', termino: '2026-12-31', calidad: 'CONTRATA', horas: 30 },
      ],
      liquidacionesYm: rangoLiq('2021-03', '2026-03'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'NO CUMPLE')
    assert.equal(r.metricas.cubreUltimos24Meses, false)
    assert.ok(r.motivos.some((m) => /continuidad|Hueco|marzo|2 años/i.test(m)))
  })

  it('periodo abierto del consolidado no tapa hueco de marzo (Cartes)', () => {
    const data = {
      nombre: 'Cartes abierto',
      periodos: [
        { inicio: '2022-05-02', termino: null, calidad: 'CONTRATA', horas: null, fuente: 'consolidado_antiguo' },
        { inicio: '2023-03-01', termino: '2024-02-29', calidad: 'CONTRATA', horas: 34 },
        { inicio: '2024-03-05', termino: '2025-02-28', calidad: 'CONTRATA', horas: 37 },
        { inicio: '2024-03-05', termino: '2027-02-28', calidad: 'CONTRATA DOCENTE', horas: null },
        { inicio: '2025-03-01', termino: '2026-02-28', calidad: 'CONTRATA', horas: 37 },
      ],
      liquidacionesYm: rangoLiq('2022-05', '2026-03'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'NO CUMPLE')
    assert.equal(r.metricas.cubreUltimos24Meses, false)
  })

  it('recontratación 2025 desde el 10 de marzo → NO CUMPLE (Amigo / hábil=03)', () => {
    const data = {
      nombre: 'Amigo tipo',
      periodos: [
        { inicio: '2021-03-01', termino: '2022-02-28', calidad: 'CONTRATA', horas: 30 },
        { inicio: '2022-03-01', termino: '2023-02-28', calidad: 'CONTRATA', horas: 30 },
        { inicio: '2023-03-01', termino: '2024-02-29', calidad: 'CONTRATA', horas: 30 },
        { inicio: '2024-03-01', termino: '2025-02-28', calidad: 'CONTRATA', horas: 30 },
        { inicio: '2025-03-10', termino: '2026-02-28', calidad: 'CONTRATA', horas: 43 },
        { inicio: '2026-03-02', termino: '2027-02-28', calidad: 'CONTRATA', horas: 31 },
      ],
      liquidacionesYm: rangoLiq('2021-03', '2026-03'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'NO CUMPLE')
    assert.equal(r.metricas.cubreUltimos24Meses, false)
  })

  it('inicio 03-03-2023 (hábil era 01) en vía continua → NO CUMPLE', () => {
    const data = {
      nombre: 'Almeyda tipo',
      periodos: [
        { inicio: '2021-03-01', termino: '2022-12-31', calidad: 'CONTRATA', horas: 44 },
        { inicio: '2023-03-03', termino: '2026-02-28', calidad: 'CONTRATA', horas: 44 },
        { inicio: '2026-03-02', termino: '2027-02-28', calidad: 'CONTRATA', horas: 44 },
      ],
      liquidacionesYm: rangoLiq('2021-03', '2026-03'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'NO CUMPLE')
    assert.ok(
      r.motivos.some((m) => /continuidad|Hueco|48|Inicio de cadena/i.test(m))
    )
  })

  it('horas al corte = suma de actos concurrentes (distintos establecimientos)', () => {
    const data = {
      periodos: [
        { inicio: '2021-04-01', termino: '2026-02-28', calidad: 'CONTRATA', horas: 20, establecimiento: 'F-509', n_decreto: '10' },
        { inicio: '2023-03-01', termino: '2026-02-28', calidad: 'CONTRATA', horas: 24, establecimiento: 'F-487', n_decreto: '20' },
      ],
      liquidacionesYm: rangoLiq('2021-04', '2026-03'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.horas, 44)
    assert.ok(String(r.metricas.actosDetalle || '').includes('20'))
  })

  it('sin antecedentes → REVISAR (no NO CUMPLE)', () => {
    const r = evaluar21803(
      { nombre: 'Sin ficha', rut: '1-9', periodos: [], liquidacionesYm: [], sinAntecedentesSigex: true },
      'transitorio',
      '2025-07-31'
    )
    assert.equal(r.estado, 'REVISAR')
    assert.ok(r.motivos.some((m) => /Sin antecedentes/i.test(m)))
  })

  it('periodos externos sin ficha SIGEX se evalúan (Almonacid: inicio marzo tardío → NO CUMPLE)', () => {
    const r = evaluar21803(
      {
        nombre: 'Almonacid',
        rut: '1-9',
        sinAntecedentesSigex: true,
        periodos: [
          { inicio: '2024-04-01', termino: '2026-02-28', calidad: 'CONTRATA', horas: 30 },
          { inicio: '2026-03-09', termino: '2026-03-24', calidad: 'REEMPLAZANTE DOC.', horas: 29 },
        ],
        liquidacionesYm: [],
      },
      'transitorio',
      '2025-07-31'
    )
    assert.equal(r.estado, 'NO CUMPLE')
    assert.equal(r.metricas.vigenteMarzoOk, false)
  })

  it('sin contrato al 02-03-2026 → NO CUMPLE', () => {
    const data = {
      periodos: [
        { inicio: '2021-08-01', termino: '2026-02-28', calidad: 'CONTRATA', horas: 30 },
      ],
      liquidacionesYm: rangoLiq('2021-08', '2026-02'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'NO CUMPLE')
    assert.ok(r.motivos.some((m) => /2026-03-02|marzo/i.test(m)))
  })

  it('contrato que empieza 12-03-2026 no marca vigente al 02-03-2026', () => {
    const data = {
      periodos: [
        { inicio: '2021-08-01', termino: '2025-12-30', calidad: 'CONTRATA', horas: 32 },
        { inicio: '2026-03-12', termino: '2027-02-28', calidad: 'CONTRATA', horas: 26 },
      ],
      liquidacionesYm: rangoLiq('2021-08', '2025-12'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.metricas.vigenteMarzoOk, false)
  })

  it('directivo a contrata que cumple plazos → CUMPLE con esDirectivo', () => {
    const data = {
      periodos: [
        {
          inicio: '2021-08-01',
          termino: '2026-12-31',
          calidad: 'CONTRATA',
          horas: 44,
          establecimiento: 'A-21',
        },
      ],
      liquidacionesYm: rangoLiq('2021-08', '2026-03'),
      cargo: 'JEFE U.T.P.',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'CUMPLE')
    assert.equal(r.esDirectivo, true)
  })

  it('decreto sin liquidación en algunos meses → CUMPLE o NO CUMPLE (no REVISAR)', () => {
    const data = {
      periodos: [
        {
          inicio: '2021-08-01',
          termino: '2026-12-31',
          calidad: 'CONTRATA',
          horas: 30,
        },
      ],
      liquidacionesYm: rangoLiq('2021-08', '2023-12'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.notEqual(r.estado, 'REVISAR')
    assert.equal(r.estado, 'CUMPLE')
  })
})

describe('Ley 21.176', () => {
  it('titular 30h + 4 años extensión → CUMPLE (inciso 2°)', () => {
    const data = {
      tipoContratoFicha: 'TITULARES',
      horasTitularesFicha: 30,
      horasYaTitularizadas: false,
      periodos: [
        {
          inicio: '2018-01-01',
          termino: '2026-12-31',
          calidad: 'TITULAR',
          horas: 30,
        },
        {
          inicio: '2021-08-01',
          termino: '2025-12-31',
          calidad: 'EXTENSION HRS. C.T.',
          horas: 14,
        },
      ],
      liquidacionesYm: rangoLiq('2021-08', '2025-12'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21176(data, 'inciso2', '2025-12-31')
    assert.equal(r.estado, 'CUMPLE')
    assert.equal(r.horas, 14)
    assert.ok(r.metricas.horasTitulares >= 30)
  })

  it('titular 28h + 6 años extensión → NO CUMPLE (<30 h titulares)', () => {
    const data = {
      tipoContratoFicha: 'TITULARES',
      horasTitularesFicha: 28,
      horasYaTitularizadas: false,
      periodos: [
        {
          inicio: '2015-01-01',
          termino: '2026-12-31',
          calidad: 'TITULAR',
          horas: 28,
        },
        {
          inicio: '2019-01-01',
          termino: '2025-12-31',
          calidad: 'EXTENSION HRS. C.T.',
          horas: 10,
        },
      ],
      liquidacionesYm: rangoLiq('2019-01', '2025-12'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21176(data, 'inciso2', '2025-12-31')
    assert.equal(r.estado, 'NO CUMPLE')
    assert.ok(r.motivos.some((m) => /30|titulares/i.test(m)))
  })
})

void ymKey
