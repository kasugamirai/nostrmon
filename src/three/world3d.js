// STUB — replaced by the world module owner. See docs/3d-architecture.md
import { MAPS } from '../data/maps.js'
export class World3D {
  constructor(game, canvas) { this.g = game; this.cv = canvas; this.p = { x: 0, y: 0, dir: 'down' }; this.path = null; this.running = false; this.map = null }
  set held(v) {} get held() { return [] }
  loadMap(id, x, y, dir = 'down') { this.map = MAPS[id]; Object.assign(this.p, { x, y, dir }) }
  sendPresence() {} interact() {} setPaused() {} setJoystick() {} press() {}
}
