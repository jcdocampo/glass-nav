import test from 'node:test'
import assert from 'node:assert/strict'
import {glassAppearance,LensMotion} from '../src/index.js'
const tabs=['home','explore','library','favorites'].map((id,i)=>({id,x:42+i*76,y:32,width:74,height:54}))
test('frost endpoints stay bounded and change both material inputs',()=>{
 const clear=glassAppearance(0),frost=glassAppearance(1)
 assert(clear.opacity<frost.opacity);assert(clear.clarity>frost.clarity)
 assert.deepEqual(glassAppearance(-3),clear);assert.deepEqual(glassAppearance(4),frost)
 assert.equal(glassAppearance(NaN).frost,.7)
})
test('hold swelling is bounded and release returns to the selected resting shape',()=>{
 const motion=new LensMotion(tabs,'home');motion.press('home')
 for(let i=1;i<=180;i++)motion.tick(1/60,i/60)
 const held=motion.visual;assert(held.height>54&&held.height<110)
 motion.release('home');for(let i=1;i<=240;i++)motion.tick(1/60,3+i/60)
 assert.equal(motion.committed,'home');assert(Math.abs(motion.visual.height-54)<.01)
})
test('reduced motion settles without an animated deformation',()=>{
 const motion=new LensMotion(tabs,'home',{reduced:true});motion.press('library');motion.release('library')
 motion.tick(1/60,1);assert.equal(motion.committed,'library');assert.equal(motion.visual.material,0)
})
