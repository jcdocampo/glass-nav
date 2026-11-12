import {createGlassControls} from './src/index.js'
import {createAppearanceSlider} from './appearance-slider.js'
import {createSceneScrollbar} from './scene-scrollbar.js'

const input = document.getElementById('frost')
const status = document.getElementById('selection-status')
const controls = await createGlassControls({
  navbar: document.getElementById('pill'),
  button: document.getElementById('glass-action'),
  root: document.getElementById('root'),
  frost: Number(input.value) / 100,
  onSelect(id) {
    status.textContent = `${id[0].toUpperCase() + id.slice(1)} selected`
  },
  onSearch() {
    status.textContent = 'Search button'
  },
})

const slider = createAppearanceSlider(input, document.getElementById('slider-thumb'), value => controls.setFrost(value))
const scrollbar = createSceneScrollbar(document.getElementById('scene-scroll'), document.querySelector('.scene-scrollbar'))
const reportHeight = () => parent.postMessage({type: 'glass-demo:height', height: Math.ceil(document.body.getBoundingClientRect().height)}, location.origin)
const bodySize = new ResizeObserver(reportHeight)
bodySize.observe(document.body)
reportHeight()

window.addEventListener('pagehide', () => {scrollbar.destroy(); bodySize.disconnect(); slider.destroy(); controls.destroy()}, {once: true})
window.__glassDemo = {...controls, slider, scrollbar}
