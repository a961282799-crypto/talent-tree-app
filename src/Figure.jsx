/**
 * What a reply can show besides text: function graphs (with an optional
 * slider), step chains and tappable choices. Parsing lives in figure.js.
 */
import { useMemo, useState } from 'react'
import { parseChoices, parseFlow, parsePlot, sampleCurve, scopeOf, ticks } from './figure.js'
import { Rich } from './tree.js'
import { t } from './i18n.js'

const W = 340
const PAD = { l: 34, r: 12, t: 12, b: 24 }
const fmt = v => String(Number(v.toFixed(6)))
const fmtSlider = (v, step) => v.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2)

/** Shown while a block is still streaming in, or when it cannot be drawn. */
function Raw({ raw }) {
  return <pre className="fig-raw"><code>{raw}</code></pre>
}

export function Pending() {
  return <div className="fig fig-pending"><span className="typing"><i /><i /><i /></span>{t('fig.drawing')}</div>
}

export function Plot({ raw }) {
  const plot = useMemo(() => {
    try { return parsePlot(raw) } catch { return null }
  }, [raw])
  const [value, setValue] = useState(plot?.slider?.value)
  const id = useMemo(() => `fig${Math.random().toString(36).slice(2, 8)}`, [])
  if (!plot) return <Raw raw={raw} />

  const [x0, x1] = plot.x
  const [y0, y1] = plot.y
  const innerW = W - PAD.l - PAD.r
  // Equal scales keep circles round and slopes true; otherwise a comfortable 3:2 box.
  const innerH = plot.equal ? Math.max(120, Math.min(360, (innerW * (y1 - y0)) / (x1 - x0))) : 190
  const H = innerH + PAD.t + PAD.b
  const sx = x => PAD.l + ((x - x0) / (x1 - x0)) * innerW
  const sy = y => PAD.t + innerH - ((y - y0) / (y1 - y0)) * innerH
  const scope = scopeOf(plot, value)

  const xs = ticks(x0, x1, 6)
  const ys = ticks(y0, y1, 5)
  const path = line => line.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join('')
  const inBox = (x, y) => Number.isFinite(x) && Number.isFinite(y)
  const legend = plot.curves.filter(c => c.label)

  return (
    <figure className="fig fig-plot">
      {plot.title && <figcaption>{plot.title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={plot.title || t('fig.plot')}>
        <defs><clipPath id={id}><rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} /></clipPath></defs>
        <rect className="fig-box" x={PAD.l} y={PAD.t} width={innerW} height={innerH} rx="6" />
        {xs.map(v => <line key={`x${v}`} className={v === 0 ? 'fig-axis' : 'fig-grid'} x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={PAD.t + innerH} />)}
        {ys.map(v => <line key={`y${v}`} className={v === 0 ? 'fig-axis' : 'fig-grid'} y1={sy(v)} y2={sy(v)} x1={PAD.l} x2={PAD.l + innerW} />)}
        {xs.map(v => <text key={`tx${v}`} className="fig-tick" x={sx(v)} y={H - 7} textAnchor="middle">{fmt(v)}</text>)}
        {ys.map(v => <text key={`ty${v}`} className="fig-tick" x={PAD.l - 6} y={sy(v) + 3.5} textAnchor="end">{fmt(v)}</text>)}
        <g clipPath={`url(#${id})`}>
          {plot.areas.map((a, i) => {
            const from = a.from(scope)
            const to = a.to(scope)
            if (!inBox(from, to) || to <= from) return null
            const lines = sampleCurve(a.fn, scope, [from, to], [y0, y1], 80)
            if (!lines.length) return null
            const pts = lines.flat()
            return <path key={`a${i}`} className={`fig-area fig-c-${a.color}`} d={`M${sx(pts[0][0]).toFixed(1)} ${sy(0).toFixed(1)}${pts.map(([x, y]) => `L${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join('')}L${sx(pts[pts.length - 1][0]).toFixed(1)} ${sy(0).toFixed(1)}Z`} />
          })}
          {plot.curves.map((c, i) => sampleCurve(c.fn, scope, plot.x, plot.y).map((line, j) => (
            <path key={`c${i}-${j}`} className={`fig-curve fig-c-${c.color}${c.dash ? ' fig-dash' : ''}`} d={path(line)} />
          )))}
          {plot.segments.map((s, i) => {
            let [ax, ay, bx, by] = [sx(s.x1(scope)), sy(s.y1(scope)), sx(s.x2(scope)), sy(s.y2(scope))]
            if (![ax, ay, bx, by].every(Number.isFinite)) return null
            const [mx, my] = [(ax + bx) / 2, (ay + by) / 2]
            if (s.extend) {
              const len = Math.hypot(bx - ax, by - ay)
              if (len < 1e-6) return null
              const [ux, uy] = [((bx - ax) / len) * 1000, ((by - ay) / len) * 1000]
              ;[ax, ay, bx, by] = [ax - ux, ay - uy, bx + ux, by + uy]
            }
            return (
              <g key={`s${i}`} className={`fig-c-${s.color}`}>
                <line className={`fig-seg${s.dash ? ' fig-dash' : ''}`} x1={ax} y1={ay} x2={bx} y2={by} />
                {s.label && <text className="fig-label" x={mx + 6} y={my - 6}>{s.label}</text>}
              </g>
            )
          })}
        </g>
        {plot.points.map((p, i) => {
          const [px, py] = [sx(p.x(scope)), sy(p.y(scope))]
          if (!inBox(px, py) || px < PAD.l - 1 || px > W - PAD.r + 1 || py < PAD.t - 1 || py > PAD.t + innerH + 1) return null
          const right = px < W - 70
          return (
            <g key={`p${i}`} className={`fig-c-${p.color}`}>
              <circle className="fig-point" cx={px} cy={py} r="4.5" />
              {p.label && <text className="fig-label" x={px + (right ? 8 : -8)} y={py < PAD.t + 18 ? py + 16 : py - 8} textAnchor={right ? 'start' : 'end'}>{p.label}</text>}
            </g>
          )
        })}
      </svg>
      {legend.length > 0 && (
        <div className="fig-legend">
          {legend.map((c, i) => <span key={i} className={`fig-c-${c.color}`}><i className={c.dash ? 'fig-dash' : ''} />{c.label}</span>)}
        </div>
      )}
      {plot.slider && (
        <label className="fig-slider">
          <span>{plot.slider.label} = <b>{fmtSlider(value, plot.slider.step)}</b></span>
          <input type="range" min={plot.slider.min} max={plot.slider.max} step={plot.slider.step} value={value} onChange={e => setValue(Number(e.target.value))} aria-label={plot.slider.label} />
          <em>{t('fig.drag')}</em>
        </label>
      )}
    </figure>
  )
}

export function Flow({ raw }) {
  const rows = useMemo(() => {
    try { return parseFlow(raw) } catch { return null }
  }, [raw])
  if (!rows) return <Raw raw={raw} />
  return (
    <div className="fig fig-flow tt-scope">
      {rows.map((row, i) => (
        <ol key={i} className="flow-row">
          {row.map((step, j) => <li key={j}><span className="flow-step"><Rich text={step} /></span></li>)}
        </ol>
      ))}
    </div>
  )
}

/** Tappable answers. Without `onPick` (an older message) they show as a plain list. */
export function Choices({ raw, onPick }) {
  const options = useMemo(() => {
    try { return parseChoices(raw) } catch { return null }
  }, [raw])
  if (!options) return <Raw raw={raw} />
  return (
    <div className={`choices tt-scope${onPick ? '' : ' choices-done'}`} role="group" aria-label={t('fig.choices')}>
      {options.map((option, i) => (
        <button key={i} type="button" className="choice" disabled={!onPick} onClick={() => onPick?.(option)}>
          <b>{String.fromCharCode(65 + i)}</b>
          <span><Rich text={option} /></span>
        </button>
      ))}
    </div>
  )
}
