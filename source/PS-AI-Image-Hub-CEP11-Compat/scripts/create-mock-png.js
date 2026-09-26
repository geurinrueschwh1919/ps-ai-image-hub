"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const WIDTH = 96;
const HEIGHT = 96;

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function createPixels() {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  function setPixel(x, y, red, green, blue, alpha) {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const offset = (y * WIDTH + x) * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = alpha;
  }
  function line(x0, y0, x1, y1, thickness) {
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      for (let oy = -thickness; oy <= thickness; oy += 1) {
        for (let ox = -thickness; ox <= thickness; ox += 1) setPixel(x0 + ox, y0 + oy, 255, 255, 255, 235);
      }
      if (x0 === x1 && y0 === y1) break;
      const twice = error * 2;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  }

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const diagonal = x + y;
      if (diagonal < 76) setPixel(x, y, 67, 43, 120, 255);
      else if (diagonal < 124) setPixel(x, y, 23, 107, 135, 255);
      else setPixel(x, y, 240, 154, 86, 255);
    }
  }

  line(18, 19, 77, 19, 1);
  line(77, 19, 77, 63, 1);
  line(77, 63, 18, 63, 1);
  line(18, 63, 18, 19, 1);
  line(22, 58, 39, 41, 1);
  line(39, 41, 52, 54, 1);
  line(52, 54, 62, 45, 1);
  line(62, 45, 73, 58, 1);

  for (let y = 28; y <= 35; y += 1) {
    for (let x = 27; x <= 34; x += 1) {
      const dx = x - 30.5;
      const dy = y - 31.5;
      if (dx * dx + dy * dy <= 15) setPixel(x, y, 255, 255, 255, 235);
    }
  }
  return pixels;
}

function buildPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const pixels = createPixels();
  const scanlines = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));
  for (let y = 0; y < HEIGHT; y += 1) {
    const targetOffset = y * (1 + WIDTH * 4);
    scanlines[targetOffset] = 0;
    pixels.copy(scanlines, targetOffset + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function main() {
  const destination = path.resolve(__dirname, "..", "client", "assets", "mock-result.png");
  const bytes = buildPng();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  console.log("PASS: wrote CEP Mock PNG fixture (" + bytes.length + " bytes): " + destination);
}

if (require.main === module) main();

module.exports = { WIDTH, HEIGHT, buildPng, crc32 };
