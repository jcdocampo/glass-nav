// Bounded reconstruction of this site's nearby paint, not a browser screenshot.
// Same-origin images, ordinary backgrounds and text contribute actual pixels.
// The site's intersecting linear alpha masks are applied to sampled images.
// Unsupported effects (video, SVG, complex blending) remain approximate.
import { createRasterizer } from './raster.js';
export const SURFACE = Object.freeze({ opacity: .78, blur: 18, saturation: 1.35, compression: .04, sampleDpr: 1.5, updateInterval: 65 });
export function opticalDpr(maximum=2.5){return Math.min(devicePixelRatio||1,matchMedia('(any-pointer: coarse)').matches?Math.min(2,maximum):maximum);}
export const scrollCacheMargin=()=>matchMedia('(any-pointer: coarse)').matches&&typeof Worker==='function'&&typeof OffscreenCanvas==='function'?128:0;
let nextTouchCapture=0;

function split(value) {
  const parts=[];let depth=0,start=0;
  for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===','&&!depth){parts.push(value.slice(start,i).trim());start=i+1;}}
  parts.push(value.slice(start).trim());return parts;
}
const visibleColor = color => color!=='transparent'&&!/rgba\([^)]*,\s*0\s*\)/.test(color);
const overlaps = (a,b) => a.right>b.left&&a.left<b.right&&a.bottom>b.top&&a.top<b.bottom;
const bounds = (x,y,width,height) => ({x,y,width,height,left:x,top:y,right:x+width,bottom:y+height});
const intersect=(a,b)=>bounds(Math.max(a.left,b.left),Math.max(a.top,b.top),Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)),Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)));

let nativeCanvasBlur;
export function hasCanvasBlur(){
  if(nativeCanvasBlur!==undefined)return nativeCanvasBlur;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=9;
  const ctx=canvas.getContext('2d');if(!('filter' in ctx))return nativeCanvasBlur=false;
  ctx.filter='blur(1px)';ctx.fillStyle='#fff';ctx.fillRect(4,4,1,1);
  return nativeCanvasBlur=ctx.getImageData(3,4,1,1).data[3]>0;
}
const blurBuffers=new WeakMap();
export function blurPixels(input,width,height,radius,output=new Uint8ClampedArray(input.length)){
  // Three separable sliding box passes approximate a Gaussian. Replicated
  // boundaries prevent dark/transparent sampling strips at the texture edge.
  for(let pass=0;pass<3;pass++)for(const horizontal of [true,false]){
    const length=horizontal?width:height,lines=horizontal?height:width;
    const stride=horizontal?4:width*4,lineStride=horizontal?width*4:4,divisor=radius*2+1;
    for(let line=0;line<lines;line++){
      const origin=line*lineStride;let red=0,green=0,blue=0;
      for(let p=-radius;p<=radius;p++){const i=origin+Math.max(0,Math.min(length-1,p))*stride;red+=input[i];green+=input[i+1];blue+=input[i+2];}
      for(let p=0;p<length;p++){
        const i=origin+p*stride;output[i]=red/divisor;output[i+1]=green/divisor;output[i+2]=blue/divisor;output[i+3]=255;
        const remove=origin+Math.max(0,p-radius)*stride,add=origin+Math.min(length-1,p+radius+1)*stride;
        red+=input[add]-input[remove];green+=input[add+1]-input[remove+1];blue+=input[add+2]-input[remove+2];
      }
    }
    [input,output]=[output,input];
  }
  for(let i=0;i<input.length;i+=4){const light=.2126*input[i]+.7152*input[i+1]+.0722*input[i+2];for(let c=0;c<3;c++)input[i+c]=light+(input[i+c]-light)*SURFACE.saturation;}
  return input;
}
function soften(ctx,radius){
  const {width,height}=ctx.canvas,image=ctx.getImageData(0,0,width,height);
  let output=blurBuffers.get(ctx);
  if(!output||output.length!==image.data.length){output=new Uint8ClampedArray(image.data.length);blurBuffers.set(ctx,output);}
  const result=blurPixels(image.data,width,height,radius,output);
  if(result!==image.data)image.data.set(result);ctx.putImageData(image,0,0);
}

function background(ctx,style,r,paintImage) {
  if(visibleColor(style.backgroundColor)){ctx.fillStyle=style.backgroundColor;ctx.fillRect(r.x,r.y,r.width,r.height);}
  for(const layer of split(style.backgroundImage||'none').reverse()){
    if(/^(?:url|(?:-webkit-)?image-set)\(/.test(layer)){paintImage?.(layer,style,r);continue;}
    if(!layer.startsWith('linear-gradient('))continue;
    const parts=split(layer.slice(16,-1));let angle=Math.PI;
    if(/deg$/.test(parts[0]))angle=parseFloat(parts.shift())*Math.PI/180;
    else if(parts[0].startsWith('to ')){const direction=parts.shift();angle=direction.includes('right')?Math.PI/2:direction.includes('left')?-Math.PI/2:direction.includes('top')?0:Math.PI;}
    const dx=Math.sin(angle),dy=-Math.cos(angle),length=Math.abs(r.width*dx)+Math.abs(r.height*dy);
    const cx=r.x+r.width/2,cy=r.y+r.height/2;
    const gradient=ctx.createLinearGradient(cx-dx*length/2,cy-dy*length/2,cx+dx*length/2,cy+dy*length/2);
    parts.forEach((stop,i)=>{const match=stop.match(/^(.*?)(?:\s+([-\d.]+)%)?$/);try{gradient.addColorStop(Math.max(0,Math.min(1,match[2]===undefined?i/Math.max(1,parts.length-1):Number(match[2])/100)),match[1]);}catch{}});
    ctx.fillStyle=gradient;ctx.fillRect(r.x,r.y,r.width,r.height);
  }
}

export function createBackgroundSource(pill,scene,onDirty,{underlay=null,scrollMargin=0,asyncRaster=false,root:sceneRoot=null}={}) {
  let rasterizer=asyncRaster?createRasterizer():null;
  const symmetric=!!rasterizer;
  const raw=document.createElement('canvas'),frost=document.createElement('canvas');
  const extent={width:scene.canvasWidth,height:scene.canvasHeight+scrollMargin*(symmetric?2:1)},origin={x:0,y:symmetric?scrollMargin:0};
  const dpr=Math.min(scene.dpr,SURFACE.sampleDpr);
  raw.width=Math.ceil(extent.width*dpr);raw.height=Math.ceil(extent.height*dpr);
  // A heavily blurred texture needs far fewer samples than sharp refraction.
  const frostDpr=hasCanvasBlur()?(scrollMargin ? .5 : 1):(scrollMargin ? .44 : .5);
  frost.width=Math.ceil(extent.width*frostDpr);frost.height=Math.ceil(extent.height*frostDpr);
  const rawContext=raw.getContext('2d'),fc=frost.getContext('2d',{willReadFrequently:!hasCanvasBlur()});
  let ctx=rawContext,maskedImage,maskedContext,maskedNative,recorder;
  let frontRaw=raw,frontFrost=frost,frontValid=false,pending=false,prepared=null,revision=0;
  let dirty=true,last=-Infinity,disposed=false,animatedUntil=0,stats={captures:0,nodes:0,images:0,skipped:0,duration:0};
  let glyphCache=new WeakMap();
  const imageCache=new Map();
  const decodedImages=new WeakSet();
  let sampledArea=null,covered=new WeakSet();
  let capturedX=scrollX,capturedY=scrollY,scaleX=1,scaleY=1,hasFixed=false,anchor=null,capturedPill=null;
  let previousGeometry=null;
  const offsetFor=({capturedX,capturedY,scaleX,scaleY,hasFixed,anchor,capturedPill})=>{
    if(hasFixed)return {x:0,y:0};
    if(anchor?.element.isConnected&&capturedPill){
      const now=anchor.element.getBoundingClientRect(),p=pill.getBoundingClientRect();
      // A zoom changes the bounds around the transform origin. Treating that
      // as scroll translates old pixels, then jumps back at the next capture.
      const resized=Math.abs(anchor.rect.width-now.width)>.01||Math.abs(anchor.rect.height-now.height)>.01;
      return {x:((resized?scrollX-capturedX:anchor.rect.x-now.x)+p.x-capturedPill.x)*scaleX,y:((resized?scrollY-capturedY:anchor.rect.y-now.y)+p.y-capturedPill.y)*scaleY};
    }
    return {x:(scrollX-capturedX)*scaleX,y:(scrollY-capturedY)*scaleY};
  };
  const geometry=()=>({capturedX,capturedY,scaleX,scaleY,hasFixed,anchor,capturedPill,originY:origin.y});
  const offset=()=>offsetFor(geometry());
  const restore=state=>{({capturedX,capturedY,scaleX,scaleY,hasFixed,anchor,capturedPill}=state);origin.y=state.originY;};
  const closeFront=()=>{if(frontRaw!==raw)frontRaw.close();if(frontFrost!==frost)frontFrost.close();};
  const invalidate=()=>{if(disposed)return;revision++;dirty=true;onDirty?.();};
  function imageResource(address){
    let image=imageCache.get(address);
    if(!image){
      image=new Image();image.decoding='async';imageCache.set(address,image);
      image.addEventListener('load',()=>{
        Promise.resolve(image.decode?.()).catch(()=>{}).then(()=>{decodedImages.add(image);invalidate();});
      },{once:true});
      image.src=address;
    }
    return image;
  }
  const root=sceneRoot||document.getElementById('root');
  const observer=new MutationObserver(records=>{
    for(const record of records){if(record.type==='characterData')glyphCache.delete(record.target);else if(record.type==='childList')glyphCache=new WeakMap();}
    if(records.some(record=>{
      const element=record.target.nodeType===1?record.target:record.target.parentElement;
      return element&&(!sampledArea||covered.has(element)||overlaps(element.getBoundingClientRect(),sampledArea));
    }))invalidate();
  });
  if(root)observer.observe(root,{subtree:true,attributes:true,childList:true,characterData:true,attributeFilter:['class','style','src','srcset']});
  document.addEventListener('scroll',invalidate,{capture:true,passive:true});
  document.addEventListener('load',invalidate,true);
  const relevant=element=>element?.nodeType===1&&root?.contains(element)&&(!sampledArea||covered.has(element)||overlaps(element.getBoundingClientRect(),sampledArea));
  const imageTransforms=new Map();
  function imageMoving(time){
    for(const [element,properties] of imageTransforms){
      for(const [property,until] of properties)if(time>until||!element.isConnected)properties.delete(property);
      if(!properties.size)imageTransforms.delete(element);
    }
    return imageTransforms.size>0;
  }
  const effect=event=>{
    const imageTransform=event.target instanceof HTMLImageElement&&['transform','scale','translate','rotate'].includes(event.propertyName);
    const ending=event.type==='transitionend'||event.type==='transitioncancel';
    const tracked=imageTransforms.has(event.target);
    if(imageTransform&&ending){imageTransforms.get(event.target)?.delete(event.propertyName);if(!imageTransforms.get(event.target)?.size)imageTransforms.delete(event.target);}
    if(!tracked&&!relevant(event.target))return;
    if(event.type==='animationstart'||event.type==='transitionrun'){
      const style=getComputedStyle(event.target),animation=event.type==='animationstart';
      const ms=value=>Math.max(0,...value.split(',').map(v=>(parseFloat(v)||0)*(v.trim().endsWith('ms')?1:1000)));
      const until=performance.now()+Math.min(2500,ms(animation?style.animationDuration:style.transitionDuration)+ms(animation?style.animationDelay:style.transitionDelay)+80);
      if(!animation||!style.animationIterationCount.includes('infinite'))animatedUntil=Math.max(animatedUntil,until);
      if(imageTransform&&event.type==='transitionrun'){
        if(!imageTransforms.has(event.target))imageTransforms.set(event.target,new Map());
        imageTransforms.get(event.target).set(event.propertyName,until);
      }
    }
    invalidate();
  };
  const effectEvents=['animationstart','animationend','animationcancel','transitionrun','transitionend','transitioncancel'];
  effectEvents.forEach(type=>root?.addEventListener(type,effect,true));
  const fontsChanged=()=>{glyphCache=new WeakMap();invalidate();};document.fonts?.addEventListener('loadingdone',fontsChanged);

  function capture(time,force=false) {
    if(disposed)return false;
    if(prepared){
      const ready=prepared;prepared=null;previousGeometry=geometry();closeFront();frontRaw=ready.data.raw;frontFrost=ready.data.frost;restore(ready.geometry);
      stats={...ready.stats,captures:stats.captures+1,rasterMs:ready.data.rasterMs,latency:performance.now()-ready.start,worker:true};
      dirty=dirty||revision!==ready.revision;return true;
    }
    if(pending)return false;
    const movingImage=imageMoving(time);
    if(movingImage||time<animatedUntil)dirty=true;
    const delta=offset();
    const fixedScroll=hasFixed&&(scrollX!==capturedX||scrollY!==capturedY);
    // The cached texture follows scroll every paint; rebuild only after enough
    // movement to use its sampling margin, rather than once per scroll event.
    const verticalSlack=(symmetric?scrollMargin:delta.y<0?origin.y:scrollMargin-origin.y)+16;
    const urgent=scrollMargin&&(Math.abs(delta.x)>=32||Math.abs(delta.y)>verticalSlack);
    const moved=Math.abs(delta.x)>=32||Math.abs(delta.y)>=(rasterizer?96:scrollMargin||32);
    // Photo transforms need fresh geometry each display frame. Keep the
    // cheaper cached/reprojected cadence for ordinary page scrolling.
    const interval=movingImage?0:time<animatedUntil?SURFACE.updateInterval:rasterizer&&(Math.abs(delta.y)>1||Math.abs(delta.x)>1)?110:SURFACE.updateInterval;
    if(disposed||(!force&&(!dirty||(time-last<interval&&!moved&&!urgent&&!fixedScroll))))return false;
    // Separate the two glass controls' expensive rebuilds, while both continue
    // scrolling their cached pixels on every animation frame.
    if(!force&&scrollMargin&&!urgent&&performance.now()<nextTouchCapture)return false;
    dirty=false;last=time;const start=performance.now(),oldGeometry=geometry(),stageRevision=revision;
    recorder=rasterizer&&!force&&frontValid?rasterizer.record():null;
    ctx=recorder?recorder.context(raw,rawContext):rawContext;
    maskedContext=recorder&&maskedImage?recorder.context(maskedImage,maskedNative):maskedNative;
    const p=pill.getBoundingClientRect(),sx=scene.width/p.width,sy=scene.height/p.height;
    // Put extra cached pixels ahead of the scroll direction. On reversal,
    // urgent captures switch sides before the original sampling margin runs out.
    if(!symmetric&&scrollMargin&&Math.abs(delta.y)>1)origin.y=delta.y<0?scrollMargin:0;
    capturedX=scrollX;capturedY=scrollY;scaleX=sx;scaleY=sy;hasFixed=false;anchor=null;capturedPill={x:p.x,y:p.y};
    const area=bounds(p.x-scene.pad/sx,p.y-(scene.pad+origin.y)/sy,extent.width/sx,extent.height/sy);
    sampledArea=area;covered=new WeakSet();
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,raw.width,raw.height);
    ctx.setTransform(dpr*sx,0,0,dpr*sy,dpr*(scene.pad-p.x*sx),dpr*(scene.pad+origin.y-p.y*sy));
    ctx.fillStyle=getComputedStyle(document.body).backgroundColor||'#f5f5f7';ctx.fillRect(area.x,area.y,area.width,area.height);
    let nodes=0,images=0,backgrounds=0,skipped=0,paintedGlyphs=0,glyphCacheHits=0,glyphReads=0;
    const styles=new Map(),getStyle=element=>{let style=styles.get(element);if(!style){style=getComputedStyle(element);styles.set(element,style);}return style;};
    function register(element,r,trackingElement=element){
      const score=Math.max(0,Math.min(r.right,p.right)-Math.max(r.left,p.left))*Math.max(0,Math.min(r.bottom,p.bottom)-Math.max(r.top,p.top));
      if(score&&(!anchor||score>=anchor.score)){
        const box=trackingElement===element?r:trackingElement.getBoundingClientRect();
        anchor={element:trackingElement,rect:{x:box.x,y:box.y,width:box.width,height:box.height},score};
      }
    }
    function paintImage(layer,style,r){
      let resolution=1;
      if(/^(?:-webkit-)?image-set\(/.test(layer)){
        const candidates=split(layer.slice(layer.indexOf('(')+1,-1)).map(value=>{
          const image=value.match(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/)?.[0]||'';
          return {value:image,resolution:Number(value.slice(image.length).match(/([\d.]+)(?:dppx|x)\b/)?.[1]||1)};
        }).sort((a,b)=>a.resolution-b.resolution);
        const selected=candidates.find(candidate=>candidate.resolution>=(devicePixelRatio||1))||candidates.at(-1);
        if(!selected)return;resolution=selected.resolution;layer=selected.value;
      }
      if(!layer.startsWith('url('))return;
      const address=layer.slice(4,-1).trim().replace(/^(['"])(.*)\1$/,'$2');
      let url;try{url=new URL(address,location.href);}catch{return;}
      if(url.origin!==location.origin&&!['data:','blob:'].includes(url.protocol)){skipped++;return;}
      const image=imageResource(url.href);
      if(!image.complete||!image.naturalWidth||!decodedImages.has(image))return;
      const size=split(style.backgroundSize||'auto')[0],position=split(style.backgroundPosition||'50% 50%')[0].split(/\s+/);
      const cssWidth=parseFloat(style.width)||r.width,cssHeight=parseFloat(style.height)||r.height;
      let w=image.naturalWidth/resolution*r.width/cssWidth,h=image.naturalHeight/resolution*r.height/cssHeight;
      if(size==='cover'||size==='contain'){
        const fit=(size==='cover'?Math.max:Math.min)(r.width/image.naturalWidth,r.height/image.naturalHeight);w=image.naturalWidth*fit;h=image.naturalHeight*fit;
      }else if(size!=='auto'){
        const values=size.split(/\s+/),length=(value,extent,scale)=>value?.endsWith('%')?parseFloat(value)*extent/100:parseFloat(value)*scale;
        if(values[0]!=='auto'){w=length(values[0],r.width,r.width/cssWidth);h=w*image.naturalHeight/image.naturalWidth;}
        if(values[1]&&values[1]!=='auto'){h=length(values[1],r.height,r.height/cssHeight);if(values[0]==='auto')w=h*image.naturalWidth/image.naturalHeight;}
      }
      const locate=(value,free,scale)=>value==='left'||value==='top'?0:value==='right'||value==='bottom'?free:value==='center'?free/2:value?.endsWith('%')?parseFloat(value)*free/100:(parseFloat(value)||0)*scale;
      const x=r.x+locate(position[0],r.width-w,r.width/cssWidth),y=r.y+locate(position[1]||'50%',r.height-h,r.height/cssHeight);
      ctx.save();
      if(style.filter&&style.filter!=='none')ctx.filter=style.filter.replace(/blur\(([\d.]+)px\)/g,(_,radius)=>`blur(${Number(radius)*dpr*(sx+sy)/2}px)`);
      ctx.drawImage(image,x,y,w,h);ctx.restore();images++;backgrounds++;
    }
    function rounded(r,style){ctx.beginPath();ctx.roundRect(r.x,r.y,r.width,r.height,Math.min(r.width/2,r.height/2,parseFloat(style.borderTopLeftRadius)||0));}
    function pseudo(element,name,r){
      const style=getComputedStyle(element,name);if(style.content==='none'||style.content==='normal'||style.display==='none')return;
      const width=parseFloat(style.width)||r.width,height=parseFloat(style.height)||r.height;
      const x=r.x+(style.left!=='auto'?parseFloat(style.left)||0:style.right!=='auto'?r.width-width-(parseFloat(style.right)||0):0);
      const y=r.y+(style.top!=='auto'?parseFloat(style.top)||0:style.bottom!=='auto'?r.height-height-(parseFloat(style.bottom)||0):0);
      ctx.save();ctx.globalAlpha*=parseFloat(style.opacity);background(ctx,style,bounds(x,y,width,height),paintImage);ctx.restore();
    }
    function text(node,parentStyle,clipArea){
      if(paintedGlyphs>=600||!node.textContent.trim())return;
      const range=document.createRange();range.selectNodeContents(node);
      if(!overlaps(range.getBoundingClientRect(),clipArea))return;
      register(node.parentElement,node.parentElement.getBoundingClientRect());
      ctx.fillStyle=parentStyle.color;ctx.font=parentStyle.font;ctx.textBaseline='alphabetic';
      if('letterSpacing' in ctx)ctx.letterSpacing=parentStyle.letterSpacing;
      const metrics=ctx.measureText('Mg'),ascent=metrics.fontBoundingBoxAscent||parseFloat(parentStyle.fontSize)*.8,descent=metrics.fontBoundingBoxDescent||parseFloat(parentStyle.fontSize)*.2;
      // Ranges preserve wrapped line placement. Only the intersecting text
      // nodes are examined, and a per-capture glyph budget bounds long prose.
      const value=node.textContent;let glyphs=0;
      const parent=node.parentElement,pr=parent.getBoundingClientRect();
      if(value.length<=6000&&!/[\r\n\t]|\s{2}/.test(value)&&parentStyle.direction!=='rtl'){
        let cached=glyphCache.get(node);
        if(!cached||cached.value!==value||cached.font!==parentStyle.font||cached.spacing!==parentStyle.letterSpacing||cached.width!==pr.width||cached.height!==pr.height){
          const lines=[...range.getClientRects()].map(r=>({x:r.x-pr.x,y:r.y-pr.y,width:r.width,height:r.height}));
          cached={value,font:parentStyle.font,spacing:parentStyle.letterSpacing,width:pr.width,height:pr.height,lines,entries:new Map()};glyphCache.set(node,cached);
        }else glyphCacheHits++;
        // Find visible line spans logarithmically. Measuring every character in
        // a long paragraph just to sample one line caused cold-scroll stalls.
        const boundary=(y,after)=>{
          let lo=0,hi=value.length;
          while(lo<hi){const mid=(lo+hi)>>1;range.setStart(node,mid);range.setEnd(node,mid+1);const top=range.getBoundingClientRect().top-pr.y;glyphReads++;if(top<y-.25||(after&&top<=y+.25))lo=mid+1;else hi=mid;}
          return lo;
        };
        for(const line of cached.lines){
          if(glyphs>=500||paintedGlyphs>=600)break;
          if(!overlaps(bounds(pr.x+line.x,pr.y+line.y,line.width,line.height),clipArea))continue;
          if(line.start===undefined){line.start=boundary(line.y,false);line.end=boundary(line.y,true);}
          for(let i=line.start;i<line.end&&glyphs<500&&paintedGlyphs<600;i++)if(value[i].trim()){
            let entry=cached.entries.get(i);
            if(!entry){range.setStart(node,i);range.setEnd(node,i+1);const r=range.getBoundingClientRect();glyphReads++;entry={char:value[i],x:r.x-pr.x,y:r.y-pr.y,width:r.width,height:r.height};cached.entries.set(i,entry);}
            const r=bounds(pr.x+entry.x,pr.y+entry.y,entry.width,entry.height);
            if(!overlaps(r,clipArea))continue;
            ctx.fillText(entry.char,r.x,r.y+(r.height-ascent-descent)/2+ascent);glyphs++;paintedGlyphs++;
          }
        }
        range.detach();return;
      }
      for(let i=0;i<value.length&&glyphs<500&&paintedGlyphs<600;i++){
        range.setStart(node,i);range.setEnd(node,i+1);const r=range.getBoundingClientRect();glyphReads++;
        if(!overlaps(r,clipArea)||!value[i].trim())continue;
        ctx.fillText(value[i],r.x,r.y+(r.height-ascent-descent)/2+ascent);glyphs++;paintedGlyphs++;
      }
      range.detach();
    }
    function walk(element,depth=0,clipArea=area){
      if(clipArea.width<=0||clipArea.height<=0)return;
      if(depth>35||nodes>240||element.matches('script,style,svg,canvas,video,iframe,[data-glass-control]'))return;
      const r=element.getBoundingClientRect();
      const style=getStyle(element);
      if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<.005)return;
      if(!overlaps(r,clipArea)&&!['visible'].includes(style.overflow))return;
      if(!overlaps(r,clipArea)&&r.width&&r.height)return;
      nodes++;covered.add(element);ctx.save();ctx.globalAlpha*=Number(style.opacity);
      if(style.position==='fixed')hasFixed=true;
      if(overlaps(r,clipArea)){
        ctx.save();rounded(r,style);ctx.clip();background(ctx,style,r,paintImage);ctx.restore();
        if(style.backgroundImage?.includes('url(')||(element.childNodes.length===0&&visibleColor(style.backgroundColor)))register(element,r);
        if(element instanceof HTMLImageElement&&element.complete&&element.naturalWidth){
          const url=new URL(element.currentSrc||element.src,location.href);
          if(url.origin===location.origin||url.protocol==='data:'||url.protocol==='blob:'){
            // Read the selected resource independently of srcset's rounded,
            // density-corrected natural dimensions, preserving its exact ratio.
            const resource=imageResource(url.href),ready=resource.complete&&resource.naturalWidth&&decodedImages.has(resource);
            // Do not synchronously decode cold, offscreen photos just to fill
            // the scroll cache. Their async decode invalidates the cache when ready.
            if(!ready&&(r.top>=innerHeight||r.bottom<=0)){ctx.restore();return;}
            const image=ready?resource:element;
            const scale=style.objectFit==='cover'?Math.max(r.width/image.naturalWidth,r.height/image.naturalHeight):style.objectFit==='contain'?Math.min(r.width/image.naturalWidth,r.height/image.naturalHeight):null;
            const positions=style.objectPosition.split(' '),fraction=v=>v==='left'||v==='top'?0:v==='right'||v==='bottom'?1:Number.isFinite(parseFloat(v))?parseFloat(v)/100:.5;
            const w=scale?image.naturalWidth*scale:r.width,h=scale?image.naturalHeight*scale:r.height;
            const x=r.x+(r.width-w)*fraction(positions[0]),y=r.y+(r.height-h)*fraction(positions[1]);
            const left=Math.max(x,r.x,clipArea.x),top=Math.max(y,r.y,clipArea.y),right=Math.min(x+w,r.right,clipArea.right),bottom=Math.min(y+h,r.bottom,clipArea.bottom);
            ctx.save();rounded(r,style);ctx.clip();
            if(right>left&&bottom>top)try{
              // Responsive <picture>/srcset natural dimensions are density-
              // corrected, but drawImage source rectangles use bitmap pixels.
              // Draw the complete selected image into its fitted destination;
              // the canvas and existing clips bound the sampled region instead.
              const args=ready?[image,(left-x)*image.naturalWidth/w,(top-y)*image.naturalHeight/h,(right-left)*image.naturalWidth/w,(bottom-top)*image.naturalHeight/h,left,top,right-left,bottom-top]:[image,x,y,w,h];
              const masks=split(style.maskImage||style.webkitMaskImage||'none').filter(layer=>layer.startsWith('linear-gradient('));
              if(masks.length){
                // Only the intersecting viewport crop is rasterized. Keep mask
                // coordinates tied to the full photo so its feather never turns
                // into a rectangle where a moving lens samples the photo edge.
                if(!maskedImage){maskedImage=document.createElement('canvas');maskedImage.width=raw.width;maskedImage.height=raw.height;maskedNative=maskedImage.getContext('2d');maskedContext=recorder?recorder.context(maskedImage,maskedNative):maskedNative;}
                maskedContext.setTransform(1,0,0,1,0,0);maskedContext.clearRect(0,0,maskedImage.width,maskedImage.height);
                maskedContext.setTransform(dpr*sx,0,0,dpr*sy,-area.x*dpr*sx,-area.y*dpr*sy);
                maskedContext.drawImage(...args);
                maskedContext.globalCompositeOperation='destination-in';
                for(const mask of masks)background(maskedContext,{backgroundColor:'transparent',backgroundImage:mask},r);
                maskedContext.globalCompositeOperation='source-over';
                ctx.drawImage(maskedImage,area.x,area.y,maskedImage.width/(dpr*sx),maskedImage.height/(dpr*sy));
              }else ctx.drawImage(...args);
              images++;
              // The picture's layout box follows scrolling without following
              // its child's hover scale. The photo itself is repainted above.
              register(element,r,element.parentElement||element);
            }catch{skipped++;}
            ctx.restore();
          }else skipped++;
        }
      }
      const clips=/(hidden|clip|scroll|auto)/.test(style.overflow+style.overflowX+style.overflowY);
      if(clips){rounded(r,style);ctx.clip();}
      const childArea=clips?intersect(clipArea,r):clipArea;
      pseudo(element,'::before',r);
      // Keep the site's ordinary positioned descendants in their local z order.
      const children=[...element.childNodes].map((node,index)=>({node,index,z:node.nodeType===1?parseInt(getStyle(node).zIndex)||0:0})).sort((a,b)=>a.z-b.z||a.index-b.index);
      for(const {node} of children){if(node.nodeType===1)walk(node,depth+1,childArea);else if(node.nodeType===3)text(node,style,childArea);}
      pseudo(element,'::after',r);ctx.restore();
    }
    if(root)walk(root);
    const walked=performance.now();
    // Optional foreground control beneath this glass. Keeping it outside the
    // DOM walker prevents recursion between the navbar and button materials.
    const underlays=underlay?.(ctx,area)?1:0;
    const blurred=performance.now();
    const measurement={nodes,images,backgrounds,skipped,underlays,glyphCacheHits,glyphReads,scrollMargin,cacheOriginY:origin.y,walkMs:walked-start,underlayMs:blurred-walked,blur:hasCanvasBlur()?'canvas-filter':'bounded-box-blur'};
    if(recorder){
      const stageGeometry=geometry(),duration=performance.now()-start;
      restore(oldGeometry);ctx=rawContext;maskedContext=maskedNative;pending=true;
      if(scrollMargin)nextTouchCapture=performance.now()+8;
      recorder.render({frostWidth:frost.width,frostHeight:frost.height,radius:SURFACE.blur*frostDpr,software:!hasCanvasBlur()}).then(data=>{
        pending=false;
        if(disposed){data.raw.close();data.frost.close();return;}
        prepared={data,geometry:stageGeometry,stats:{...measurement,duration,blurMs:0,maxDuration:Math.max(stats.maxDuration||0,duration)},start,revision:stageRevision};onDirty?.();
      }).catch(()=>{pending=false;if(disposed)return;rasterizer?.destroy();rasterizer=null;invalidate();});
      recorder=null;return false;
    }
    fc.setTransform(1,0,0,1,0,0);fc.clearRect(0,0,frost.width,frost.height);
    if(hasCanvasBlur()){fc.filter=`blur(${SURFACE.blur*frostDpr}px) saturate(${SURFACE.saturation})`;fc.drawImage(raw,0,0,frost.width,frost.height);fc.filter='none';}
    else{
      fc.drawImage(raw,0,0,frost.width,frost.height);soften(fc,Math.max(1,Math.round(SURFACE.blur*frostDpr)));
    }
    const duration=performance.now()-start;
    if(scrollMargin)nextTouchCapture=performance.now()+8;
    previousGeometry=oldGeometry;closeFront();frontRaw=raw;frontFrost=frost;frontValid=true;
    stats={...measurement,captures:stats.captures+1,duration,blurMs:performance.now()-blurred,maxDuration:Math.max(stats.maxDuration||0,duration),worker:false};return true;
  }
  return {get raw(){return frontRaw;},get frost(){return frontFrost;},extent,origin,capture,invalidate,get offset(){return offset();},get previousOffset(){return offsetFor(previousGeometry||geometry());},get previousOrigin(){return {x:0,y:previousGeometry?.originY||0};},get animating(){return performance.now()<animatedUntil||imageMoving(performance.now());},get dirty(){return dirty||pending||!!prepared||performance.now()<animatedUntil||imageMoving(performance.now());},get stats(){return {...stats,pending};},destroy(){disposed=true;imageTransforms.clear();rasterizer?.destroy();closeFront();prepared?.data.raw.close();prepared?.data.frost.close();imageCache.clear();observer.disconnect();document.removeEventListener('scroll',invalidate,true);document.removeEventListener('load',invalidate,true);effectEvents.forEach(type=>root?.removeEventListener(type,effect,true));document.fonts?.removeEventListener('loadingdone',fontsChanged);}};
}
