import {spring} from './src/nav-motion.js'

// Only the indicator yields at the limits; the content and the safe inset stay fixed.
export function createSceneScrollbar(scroll, rail) {
  const thumb = rail.firstElementChild
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const listeners = []
  let drag = null, touch = null, target = 0, strain = 0, velocity = 0
  let frame = 0, previous = 0, releaseTimer = 0, disposed = false
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
  const railHeight = () => rail.getBoundingClientRect().height
  const baseHeight = () => Math.min(railHeight(), Math.max(28, railHeight() * scroll.clientHeight / scroll.scrollHeight))
  function listen(element, event, handler, options) {
    element.addEventListener(event, handler, options)
    listeners.push(() => element.removeEventListener(event, handler, options))
  }
  function paint() {
    const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    const progress = max ? clamp(scroll.scrollTop / max, 0, 1) : 0
    const base = baseHeight(), shrink = Math.min(Math.abs(strain), base * .4)
    const height = base - shrink
    const y = clamp(progress * (railHeight() - base) + (strain > 0 ? shrink : 0), 0, railHeight() - height)
    thumb.style.height = `${height}px`
    thumb.style.transform = `translateY(${y}px)`
    rail.setAttribute('aria-valuenow', String(Math.round(progress * 100)))
    rail.hidden = max <= 0
  }
  function tick(time) {
    frame = 0
    const dt = previous ? Math.min(.05, (time - previous) / 1000) : 1 / 60
    previous = time
    ;[strain, velocity] = reduced.matches ? [0, 0] : spring(strain, velocity, target, dt, 23, .87)
    const moving = Math.abs(strain - target) > .005 || Math.abs(velocity) > .03
    if (!moving) {strain = target; velocity = 0; previous = 0}
    paint()
    if (moving) wake()
  }
  function wake() {if (!disposed && !frame) frame = requestAnimationFrame(tick)}
  function relax() {clearTimeout(releaseTimer); target = 0; wake()}
  function stretch(amount, held = false) {
    clearTimeout(releaseTimer)
    const limit = Math.min(20, baseHeight() * .38)
    const requested = Math.sign(amount) * limit * Math.tanh(Math.abs(amount) / 90)
    // Retain outward strain through one gesture, including slower tail events.
    // A finger remaining down is not a release; wheel streams need a quiet window.
    target = reduced.matches ? 0 : Math.sign(requested) === Math.sign(target) ? Math.sign(requested) * Math.max(Math.abs(target), Math.abs(requested)) : requested
    wake()
    if (!held) releaseTimer = setTimeout(relax, 240)
  }
  function edgeInput(delta, held) {
    if (Math.abs(delta) < .001) return
    const max = scroll.scrollHeight - scroll.clientHeight
    const position = clamp(scroll.scrollTop, 0, max)
    const requested = position + delta
    const excess = requested - clamp(requested, 0, max)
    if ((position <= 1 && delta < 0) || (position >= max - 1 && delta > 0) || Math.abs(excess) > .001) {
      stretch((Math.abs(excess) > .001 ? excess : delta) + target * 5, held)
    } else relax()
  }
  function dragTo(event) {
    const rect = rail.getBoundingClientRect(), travel = rect.height - baseHeight()
    if (travel <= 0) return
    const position = event.clientY - rect.top - drag
    scroll.scrollTop = position / travel * (scroll.scrollHeight - scroll.clientHeight)
    stretch((position - clamp(position, 0, travel)) * 4, true)
  }
  listen(rail, 'pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return
    event.preventDefault()
    const rect = thumb.getBoundingClientRect()
    drag = event.clientY >= rect.top && event.clientY <= rect.bottom ? event.clientY - rect.top : rect.height / 2
    rail.setPointerCapture(event.pointerId)
    dragTo(event)
  })
  listen(rail, 'pointermove', event => {if (drag !== null && rail.hasPointerCapture(event.pointerId)) dragTo(event)})
  listen(rail, 'lostpointercapture', () => {drag = null; relax()})
  listen(rail, 'keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return
    event.preventDefault()
    const step = ['PageUp', 'PageDown', ' '].includes(event.key) ? scroll.clientHeight * .8 : 48
    scroll.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? scroll.scrollHeight : scroll.scrollTop + (['ArrowUp', 'PageUp'].includes(event.key) || event.key === ' ' && event.shiftKey ? -step : step)
    relax()
  })
  const viewport = scroll.parentElement
  listen(viewport, 'wheel', event => {
    if (rail.contains(event.target)) return
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1)
    edgeInput(delta, false)
    // The floating controls are outside the scroller, but still cover its content.
    if (!scroll.contains(event.target)) {event.preventDefault(); scroll.scrollTop += delta}
  }, {passive: false})
  listen(rail, 'wheel', event => {
    event.preventDefault()
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1)
    edgeInput(delta, false)
    scroll.scrollTop += delta
  }, {passive: false})
  listen(scroll, 'touchstart', event => {if (!touch) {const point = event.changedTouches[0]; touch = {id: point.identifier, y: point.clientY}}}, {passive: true})
  listen(scroll, 'touchmove', event => {
    const point = [...event.touches].find(point => point.identifier === touch?.id)
    if (!point) return
    edgeInput((touch.y - point.clientY) * 2.5, true)
    touch.y = point.clientY
  }, {passive: true})
  for (const event of ['touchend', 'touchcancel']) listen(scroll, event, () => {touch = null; relax()}, {passive: true})
  listen(scroll, 'scroll', paint, {passive: true})
  listen(reduced, 'change', relax)
  const resize = new ResizeObserver(paint)
  resize.observe(scroll)
  resize.observe(scroll.firstElementChild)
  paint()
  return {
    snapshot: () => ({strain, target, baseHeight: baseHeight(), framePending: Boolean(frame)}),
    destroy() {disposed = true; cancelAnimationFrame(frame); clearTimeout(releaseTimer); resize.disconnect(); listeners.forEach(remove => remove())},
  }
}
