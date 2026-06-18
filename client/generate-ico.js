// Create a proper ICO file from scratch with a Telecord-themed icon
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Create a proper PNG buffer from raw RGBA pixels
function createPNG(width, height, pixelGenerator) {
  // PNG file structure:
  // Signature + IHDR + IDAT(s) + IEND
  
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk('IHDR', ihdrData);
  
  // Raw pixel data with filter bytes
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // No filter
    for (let x = 0; x < width; x++) {
      const { r, g, b, a } = pixelGenerator(x, y, width, height);
      const offset = y * (1 + width * 4) + 1 + x * 4;
      rawData[offset] = r;
      rawData[offset + 1] = g;
      rawData[offset + 2] = b;
      rawData[offset + 3] = a;
    }
  }
  
  const compressed = zlib.deflateSync(rawData);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeB, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeB, data, crc]);
}

// CRC32 for PNG
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

// Create ICO from PNG data
function createICO(pngBuffers) {
  // ICONDIR: 6 bytes
  const iconDir = Buffer.alloc(6);
  iconDir.writeUInt16LE(0, 0);
  iconDir.writeUInt16LE(1, 2);
  iconDir.writeUInt16LE(pngBuffers.length, 4);

  const entries = [];
  let offset = 6 + pngBuffers.length * 16;

  for (const { png, size } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([iconDir, ...entries, ...pngBuffers.map(p => p.png)]);
}

// Icon pixel generator - Telecord logo
function iconPixel(x, y, w, h) {
  const cx = w / 2, cy = h / 2;
  const radius = w * 0.42;
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // Rounded square shape
  const px = Math.abs(dx), py = Math.abs(dy);
  const cornerRadius = w * 0.22;
  const halfSize = w * 0.42;
  
  let insideShape = false;
  if (px <= halfSize - cornerRadius && py <= halfSize) insideShape = true;
  else if (px <= halfSize && py <= halfSize - cornerRadius) insideShape = true;
  else {
    const cdx = px - (halfSize - cornerRadius);
    const cdy = py - (halfSize - cornerRadius);
    if (cdx > 0 && cdy > 0 && Math.sqrt(cdx * cdx + cdy * cdy) <= cornerRadius) insideShape = true;
  }
  
  if (!insideShape) return { r: 0, g: 0, b: 0, a: 0 };

  // Gradient background: purple to blue  
  const t = (x + y) / (w + h);
  const bgR = lerp(108, 88, t);
  const bgG = lerp(92, 101, t);
  const bgB = lerp(231, 242, t);
  
  // Chat bubble icon in center
  const bubbleCx = cx - w * 0.02;
  const bubbleCy = cy - h * 0.04;
  const bubbleW = w * 0.25;
  const bubbleH = h * 0.18;
  
  const bx = (x - bubbleCx) / bubbleW;
  const by = (y - bubbleCy) / bubbleH;
  const bubbleDist = bx * bx + by * by;
  
  // Bubble tail
  const tailX = x - (bubbleCx + bubbleW * 0.3);
  const tailY = y - (bubbleCy + bubbleH * 1.0);
  const inTail = tailX > -w * 0.03 && tailX < w * 0.08 && tailY > 0 && tailY < h * 0.08 && tailX > tailY * 0.5;
  
  if (bubbleDist < 1.0 || inTail) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  
  // Signal arcs
  const arcCx = cx + w * 0.08;
  const arcCy = cy + h * 0.02;
  
  for (let i = 1; i <= 3; i++) {
    const arcR = w * (0.08 + i * 0.06);
    const adx = x - arcCx, ady = y - arcCy;
    const arcDist = Math.sqrt(adx * adx + ady * ady);
    const angle = Math.atan2(ady, adx);
    
    if (angle > -Math.PI * 0.4 && angle < Math.PI * 0.4 &&
        Math.abs(arcDist - arcR) < w * 0.018) {
      return { r: 255, g: 255, b: 255, a: Math.round(255 * (1 - i * 0.15)) };
    }
  }
  
  return { r: Math.round(bgR), g: Math.round(bgG), b: Math.round(bgB), a: 255 };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Generate multiple sizes for ICO
const sizes = [256, 128, 64, 48, 32, 16];
const pngBuffers = sizes.map(size => ({
  png: createPNG(size, size, iconPixel),
  size
}));

const buildDir = path.join(__dirname, 'build-resources');
const icoData = createICO(pngBuffers);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoData);
console.log(`✓ Created icon.ico with ${sizes.length} sizes: ${sizes.join(', ')}`);

// Also save 256px PNG for electron-builder
fs.writeFileSync(path.join(buildDir, 'icon.png'), pngBuffers[0].png);
console.log('✓ Created proper icon.png (256x256)');

console.log('Done!');
