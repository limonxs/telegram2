// Convert PNG images to BMP for NSIS installer
const fs = require('fs');
const path = require('path');

// Simple PNG to BMP converter (uncompressed 24-bit BMP)
// Reads PNG using a basic decoder and writes BMP format

// We'll use a canvas-less approach - read the PNG and create a properly sized BMP
// For NSIS, we need specific sizes:
// - Sidebar: 164x314 pixels
// - Header: 150x57 pixels

// Since we can't easily decode PNG without external deps in pure Node,
// let's create gradient BMP files programmatically that match our theme

function createBMP(width, height, pixelGenerator) {
  const rowSize = Math.ceil((width * 3) / 4) * 4; // Rows must be aligned to 4 bytes
  const imageSize = rowSize * height;
  const fileSize = 54 + imageSize;

  const buffer = Buffer.alloc(fileSize);

  // BMP File Header (14 bytes)
  buffer.write('BM', 0);                      // Signature
  buffer.writeUInt32LE(fileSize, 2);           // File size
  buffer.writeUInt32LE(0, 6);                  // Reserved
  buffer.writeUInt32LE(54, 10);                // Data offset

  // DIB Header (40 bytes) - BITMAPINFOHEADER
  buffer.writeUInt32LE(40, 14);                // Header size
  buffer.writeInt32LE(width, 18);              // Width
  buffer.writeInt32LE(height, 22);             // Height (positive = bottom-up)
  buffer.writeUInt16LE(1, 26);                 // Color planes
  buffer.writeUInt16LE(24, 28);                // Bits per pixel
  buffer.writeUInt32LE(0, 30);                 // Compression (none)
  buffer.writeUInt32LE(imageSize, 34);         // Image size
  buffer.writeInt32LE(2835, 38);               // X pixels per meter
  buffer.writeInt32LE(2835, 42);               // Y pixels per meter
  buffer.writeUInt32LE(0, 46);                 // Colors in color table
  buffer.writeUInt32LE(0, 50);                 // Important colors

  // Pixel data (bottom-up, BGR format)
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const { r, g, b } = pixelGenerator(x, y, width, height);
      const offset = 54 + (height - 1 - y) * rowSize + x * 3;
      buffer[offset] = b;     // Blue
      buffer[offset + 1] = g; // Green
      buffer[offset + 2] = r; // Red
    }
  }

  return buffer;
}

// Interpolate between two colors
function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Sidebar: 164x314 - Dark purple gradient with glowing nodes
function sidebarPixel(x, y, w, h) {
  const t = y / h;
  // Deep navy to deep purple gradient
  const bgR = lerp(10, 26, t);
  const bgG = lerp(10, 16, t);
  const bgB = lerp(24, 64, t);

  // Add subtle glow orb in the center
  const cx = w * 0.5, cy = h * 0.4;
  const dx = (x - cx) / w, dy = (y - cy) / h;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const glow = Math.max(0, 1 - dist * 3) * 0.3;

  // Add node dots along left edge
  let nodeBrightness = 0;
  const nodeX = w * 0.25;
  const nodeCount = 6;
  for (let i = 0; i < nodeCount; i++) {
    const nodeY = h * (0.15 + i * 0.12);
    const ndx = (x - nodeX) / w;
    const ndy = (y - nodeY) / h;
    const ndist = Math.sqrt(ndx * ndx + ndy * ndy);
    nodeBrightness += Math.max(0, 1 - ndist * 8) * 0.5;
  }

  // Connecting line
  let lineBrightness = 0;
  if (Math.abs(x - nodeX) < 1.5 && y > h * 0.15 && y < h * (0.15 + (nodeCount - 1) * 0.12)) {
    lineBrightness = 0.15;
  }

  const accentR = 108, accentG = 92, accentB = 231;

  const r = Math.min(255, bgR + (accentR * (glow + nodeBrightness + lineBrightness)));
  const g = Math.min(255, bgG + (accentG * (glow + nodeBrightness + lineBrightness)));
  const b = Math.min(255, bgB + (accentB * (glow + nodeBrightness + lineBrightness)));

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

// Header: 150x57 - Dark gradient with subtle accent
function headerPixel(x, y, w, h) {
  const t = x / w;
  const bgR = lerp(10, 30, t);
  const bgG = lerp(10, 14, t);
  const bgB = lerp(18, 60, t);

  // Subtle glow on right side
  const gx = (x - w * 0.85) / w;
  const gy = (y - h * 0.5) / h;
  const gdist = Math.sqrt(gx * gx + gy * gy);
  const glow = Math.max(0, 1 - gdist * 5) * 0.25;

  const r = Math.min(255, bgR + 108 * glow);
  const g = Math.min(255, bgG + 92 * glow);
  const b = Math.min(255, bgB + 231 * glow);

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

// Generate files
const buildDir = path.join(__dirname, 'build-resources');

const sidebarBuf = createBMP(164, 314, sidebarPixel);
fs.writeFileSync(path.join(buildDir, 'installerSidebar.bmp'), sidebarBuf);
console.log('✓ Created installerSidebar.bmp (164x314)');

const headerBuf = createBMP(150, 57, headerPixel);
fs.writeFileSync(path.join(buildDir, 'installerHeader.bmp'), headerBuf);
console.log('✓ Created installerHeader.bmp (150x57)');

console.log('Done! BMP files ready for NSIS installer.');
