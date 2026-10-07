const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

// Colores Matcha Zen & Jade
// Secundario (Menta): #55EFC4 -> RGB(85, 239, 196)
// Primario (Jade):    #00B894 -> RGB(0, 184, 148)
const COLOR_MINT = { r: 85, g: 239, b: 196 };
const COLOR_JADE = { r: 0, g: 184, b: 148 };

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, l };
}

function recolorImage(image) {
  const width = image.bitmap.width;
  const height = image.bitmap.height;

  image.scan(0, 0, width, height, (x, y, idx) => {
    const r = image.bitmap.data[idx];
    const g = image.bitmap.data[idx + 1];
    const b = image.bitmap.data[idx + 2];
    const a = image.bitmap.data[idx + 3];

    if (a < 10) return;

    const hsl = rgbToHsl(r, g, b);

    // Si es un píxel coloreado de la gama fría/azul/cian del logo original (Hue entre 160° y 270°, y con saturación)
    if (hsl.s > 0.18 && hsl.h >= 160 && hsl.h <= 270) {
      // t = 0 en cian (180°), t = 1 en azul profundo (245°)
      let t = (hsl.h - 180) / (245 - 180);
      t = Math.max(0, Math.min(1, t));

      // Interpolamos entre Menta y Jade
      const targetR = COLOR_MINT.r + (COLOR_JADE.r - COLOR_MINT.r) * t;
      const targetG = COLOR_MINT.g + (COLOR_JADE.g - COLOR_MINT.g) * t;
      const targetB = COLOR_MINT.b + (COLOR_JADE.b - COLOR_MINT.b) * t;

      // Escalamos según el brillo relativo del píxel original
      const brightnessMultiplier = hsl.l / 0.55;
      image.bitmap.data[idx] = Math.min(255, Math.round(targetR * brightnessMultiplier));
      image.bitmap.data[idx + 1] = Math.min(255, Math.round(targetG * brightnessMultiplier));
      image.bitmap.data[idx + 2] = Math.min(255, Math.round(targetB * brightnessMultiplier));
    }
  });

  return image;
}

function buildIcoBuffer(pngBuffersWithSizes) {
  const count = pngBuffersWithSizes.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let currentOffset = headerSize + count * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // 1 = ICO
  header.writeUInt16LE(count, 4); // Image count

  const dirEntries = [];
  for (const item of pngBuffersWithSizes) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(item.size >= 256 ? 0 : item.size, 0); // Width
    entry.writeUInt8(item.size >= 256 ? 0 : item.size, 1); // Height
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(item.buffer.length, 8); // Image size in bytes
    entry.writeUInt32LE(currentOffset, 12); // Offset
    dirEntries.push(entry);

    currentOffset += item.buffer.length;
  }

  const allBuffers = [header, ...dirEntries, ...pngBuffersWithSizes.map(x => x.buffer)];
  return Buffer.concat(allBuffers);
}

async function run() {
  console.log('Cargando icono base 512x512.png...');
  const baseImg = await Jimp.read('static/icons/512x512.png');
  const recolored512 = recolorImage(baseImg);

  const sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512];
  const pngBuffers = [];

  for (const size of sizes) {
    console.log(`Generando tamaño ${size}x${size}...`);
    const resized = recolored512.clone().resize({ w: size, h: size });
    const buf = await resized.getBuffer('image/png');

    // Guardar en static/icons/
    const staticPngPath = path.join('static', 'icons', `${size}x${size}.png`);
    fs.writeFileSync(staticPngPath, buf);

    // Guardar en build/icons/
    const buildIconsPngPath = path.join('build', 'icons', `${size}x${size}.png`);
    if (fs.existsSync(path.dirname(buildIconsPngPath))) {
      fs.writeFileSync(buildIconsPngPath, buf);
    }

    if (size === 256) {
      fs.writeFileSync(path.join('static', 'icons', 'icon.png'), buf);
      fs.writeFileSync(path.join('build', 'icon.png'), buf);
      fs.writeFileSync(path.join('build', 'icons', 'icon.png'), buf);
    }

    if ([16, 24, 32, 48, 64, 128, 256].includes(size)) {
      pngBuffers.push({ size, buffer: buf });
    }
  }

  console.log('Construyendo icon.ico multi-resolución para Windows...');
  const icoBuffer = buildIcoBuffer(pngBuffers);
  fs.writeFileSync(path.join('static', 'icons', 'icon.ico'), icoBuffer);
  fs.writeFileSync(path.join('build', 'icon.ico'), icoBuffer);
  fs.writeFileSync(path.join('build', 'icons', 'icon.ico'), icoBuffer);

  console.log('¡Iconos Matcha Zen & Jade generados con éxito!');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
