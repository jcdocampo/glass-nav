import { ButtonMotion } from './button-motion.js';
import { createButtonOptics, BUTTON_SURFACE } from './button-optics.js';
import { SURFACE } from './background.js';
import { TRACK_MATERIAL } from './nav-optics.js';
import { createFixedUnderlay } from './fixed-underlay.js';

export function createGlassButton(button, { onToggle, open = false, sceneRoot = null } = {}) {
  const radius = BUTTON_SURFACE.diameter / 2;
  const surface = button.querySelector('[data-glass-surface]');
  const foreground = button.querySelector('[data-glass-foreground]');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const motion = new ButtonMotion({ reduced: preference.matches });
  motion.open = open;
  for(const [name,value] of Object.entries({opacity:TRACK_MATERIAL.opacity,blur:`${SURFACE.blur}px`,saturation:SURFACE.saturation}))button.style.setProperty(`--nav-track-${name}`,value);
  button.style.setProperty('--glass-action-surface-opacity',TRACK_MATERIAL.opacity);
  let pointer = null, frame = 0, previousFrame = 0, paintRevision = 0, disposed=false, appearance={...TRACK_MATERIAL};
  const events=[];const listen=(target,type,handler,options)=>{target.addEventListener(type,handler,options);events.push(()=>target.removeEventListener(type,handler,options));};
  const fixedUnderlay=createFixedUnderlay(paintUnderlay);
  const optics = createButtonOptics(button, surface, wake, {sceneRoot});
  const paint = () => {
    if(disposed)return;
    const v = motion.visual;
    const transform = `matrix(${v.a},${v.b},${v.b},${v.d},${v.x},${v.y})`;
    surface.style.transform = foreground.style.transform = transform;
    button.style.setProperty('--glass-action-active', v.material.toFixed(5));
    optics?.draw(v, performance.now());
    paintRevision++;button.dispatchEvent(new Event('liquid-glass:surface'));
  };
  function loop(time) {
    if(disposed)return;
    frame = 0;
    motion.tick(previousFrame ? (time - previousFrame) / 1000 : 1 / 60, time / 1000);
    previousFrame = time;
    paint();
    if (!motion.settled || optics?.pending) frame = requestAnimationFrame(loop);
  }
  function wake() { if (!disposed&&!frame) { previousFrame = 0; frame = requestAnimationFrame(loop); } }
  function finish(event, cancelled = false) {
    if (!pointer || (event && pointer.id !== event.pointerId)) return;
    const contact = pointer; pointer = null;
    motion.release(); wake();
    try { button.releasePointerCapture(contact.id); } catch {}
    if (!cancelled && !contact.dragged) onToggle?.();
  }
  listen(button,'pointerdown', event => {
    if (pointer || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY,
      lastX: event.clientX, lastY: event.clientY, time: event.timeStamp, dragged: false,
      // Regrabbing a settling button preserves its current centre.
      offsetX: radius * Math.atanh(Math.min(.9999, Math.hypot(motion.x, motion.y) / 4)) *
        (Math.hypot(motion.x, motion.y) ? motion.x / Math.hypot(motion.x, motion.y) : 0),
      offsetY: radius * Math.atanh(Math.min(.9999, Math.hypot(motion.x, motion.y) / 4)) *
        (Math.hypot(motion.x, motion.y) ? motion.y / Math.hypot(motion.x, motion.y) : 0) };
    motion.press(); wake();
    optics?.invalidate();
    try { button.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  }, { passive: false });
  listen(button,'pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.lastX, dy = event.clientY - pointer.lastY;
    const dt = Math.max(.001, (event.timeStamp - pointer.time) / 1000);
    const x = event.clientX - pointer.x, y = event.clientY - pointer.y;
    pointer.dragged ||= Math.hypot(x, y) > 3;
    motion.move(x + pointer.offsetX, y + pointer.offsetY, dx, dy, dt, event.timeStamp / 1000);
    pointer.lastX = event.clientX; pointer.lastY = event.clientY; pointer.time = event.timeStamp;
    wake();
  });
  listen(button,'pointerup', event => finish(event));
  listen(button,'pointercancel', event => finish(event, true));
  listen(button,'lostpointercapture', event => finish(event, true));
  listen(button,'contextmenu', event => event.preventDefault());
  // Pointer activation is handled above; detail=0 also covers assistive clicks.
  listen(button,'click', event => { if (event.detail === 0) onToggle?.(); });
  listen(window,'blur', () => finish(null, true));
  listen(document,'visibilitychange', () => { if (document.hidden) finish(null, true); });
  listen(preference,'change', () => { motion.reduced = preference.matches; wake(); });
  listen(window,'resize', () => { optics?.invalidate(); wake(); });
  paint(); wake();
    function paintUnderlay(ctx, area) {
      const r=button.getBoundingClientRect();
      if(r.right+18<area.left||r.left-18>area.right||r.bottom+18<area.top||r.top-18>area.bottom)return false;
      const v=motion.visual;
      ctx.save();ctx.translate(r.left+r.width/2+v.x,r.top+r.height/2+v.y);ctx.transform(v.a,v.b,v.b,v.d,0,0);
      ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);
      ctx.fillStyle=`rgb(255 255 255 / ${appearance.opacity})`;
      ctx.shadowColor='rgba(0,0,0,.12)';ctx.shadowBlur=24;ctx.shadowOffsetY=6;ctx.fill();
      ctx.shadowColor='transparent';
      const canvas=surface.querySelector('canvas');
      if(canvas)ctx.drawImage(canvas,-BUTTON_SURFACE.size/2,-BUTTON_SURFACE.size/2,BUTTON_SURFACE.size,BUTTON_SURFACE.size);
      const svg=foreground.querySelector('svg');
      const iconStyle=getComputedStyle(svg);
      ctx.translate(-12,-12);ctx.strokeStyle=iconStyle.stroke;ctx.lineWidth=parseFloat(iconStyle.strokeWidth)||2.35;ctx.lineCap=ctx.lineJoin='round';
      svg.querySelectorAll('path').forEach(path=>{const d=path.getAttribute('d');if(ctx.strokePath)ctx.strokePath(d);else ctx.stroke(new Path2D(d));});ctx.restore();return true;
    }
  return { setAppearance(style){appearance={...appearance,...style};optics?.setAppearance(style);surface.style.backgroundColor=`rgb(255 255 255 / ${appearance.opacity})`;paint();wake();},
    destroy(){disposed=true;cancelAnimationFrame(frame);events.forEach(remove=>remove());optics?.destroy();},
    setOpen(value) { motion.open = !!value; optics?.invalidate(); wake(); },
    paintUnderlay, getUnderlay(){return fixedUnderlay(button.getBoundingClientRect(),paintRevision);},
    snapshot() { return { ...motion.visual, holding: motion.holding, open: motion.open, animating: !!frame, optics: optics?.mode || 'native-frost' }; } };
}
