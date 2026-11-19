/**
 * Tests del motor de titularidad (node:test).
 * Ejecutar: node --test src/lib/titularidad/evaluar.test.js
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { evaluar21803, evaluar21176 } = require('./evaluar')
const { ymKey, shiftYm } = require('./timeline')

function rangoLiq(desdeYm, hastaYm) {
  const out = []
  let cur = desdeYm
  while (cur <= hastaYm) {
    out.push(cur)
    cur = shiftYm(cur, 1)
  }
  return out
}

describe('Ley 21.803 transitorio', () => {
  it('contrata con 4 años continuos al 31-07-2025 → CUMPLE', () => {
    const data = {
      nombre: 'Docente Continuo',
      rut: '1-9',
      periodos: [
        {
          inicio: '2021-08-01',
          termino: '2025-07-31',
          calidad: 'CONTRATA DOCENTE',
          horas: 30,
          establecimiento: 'F-509',
        },
      ],
      liquidacionesYm: rangoLiq('2021-08', '2025-07'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'CUMPLE')
    assert.equal(r.horas, 30)
    assert.ok(r.metricas.mesesContinuosMax >= 48)
  })

  it('48 meses discontinuos pero corte en últimos 24 → NO CUMPLE', () => {
    // 48 meses en ventana, pero hueco reciente (2024-01 a 2024-06 sin contrato)
    const periodos = [
      { inicio: '2019-08-01', termino: '2023-12-31', calidad: 'CONTRATA', horas: 30 },
      { inicio: '2024-07-01', termino: '2025-07-31', calidad: 'CONTRATA', horas: 30 },
    ]
    const data = {
      periodos,
      liquidacionesYm: [
        ...rangoLiq('2019-08', '2023-12'),
        ...rangoLiq('2024-07', '2025-07'),
      ],
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'NO CUMPLE')
    assert.equal(r.metricas.cubreUltimos24Meses, false)
    assert.ok(r.motivos.some((m) => /24 meses|interrupción|Corte/i.test(m)))
  })

  it('47 meses → NO CUMPLE con motivo claro', () => {
    const data = {
      periodos: [
        {
          inicio: '2021-09-01',
          termino: '2025-07-31',
          calidad: 'CONTRATA',
          horas: 28,
        },
      ],
      liquidacionesYm: rangoLiq('2021-09', '2025-07'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'NO CUMPLE')
    assert.ok(r.metricas.mesesTotalesVentana <= 47 || r.metricas.mesesContinuosMax <= 47)
    assert.ok(r.motivos.some((m) => /mes/i.test(m)))
  })

  it('recontratación cada marzo con receso ene-feb → continuidad no se rompe', () => {
    const periodos = []
    for (let y = 2021; y <= 2024; y++) {
      periodos.push({
        inicio: `${y}-03-01`,
        termino: `${y}-12-31`,
        calidad: 'CONTRATA',
        horas: 44,
      })
    }
    periodos.push({
      inicio: '2025-03-01',
      termino: '2025-07-31',
      calidad: 'CONTRATA',
      horas: 44,
    })
    const data = {
      periodos,
      liquidacionesYm: [
        ...rangoLiq('2021-03', '2021-12'),
        ...rangoLiq('2022-03', '2022-12'),
        ...rangoLiq('2023-03', '2023-12'),
        ...rangoLiq('2024-03', '2024-12'),
        ...rangoLiq('2025-03', '2025-07'),
      ],
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.metricas.cubreUltimos24Meses, true)
    assert.ok(r.metricas.mesesContinuosMax >= 48 || r.estado === 'CUMPLE')
    assert.notEqual(r.estado, 'NO CUMPLE')
  })

  it('directivo a contrata que cumple plazos → CUMPLE con esDirectivo', () => {
    const data = {
      periodos: [
        {
          inicio: '2021-08-01',
          termino: '2025-07-31',
          calidad: 'CONTRATA',
          horas: 44,
          establecimiento: 'A-21',
        },
      ],
      liquidacionesYm: rangoLiq('2021-08', '2025-07'),
      cargo: 'JEFE U.T.P.',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'CUMPLE')
    assert.equal(r.esDirectivo, true)
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

describe('Inconsistencias', () => {
  it('decreto sin liquidaciones en algunos meses → REVISAR', () => {
    const data = {
      periodos: [
        {
          inicio: '2021-08-01',
          termino: '2025-07-31',
          calidad: 'CONTRATA',
          horas: 30,
        },
      ],
      // liquidaciones incompletas
      liquidacionesYm: rangoLiq('2021-08', '2023-12'),
      cargo: 'DOCENTE',
    }
    const r = evaluar21803(data, 'transitorio', '2025-07-31')
    assert.equal(r.estado, 'REVISAR')
    assert.ok(r.motivos.some((m) => /liquidaci[oó]n/i.test(m)))
  })
})

// silence unused
void ymKey
