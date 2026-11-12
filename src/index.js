import {createGlassNavbar} from './navbar.js'
import {createGlassButton} from './button.js'
export {LensMotion} from './nav-motion.js'
export {createGlassNavbar,createGlassButton}

export function glassAppearance(frost=.7){
 const amount=Math.max(0,Math.min(1,Number.isFinite(Number(frost))?Number(frost):.7))
 return {frost:amount,opacity:.12+.83*amount,clarity:1-.78*amount*amount}
}

export async function createGlassControls({navbar,button,root,active='home',onSelect=()=>{},onSearch=()=>{},frost=.7}){
 if(!navbar||!button||!root)throw new TypeError('Provide a navbar, button and content root')
 const action=createGlassButton(button,{onToggle:onSearch,sceneRoot:root})
 let nav
 try{nav=await createGlassNavbar(navbar,{active,onCommit:onSelect,sceneRoot:root,companion:action,companionElement:button})}
 catch(error){action.destroy();throw error}
 const setFrost=value=>{
  const appearance=glassAppearance(value)
  action.setAppearance(appearance);nav.setAppearance(appearance)
  navbar.style.setProperty('--glass-opacity',appearance.opacity)
  navbar.style.setProperty('--glass-clarity',appearance.clarity)
  button.style.setProperty('--glass-opacity',appearance.opacity)
  return appearance
 }
 setFrost(frost)
 return {navbar:nav,button:action,setFrost,destroy(){nav.destroy();action.destroy()}}
}
