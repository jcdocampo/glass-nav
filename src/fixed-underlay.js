import { SURFACE, hasCanvasBlur } from './background.js';

// Blur transparent sprites in premultiplied RGBA so their soft perimeter does
// not acquire a dark/opaque rectangle on browsers without Canvas2D filters.
export function softenSprite(ctx,radius){
  const {width,height}=ctx.canvas,image=ctx.getImageData(0,0,width,height);
  let a=new Float32Array(image.data.length),b=new Float32Array(a.length);
  for(let i=0;i<a.length;i+=4){const alpha=image.data[i+3]/255;a[i]=image.data[i]*alpha;a[i+1]=image.data[i+1]*alpha;a[i+2]=image.data[i+2]*alpha;a[i+3]=alpha;}
  for(let pass=0;pass<3;pass++)for(const horizontal of [true,false]){
    const length=horizontal?width:height,lines=horizontal?height:width,stride=horizontal?4:width*4,lineStride=horizontal?width*4:4,divisor=radius*2+1;
    for(let line=0;line<lines;line++)for(let channel=0;channel<4;channel++){
      const start=line*lineStride+channel;let sum=0;
      for(let k=0;k<=Math.min(radius,length-1);k++)sum+=a[start+k*stride];
      for(let k=0;k<length;k++){b[start+k*stride]=sum/divisor;if(k-radius>=0)sum-=a[start+(k-radius)*stride];if(k+radius+1<length)sum+=a[start+(k+radius+1)*stride];}
    }
    [a,b]=[b,a];
  }
  for(let i=0;i<a.length;i+=4){const alpha=a[i+3];image.data[i+3]=alpha*255;const light=alpha?(.2126*a[i]+.7152*a[i+1]+.0722*a[i+2])/alpha:0;for(let c=0;c<3;c++)image.data[i+c]=alpha?light+(a[i+c]/alpha-light)*SURFACE.saturation:0;}
  ctx.putImageData(image,0,0);
}

export function createFixedUnderlay(paint){
  const image=document.createElement('canvas'),frost=document.createElement('canvas'),dpr=SURFACE.sampleDpr;
  image.width=image.height=180*dpr;frost.width=frost.height=90;
  const ctx=image.getContext('2d'),fc=frost.getContext('2d',{willReadFrequently:!hasCanvasBlur()});
  let previous=-1,rect=null;
  return (box,revision)=>{
    const next={left:box.left-60,top:box.top-60,right:box.left+120,bottom:box.top+120,width:180,height:180};
    if(previous!==revision||rect?.left!==next.left||rect?.top!==next.top){
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,image.width,image.height);
      ctx.setTransform(dpr,0,0,dpr,-next.left*dpr,-next.top*dpr);paint(ctx,next);
      fc.clearRect(0,0,90,90);
      if(hasCanvasBlur())fc.filter=`blur(${SURFACE.blur*.5}px) saturate(${SURFACE.saturation})`;
      fc.drawImage(image,0,0,90,90);fc.filter='none';
      if(!hasCanvasBlur())softenSprite(fc,Math.round(SURFACE.blur*.5));
      previous=revision;rect=next;
    }
    return {image,frost,rect,revision};
  };
}
