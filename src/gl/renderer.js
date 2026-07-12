/**
 * The globe, in WebGL2. Ours, top to bottom.
 *
 * Three things get drawn:
 *
 *   1. A base sphere, textured with a whole-planet image (~10 km/px). It's the
 *      view from orbit, and the fallback everywhere else.
 *   2. Terrain patches. The visible region, at a tile zoom that tracks the
 *      camera, so the coastline stays sharp all the way in. Each patch is a
 *      terrain tile decoded to colour (see bathymetry.tileColor) — from the very
 *      same elevation numbers we report as depth, so the picture and the reading
 *      can never disagree.
 *   3. A marker at the point you clicked.
 *
 * A patch is a subdivided grid, not a quad: a flat quad's interior would sag
 * below the sphere it's wrapped around. That is the exact bug that buried the
 * middle of South America inside the planet when land was polygons.
 */

import { perspective, orient, viewAt, multiply, toLonLat, toUnit } from './math.js';

const FOVY = (35 * Math.PI) / 180;

// Concentric radii, so nothing z-fights.
const R_SPHERE = 1.0;
const R_PATCH = 1.0006;
const R_MARK = 1.0018;

const VERT = `#version 300 es
precision highp float;

in vec2 aLonLat;
in vec2 aUV;
in vec4 aColor;

uniform mat4 uMVP;
uniform mat3 uRot;
uniform float uRadius;

out vec4 vColor;
out vec3 vNormal;
out vec2 vUV;

void main() {
  float lat = radians(aLonLat.y);
  float lon = radians(aLonLat.x);
  float cl = cos(lat);
  vec3 dir = vec3(cl * sin(lon), sin(lat), cl * cos(lon));

  vNormal = uRot * dir;
  vColor = aColor;
  vUV = aUV;
  gl_Position = uMVP * vec4(dir * uRadius, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in vec4 vColor;
in vec3 vNormal;
in vec2 vUV;

uniform int uMode;      // 0 = vertex colour, 1 = texture
uniform float uShade;
uniform sampler2D uTex;

out vec4 outColor;

void main() {
  vec4 base = uMode == 1 ? texture(uTex, vUV) : vColor;

  // Light over the viewer's shoulder. Enough to round the globe off; never
  // enough to eat the palette, because the colour of the water is data.
  const vec3 L = normalize(vec3(-0.35, 0.45, 0.82));
  float lambert = max(dot(normalize(vNormal), L), 0.0);
  float shade = mix(1.0, 0.66 + 0.34 * lambert, uShade);

  outColor = vec4(base.rgb * shade, base.a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

class Mesh {
  constructor(gl, mode) {
    this.gl = gl;
    this.mode = mode;
    this.vao = gl.createVertexArray();
    this.pos = gl.createBuffer();
    this.uv = gl.createBuffer();
    this.col = gl.createBuffer();
    this.idx = gl.createBuffer();
    this.count = 0;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uv);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.col);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idx);
    gl.bindVertexArray(null);
  }

  upload(lonlat, uv, colors, indices) {
    const gl = this.gl;
    const n = lonlat.length / 2;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pos);
    gl.bufferData(gl.ARRAY_BUFFER, lonlat, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uv);
    gl.bufferData(gl.ARRAY_BUFFER, uv ?? new Float32Array(n * 2), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.col);
    gl.bufferData(gl.ARRAY_BUFFER, colors ?? new Uint8Array(n * 4), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.count = indices.length;
  }

  free() {
    const gl = this.gl;
    gl.deleteBuffer(this.pos);
    gl.deleteBuffer(this.uv);
    gl.deleteBuffer(this.col);
    gl.deleteBuffer(this.idx);
    gl.deleteVertexArray(this.vao);
    this.count = 0;
  }
}

/** Inverse Web Mercator: tile-space y → latitude. */
function mercY(y, n) {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
}

export class Renderer {
  constructor(canvas, { maxPixelRatio = 1.5 } = {}) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');

    this.canvas = canvas;
    this.gl = gl;
    this.maxPixelRatio = maxPixelRatio;

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, 0, 'aLonLat');
    gl.bindAttribLocation(program, 1, 'aUV');
    gl.bindAttribLocation(program, 2, 'aColor');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
    }

    this.program = program;
    this.u = {
      mvp: gl.getUniformLocation(program, 'uMVP'),
      rot: gl.getUniformLocation(program, 'uRot'),
      radius: gl.getUniformLocation(program, 'uRadius'),
      shade: gl.getUniformLocation(program, 'uShade'),
      mode: gl.getUniformLocation(program, 'uMode'),
      tex: gl.getUniformLocation(program, 'uTex'),
    };

    gl.enable(gl.DEPTH_TEST);
    // No culling: the depth buffer already hides the far side, and culling would
    // silently bet on every triangle's winding being what I assumed.
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.016, 0.027, 0.051, 1);

    this.sphere = new Mesh(gl, gl.TRIANGLES);
    this.patches = new Map(); // "z/x/y" → {mesh, tex}

    this.basemap = null;
    this.camera = { lon: -40, lat: 18, zoom: 1.1 };
    this.viewport = { width: 1, height: 1 };
  }

  /* ─────────────────────────────────────────────────────────── geometry */

  buildSphere() {
    const NLAT = 90;
    const NLON = 180;
    const n = (NLAT + 1) * (NLON + 1);
    const lonlat = new Float32Array(n * 2);
    const uv = new Float32Array(n * 2);
    const indices = new Uint32Array(NLAT * NLON * 6);

    let v = 0;
    for (let i = 0; i <= NLAT; i++) {
      const lat = 90 - (i / NLAT) * 180;
      for (let j = 0; j <= NLON; j++) {
        const lon = -180 + (j / NLON) * 360;
        lonlat[v * 2] = lon;
        lonlat[v * 2 + 1] = lat;
        uv[v * 2] = j / NLON; // the basemap is equirectangular
        uv[v * 2 + 1] = i / NLAT;
        v++;
      }
    }

    let k = 0;
    const stride = NLON + 1;
    for (let i = 0; i < NLAT; i++) {
      for (let j = 0; j < NLON; j++) {
        const a = i * stride + j;
        const b = a + stride;
        indices[k++] = a; indices[k++] = a + 1; indices[k++] = b;
        indices[k++] = b; indices[k++] = a + 1; indices[k++] = b + 1;
      }
    }
    this.sphere.upload(lonlat, uv, null, indices);
  }

  setBasemap(image) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.basemap = tex;
  }

  hasPatch(key) {
    return this.patches.has(key);
  }

  /**
   * One terrain tile, as a patch of sphere.
   *
   * Subdivided, and that matters: the tile's corners sit on the sphere, but a
   * flat quad between them would bow inward and sink beneath the surface. GRID
   * segments keep the sag far below anything visible.
   *
   * UVs run linearly in MERCATOR space, not latitude — that's the projection the
   * tile is drawn in, and interpolating it as if it were latitude is precisely
   * the mistake that banded the satellite imagery.
   */
  addPatch(key, z, x, y, image) {
    const gl = this.gl;
    if (this.patches.has(key)) return;

    const GRID = 8;
    const n = 2 ** z;
    const verts = (GRID + 1) * (GRID + 1);

    const lonlat = new Float32Array(verts * 2);
    const uv = new Float32Array(verts * 2);
    const indices = new Uint32Array(GRID * GRID * 6);

    let v = 0;
    for (let j = 0; j <= GRID; j++) {
      const ty = y + j / GRID;
      const lat = mercY(ty, n);
      for (let i = 0; i <= GRID; i++) {
        const tx = x + i / GRID;
        const lon = (tx / n) * 360 - 180;
        lonlat[v * 2] = lon;
        lonlat[v * 2 + 1] = lat;
        uv[v * 2] = i / GRID;
        uv[v * 2 + 1] = j / GRID;
        v++;
      }
    }

    let k = 0;
    const stride = GRID + 1;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = j * stride + i;
        const b = a + stride;
        indices[k++] = a; indices[k++] = a + 1; indices[k++] = b;
        indices[k++] = b; indices[k++] = a + 1; indices[k++] = b + 1;
      }
    }

    const mesh = new Mesh(gl, gl.TRIANGLES);
    mesh.upload(lonlat, uv, null, indices);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    // LINEAR, now that the tile arrives already decoded to colour. Blending two
    // *colours* is meaningful; blending two raw terrarium elevation codes was
    // not, which is why this had to be NEAREST before — and why the coastline
    // came out as a staircase of hard squares.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.patches.set(key, { mesh, tex, z });
  }

  /** Drop patches we're no longer looking at. */
  keepOnly(keys) {
    for (const [key, patch] of this.patches) {
      if (keys.has(key)) continue;
      patch.mesh.free();
      this.gl.deleteTexture(patch.tex);
      this.patches.delete(key);
    }
  }

  /* ───────────────────────────────────────────────────────────── camera */

  radiusPx(zoom) {
    return (512 * 2 ** zoom) / (2 * Math.PI);
  }

  distance(zoom, height) {
    const f = height / 2 / Math.tan(FOVY / 2);
    return Math.sqrt(1 + (f / this.radiusPx(zoom)) ** 2);
  }

  matrices() {
    const { width, height } = this.viewport;
    const { lon, lat, zoom } = this.camera;

    const d = this.distance(zoom, height);
    // The near plane tracks altitude. Fixed, it would sit inside the planet once
    // zoomed in (the camera is ~700 m up at max zoom) and clip the globe away.
    const near = Math.max(1e-6, (d - 1) * 0.08);
    const far = d + 1.2;

    const proj = perspective(FOVY, width / height, near, far);
    const model = orient(lon, lat);
    const mvp = multiply(multiply(proj, viewAt(d)), model);
    const rot = new Float32Array([
      model[0], model[1], model[2],
      model[4], model[5], model[6],
      model[8], model[9], model[10],
    ]);
    return { mvp, rot };
  }

  /**
   * lon/lat → screen pixel, or null if it's round the back of the globe.
   *
   * This is what lets the click marker be a DOM element rather than geometry.
   * It used to be a disc drawn ON the sphere, sized in degrees — so it was a
   * literal patch of ocean, hundreds of kilometres across, that grew and shrank
   * with the planet. A pin is interface, not terrain: it belongs in screen space,
   * where CSS can glow and pulse it on the compositor for nothing.
   */
  project(lon, lat) {
    const { mvp } = this.matrices();
    const [ux, uy, uz] = toUnit(lon, lat);
    const p = [ux * R_MARK, uy * R_MARK, uz * R_MARK];

    // Column-major: (M·v)_i = Σ M[j*4+i]·v_j
    const cx = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
    const cy = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
    const cw = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
    if (cw <= 0) return null;

    // Near side only. After the model rotation the camera sits on +Z at distance
    // d, so the visible cap is everything above the horizon plane at z = 1/d.
    const model = orient(this.camera.lon, this.camera.lat);
    const worldZ = model[2] * p[0] + model[6] * p[1] + model[10] * p[2];
    const d = this.distance(this.camera.zoom, this.viewport.height);
    if (worldZ < 1 / d) return null;

    return {
      x: ((cx / cw) * 0.5 + 0.5) * this.viewport.width,
      y: (1 - ((cy / cw) * 0.5 + 0.5)) * this.viewport.height,
    };
  }

  /** Screen pixel → lon/lat, or null if the ray misses the globe. */
  pick(px, py) {
    const { width, height } = this.viewport;
    const { lon, lat, zoom } = this.camera;

    const ndcX = (px / width) * 2 - 1;
    const ndcY = 1 - (py / height) * 2;

    const t = Math.tan(FOVY / 2);
    const dir = [ndcX * t * (width / height), ndcY * t, -1];
    const len = Math.hypot(...dir);
    dir[0] /= len; dir[1] /= len; dir[2] /= len;

    const d = this.distance(zoom, height);
    const b = 2 * d * dir[2];
    const c = d * d - 1;
    const disc = b * b - 4 * c;
    if (disc < 0) return null; // missed the planet

    const s = (-b - Math.sqrt(disc)) / 2;
    const hit = [s * dir[0], s * dir[1], d + s * dir[2]];

    const m = orient(lon, lat); // rotation: inverse is the transpose
    const p = [
      m[0] * hit[0] + m[1] * hit[1] + m[2] * hit[2],
      m[4] * hit[0] + m[5] * hit[1] + m[6] * hit[2],
      m[8] * hit[0] + m[9] * hit[1] + m[10] * hit[2],
    ];
    const nn = Math.hypot(...p);
    return toLonLat([p[0] / nn, p[1] / nn, p[2] / nn]);
  }

  /* ──────────────────────────────────────────────────────────── drawing */

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.viewport = { width: w, height: h };
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  }

  draw() {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const { mvp, rot } = this.matrices();
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.u.mvp, false, mvp);
    gl.uniformMatrix3fv(this.u.rot, false, rot);
    gl.uniform1i(this.u.tex, 0);
    gl.activeTexture(gl.TEXTURE0);

    const pass = (mesh, radius, mode, shade, tex) => {
      if (!mesh.count) return;
      gl.uniform1f(this.u.radius, radius);
      gl.uniform1f(this.u.shade, shade);
      gl.uniform1i(this.u.mode, mode);
      if (tex) gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(mesh.mode, mesh.count, gl.UNSIGNED_INT, 0);
    };

    // The whole planet, coarse. Always there, so nothing is ever blank.
    if (this.basemap) pass(this.sphere, R_SPHERE, 1, 1, this.basemap);

    // The bit you're looking at, sharp. Coarser tiles first, so finer ones land
    // on top of them rather than under.
    const patches = [...this.patches.values()].sort((a, b) => a.z - b.z);
    for (const p of patches) pass(p.mesh, R_PATCH, 1, 1, p.tex);

    gl.bindVertexArray(null);
  }
}
