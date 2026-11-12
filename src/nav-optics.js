// A small known-source lens. The texture contains only the existing tab SVGs
// and labels, at their measured DOM positions. An optional bounded page scene
// supplies surrounding color/image/text pixels without a screenshot API.
import { SURFACE, opticalDpr } from './background.js';
// The outer navbar uses its own bounded contact scale, independent of lens strain.
export const OPTICS = Object.freeze({ edge: 14, refraction: 5.5, dispersion: 0.63, backgroundEdge: 18, backgroundRefraction: 7.25, backgroundDispersion: 1.38, backgroundBulge: .65, taper: 0, compression: .18, highlight: 0.42, shadow: 0.13, trackWidth: 0, trackHeight: 0, padding: 60, maxDpr: 2.5 });
// Outer rim folds the neighboring scene across its surface normal. Unlike the
// selection lens's pixel displacement, refraction here is the fold gain.
export const TRACK_MATERIAL = Object.freeze({ opacity: .70, clarity: .62 });
export const TRACK_OPTICS = Object.freeze({ edge: 20, refraction: 2.4, dispersion: 2.35 });
// Preserve the familiar gray over white, but transmit enough blurred color
// for the selection to read as frosted material rather than a painted fill.
export const RESTING_OPACITY = .55;
export const RESTING_COLOR = Object.freeze([208,208,217]);

// Default material and optics for the elastic lens.
// Keep the later symmetric contour; compression is the original optical track
// setting, independent of the shared background/button surface configuration.
// An odd horizontal warp keeps both ends mirrored and equally tall. Only
// horizontal curvature changes; its inverse Jacobian preserves rim thickness.
export function lensWarpX(x,width,contour=0){const s=Math.max(-.06,Math.min(.06,contour)),half=width/2;return s?x*(1+s-s*(x/half)**2):x;}
function lensUnwarpX(x,width,contour){
  const s=Math.max(-.06,Math.min(.06,contour)),half=width/2,u=x/half;
  if(!s)return {x,jacobian:1};
  if(u>1)return {x:half+(x-half)/(1-2*s),jacobian:1/(1-2*s)};
  if(u< -1)return {x:-half+(x+half)/(1-2*s),jacobian:1/(1-2*s)};
  let a=u;for(let i=0;i<3;i++)a-=(a*(1+s-s*a*a)-u)/(1+s-3*s*a*a);
  return {x:a*half,jacobian:1/(1+s-3*s*a*a)};
}
export function lensField(x,y,{width,height,flow=0,contour=0}) {
  const warp=lensUnwarpX(x,width,contour);x=warp.x;
  const half=width/2,r=Math.min(width,height)/2,straight=Math.max(0,half-r),vertical=Math.max(0,height/2-r),tilt=Math.max(-1,Math.min(1,flow))*OPTICS.taper;
  const f=1+tilt*Math.max(-1,Math.min(1,x/half));
  const qx=x-Math.max(-straight,Math.min(straight,x)),qy=y/f-Math.max(-vertical,Math.min(vertical,y/f)),length=Math.hypot(qx,qy);
  const nx=length?qx/length:0,ny=length?qy/length:1;
  if(!tilt&&!contour)return {distance:length-r,nx,ny};
  const derivative=Math.abs(x)<half?tilt/half:0;
  const gx=(nx-ny*y*derivative/(f*f))*warp.jacobian,gy=ny/f,scale=Math.hypot(gx,gy);
  return {distance:(length-r)/scale,nx:gx/scale,ny:gy/scale};
}

function lensPath(ctx,state,pad) {
  const {x,y,width,height,flow=0,contour=0}=state;
  ctx.beginPath();
  const r=Math.min(width,height)/2,straight=Math.max(0,width/2-r),vertical=Math.max(0,height/2-r);
  if(Math.abs(flow)<.0001&&!contour){ctx.roundRect(x+pad-width/2,y+pad-height/2,width,height,r);return;}
  for(let corner=0;corner<4;corner++)for(let i=0;i<=32;i++){
    const angle=-Math.PI/2+corner*Math.PI/2+i*Math.PI/64;
    const px=(corner<2?straight:-straight)+r*Math.cos(angle);
    const py=((corner===0||corner===3?-vertical:vertical)+r*Math.sin(angle))*(1+OPTICS.taper*flow*px/(width/2));
    const warped=lensWarpX(px,width,contour);
    if(!corner&&!i)ctx.moveTo(x+pad+warped,y+pad+py);else ctx.lineTo(x+pad+warped,y+pad+py);
  }
  ctx.closePath();
}

const vertex = `attribute vec2 position; varying vec2 uv; void main(){uv=(position+1.)*.5;gl_Position=vec4(position,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 uv;
uniform sampler2D source, backdrop, frosted, fixedRaw, fixedSoft, previousRaw, previousSoft;
uniform vec2 previousOffset, previousOrigin, appearance;
uniform float backgroundBlend;
uniform vec4 fixedRect;
uniform float fixedAvailable;
uniform vec2 size, center, lens, track, trackScale, backgroundOffset, backgroundSize, backgroundOrigin;
uniform float material, edge, bend, prism, backgroundEdge, backgroundBend, backgroundPrism, trackEdge, trackBend, trackPrism, shine, shade, pixel, backgroundAvailable, baseInk, glassTrack, clearLens, relaxation, compression, flow, contour;
vec3 field(vec2 p){
  float r=min(lens.x,lens.y)*.5,halfWidth=lens.x*.5,straight=max(0.,halfWidth-r),vertical=max(0.,lens.y*.5-r);
  float shape=clamp(contour,-.06,.06),sx=p.x,jacobian=1.;
  if(abs(shape)>.000001){
    float u=p.x/halfWidth;
    if(u>1.){jacobian=1./(1.-2.*shape);sx=halfWidth+(p.x-halfWidth)*jacobian;}
    else if(u< -1.){jacobian=1./(1.+2.*shape);sx=-halfWidth+(p.x+halfWidth)*jacobian;}
    else{float a=u;for(int i=0;i<3;i++){a-=(a*(1.+shape-shape*a*a)-u)/(1.+shape-3.*shape*a*a);}sx=a*halfWidth;jacobian=1./(1.+shape-3.*shape*a*a);}
  }
  float tilt=flow*${OPTICS.taper.toFixed(3)};
  float f=1.+tilt*clamp(sx/halfWidth,-1.,1.);
  vec2 q=vec2(sx-clamp(sx,-straight,straight),p.y/f-clamp(p.y/f,-vertical,vertical));
  float len=length(q),distance=len-r;
  if(abs(tilt)<.000001&&abs(shape)<.000001)return vec3(distance,normalize(q+vec2(.00001)));
  vec2 n=len>.00001?q/len:vec2(0.,1.);
  float derivative=abs(sx)<halfWidth?tilt/halfWidth:0.;
  vec2 gradient=vec2((n.x-n.y*p.y*derivative/(f*f))*jacobian,n.y/f);
  float scale=length(gradient);
  return vec3(distance/scale,gradient/scale);
}
float ink(vec2 p){return texture2D(source,vec2(p.x/size.x,p.y/size.y)).a;}
float trackField(vec2 p,float compressed){
  vec2 q=p-vec2(${OPTICS.padding.toFixed(1)})-track*.5;
  vec2 dimensions=track*trackScale;
  q.y*=1.+compression*material*compressed;
  float r=dimensions.y*.5;
  return length(vec2(q.x-clamp(q.x,-(dimensions.x-dimensions.y)*.5,(dimensions.x-dimensions.y)*.5),q.y))-r;
}
// Fixed controls use viewport coordinates, independent of the scrolling cache.
vec4 fixedColor(vec2 p,float soft){
  if(fixedAvailable<.5)return vec4(0.);
  vec2 uv=(p-fixedRect.xy)/fixedRect.zw;
  if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.)return vec4(0.);
  if(soft>.5)return texture2D(fixedSoft,uv);
  return texture2D(fixedRaw,uv);
}
vec3 pageAt(vec2 p){vec4 f=fixedColor(p,0.);return mix(mix(texture2D(previousRaw,(p+previousOffset+previousOrigin)/backgroundSize).rgb,texture2D(backdrop,(p+backgroundOffset+backgroundOrigin)/backgroundSize).rgb,backgroundBlend),f.rgb,f.a);}
vec3 softAt(vec2 p){vec4 f=fixedColor(p,1.);return mix(mix(texture2D(previousSoft,(p+previousOffset+previousOrigin)/backgroundSize).rgb,texture2D(frosted,(p+backgroundOffset+backgroundOrigin)/backgroundSize).rgb,backgroundBlend),f.rgb,f.a);}
// The full track is a second, stationary glass surface in this same pass.
// Its material is independent of the moving selection's glass/gray handoff.
vec3 trackGlassColor(vec2 p){
  vec2 dimensions=track*trackScale;
  vec2 q=p-vec2(${OPTICS.padding.toFixed(1)})-track*.5;
  float r=dimensions.y*.5,straight=(dimensions.x-dimensions.y)*.5;
  vec2 curve=vec2(q.x-clamp(q.x,-straight,straight),q.y);
  float d=length(curve)-r;
  vec2 normal=normalize(curve+vec2(.00001));
  float profile=pow(1.-clamp(-d/trackEdge,0.,1.),2.);
  vec2 direction=normal;
  float depth=max(0.,-d);
  // Reverse the normal coordinate in the narrow rim, then ease back into the
  // registered center. Tangential coordinates do not slide or magnify.
  float fold=1.-smoothstep(5.,trackEdge,depth);
  vec2 point=p+normal*depth*fold*trackBend;
  vec2 uv=(point+backgroundOffset+backgroundOrigin)/backgroundSize;
  vec3 page=pageAt(point);
  // Contrast-dependent dispersion at the real page edges, not a rainbow rim.
  if(profile>.0001&&trackPrism>.0){
    vec3 gx=pageAt(point+vec2(2.,0.))-pageAt(point-vec2(2.,0.));
    vec3 gy=pageAt(point+vec2(0.,2.))-pageAt(point-vec2(0.,2.));
    float contrast=smoothstep(.035,.28,max(length(gx),length(gy)));
    vec2 gradient=vec2(gx.r,gy.r),candidate=vec2(gx.g,gy.g);
    if(dot(candidate,candidate)>dot(gradient,gradient))gradient=candidate;
    candidate=vec2(gx.b,gy.b);
    if(dot(candidate,candidate)>dot(gradient,gradient))gradient=candidate;
    vec2 prismDirection=direction;
    if(length(gradient)>.0001){gradient=normalize(gradient);if(dot(gradient,direction)<0.)gradient=-gradient;prismDirection=normalize(mix(direction,gradient,.8));}
    vec2 spread=prismDirection*profile*trackPrism*contrast;
    page=vec3(pageAt(point-spread).r,page.g,pageAt(point+spread).b);
  }
  vec3 soft=softAt(point);
  vec3 fill=mix(mix(soft,page,appearance.y),vec3(1.),appearance.x);
  float rim=exp(-abs(d+.65)*2.1),inner=exp(-abs(d+2.5)*.65);
  fill-=vec3(.035,.030,.020)*inner*(.4+max(normal.y,0.));
  return mix(fill,vec3(1.),rim*shine*(.4+max(-normal.y,0.)*.6));
}
vec3 surface(vec2 p){
  vec2 uv=(p+backgroundOffset+backgroundOrigin)/backgroundSize;
  vec3 page=pageAt(p);
  if(clearLens>.5)return page;
  vec3 soft=softAt(p);
  // The outer track has a bounded contact response; beneath the lens it compresses
  // optically. Glyph layout, page images and hit areas stay registered.
  float d=trackField(p,1.);
  float mask=1.-smoothstep(-pixel,pixel,d);
  vec3 trackColor=mix(mix(soft,page,.55),vec3(1.),${(SURFACE.opacity*.96).toFixed(3)});
  if(glassTrack>.5&&mask>.001)trackColor=trackGlassColor(p);
  return mix(mix(page,vec3(1.),.20),trackColor,mask);
}
vec4 baseSurface(vec2 p,float shadow){
  float a=baseInk*ink(p);
  if(baseInk>.5&&backgroundAvailable>.5){
    float tm=1.-smoothstep(-pixel,pixel,trackField(p,0.));
    vec3 color=mix(softAt(p),vec3(1.),${SURFACE.opacity.toFixed(2)});
    if(glassTrack>.5&&tm>.001)color=trackGlassColor(p);
    float alpha=tm+shadow*(1.-tm);
    return vec4(color*tm*(1.-shadow)*(1.-a),a+alpha*(1.-a));
  }
  return vec4(0.,0.,0.,a+shadow*(1.-a));
}
vec3 restingFill(vec2 p){
  vec3 gray=vec3(229.,229.,234.)/255.;
  if(backgroundAvailable<.5)return gray;
  return mix(softAt(p),vec3(${RESTING_COLOR.map(v=>`${v}.`).join(',')})/255.,${RESTING_OPACITY});
}
void main(){
  vec2 p=vec2(uv.x,1.-uv.y)*size;
  vec2 q=p-center;
  vec3 geometry=field(q);
  float d=geometry.x;
  float mask=1.-smoothstep(-pixel,pixel,d);
  float shadowDistance=field(q-vec2(0.,2.+material*2.)).x;
  float shadow=exp(-max(0.,shadowDistance)/3.5)*shade*material;
  if(mask<.001){
    gl_FragColor=baseSurface(p,shadow);
    return;
  }
  // Gray-dominant frost is composited opaquely, including the perimeter seam.
  if(material<=0.){
    vec3 color=mix(restingFill(p),vec3(0.,.478431,1.),ink(p));
    gl_FragColor=vec4(color*mask,mask);
    // Antialias onto the glass already beneath the selection. A transparent
    // seam here exposed the page and looked like a dark outline around gray.
    if(glassTrack>.5&&mask<.999)gl_FragColor+=baseSurface(p,0.)*(1.-mask);
    return;
  }
  vec2 normal=geometry.yz;
  // Zero displacement throughout the center. A smooth, nonlinear annulus
  // refracts the curved perimeter; its CSS-pixel thickness never stretches.
  float t=clamp(-d/edge,0.,1.);
  float profile=(1.-t)*(1.-t);
  float offset=profile*bend*material;
  vec2 samplePoint=p-normal*offset;
  float split=profile*prism*material;
  vec3 a=vec3(ink(samplePoint-normal*split),ink(samplePoint),ink(samplePoint+normal*split));
  vec3 blue=vec3(0.,.478431,1.);
  vec3 fill=mix(restingFill(p),vec3(.985,.991,1.),material);
  if(backgroundAvailable>.5){
    float bt=clamp(-d/backgroundEdge,0.,1.);
    float backgroundProfile=(1.-bt)*(1.-bt);
    // A domed surface also slopes toward the center along the flatter top and
    // bottom. This bends color boundaries crossing those regions, rather than
    // treating the lens as an extrusion with vertical-only refraction there.
    vec2 radial=normalize(q/(lens*.5)+vec2(.00001));
    vec2 direction=normalize(mix(normal,radial,${OPTICS.backgroundBulge.toFixed(2)}));
    vec2 backgroundPoint=p-direction*backgroundProfile*backgroundBend*material;
    // Dispersion is driven by real page contrast, rather than by the synthetic
    // track edge. Uniform backgrounds cannot create a fixed rainbow border.
    vec2 uv=(backgroundPoint+backgroundOffset+backgroundOrigin)/backgroundSize;
    vec3 gx=pageAt(backgroundPoint+vec2(2.,0.))-pageAt(backgroundPoint-vec2(2.,0.));
    vec3 gy=pageAt(backgroundPoint+vec2(0.,2.))-pageAt(backgroundPoint-vec2(0.,2.));
    float contrast=smoothstep(.035,.28,max(length(gx),length(gy)));
    // Resolve channel separation across the source boundary too. A vertical
    // white divider can then fan out at a flatter top/bottom edge, as in the
    // supplied crops. The direction remains oriented by the lens geometry.
    vec2 gradient=vec2(gx.r,gy.r),candidate=vec2(gx.g,gy.g);
    if(dot(candidate,candidate)>dot(gradient,gradient))gradient=candidate;
    candidate=vec2(gx.b,gy.b);
    if(dot(candidate,candidate)>dot(gradient,gradient))gradient=candidate;
    vec2 prismDirection=direction;
    if(length(gradient)>.0001){
      gradient=normalize(gradient);
      if(dot(gradient,direction)<0.)gradient=-gradient;
      prismDirection=normalize(mix(direction,gradient,.8));
    }
    float spread=backgroundProfile*backgroundPrism*material*contrast;
    vec3 refracted=vec3(surface(backgroundPoint-prismDirection*spread).r,surface(backgroundPoint).g,surface(backgroundPoint+prismDirection*spread).b);
    fill=mix(restingFill(p),refracted,material);
  }
  // Only a narrow silhouette highlight and inner shade, never a thick rim.
  float extraFrost=clamp((.62-appearance.y)/.62,0.,1.);
  fill=mix(fill,mix(softAt(p),vec3(1.),appearance.x),extraFrost*material*(1.-clearLens));
  float rim=exp(-abs(d+.65+relaxation*.15)*2.1)*material;
  float inner=exp(-abs(d+2.5)*.65)*material;
  fill-=vec3(.035,.030,.020)*inner*(.4+max(normal.y,0.));
  fill=mix(fill,vec3(1.),rim*shine*(.4+max(-normal.y,0.)*.6));
  vec3 color=mix(fill,blue,a);
  float alpha=mask+shadow*(1.-mask);
  gl_FragColor=vec4(color*mask,alpha);
  if(glassTrack>.5&&mask<.999)gl_FragColor=vec4(color*mask,mask)+baseSurface(p,shadow)*(1.-mask);
}`;

function labelBaseline(label, style) {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;padding:0;margin:0;';
  probe.style.font = style.font;
  probe.style.lineHeight = style.lineHeight;
  probe.style.letterSpacing = style.letterSpacing;
  probe.textContent = label.textContent;
  const marker = document.createElement('i');
  marker.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline';
  probe.append(marker);
  document.body.append(probe);
  const rect = probe.getBoundingClientRect();
  const zoom = rect.height / parseFloat(getComputedStyle(probe).height) || 1;
  const baseline = (marker.getBoundingClientRect().top - rect.top) / zoom;
  probe.remove();
  return baseline;
}

export async function measureScene(pill) {
  const bounds = pill.getBoundingClientRect();
  const layout = getComputedStyle(pill);
  const box = axis => parseFloat(layout[axis]) + (layout.boxSizing === 'border-box' ? 0 : axis === 'width' ? parseFloat(layout.paddingLeft)+parseFloat(layout.paddingRight) : parseFloat(layout.paddingTop)+parseFloat(layout.paddingBottom));
  const width = box('width'), height = box('height');
  const scaleX = width / bounds.width, scaleY = height / bounds.height;
  const pad = OPTICS.padding;
  const dpr = opticalDpr(OPTICS.maxDpr);
  const atlas = document.createElement('canvas');
  atlas.width = Math.ceil((width + pad * 2) * dpr);
  atlas.height = Math.ceil((height + pad * 2) * dpr);
  const ctx = atlas.getContext('2d', { willReadFrequently: true });
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#000';
  const tabs = [];
  await Promise.all([...pill.querySelectorAll('.nb')].map(async button => {
    const r = button.getBoundingClientRect();
    const tab = { id: button.dataset.nav, x: (r.left-bounds.left)*scaleX + r.width*scaleX/2, y: (r.top-bounds.top)*scaleY+r.height*scaleY/2, width: r.width*scaleX, height: r.height*scaleY };
    tabs.push(tab);
    const svg = button.querySelector('svg');
    const iconRect = svg.getBoundingClientRect();
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if(copy.getAttribute('stroke')!=='none')copy.setAttribute('stroke', '#000');
    copy.style.cssText = 'color:#000;';
    const img = new Image();
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    try {
      img.src = url;
      await img.decode();
      ctx.drawImage(img, pad+(iconRect.left-bounds.left)*scaleX, pad+(iconRect.top-bounds.top)*scaleY, iconRect.width*scaleX, iconRect.height*scaleY);
    } finally { URL.revokeObjectURL(url); }
    const label = button.querySelector('span');
    const lr = label.getBoundingClientRect(), style = getComputedStyle(label);
    ctx.font = style.font;
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = style.letterSpacing;
    const x = pad+(lr.left-bounds.left)*scaleX;
    const y = pad+(lr.top-bounds.top)*scaleY+labelBaseline(label, style);
    if ('letterSpacing' in ctx) ctx.fillText(label.textContent, x, y);
    else {
      let cursor = x;
      for (const char of label.textContent) { ctx.fillText(char, cursor, y); cursor += ctx.measureText(char).width + (parseFloat(style.letterSpacing)||0); }
    }
  }));
  tabs.sort((a,b) => a.x-b.x);
  return { atlas, tabs, width, height, dpr, pad, canvasWidth: atlas.width/dpr, canvasHeight: atlas.height/dpr };
}

function makeProgram(gl) {
  const compile = (type, code) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  const shaders = [compile(gl.VERTEX_SHADER, vertex), compile(gl.FRAGMENT_SHADER, fragment)];
  shaders.forEach(shader => gl.attachShader(program, shader)); gl.linkProgram(program);
  shaders.forEach(shader => gl.deleteShader(shader));
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

export function createRenderer(pill, scene, { forceFallback = false, includeBase = false, glassTrack = false, clearLens = false, onContextLost = () => {} } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'nav-liquid-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = `position:absolute;pointer-events:none;left:-${scene.pad}px;top:-${scene.pad}px;width:${scene.canvasWidth}px;height:${scene.canvasHeight}px;z-index:3;`;
  canvas.width = scene.atlas.width; canvas.height = scene.atlas.height;
  let gl = null, program, buffer, texture;
  const backgroundTextures=[];
  try {
    if (!forceFallback) gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, depth: false, stencil: false, preserveDrawingBuffer: true });
    if (gl) {
      program = makeProgram(gl); gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,scene.atlas);
      for(const unit of [1,2,3,4,5,6]){
        gl.activeTexture(gl.TEXTURE0+unit);const image=gl.createTexture();backgroundTextures.push(image);gl.bindTexture(gl.TEXTURE_2D,image);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(unit<3?[255,255,255,255]:[0,0,0,0]));
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.viewport(0,0,canvas.width,canvas.height);
    }
  } catch (error) {
    gl?.deleteTexture(texture); gl?.deleteBuffer(buffer); gl?.deleteProgram(program);
    backgroundTextures.forEach(image=>gl?.deleteTexture(image));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
    if(!forceFallback)return createRenderer(pill,scene,{forceFallback:true,includeBase,glassTrack,clearLens,onContextLost});
    throw error;
  }
  // Canvas2D fallback: same shape/registration and material, without refraction
  // or dispersion. Ordinary semantic DOM buttons remain available throughout.
  const ctx = gl ? null : canvas.getContext('2d');
  let fallbackInk;
  if (ctx) {
    fallbackInk=document.createElement('canvas');fallbackInk.width=scene.atlas.width;fallbackInk.height=scene.atlas.height;
    const ic=fallbackInk.getContext('2d');ic.drawImage(scene.atlas,0,0);ic.globalCompositeOperation='source-in';ic.fillStyle='#007aff';ic.fillRect(0,0,fallbackInk.width,fallbackInk.height);
  }
  const uniform = name => gl.getUniformLocation(program,name);
  const locations = gl ? Object.fromEntries(['appearance','previousOffset','previousOrigin','backgroundBlend','fixedRect','fixedAvailable','size','center','lens','track','trackScale','backgroundOffset','backgroundSize','backgroundOrigin','material','edge','bend','prism','backgroundEdge','backgroundBend','backgroundPrism','trackEdge','trackBend','trackPrism','flow','contour','shine','shade','pixel','backgroundAvailable','baseInk','glassTrack','clearLens','relaxation','compression'].map(name => [name,uniform(name)])) : null;
  if(gl){gl.uniform1i(uniform('backdrop'),1);gl.uniform1i(uniform('frosted'),2);gl.uniform1i(uniform('fixedRaw'),3);gl.uniform1i(uniform('fixedSoft'),4);gl.uniform1i(uniform('previousRaw'),5);gl.uniform1i(uniform('previousSoft'),6);gl.uniform1f(locations.baseInk,includeBase?1:0);gl.uniform1f(locations.glassTrack,glassTrack?1:0);gl.uniform1f(locations.clearLens,clearLens?1:0);gl.uniform2f(locations.track,scene.width,scene.height);}
  let appearance={...TRACK_MATERIAL};
  let backgroundSource=null,underlaySource=null,fixedBox=null,fixedRevision=-1,fixedImage=null;
  const backgroundSizes=new Map();
  let blendStart=0,blendDuration=0,backgroundTime=0;
  const smoothBackground=matchMedia('(any-pointer: coarse)').matches;
  function setBackground(source){
    const hadBackground=!!backgroundSource; backgroundSource=source;
    if(!gl)return;
    const now=performance.now();
    blendDuration=hadBackground&&smoothBackground&&source.animating?Math.min(65,Math.max(16,(now-backgroundTime)*.8)):0;
    blendStart=now;backgroundTime=now;
    gl.uniform2f(locations.backgroundSize,source.extent?.width||scene.canvasWidth,source.extent?.height||scene.canvasHeight);
    gl.uniform2f(locations.backgroundOrigin,source.origin?.x||0,source.origin?.y||0);
    if(hadBackground)for(let i=0;i<2;i++)[backgroundTextures[i],backgroundTextures[4+i]]=[backgroundTextures[4+i],backgroundTextures[i]];
    const upload=(image,index)=>{
      const texture=backgroundTextures[index],size=`${image.width}x${image.height}`;
      gl.activeTexture(gl.TEXTURE1+index);gl.bindTexture(gl.TEXTURE_2D,texture);
      if(backgroundSizes.get(texture)===size)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,image);
      else{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);backgroundSizes.set(texture,size);}
    };
    [source.raw,source.frost].forEach((image,i)=>{upload(image,i);if(!hadBackground)upload(image,4+i);else{gl.activeTexture(gl.TEXTURE5+i);gl.bindTexture(gl.TEXTURE_2D,backgroundTextures[4+i]);}});
    gl.activeTexture(gl.TEXTURE0);gl.uniform1f(locations.backgroundAvailable,1);
  }
  function setUnderlay(source){
    underlaySource=source;
    if(gl)gl.uniform1f(locations.fixedAvailable,source?1:0);
    if(!source)return;
    const p=pill.getBoundingClientRect(),sx=scene.width/p.width,sy=scene.height/p.height,r=source.rect;
    fixedBox={x:(r.left-p.x)*sx+scene.pad,y:(r.top-p.y)*sy+scene.pad,width:r.width*sx,height:r.height*sy};
    if(!gl)return;
    gl.uniform4f(locations.fixedRect,fixedBox.x,fixedBox.y,fixedBox.width,fixedBox.height);
    if(fixedRevision!==source.revision||fixedImage!==source.image){
      [source.image,source.frost].forEach((image,i)=>{
        gl.activeTexture(gl.TEXTURE3+i);gl.bindTexture(gl.TEXTURE_2D,backgroundTextures[2+i]);
        if(fixedImage===source.image)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,image);
        else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      });
      fixedRevision=source.revision;fixedImage=source.image;
    }
    gl.activeTexture(gl.TEXTURE0);
  }
  function draw(state, optical = OPTICS) {
    const { x,y,width,height,material } = state;
    if(gl)gl.uniform2f(locations.appearance,appearance.opacity,appearance.clarity);
    if (gl) {
      const previous=backgroundSource?.previousOffset||state.backgroundOffset||{x:0,y:0},previousOrigin=backgroundSource?.previousOrigin||backgroundSource?.origin||{x:0,y:0};
      gl.uniform2f(locations.previousOffset,previous.x,previous.y);gl.uniform2f(locations.previousOrigin,previousOrigin.x,previousOrigin.y);
      gl.uniform1f(locations.backgroundBlend,blendDuration?Math.min(1,(performance.now()-blendStart)/blendDuration):1);
      gl.uniform2f(locations.size,scene.canvasWidth,scene.canvasHeight);
      gl.uniform2f(locations.center,x+scene.pad,y+scene.pad);
      gl.uniform2f(locations.lens,width,height);
      gl.uniform2f(locations.trackScale,state.trackScaleX??1,state.trackScaleY??1);
      gl.uniform2f(locations.backgroundOffset,state.backgroundOffset?.x||0,state.backgroundOffset?.y||0);
      gl.uniform1f(locations.relaxation,state.relax||0);
      gl.uniform1f(locations.compression,optical.compression??SURFACE.compression);
      gl.uniform1f(locations.flow,state.flow||0);
      gl.uniform1f(locations.contour,state.contour||0);
      gl.uniform1f(locations.backgroundEdge,optical.backgroundEdge??OPTICS.backgroundEdge);
      gl.uniform1f(locations.backgroundBend,optical.backgroundRefraction??OPTICS.backgroundRefraction);
      gl.uniform1f(locations.backgroundPrism,optical.backgroundDispersion??OPTICS.backgroundDispersion);
      gl.uniform1f(locations.trackEdge,optical.trackEdge??TRACK_OPTICS.edge);
      gl.uniform1f(locations.trackBend,optical.trackRefraction??TRACK_OPTICS.refraction);
      gl.uniform1f(locations.trackPrism,optical.trackDispersion??TRACK_OPTICS.dispersion);
      for (const [key,value] of Object.entries({ material, edge: optical.edge, bend: optical.refraction, prism: optical.dispersion, shine: optical.highlight, shade: optical.shadow, pixel: 0.75/scene.dpr })) gl.uniform1f(locations[key],value);
      gl.drawArrays(gl.TRIANGLES,0,6);
    } else {
      ctx.setTransform(scene.dpr,0,0,scene.dpr,0,0);
      ctx.clearRect(0,0,scene.canvasWidth,scene.canvasHeight);
      if(includeBase&&backgroundSource){
        const tw=scene.width*(state.trackScaleX??1),th=scene.height*(state.trackScaleY??1),tx=scene.pad+(scene.width-tw)/2,ty=scene.pad+(scene.height-th)/2;
        ctx.save();ctx.beginPath();ctx.roundRect(tx,ty,tw,th,th/2);ctx.clip();
        const ox=-(state.backgroundOffset?.x||0)-(backgroundSource.origin?.x||0),oy=-(state.backgroundOffset?.y||0)-(backgroundSource.origin?.y||0);
        ctx.drawImage(backgroundSource.frost,ox,oy,backgroundSource.extent?.width||scene.canvasWidth,backgroundSource.extent?.height||scene.canvasHeight);
        if(underlaySource&&fixedBox)ctx.drawImage(underlaySource.frost,fixedBox.x,fixedBox.y,fixedBox.width,fixedBox.height);
        if(glassTrack){ctx.globalAlpha=appearance.clarity;ctx.drawImage(backgroundSource.raw,ox,oy,backgroundSource.extent?.width||scene.canvasWidth,backgroundSource.extent?.height||scene.canvasHeight);ctx.globalAlpha=1;}
        if(underlaySource&&fixedBox){ctx.globalAlpha=appearance.clarity;ctx.drawImage(underlaySource.image,fixedBox.x,fixedBox.y,fixedBox.width,fixedBox.height);ctx.globalAlpha=1;}
        ctx.fillStyle=`rgb(255 255 255 / ${(glassTrack?appearance.opacity:SURFACE.opacity)})`;ctx.fillRect(tx,ty,tw,th);
        if(glassTrack){ctx.strokeStyle=`rgb(255 255 255 / ${OPTICS.highlight*.7})`;ctx.lineWidth=1;ctx.stroke();}
        ctx.restore();
      }
      if(includeBase){ctx.drawImage(scene.atlas,0,0,scene.canvasWidth,scene.canvasHeight);}
      ctx.save();lensPath(ctx,state,scene.pad);
      const resting=backgroundSource?RESTING_COLOR:[229,229,234];
      const c=Math.round(resting[0]+material*(252-resting[0])), b=Math.round(resting[2]+material*(255-resting[2]));
      ctx.fillStyle=`rgb(${c},${c},${b})`;ctx.fill();ctx.clip();
      if(backgroundSource&&material<1){
        ctx.globalAlpha=(1-RESTING_OPACITY)*(1-material);
        ctx.drawImage(backgroundSource.frost,-(state.backgroundOffset?.x||0)-(backgroundSource.origin?.x||0),-(state.backgroundOffset?.y||0)-(backgroundSource.origin?.y||0),backgroundSource.extent?.width||scene.canvasWidth,backgroundSource.extent?.height||scene.canvasHeight);ctx.globalAlpha=1;
      }
      if(backgroundSource&&material>0){ctx.globalAlpha=clearLens?material:material*.35;ctx.drawImage(clearLens?backgroundSource.raw:backgroundSource.frost,-(state.backgroundOffset?.x||0)-(backgroundSource.origin?.x||0),-(state.backgroundOffset?.y||0)-(backgroundSource.origin?.y||0),backgroundSource.extent?.width||scene.canvasWidth,backgroundSource.extent?.height||scene.canvasHeight);ctx.globalAlpha=1;}
      ctx.drawImage(fallbackInk,0,0,scene.canvasWidth,scene.canvasHeight);ctx.restore();
    }
  }
  const lost = event => { event.preventDefault(); onContextLost(); };
  canvas.addEventListener('webglcontextlost',lost);
  pill.append(canvas);
  return { canvas, scene, mode: gl ? 'webgl' : 'canvas2d', draw, setBackground, setUnderlay, setAppearance(style){appearance={...appearance,...style};}, get needsFrame(){return performance.now()<blendStart+blendDuration;}, destroy() {
    canvas.removeEventListener('webglcontextlost',lost);
    if(gl){backgroundTextures.forEach(image=>gl.deleteTexture(image));gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
    canvas.remove();
  } };
}
