import zlib from "node:zlib";

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function pixel(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const dx = (x + 0.5 - cx) / size;
  const dy = (y + 0.5 - cy) / size;
  const straw = [231, 211, 161, 255];
  const ink = [42, 27, 16, 255];
  const paper = [255, 246, 228, 255];
  const comb = [226, 61, 50, 255];
  const yolk = [240, 180, 41, 255];

  const inDisc = dx * dx + dy * dy < 0.46 * 0.46;
  if (!inDisc) return [0, 0, 0, 0];

  // Comb
  for (const bump of [-0.02, 0.05, 0.12]) {
    const bx = dx - 0.08 - bump * 0.15;
    const by = dy + 0.28;
    if (bx * bx + by * by < 0.035) return comb;
  }
  // Beak
  if (dx > 0.16 && dx < 0.3 && dy > -0.08 && dy < 0.04 && dx - 0.14 > Math.abs(dy + 0.02) * 1.4) {
    return yolk;
  }
  // Eye
  if ((dx - 0.08) ** 2 + (dy + 0.16) ** 2 < 0.004) return ink;
  // Head
  if ((dx - 0.04) ** 2 + (dy + 0.12) ** 2 < 0.055) return paper;
  // Wing
  if ((dx + 0.08) ** 2 / 0.03 + (dy - 0.08) ** 2 / 0.02 < 1) return yolk;
  // Body
  if ((dx + 0.02) ** 2 / 0.09 + (dy - 0.08) ** 2 / 0.07 < 1) return paper;
  // Feet
  if (Math.abs(dx + 0.02) < 0.09 && dy > 0.28 && dy < 0.34) return yolk;
  return straw;
}

export function chickenPng(size = 180) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = row + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
