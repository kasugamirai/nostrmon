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

// —— 遮挡透视：树冠 / 房屋挡在镜头与玩家之间时，按屏幕椭圆区域抖动镂空 ——
// World3D 每帧写入：occC = 玩家在绘制缓冲区中的像素坐标，occR = 椭圆半径（像素，x / y；x = 0 时关闭），
// occPlane = (玩家世界 x, z, 指向镜头的水平单位向量 x, z)。只有位于"玩家所在竖直平面"镜头一侧 0.3 格以外的片元才会被镂空，
// 用世界坐标而不是片元深度判断，所以描边外壳的背面（树冠后侧）也会一起镂空，不会露出黑色内壳。
// 只影响主渲染；阴影用深度材质，不受影响。
export const OCCLUDE = {
  occC: { value: new THREE.Vector2(-1e4, -1e4) },
  occR: { value: new THREE.Vector2(0, 0) },
  occPlane: { value: new THREE.Vector4(0, 0, 0, 1) },
}
const OCC_VERT_HEAD = '\nvarying vec3 vOccW;'
const OCC_VERT = /* glsl */`
  {
    vec4 occW = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
    occW = instanceMatrix * occW;
    #endif
    vOccW = (modelMatrix * occW).xyz;
  }`
const OCC_FRAG = /* glsl */`
uniform vec2 occC;
uniform vec2 occR;
uniform vec4 occPlane;
varying vec3 vOccW;
const float OCC_BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void occDiscard() {
  if (occR.x <= 0.0) return;
  float ahead = dot(vOccW.xz - occPlane.xy, occPlane.zw);
  if (ahead < 0.3) return;
  vec2 d = (gl_FragCoord.xy - occC) / occR;
  float k = dot(d, d);
  if (k >= 1.0) return;
  float a = smoothstep(1.0, 0.4, k) * smoothstep(0.3, 0.7, ahead);
  ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));
  float b = OCC_BAYER[q.x + q.y * 4] / 16.0 + 0.03;
  if (a > b) discard;
}`
function injectOcclusion(shader) {
  shader.uniforms.occC = OCCLUDE.occC
  shader.uniforms.occR = OCCLUDE.occR
  shader.uniforms.occPlane = OCCLUDE.occPlane
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>' + OCC_VERT_HEAD)
    .replace('#include <project_vertex>', '#include <project_vertex>' + OCC_VERT)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + OCC_FRAG)
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n\toccDiscard();')
}
// 给静态遮挡物（树、房屋）用的材质副本：与 base 同参数，额外带遮挡镂空
const occCache = new Map()
export function occluderMat(base) {
  let m = occCache.get(base)
  if (m) return m
  m = base.clone()
  m.onBeforeCompile = injectOcclusion
  m.customProgramCacheKey = () => 'occ-' + base.type
  occCache.set(base, m)
  return m
}

// 描边材质：顶点沿法线外扩 thickness，背面渲染 → 卡通描边。对 InstancedMesh 同样有效。
// occlude = true 时描边也参与遮挡镂空（与 occluderMat 配套）
const outlineCache = new Map()
export function outlineMat(thickness = 0.03, color = OUTLINE_COLOR, occlude = false) {
  const key = thickness + '|' + color + (occlude ? '|occ' : '')
  if (outlineCache.has(key)) return outlineCache.get(key)
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outlineThickness = { value: thickness }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineThickness;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * outlineThickness;')
    if (occlude) injectOcclusion(shader)
  }
  m.customProgramCacheKey = () => 'outline' + key
  outlineCache.set(key, m)
  return m
}

// 给网格加描边：复用几何体的子网格
export function addOutline(mesh, thickness = 0.03, { occlude = false } = {}) {
  const om = outlineMat(thickness, OUTLINE_COLOR, occlude)
  const o = mesh.isInstancedMesh
    ? new THREE.InstancedMesh(mesh.geometry, om, mesh.count)
    : new THREE.Mesh(mesh.geometry, om)
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
