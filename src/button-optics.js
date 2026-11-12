import { createBackgroundSource, opticalDpr, scrollCacheMargin } from './background.js';
import { TRACK_OPTICS, OPTICS, TRACK_MATERIAL } from './nav-optics.js';
export const BUTTON_SURFACE = Object.freeze({ diameter:54, pad:60, size:174 });

// A single button surface, using the navbar's bounded background reconstruction.
// The core stays frosted; only the curved edge samples sharp, refracted colors.
const vertex = `attribute vec2 position; varying vec2 uv;
void main(){uv=(position+1.)*.5;gl_Position=vec4(position,0.,1.);}`;
// Same folded rim, contrast-driven prism and white/soft/sharp mix as the
// outer navbar. This is the button itself, at rest and during interaction.
const fragment = `precision highp float;
varying vec2 uv;
uniform sampler2D backdrop, frosted;
uniform mat2 deformation;
uniform vec2 translation, backgroundOffset, backgroundSize, backgroundOrigin, appearance;
uniform float pixel, bend, prism;
void main(){
  vec2 local=vec2(uv.x,1.-uv.y)*${BUTTON_SURFACE.size.toFixed(1)}-${(BUTTON_SURFACE.size/2).toFixed(1)};
  vec2 gradient=normalize(local+vec2(.00001));
  float determinant=deformation[0][0]*deformation[1][1]-deformation[1][0]*deformation[0][1];
  gradient=vec2(deformation[1][1]*gradient.x-deformation[0][1]*gradient.y,
    -deformation[1][0]*gradient.x+deformation[0][0]*gradient.y)/determinant;
  float distance=(length(local)-${(BUTTON_SURFACE.diameter/2).toFixed(1)})/length(gradient);
  vec2 normal=normalize(gradient);
  float mask=1.-smoothstep(-pixel,pixel,distance);
  if(mask<.001){gl_FragColor=vec4(0.);return;}
  vec2 point=deformation*local+vec2(${(BUTTON_SURFACE.size/2).toFixed(1)})+translation+backgroundOffset;
  float depth=max(0.,-distance);
  float profile=pow(1.-clamp(depth/${TRACK_OPTICS.edge.toFixed(1)},0.,1.),2.);
  float fold=1.-smoothstep(5.,${TRACK_OPTICS.edge.toFixed(1)},depth);
  vec2 uv=(point+normal*depth*fold*bend+backgroundOrigin)/backgroundSize;
  vec3 page=texture2D(backdrop,uv).rgb;
  if(profile>.0001&&prism>0.){
    vec3 gx=texture2D(backdrop,uv+vec2(2./backgroundSize.x,0.)).rgb-texture2D(backdrop,uv-vec2(2./backgroundSize.x,0.)).rgb;
    vec3 gy=texture2D(backdrop,uv+vec2(0.,2./backgroundSize.y)).rgb-texture2D(backdrop,uv-vec2(0.,2./backgroundSize.y)).rgb;
    float contrast=smoothstep(.035,.28,max(length(gx),length(gy)));
    vec2 direction=vec2(gx.r,gy.r),candidate=vec2(gx.g,gy.g);
    if(dot(candidate,candidate)>dot(direction,direction))direction=candidate;
    candidate=vec2(gx.b,gy.b);
    if(dot(candidate,candidate)>dot(direction,direction))direction=candidate;
    if(length(direction)>.0001){direction=normalize(direction);if(dot(direction,normal)<0.)direction=-direction;direction=normalize(mix(normal,direction,.8));}
    else direction=normal;
    vec2 spread=direction*profile*prism*contrast/backgroundSize;
    page=vec3(texture2D(backdrop,uv-spread).r,page.g,texture2D(backdrop,uv+spread).b);
  }
  vec3 soft=texture2D(frosted,uv).rgb;
  vec3 fill=mix(mix(soft,page,appearance.y),vec3(1.),appearance.x);
  float rim=exp(-abs(distance+.65)*2.1),inner=exp(-abs(distance+2.5)*.65);
  fill-=vec3(.035,.030,.020)*inner*(.4+max(normal.y,0.));
  fill=mix(fill,vec3(1.),rim*${OPTICS.highlight.toFixed(2)}*(.4+max(-normal.y,0.)*.6));
  gl_FragColor=vec4(fill*mask,mask);
}`;

export function createButtonOptics(button, surface, wake, {sceneRoot=null}={}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'glass-action-frosted-surface'; canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = `position:absolute;left:-${BUTTON_SURFACE.pad}px;top:-${BUTTON_SURFACE.pad}px;width:${BUTTON_SURFACE.size}px;height:${BUTTON_SURFACE.size}px;pointer-events:none;`;
  const dpr = opticalDpr();
  canvas.width = canvas.height = Math.ceil(BUTTON_SURFACE.size * dpr);
  let gl, program, buffer, source, active = false;
  const shaders = [], textures = [];
  function dispose() {
    source?.destroy();
    if (gl) { textures.forEach(t => gl.deleteTexture(t)); shaders.forEach(s => gl.deleteShader(s)); gl.deleteBuffer(buffer); gl.deleteProgram(program); }
    canvas.remove();surface.classList.remove('has-glass-surface');
  }
  try {
    gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, depth: false, stencil: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    program = gl.createProgram();
    for (const [type, code] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, code); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniform = name => gl.getUniformLocation(program, name);
    const locations = Object.fromEntries(['appearance','deformation','translation','backgroundOffset','backgroundSize','backgroundOrigin','pixel','bend','prism'].map(k => [k, uniform(k)]));
    for (const [unit, name] of ['backdrop','frosted'].entries()) {
      gl.activeTexture(gl.TEXTURE0 + unit); const texture = gl.createTexture(); textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(uniform(name), unit);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    source = createBackgroundSource(button, { width:BUTTON_SURFACE.diameter, height:BUTTON_SURFACE.diameter, pad:BUTTON_SURFACE.pad, canvasWidth:BUTTON_SURFACE.size, canvasHeight:BUTTON_SURFACE.size, dpr }, () => { if (active) wake(); },{root:sceneRoot,scrollMargin:scrollCacheMargin(),asyncRaster:matchMedia('(any-pointer: coarse)').matches});
    gl.uniform2f(locations.backgroundSize,source.extent.width,source.extent.height);gl.uniform2f(locations.backgroundOrigin,source.origin.x,source.origin.y);
    let valid = false, appearance={...TRACK_MATERIAL};
    const textureSizes=[];
    surface.append(canvas);surface.classList.add('has-glass-surface');
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); active = false; dispose(); });
    return {
      invalidate() { source.invalidate(); },
      setAppearance(style){appearance={...appearance,...style};},
      draw(v, time, { bend = TRACK_OPTICS.refraction, prism = TRACK_OPTICS.dispersion } = {}) {
        if (gl.isContextLost()) return;
        gl.uniform2f(locations.appearance,appearance.opacity,appearance.clarity);
        active = true;
        if (source.capture(time, !valid)) {
          valid = true;
          gl.uniform2f(locations.backgroundSize,source.extent.width,source.extent.height);
          gl.uniform2f(locations.backgroundOrigin,source.origin.x,source.origin.y);
          [source.raw, source.frost].forEach((image, unit) => {
            gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
            const size=`${image.width}x${image.height}`;
            if(textureSizes[unit]===size)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,image);
            else{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);textureSizes[unit]=size;}
          });
        }
        gl.uniformMatrix2fv(locations.deformation, false, new Float32Array([v.a, v.b, v.b, v.d]));
        gl.uniform2f(locations.translation, v.x, v.y); gl.uniform2f(locations.backgroundOffset, source.offset.x, source.offset.y);
        gl.uniform1f(locations.pixel, .75 / dpr);
        gl.uniform1f(locations.bend, bend); gl.uniform1f(locations.prism, prism);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
      get pending() { return active && source.dirty; },
      get mode() { return gl.isContextLost() ? 'native-frost' : 'webgl'; },
      get stats() { return source.stats; }, destroy: dispose,
    };
  } catch (error) {
    dispose(); console.warn('button uses native frost because edge rendering is unavailable:', error.message); return null;
  }
}
