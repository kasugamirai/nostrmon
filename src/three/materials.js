// 3D 共享材质：卡通着色（MeshToonMaterial + 三阶渐变）与法线外扩描边
import * as THREE from 'three'
export { hueRotate, shade } from '../render/sprites.js'

export const OUTLINE_COLOR = 0x1c1a2e

let grad = null
export function gradientMap() {
  if (grad) return grad
  grad = new THREE.DataTexture(new Uint8Array([70, 150, 215, 255]), 4, 1, THREE.RedFormat)
  grad.minFilter = grad.magFilter = THREE.NearestFilter
  grad.generateMipmaps = false
  grad.needsUpdate = true
  return grad
}

const cache = new Map()
// 共享缓存材质：同色同参数的网格共用一份，调用方不要修改它。
// 需要单独变色/闪白时传 { unique: true } 拿一份私有副本。
export function toonMat(color, { emissive = 0x000000, transparent = false, opacity = 1, side = THREE.FrontSide, unique = false, vertexColors = false } = {}) {
  const key = [color, emissive, transparent, opacity, side, vertexColors].join('|')
  if (!unique && cache.has(key)) return cache.get(key)
  const m = new THREE.MeshToonMaterial({ color, emissive, transparent, opacity, side, vertexColors, gradientMap: gradientMap() })
  if (!unique) cache.set(key, m)
  else m.userData.unique = true
  return m
}

// 描边材质：顶点沿法线外扩 thickness，背面渲染 → 卡通描边。对 InstancedMesh 同样有效。
const outlineCache = new Map()
export function outlineMat(thickness = 0.03, color = OUTLINE_COLOR) {
  const key = thickness + '|' + color
  if (outlineCache.has(key)) return outlineCache.get(key)
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outlineThickness = { value: thickness }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineThickness;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * outlineThickness;')
  }
  m.customProgramCacheKey = () => 'outline' + key
  outlineCache.set(key, m)
  return m
}

// 给网格加描边：复用几何体的子网格
export function addOutline(mesh, thickness = 0.03) {
  const o = mesh.isInstancedMesh
    ? new THREE.InstancedMesh(mesh.geometry, outlineMat(thickness), mesh.count)
    : new THREE.Mesh(mesh.geometry, outlineMat(thickness))
  if (mesh.isInstancedMesh) o.instanceMatrix = mesh.instanceMatrix
  o.name = 'outline'
  o.castShadow = false
  o.receiveShadow = false
  o.userData.isOutline = true
  mesh.add(o)
  return o
}

export function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of mats) if (m.userData?.unique) { m.map?.dispose(); m.dispose() }
  })
}
