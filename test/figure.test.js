import test from 'node:test'
import assert from 'node:assert/strict'
import { compileExpr, parseChoices, parseFlow, parsePlot, sampleCurve, scopeOf, splitBlocks, ticks } from '../src/figure.js'

test('formulas: precedence, implied multiplication, functions, constants', () => {
  assert.equal(compileExpr('2x^2 - 3(x+1) + sin(pi/2)')({ x: 2 }), 0)
  assert.equal(compileExpr('-x^2')({ x: 3 }), -9)
  assert.equal(compileExpr('2^-1')({}), 0.5)
  assert.equal(compileExpr('(1+h)**2')({ h: 1 }), 4)
  assert.ok(Math.abs(compileExpr('e^x')({ x: 1 }) - Math.E) < 1e-12)
  assert.equal(compileExpr('sqrt(abs(x))')({ x: -9 }), 3)
})

test('formulas cannot reach anything but numbers', () => {
  assert.ok(Number.isNaN(compileExpr('constructor')({})))
  assert.ok(Number.isNaN(compileExpr('alert(1)')({})))
  assert.throws(() => compileExpr('x; y'))
  assert.throws(() => compileExpr('"a"'))
  assert.throws(() => compileExpr('(x'))
})

test('a reply splits into text and blocks; an unfinished block is pending', () => {
  const blocks = splitBlocks('看图：\n```plot\n{"a":1}\n```\n然后呢？\n```choices\n是\n不是')
  assert.deepEqual(blocks.map(b => b.type), ['md', 'plot', 'md', 'choices'])
  assert.equal(blocks[1].raw, '{"a":1}')
  assert.equal(blocks[1].pending, false)
  assert.equal(blocks[3].pending, true)
  // Ordinary code blocks stay in the Markdown.
  assert.deepEqual(splitBlocks('```js\nlet a\n```').map(b => b.type), ['md'])
})

test('plot: slider formulas, automatic y-range, bad input', () => {
  const plot = parsePlot(JSON.stringify({
    x: [-1, 3], curves: [{ fn: 'x^2', label: 'y = x²' }],
    points: [{ x: '1+h', y: '(1+h)^2', label: 'B' }],
    segments: [{ from: [1, 1], to: ['1+h', '(1+h)^2'], extend: true }],
    slider: { name: 'h', min: 0.1, max: 1.5, value: 1 },
  }))
  assert.equal(plot.points[0].y(scopeOf(plot, 0.5)), 2.25)
  assert.equal(plot.points[0].y(scopeOf(plot)), 4)
  assert.ok(plot.y[0] <= 0 && plot.y[1] >= 9)
  assert.throws(() => parsePlot('not json'))
  assert.throws(() => parsePlot('{"x":[0,1]}'))
  assert.throws(() => parsePlot('{"curves":[{"fn":"x"}],"slider":{"name":"x","min":0,"max":1}}'))
})

test('curves break at poles; ticks land on round numbers', () => {
  assert.equal(sampleCurve(compileExpr('1/x'), {}, [-2, 2], [-5, 5]).length, 2)
  assert.deepEqual(ticks(-1, 3), [-1, 0, 1, 2, 3])
  assert.deepEqual(ticks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1])
})

test('flow and choices', () => {
  assert.deepEqual(parseFlow('极限 -> 导数 → 费马引理\n- a => b'), [['极限', '导数', '费马引理'], ['a', 'b']])
  assert.deepEqual(parseChoices('A. 是\nB) 不是\n- 不知道'), ['是', '不是', '不知道'])
  assert.throws(() => parseChoices('只有一个'))
})
