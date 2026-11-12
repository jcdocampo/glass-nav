import { blurPixels, SURFACE } from './background.js';

const layers=new Map(),assets=new Map();
let frost,fc,workspace;
self.onmessage=async({data})=>{
  const start=performance.now();
  try{
    await Promise.all(data.assets.map(async asset=>{
      if(!asset.bitmap&&assets.has(asset.id))return;
      const bitmap=asset.bitmap||await createImageBitmap(await(await fetch(asset.url)).blob());assets.get(asset.id)?.close();assets.set(asset.id,bitmap);
    }));
    // Keep only a small warm photo set; revisiting an evicted URL decodes it
    // again in this worker, without retaining every project photo in memory.
    const used=new Set(data.assets.map(asset=>asset.id));
    let bytes=[...assets.values()].reduce((sum,image)=>sum+image.width*image.height*4,0);
    for(const [id,image] of assets)if(!used.has(id)&&(assets.size>8||bytes>24*1024*1024)){bytes-=image.width*image.height*4;image.close();assets.delete(id);}
    for(const layer of data.layers){
      let existing=layers.get(layer.id);
      if(!existing||existing.canvas.width!==layer.width||existing.canvas.height!==layer.height){
        const canvas=new OffscreenCanvas(layer.width,layer.height);
        existing={canvas,ctx:canvas.getContext('2d',{willReadFrequently:true})};layers.set(layer.id,existing);
      }
    }
    for(const command of data.commands){
      const ctx=layers.get(command.layer).ctx;
      if(command.set){
        let value=command.value;
        if(value?.gradient){const gradient=ctx.createLinearGradient(...value.gradient);for(const stop of value.stops)gradient.addColorStop(...stop);value=gradient;}
        ctx[command.set]=value;
      }else if(command.op==='drawImage'){
        const [image,...args]=command.args;ctx.drawImage(image.layer!==undefined?layers.get(image.layer).canvas:assets.get(image.asset),...args);
      }else if(command.op==='strokePath')ctx.stroke(new Path2D(command.args[0]));
      else ctx[command.op](...command.args);
    }
    if(!frost||frost.width!==data.frostWidth||frost.height!==data.frostHeight){
      frost=new OffscreenCanvas(data.frostWidth,data.frostHeight);fc=frost.getContext('2d',{willReadFrequently:true});workspace=new Uint8ClampedArray(data.frostWidth*data.frostHeight*4);
    }
    const raw=layers.get(0).canvas;
    fc.setTransform(1,0,0,1,0,0);fc.clearRect(0,0,frost.width,frost.height);
    if(!data.software&&'filter' in fc){
      fc.filter=`blur(${data.radius}px) saturate(${SURFACE.saturation})`;fc.drawImage(raw,0,0,frost.width,frost.height);fc.filter='none';
    }else{
      fc.drawImage(raw,0,0,frost.width,frost.height);
      const image=fc.getImageData(0,0,frost.width,frost.height);
      image.data.set(blurPixels(image.data,frost.width,frost.height,Math.max(1,Math.round(data.radius)),workspace));fc.putImageData(image,0,0);
    }
    const rawImage=raw.transferToImageBitmap(),frostImage=frost.transferToImageBitmap();
    self.postMessage({id:data.id,raw:rawImage,frost:frostImage,rasterMs:performance.now()-start},[rawImage,frostImage]);
  }catch{self.postMessage({id:data.id,error:true});}
};
