const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZES = [16, 32, 48, 128];
const OUTPUT_DIR = path.join(__dirname, "..", "extension", "icons");

function createCanvas(size) {
  return Buffer.alloc(size * size * 4, 0);
}

function setPixel(pixels, size, x, y, r, g, b, a) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 4;
  const srcA = a / 255;
  const dstA = pixels[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  pixels[i] = Math.round((r * srcA + pixels[i] * dstA * (1 - srcA)) / outA);
  pixels[i + 1] = Math.round((g * srcA + pixels[i + 1] * dstA * (1 - srcA)) / outA);
  pixels[i + 2] = Math.round((b * srcA + pixels[i + 2] * dstA * (1 - srcA)) / outA);
  pixels[i + 3] = Math.round(outA * 255);
}

function fillCircle(pixels, size, cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
    for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius) {
        setPixel(pixels, size, x, y, color[0], color[1], color[2], color[3]);
      } else if (distance <= radius + 1) {
        const alpha = Math.max(0, 1 - (distance - radius)) * color[3];
        setPixel(pixels, size, x, y, color[0], color[1], color[2], Math.round(alpha));
      }
    }
  }
}

function fillRing(pixels, size, cx, cy, outerRadius, innerRadius, color) {
  for (let y = Math.floor(cy - outerRadius - 1); y <= Math.ceil(cy + outerRadius + 1); y++) {
    for (let x = Math.floor(cx - outerRadius - 1); x <= Math.ceil(cx + outerRadius + 1); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= outerRadius && distance >= innerRadius) {
        setPixel(pixels, size, x, y, color[0], color[1], color[2], color[3]);
      }
    }
  }
}

function drawStroke(pixels, size, from, to, width, color) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1) * 3;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t;
    const y = from.y + dy * t;
    fillCircle(pixels, size, x, y, width / 2, color);
  }
}

function crc32(buf) {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const combined = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(combined));
  return Buffer.concat([len, combined, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const rawData = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowOffset = y * (1 + size * 4);
    rawData[rowOffset] = 0;
    pixels.copy(rawData, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(rawData, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderBackground(pixels, size) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.46;
  const n = 5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - cx) / radius;
      const ny = (y - cy) / radius;
      const d = Math.pow(Math.abs(nx), n) + Math.pow(Math.abs(ny), n);
      if (d <= 1) {
        setPixel(pixels, size, x, y, 24, 24, 24, 255);
      } else if (d <= 1.015) {
        const aa = Math.max(0, 1 - (d - 1) / 0.015);
        setPixel(pixels, size, x, y, 24, 24, 24, Math.round(aa * 255));
      }
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - cx) / (radius - Math.max(1, size * 0.006));
      const ny = (y - cy) / (radius - Math.max(1, size * 0.006));
      const d = Math.pow(Math.abs(nx), n) + Math.pow(Math.abs(ny), n);
      if (d >= 0.96 && d <= 1 && y < cy) {
        const strength = (1 - (d - 0.96) / 0.04) * 0.1;
        setPixel(pixels, size, x, y, 255, 255, 255, Math.round(strength * 255));
      }
    }
  }
}

function renderIcon(size) {
  const pixels = createCanvas(size);
  renderBackground(pixels, size);

  const scale = size / 24;
  const strokeWidth = Math.max(1.5, size * 0.075);
  const lineColor = [236, 242, 255, 255];
  const green = [119, 245, 157, 255];
  const red = [239, 68, 68, 255];

  drawStroke(pixels, size, { x: 10.586 * scale, y: 5.414 * scale }, { x: 5.414 * scale, y: 10.586 * scale }, strokeWidth, lineColor);
  drawStroke(pixels, size, { x: 18.586 * scale, y: 13.414 * scale }, { x: 13.414 * scale, y: 18.586 * scale }, strokeWidth, lineColor);
  drawStroke(pixels, size, { x: 6 * scale, y: 12 * scale }, { x: 18 * scale, y: 12 * scale }, strokeWidth, lineColor);

  const nodeRadius = Math.max(1.8, size * 0.095);
  fillCircle(pixels, size, 12 * scale, 20 * scale, nodeRadius, green);
  fillCircle(pixels, size, 12 * scale, 4 * scale, nodeRadius, green);
  fillCircle(pixels, size, 20 * scale, 12 * scale, nodeRadius, red);
  fillCircle(pixels, size, 4 * scale, 12 * scale, nodeRadius, red);

  return encodePng(size, pixels);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
for (const size of SIZES) {
  fs.writeFileSync(path.join(OUTPUT_DIR, `icon-${size}.png`), renderIcon(size));
}
