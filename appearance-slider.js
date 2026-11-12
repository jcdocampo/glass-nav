import {createRenderer, OPTICS} from './src/nav-optics.js'
import {opticalDpr} from './src/background.js'
import {spring} from './src/nav-motion.js'

export function createAppearanceSlider(input, thumb, onChange) {
  const width = 42
  const height = 30
  const pad = OPTICS.padding
  const dpr = opticalDpr()
  const canvasWidth = width + pad * 2
  const canvasHeight = height + pad * 2
  const makeCanvas = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(canvasWidth * dpr)
    canvas.height = Math.ceil(canvasHeight * dpr)
    return canvas
  }
  const scene = {width, height, pad, dpr, canvasWidth, canvasHeight, atlas: makeCanvas(), tabs: []}
  const renderer = createRenderer(thumb, scene, {clearLens: true})
  const raw = makeCanvas()
  const preference = matchMedia('(prefers-reduced-motion: reduce)')
  const listeners = []
  let pointerHeld = false
  let keyHeld = false
  let feedbackUntil = 0
  let active = 0
  let velocity = 0
  let frame = 0
  let previousTime = 0
  let dirty = true
  let disposed = false
  let lastValue = NaN
  let trackWidth = 0
  let center = 0
  let fillWidth = 0
  let edgeFill = 0
  let edgeFillVelocity = 0
  let snapTarget = null
  let snapVelocity = 0
  let lastStop = 60
  let pointerId = null, grabOffset = 0, dragStart = 0, dragMoved = false
  let pendingImpact = false, impact = null, squeeze = 0, visualWidth = width, visualHeight = height
  const stops = [Number(input.min), (Number(input.min) + Number(input.max)) / 2, Number(input.max)]
  const snapRadius = (stops[2] - stops[0]) * .06
  const dots = [...input.closest('.appearance').querySelectorAll('[data-slider-stop]')]
  const icons = [input.closest('.appearance').querySelector('.clear-icon'), input.closest('.appearance').querySelector('.frost-icon')]
  const iconAnimations = new Set()

  function listen(target, name, handler, options) {
    target.addEventListener(name, handler, options)
    listeners.push(() => target.removeEventListener(name, handler, options))
  }

  function signalStop(value) {
    if (value !== null && lastStop !== value && (value === stops[0] || value === stops[2])) {
      const icon = icons[value === stops[0] ? 0 : 1]
      if (!preference.matches && icon) {
        icon.getAnimations().forEach(animation => animation.cancel())
        const animation = icon.animate([
          {transform: 'scale(1)'}, {transform: 'scale(1.16)', offset: .4},
          {transform: 'scale(.99)', offset: .8}, {transform: 'scale(1)'},
        ], {duration: 620, easing: 'cubic-bezier(.37,0,.22,1)'})
        iconAnimations.add(animation)
        animation.finished.catch(() => {}).finally(() => iconAnimations.delete(animation))
      }
    }
    lastStop = value
  }

  function updateGeometry() {
    trackWidth = input.clientWidth
    const progress = (input.valueAsNumber - Number(input.min)) / (Number(input.max) - Number(input.min))
    center = width / 2 + progress * Math.max(0, trackWidth - width)
    thumb.style.left = `${center}px`
    updateFill()
    input.setAttribute('aria-valuetext', `${Number(input.valueAsNumber.toFixed(2))}% frosted`)
    dots.forEach(dot => dot.classList.toggle('is-selected', Math.abs(Number(dot.dataset.sliderStop) - input.valueAsNumber) < .1))
    const value = input.valueAsNumber
    signalStop(snapTarget ?? (stops.includes(value) ? value : null))
    dirty = true
    wake()
  }

  function updateFill() {
    fillWidth = center + (edgeFill < 0 ? center * edgeFill : (trackWidth - center) * edgeFill)
    input.parentElement.style.setProperty('--slider-progress', `${fillWidth / Math.max(1, trackWidth) * 100}%`)
    dirty = true
  }

  function updateTexture() {
    const context = raw.getContext('2d')
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvasWidth, canvasHeight)
    const start = pad + width / 2 - center
    const y = pad + height / 2
    context.beginPath()
    context.roundRect(start, y - 3, trackWidth, 6, 3)
    context.fillStyle = '#e2e2e4'
    context.fill()
    if (fillWidth > 0) {
      context.beginPath()
      context.roundRect(start, y - 3, fillWidth, 6, 3)
      context.fillStyle = '#007aff'
      context.fill()
    }
    renderer.setBackground({raw, frost: raw, extent: {width: canvasWidth, height: canvasHeight}})
  }

  function draw(time) {
    frame = 0
    if (disposed) return
    const dt = previousTime ? Math.min(.05, (time - previousTime) / 1000) : 1 / 60
    previousTime = time
    if (snapTarget !== null) {
      let value
      ;[value, snapVelocity] = preference.matches ? [snapTarget, 0] : spring(input.valueAsNumber, snapVelocity, snapTarget, dt, 24)
      if (Math.abs(value - snapTarget) < .005 && Math.abs(snapVelocity) < .05) {
        value = snapTarget
        if (pendingImpact && !preference.matches) impact = {start: time, stop: value}
        pendingImpact = false
        snapTarget = null
        snapVelocity = 0
      }
      input.value = String(value)
      updateGeometry()
    }
    const stop = snapTarget ?? input.valueAsNumber
    const fillTarget = stop === stops[0] ? -1 : stop === stops[2] ? 1 : 0
    ;[edgeFill, edgeFillVelocity] = preference.matches ? [fillTarget, 0] : spring(edgeFill, edgeFillVelocity, fillTarget, dt, 24)
    const fillMoving = Math.abs(edgeFill - fillTarget) > .0005 || Math.abs(edgeFillVelocity) > .005
    if (!fillMoving) {edgeFill = fillTarget; edgeFillVelocity = 0}
    updateFill()
    const target = pointerHeld || keyHeld || snapTarget !== null || time < feedbackUntil ? 1 : 0
    if (preference.matches) {
      active = target
      velocity = 0
    } else {
      [active, velocity] = spring(active, velocity, target, dt, 22)
    }
    if (dirty) {
      updateTexture()
      if (input.valueAsNumber !== lastValue) {
        lastValue = input.valueAsNumber
        onChange(lastValue / 100)
      }
      dirty = false
    }
    squeeze = 0
    if (impact) {
      const age = (time - impact.start) / 1000
      const amount = impact.stop === stops[1] ? .085 : .11
      const phase = age < .19 ? Math.min(1, age / .19) : Math.max(0, 1 - (age - .19) / .39)
      squeeze = amount * phase * phase * (3 - 2 * phase)
      if (age >= .58 || preference.matches) impact = null
    }
    const moving = impact !== null || fillMoving || time < feedbackUntil || snapTarget !== null || Math.abs(active - target) > .0005 || Math.abs(velocity) > .005
    if (!moving) { active = target; velocity = 0 }
    thumb.style.setProperty('--slider-active', String(active))
    renderer.canvas.style.opacity = String(active)
    const naturalWidth = width * (1 + active * .28)
    visualWidth = naturalWidth * (1 - squeeze)
    visualHeight = height * (1 + active * .16) * (1 + squeeze * .28)
    const offset = !impact || impact.stop === stops[1] ? 0 : (naturalWidth - visualWidth) / 2 * (impact.stop === stops[0] ? -1 : 1)
    thumb.style.width = `${visualWidth}px`
    thumb.style.height = `${visualHeight}px`
    thumb.style.left = `${center + offset}px`
    renderer.canvas.style.left = `${(visualWidth - width) / 2 - pad}px`
    renderer.canvas.style.top = `${(visualHeight - height) / 2 - pad}px`
    renderer.draw({x: width / 2, y: height / 2, width: visualWidth, height: visualHeight, backgroundOffset: {x: offset, y: 0}, material: 1, relax: 0, flow: 0, contour: 0})
    if (moving) {
      wake()
    } else {
      previousTime = 0
    }
  }

  function wake() {
    if (!disposed && !frame) frame = requestAnimationFrame(draw)
  }

  function release() {
    if (!pointerHeld && !keyHeld) return
    const captured = pointerId
    pointerId = null
    if (captured !== null && input.hasPointerCapture(captured)) input.releasePointerCapture(captured)
    pointerHeld = false
    keyHeld = false
    const nearest = stops.reduce((nearest, stop) => Math.abs(stop - input.valueAsNumber) < Math.abs(nearest - input.valueAsNumber) ? stop : nearest)
    snapTarget = Math.abs(nearest - input.valueAsNumber) <= snapRadius ? nearest : null
    pendingImpact = snapTarget !== null && (dragMoved || Math.abs(nearest - input.valueAsNumber) > .001)
    snapVelocity = 0
    if (snapTarget !== null) signalStop(snapTarget)
    wake()
  }

  listen(input, 'input', () => {snapTarget = null; snapVelocity = 0; updateGeometry()})
  listen(input, 'pointerdown', event => {
    event.preventDefault()
    if (!event.isPrimary || event.button !== 0 || pointerId !== null) return
    const rect = thumb.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top - 4 || event.clientY > rect.bottom + 4) return
    pointerId = event.pointerId
    grabOffset = event.clientX - (input.getBoundingClientRect().left + center)
    dragStart = event.clientX
    dragMoved = false
    pointerHeld = true
    snapTarget = null
    pendingImpact = false
    snapVelocity = 0
    input.dataset.pointerFocus = 'true'
    input.focus({preventScroll: true})
    input.setPointerCapture(pointerId)
    feedbackUntil = performance.now() + 130
    wake()
  }, {capture: true})
  listen(input, 'pointermove', event => {
    if (event.pointerId !== pointerId) return
    event.preventDefault()
    const x = event.clientX - input.getBoundingClientRect().left - grabOffset
    if (Math.abs(event.clientX - dragStart) > 2) dragMoved = true
    const progress = Math.max(0, Math.min(1, (x - width / 2) / Math.max(1, trackWidth - width)))
    input.value = String(stops[0] + progress * (stops[2] - stops[0]))
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
  function endPointer(event) {
    if (event.pointerId !== pointerId) return
    pointerId = null
    release()
    input.dispatchEvent(new Event('change', {bubbles: true}))
  }
  listen(window, 'pointerup', endPointer)
  listen(window, 'pointercancel', endPointer)
  listen(input, 'lostpointercapture', endPointer)
  listen(input, 'keydown', event => {
    delete input.dataset.pointerFocus
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      keyHeld = true
      snapTarget = null
      feedbackUntil = performance.now() + 130
      event.preventDefault()
      const value = input.valueAsNumber
      input.value = String(event.key === 'Home' ? stops[0] : event.key === 'End' ? stops[2] : ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key) ? [...stops].reverse().find(stop => stop < value - .01) ?? stops[0] : stops.find(stop => stop > value + .01) ?? stops[2])
      dragMoved = input.valueAsNumber !== value
      updateGeometry()
      wake()
    }
  })
  listen(input, 'keyup', release)
  listen(input, 'blur', release)
  listen(window, 'blur', release)
  listen(preference, 'change', wake)
  const resize = new ResizeObserver(updateGeometry)
  resize.observe(input)
  updateGeometry()

  return {
    snapshot() {return {active, value: input.valueAsNumber, center, fillWidth, trackWidth, snapTarget, squeeze, visualWidth, visualHeight, renderer: renderer.mode, framePending: Boolean(frame)}},
    destroy() {
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      listeners.forEach(remove => remove())
      iconAnimations.forEach(animation => animation.cancel())
      renderer.destroy()
    },
  }
}
