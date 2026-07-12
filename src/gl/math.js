/**
 * Just enough linear algebra. Column-major, like GL wants.
 */

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0,                    0,
    0,          f, 0,                    0,
    0,          0, (far + near) * nf,   -1,
    0,          0, 2 * far * near * nf,  0,
  ]);
}

/** Rotate the world so (lon0, lat0) faces the camera: Rx(lat0) · Ry(-lon0). */
export function orient(lon0, lat0) {
  const a = (-lon0 * Math.PI) / 180;
  const b = (lat0 * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);

  // Ry(a) then Rx(b), pre-multiplied by hand.
  // prettier-ignore
  return new Float32Array([
     ca,       sa * sb,   -sa * cb,  0,
     0,        cb,         sb,       0,
     sa,      -ca * sb,    ca * cb,  0,
     0,        0,          0,        1,
  ]);
}

/** Camera sits on +Z looking at the origin. */
export function viewAt(distance) {
  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, -distance, 1,
  ]);
}

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** lon/lat (degrees) → unit vector. Matches the vertex shader exactly. */
export function toUnit(lon, lat) {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  const cl = Math.cos(la);
  return [cl * Math.sin(lo), Math.sin(la), cl * Math.cos(lo)];
}

/** Unit vector → lon/lat (degrees). The inverse of toUnit. */
export function toLonLat([x, y, z]) {
  return [
    (Math.atan2(x, z) * 180) / Math.PI,
    (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI,
  ];
}
