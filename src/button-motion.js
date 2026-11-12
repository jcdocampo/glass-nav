import { spring, clamp, CONTACT_MOTION, contactScale, holdGrowth } from './nav-motion.js';

// Same elapsed-time spring primitive as the navbar, with a restrained radial
// tether instead of a travelling lens. Contact and chat state are independent.
export class ButtonMotion {
  constructor({ reduced = false } = {}) {
    Object.assign(this, { reduced, holding: false, open: false, age: 0,
      x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, swell: 0, swellV: 0,
      strain: 0, strainV: 0, axisX: 1, axisY: 0, axisXV: 0, axisYV: 0,
      targetAxisX: 1, targetAxisY: 0, distance: 0, speed: 0,
      lastMove: -Infinity, material: 0, materialV: 0, contact:0,contactV:0,contactHold:0,holdGate:0 });
  }
  press() {
    this.holding = true; this.age = 0;
    // Retain a visible, bounded response even if touch-up precedes the next
    // display frame. Adding velocity preserves the current shape on re-grab.
    if(!this.reduced)this.contactV=Math.max(this.contactV,CONTACT_MOTION.impulse);
    this.tx = this.x; this.ty = this.y;
    this.distance = 30 * Math.atanh(Math.min(.9999, Math.hypot(this.x, this.y) / 4));
  }
  move(x, y, dx, dy, dt, time) {
    const distance = Math.hypot(x, y);
    // Absolute displacement prevents cumulative clamping from pinning one side.
    const travel = 4 * Math.tanh(distance / 30);
    this.tx = distance ? travel * x / distance : 0;
    this.ty = distance ? travel * y / distance : 0;
    this.distance = distance;
    if (distance > .01) {
      // A symmetric strain tensor avoids angle-wrap jumps during reversals.
      this.targetAxisX = (x * x - y * y) / (distance * distance);
      this.targetAxisY = 2 * x * y / (distance * distance);
    }
    const blend = 1 - Math.exp(-dt / .035);
    this.speed += (Math.min(1800, Math.hypot(dx, dy) / Math.max(.001, dt)) - this.speed) * blend;
    this.lastMove = time;
  }
  release() {
    this.holding = false; this.tx = this.ty = this.distance = this.speed = 0;
    // Keep all current values and velocities: release/regrab never reset shape.
  }
  tick(dt, time) {
    // Do not lose contact duration when a browser delivers a late frame.
    this.age += Math.max(0, dt); dt = clamp(dt, 0, .25);
    if(this.holding)this.holdGate=Math.max(this.holdGate,holdGrowth(this.age,0));
    if (time - this.lastMove > .025) this.speed *= Math.exp(-dt / .075);
    const held = this.holding && !this.reduced;
    const swellTarget = held ? .16 * (1 - Math.exp(-this.age * 2.4)) : 0;
    [this.contact,this.contactV]=spring(this.contact,this.contactV,0,dt,CONTACT_MOTION.frequency,CONTACT_MOTION.damping);
    if(this.contact<0)this.contact=this.contactV=0;
    this.contactHold=this.holding?Math.max(this.contactHold,clamp(this.contact,0,.3)):this.contactHold*Math.exp(-dt/.055);
    const strainTarget = held ? .095 * Math.tanh(this.distance / 48) + .035 * this.speed / 1800 : 0;
    [this.x, this.vx] = spring(this.x, this.vx, held ? this.tx : 0, dt, held ? 65 : 20, held ? 1 : .83);
    [this.y, this.vy] = spring(this.y, this.vy, held ? this.ty : 0, dt, held ? 65 : 20, held ? 1 : .83);
    [this.swell, this.swellV] = spring(this.swell, this.swellV, swellTarget, dt, 17, .9);
    [this.strain, this.strainV] = spring(this.strain, this.strainV, strainTarget, dt, 28, .86);
    [this.axisX, this.axisXV] = spring(this.axisX, this.axisXV, this.targetAxisX, dt, 45);
    [this.axisY, this.axisYV] = spring(this.axisY, this.axisYV, this.targetAxisY, dt, 45);
    [this.material, this.materialV] = spring(this.material, this.materialV, this.holding || this.open ? 1 : 0, dt, 22);
    if (this.reduced) {
      this.x = this.y = this.vx = this.vy = this.swell = this.swellV = this.strain = this.strainV = this.contact=this.contactV=this.contactHold=0;
    }
    if(!this.holding&&this.settled){this.swell=this.swellV=this.contact=this.contactV=this.contactHold=this.holdGate=0;}
    return this.visual;
  }
  get visual() {
    const swell=this.swell*this.holdGate;
    // Carry the first swell into the held shape instead of shrinking between
    // the larger contact pulse and the slower sustained-press deformation.
    const base = 1+swell+contactScale(Math.max(this.contact,this.contactHold))*(1-clamp(swell/.16,0,1)), stretch = this.strain;
    // Full surface and icon receive the same affine deformation. No rotating
    // icon, moving overlay, or independently clipped optical layer.
    return { a: base * (1 + stretch * (.3 + .7 * this.axisX)),
      b: base * stretch * .7 * this.axisY,
      d: base * (1 + stretch * (.3 - .7 * this.axisX)),
      x: this.x, y: this.y, material: clamp(this.material, 0, 1) };
  }
  get settled() {
    const swellTarget = this.holding && !this.reduced ? .16 : 0;
    const materialTarget = this.holding || this.open ? 1 : 0;
    return (!this.holding || this.age > 4) && this.speed < .1 &&
      Math.abs(this.x - (this.holding && !this.reduced ? this.tx : 0)) < .002 &&
      Math.abs(this.y - (this.holding && !this.reduced ? this.ty : 0)) < .002 &&
      Math.hypot(this.vx, this.vy) < .02 &&
      Math.abs(this.swell - swellTarget) < .0001 && Math.abs(this.swellV) < .001 &&
      Math.abs(this.strain - (this.holding && !this.reduced ? .095 * Math.tanh(this.distance / 48) : 0)) < .0001 &&
      Math.abs(this.strainV) < .001 && Math.hypot(this.axisXV, this.axisYV) < .001 &&
      Math.abs(this.material - materialTarget) < .0001 && Math.abs(this.materialV) < .001&&Math.abs(this.contact)<.0001&&Math.abs(this.contactV)<.001&&(this.holding||this.contactHold<.0001);
  }
}
