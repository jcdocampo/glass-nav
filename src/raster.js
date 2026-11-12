// Record this site's bounded Canvas2D paint on the main thread, then rasterize
// it in a module worker. DOM geometry stays here; expensive pixels stay there.
export function createRasterizer() {
  if(typeof Worker!=='function'||typeof OffscreenCanvas!=='function'||typeof createImageBitmap!=='function')return null;
  let worker;
  try{worker=new Worker(new URL('./raster-worker.js',import.meta.url),{type:'module'});}catch{return null;}
  let disposed=false,failed=false,serial=0,assetSerial=0;
  const waiting=new Map(),assets=new WeakMap();
  const fail=()=>{failed=true;for(const task of waiting.values()){clearTimeout(task.timeout);task.reject(new Error('Raster worker unavailable'));}waiting.clear();};
  worker.onerror=event=>{event.preventDefault();fail();};
  worker.onmessage=({data})=>{
    const task=waiting.get(data.id);
    if(!task){data.raw?.close();data.frost?.close();return;}
    waiting.delete(data.id);clearTimeout(task.timeout);
    if(data.error)task.reject(new Error('Raster worker paint failed'));else task.resolve(data);
  };
  return {
    record(){
      const commands=[],layers=new Map(),jobs=new Map();
      const image=value=>{
        const layer=layers.get(value);if(layer)return {layer:layer.id};
        const dynamic=value instanceof HTMLCanvasElement,key=dynamic?'canvas':value.currentSrc||value.src||'';
        let asset=assets.get(value);
        if(!asset||asset.key!==key){asset={id:++assetSerial,key};assets.set(value,asset);}
        if(!jobs.has(asset.id))jobs.set(asset.id,dynamic?createImageBitmap(value).then(bitmap=>({id:asset.id,bitmap})):Promise.resolve({id:asset.id,url:key}));
        return {asset:asset.id};
      };
      const context=(canvas,native)=>{
        if(layers.has(canvas))return layers.get(canvas).proxy;
        const layer={id:layers.size,width:canvas.width,height:canvas.height};layers.set(canvas,layer);
        const state={globalAlpha:1,font:native.font,letterSpacing:native.letterSpacing},stack=[];
        const encode=value=>value?._gradient||value;
        layer.proxy=new Proxy(native,{
          get(target,key){
            if(key==='canvas')return canvas;
            if(key==='strokePath')return path=>commands.push({layer:layer.id,op:'strokePath',args:[path]});
            if(key==='createLinearGradient')return (...args)=>{
              const validation=target.createLinearGradient(...args),description={gradient:args,stops:[]};
              return {_gradient:description,addColorStop(offset,color){validation.addColorStop(offset,color);description.stops.push([offset,color]);}};
            };
            if(key in state)return state[key];
            const value=target[key];
            if(typeof value!=='function')return value;
            if(key==='measureText')return value.bind(target);
            return (...args)=>{
              if(key==='save')stack.push({...state});
              if(key==='restore')Object.assign(state,stack.pop());
              commands.push({layer:layer.id,op:key,args:key==='drawImage'?[image(args[0]),...args.slice(1)]:args});
            };
          },
          set(target,key,value){state[key]=value;if(key==='font'||key==='letterSpacing')target[key]=value;commands.push({layer:layer.id,set:key,value:encode(value)});return true;},
        });
        return layer.proxy;
      };
      return {context,async render(options){
        const decoded=await Promise.all(jobs.values());
        if(disposed||failed){decoded.forEach(asset=>asset.bitmap?.close());throw new Error('Raster worker unavailable');}
        const id=++serial;
        return new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>{waiting.delete(id);reject(new Error('Raster worker timed out'));},3000);
          waiting.set(id,{resolve,reject,timeout});
          worker.postMessage({id,...options,commands,layers:[...layers.values()].map(({id,width,height})=>({id,width,height})),assets:decoded},decoded.flatMap(asset=>asset.bitmap?[asset.bitmap]:[]));
        });
      }};
    },
    destroy(){disposed=true;worker.terminate();fail();},
  };
}
