import { LensMotion } from './nav-motion.js';
import { measureScene, createRenderer, TRACK_MATERIAL } from './nav-optics.js';
import { createBackgroundSource, SURFACE, scrollCacheMargin } from './background.js';

export async function createGlassNavbar(pill, { active = 'home', onCommit, sceneRoot = null, companion = null, companionElement = null } = {}) {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let scene = await measureScene(pill);
  function paintLimits(nextScene){
    const box=pill.getBoundingClientRect(),scale=nextScene.width/box.width;
    return {left:(2-box.left)*scale,right:(innerWidth-2-box.left)*scale};
  }
  const model = new LensMotion(scene.tabs, active, { reduced: media.matches,limits:paintLimits(scene) });
  let appearance={...TRACK_MATERIAL};
  let renderer, fallback=false, raf=0, lastFrame=0, refreshVersion=0, disposed=false, commitCount=0;
  let geometry=pill.getBoundingClientRect(), pointerId=null, grabOffset=0, dragging=false;
  const pointers=new Map(), events=[];
  let backgroundSource;
  for(const [name,value] of Object.entries({opacity:TRACK_MATERIAL.opacity,blur:`${SURFACE.blur}px`,saturation:SURFACE.saturation}))pill.style.setProperty(`--nav-track-${name}`,value);
  function commit(id){commitCount++;onCommit?.(id);}
  const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);events.push(()=>target.removeEventListener(type,fn,options));};
  function makeRenderer(nextScene) {
    const result=createRenderer(pill,nextScene,{forceFallback:fallback,includeBase:true,glassTrack:true,onContextLost(){fallback=true;refresh();}});result.setAppearance(appearance);return result;
  }
  renderer=makeRenderer(scene);
  function backgroundDirty(){wake();}
  backgroundSource=createBackgroundSource(pill,scene,backgroundDirty,{root:sceneRoot,scrollMargin:scrollCacheMargin(),asyncRaster:renderer.mode==='webgl'&&matchMedia('(any-pointer: coarse)').matches});
  backgroundSource.capture(performance.now(),true);renderer.setBackground(backgroundSource);
  pill.classList.add('is-liquid-ready','has-glass-track');
  function paint(){const state=model.visual;const r=companionElement?.getBoundingClientRect(),p=pill.getBoundingClientRect();renderer.setUnderlay(r&&r.left-60<p.right+scene.pad&&r.right+60>p.left-scene.pad?companion?.getUnderlay():null);renderer.draw({...state,backgroundOffset:backgroundSource.offset});pill.dataset.liquidState=model.phase;pill.style.setProperty('--nav-track-scale-x',state.trackScaleX??1);pill.style.setProperty('--nav-track-scale-y',state.trackScaleY??1);}
  function frame(time){
    raf=0;const dt=lastFrame?Math.max(0,(time-lastFrame)/1000):1/60;lastFrame=time;
    model.tick(dt,time/1000);
    if(backgroundSource.capture(time))renderer.setBackground(backgroundSource);
    paint();
    if(model.needsFrame||backgroundSource.dirty||renderer.needsFrame)raf=requestAnimationFrame(frame);else lastFrame=0;
  }
  function wake(){
    if(!raf){lastFrame=performance.now();raf=requestAnimationFrame(frame);}
  }
  function semantics(){for(const button of pill.querySelectorAll('.nb')){if(button.dataset.nav===model.committed)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}}
  const localX = x => (x-geometry.left)*scene.width/geometry.width;
  function capture(id){try{pill.setPointerCapture(id);}catch{}}
  function anchor(point,retarget){
    pointerId=point.id;
    geometry=pill.getBoundingClientRect();
    model.limits=paintLimits(scene);
    const x=localX(point.x);
    const nearest=model.nearest(x);
    if(retarget){
      const v=model.visual;
      // Preserve a grab made inside the current lens. A new tab press aims
      // at that tab while retaining the current rendered position/velocity.
      const inside=pointers.size===1&&Math.abs(x-v.x)<v.width/2;
      // Edge compression shifts the drawn center, not the drag coordinate.
      // Keep that decoration out of pointer registration on a settling re-grab.
      grabOffset=x-(inside?model.unresist(model.x):nearest.x);
      model.press(inside?model.preview:nearest.id);
      if(inside)model.desiredX=model.targetX=model.x;
      dragging=false;
    }else{
      grabOffset=x-model.unresist(model.x);model.holding=true;model.dragging=true;model.phase='dragging';dragging=true;
      model.desiredX=model.targetX=model.x;
    }
    model.anchorPointer(x-grabOffset);
    point.start=x;point.last=x;point.time=null;
    capture(point.id);pill.style.cursor='grabbing';wake();
  }
  function down(event){
    if(event.button!==0&&event.pointerType!=='touch')return;
    if(pointerId!==null&&event.pointerType!=='touch')return;
    const point={id:event.pointerId,x:event.clientX,y:event.clientY,type:event.pointerType};
    delete pill.dataset.keyboardFocus;
    backgroundSource.invalidate();
    pointers.set(event.pointerId,point);anchor(point,true);
    point.time=event.timeStamp/1000;
    event.preventDefault();
  }
  function move(event){
    const point=pointers.get(event.pointerId);if(!point)return;
    point.x=event.clientX;point.y=event.clientY;
    if(pointerId!==event.pointerId)return;
    geometry=pill.getBoundingClientRect();
    const x=localX(event.clientX),now=performance.now()/1000,sampleTime=event.timeStamp/1000;
    const dt=point.time===null?1/60:Math.max(.001,sampleTime-point.time);
    // Small finger drift is still a tap. Treating it as a drag switches the
    // travelling lens to the much faster follow spring before it arrives.
    if(Math.abs(x-point.start)>(point.type==='touch'?8:3))dragging=true;
    if(dragging)model.move(x-grabOffset,x-point.last,dt,now);
    point.last=x;point.time=sampleTime;wake();event.preventDefault();
  }
  function finish(event,cancel=false){
    const point=pointers.get(event.pointerId);if(!point)return;
    pointers.delete(event.pointerId);
    if(event.pointerId!==pointerId)return;
    const remaining=[...pointers.values()].at(-1);
    if(remaining){anchor(remaining,false);return;}
    pointerId=null;pill.style.cursor='grab';
    const destination=cancel?model.committed:model.preview;
    dragging=false;
    model.release(destination,{commit:!cancel});semantics();wake();
    if(!cancel)commit(destination);
  }
  listen(pill,'pointerdown',down);
  listen(pill,'pointermove',move);
  listen(pill,'pointerup',event=>finish(event));
  listen(pill,'pointercancel',event=>finish(event,true));
  listen(pill,'lostpointercapture',event=>finish(event,true));
  listen(pill,'contextmenu',event=>{if(pointers.size)event.preventDefault();});
  listen(pill,'click',event=>{
    const button=event.target.closest('.nb');if(!button)return;
    // Native keyboard/assistive activation is routed through the same model.
    if(event.detail===0){
      event.preventDefault();event.stopPropagation();
      pointers.clear();pointerId=null;dragging=false;
      model.press(button.dataset.nav);model.release(button.dataset.nav);semantics();wake();commit(button.dataset.nav);
    }
  });
  listen(pill,'keydown',event=>{
    focusRing(document.activeElement);
    const buttons=[...pill.querySelectorAll('.nb')],i=buttons.indexOf(document.activeElement);
    if(i<0)return;
    const index=event.key==='ArrowRight'?(i+1)%buttons.length:event.key==='ArrowLeft'?(i+buttons.length-1)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:-1;
    if(index>=0){event.preventDefault();buttons[index].focus({preventScroll:true});}
  });
  function focusRing(button){
    const tab=scene.tabs.find(t=>t.id===button?.dataset.nav);
    if(!tab||pointers.size)return;
    pill.dataset.keyboardFocus='true';
    for(const [key,value] of Object.entries({x:tab.x-tab.width/2+3,y:tab.y-tab.height/2+3,width:tab.width-6,height:tab.height-6}))pill.style.setProperty(`--nav-focus-${key}`,`${value}px`);
  }
  listen(pill,'focusin',event=>{if(event.target.matches(':focus-visible'))focusRing(event.target);});
  listen(pill,'focusout',event=>{if(!pill.contains(event.relatedTarget))delete pill.dataset.keyboardFocus;});
  function select(id){
    if(!model.tabs.some(t=>t.id===id))return;
    if(id===model.committed&&!model.swiping)return;
    // History/external navigation interrupts a preview without navigating again.
    pointers.clear();pointerId=null;dragging=false;pill.style.cursor='grab';
    model.select(id);semantics();wake();
  }
  async function refresh(){
    const version=++refreshVersion;
    const next=await measureScene(pill);
    if(disposed||version!==refreshVersion)return;
    const replacement=makeRenderer(next);
    const nextBackground=createBackgroundSource(pill,next,backgroundDirty,{root:sceneRoot,scrollMargin:scrollCacheMargin(),asyncRaster:replacement.mode==='webgl'&&matchMedia('(any-pointer: coarse)').matches});
    nextBackground.capture(performance.now(),true);replacement.setBackground(nextBackground);
    model.resize(next.tabs);scene=next;model.limits=paintLimits(scene);
    renderer.destroy();renderer=replacement;backgroundSource.destroy();backgroundSource=nextBackground;
    geometry=pill.getBoundingClientRect();
    const point=pointers.get(pointerId);
    if(point){const x=localX(point.x);grabOffset=x-model.unresist(model.x);point.last=point.start=x;point.time=null;model.anchorPointer(model.unresist(model.x));}
    paint();wake();
  }
  listen(media,'change',()=>{model.reduced=media.matches;wake();});
  listen(window,'blur',()=>{if(pointerId===null)return;pointers.clear();pointerId=null;dragging=false;model.release(model.committed,{commit:false});pill.style.cursor='grab';wake();});
  if(companionElement)listen(companionElement,'liquid-glass:surface',()=>{
    const r=companionElement?.getBoundingClientRect();
    if(r&&r.left-60<geometry.right+scene.pad&&r.right+60>geometry.left-scene.pad)wake();
  });
  // Resolution media queries also catch moving a window between displays.
  let resolution;
  function watchResolution(){
    resolution?.removeEventListener('change',resolutionChange);
    resolution=matchMedia(`(resolution: ${devicePixelRatio}dppx)`);resolution.addEventListener('change',resolutionChange);
  }
  function resolutionChange(){watchResolution();refresh();}
  watchResolution();semantics();paint();
  return {
    select,refresh,
    setAppearance(style){appearance={...appearance,...style};renderer.setAppearance(appearance);paint();wake();},
    swipe(from,to,p){model.swipe(from,to,Math.max(0,Math.min(1,p)));paint();wake();},
    resetSwipe(){if(model.swiping){model.release(model.committed,{commit:false});wake();}},
    snapshot(){return {...model.visual,edgeImpact:{...model.edgeImpact},wobble:{...model.wobble},phase:model.phase,committed:model.committed,preview:model.preview,velocity:model.v,pointerVelocity:model.speed,pointerSpeed:model.speedMagnitude,hold:model.hold,stretch:model.stretch,tapStretch:model.tapStretch,recoil:model.recoil,inputX:model.inputX,desiredX:model.desiredX,targetX:model.targetX,limits:{...model.limits},framePending:!!raf,pointers:pointers.size,commitCount,renderer:renderer.mode,background:{mode:'bounded-dom',...backgroundSource.stats},tabs:scene.tabs.map(t=>({...t})),scene:{width:scene.width,height:scene.height,dpr:scene.dpr}};},
    destroy(){disposed=true;refreshVersion++;cancelAnimationFrame(raf);events.forEach(remove=>remove());resolution?.removeEventListener('change',resolutionChange);backgroundSource.destroy();renderer.destroy();pill.classList.remove('is-liquid-ready','has-glass-track');},
  };
}
