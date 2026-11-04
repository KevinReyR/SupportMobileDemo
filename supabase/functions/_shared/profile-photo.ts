import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const SIZE = 1024;
const RETAKE = "No pudimos separar bien el rostro y el cuello. Repite la foto con el rostro centrado, buena luz y un fondo uniforme.";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fade(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function color(image: Image, x: number, y: number) {
  return Image.colorToRGBA(image.getPixelAt(x + 1, y + 1));
}

function backgroundAt(image: Image, y: number) {
  const left = color(image, 65, y);
  const right = color(image, SIZE - 66, y);
  return left[0] + left[1] + left[2] >= right[0] + right[1] + right[2] ? left : right;
}

function isPerson(pixel: number[], background: number[]) {
  const difference = Math.hypot(pixel[0] - background[0], pixel[1] - background[1], pixel[2] - background[2]);
  const chroma = Math.max(pixel[0], pixel[1], pixel[2]) - Math.min(pixel[0], pixel[1], pixel[2]);
  return difference > 44 && (chroma > 17 || pixel[0] + pixel[1] + pixel[2] < background[0] + background[1] + background[2] - 102);
}

function silhouette(image: Image) {
  const rows: { y: number; left: number; right: number }[] = [];
  for (let y = 100; y < 720; y += 2) {
    const background = backgroundAt(image, y);
    let left = SIZE;
    let right = -1;
    for (let x = 160; x < 864; x += 2) {
      if (isPerson(color(image, x, y), background)) {
        left = Math.min(left, x);
        right = x;
      }
    }
    if (right - left >= 45) rows.push({ y, left, right });
  }
  const top = rows.find((row, index) => rows.slice(index, index + 12).filter((other) => other.y < row.y + 24).length >= 8)?.y;
  if (top === undefined || top > 430) throw new Error(RETAKE);
  const headRows = rows.filter((row) => row.y >= top + 110 && row.y <= top + 300);
  if (headRows.length < 50) throw new Error(RETAKE);
  const centers = headRows.map((row) => (row.left + row.right) / 2).sort((a, b) => a - b);
  const widths = headRows.map((row) => row.right - row.left).sort((a, b) => a - b);
  const center = Math.round(centers[Math.floor(centers.length / 2)]);
  const width = widths[Math.floor(widths.length / 2)];
  const bottom = Math.round(top + width * 1.9);
  if (center < 300 || center > 724 || width < 200 || width > 530 || bottom > 970) throw new Error(RETAKE);
  const left = new Int16Array(SIZE).fill(-1);
  const right = new Int16Array(SIZE).fill(-1);
  let missing = 0;
  for (let y = top; y <= bottom; y += 1) {
    const background = backgroundAt(image, y);
    const neck = fade((y - top - width * 1.05) / (width * 0.57));
    const limit = width * (0.68 - 0.46 * neck);
    for (let x = Math.max(1, Math.floor(center - limit)); x < Math.min(SIZE - 1, Math.ceil(center + limit)); x += 1) {
      if (isPerson(color(image, x, y), background)) {
        if (left[y] < 0) left[y] = x;
        right[y] = x;
      }
    }
    if (right[y] - left[y] < 35) {
      left[y] = -1;
      right[y] = -1;
      if (y < top + width * 1.1) missing += 1;
    }
  }
  if (missing > width * 0.07) throw new Error(RETAKE);
  return { top, bottom, center, width, left, right };
}

export function composeCorporateProfilePhoto(template: Image, selfie: Image) {
  const source = selfie.width === SIZE && selfie.height === SIZE ? selfie : selfie.cover(SIZE, SIZE);
  const person = silhouette(source);
  const scale = clamp(310 / person.width, 0.7, 1.08);
  const dx = Math.round(SIZE / 2 - person.center * scale);
  const dy = Math.round(100 - person.top * scale);
  const shirtHeight = Math.round(template.height * SIZE / template.width);
  const shirt = template.resize(SIZE, shirtHeight);
  const output = new Image(SIZE, SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const shirtY = clamp(y - 110, 0, shirtHeight - 1);
      const base = color(shirt, x, shirtY);
      let [red, green, blue] = base;
      const sx = Math.round((x - dx) / scale);
      const sy = Math.round((y - dy) / scale);
      if (sx >= 0 && sx < SIZE && sy >= person.top && sy <= person.bottom) {
        const ellipseX = (sx - person.center) / (person.width * 0.68);
        const ellipseY = (sy - person.top - person.width * 0.68) / (person.width * 0.73);
        const faceAlpha = 1 - fade((Math.hypot(ellipseX, ellipseY) - 0.84) / 0.16);
        const neckProgress = clamp((sy - person.top - person.width * 1.2) / (person.width * 0.38), 0, 1);
        const neckHalfWidth = person.width * (0.33 - 0.12 * neckProgress);
        const neckAlpha = fade((neckHalfWidth - Math.abs(sx - person.center)) / 18)
          * fade((sy - person.top - person.width * 1.14) / 15)
          * (1 - fade((sy - person.top - person.width * 1.75) / (person.width * 0.15)));
        let alpha = Math.max(faceAlpha, neckAlpha) * fade((sy - person.top) / 12);
        if (y > 505) {
          const openingHalfWidth = Math.max(0, 116 * (650 - y) / 145);
          alpha *= fade((openingHalfWidth - Math.abs(x - SIZE / 2)) / 10);
          alpha *= 1 - fade((y - 630) / 20);
        }
        if (sy < person.top + person.width * 1.15 && person.left[sy] >= 0) {
          alpha *= fade((sx - person.left[sy] + 15) / 25)
            * fade((person.right[sy] - sx + 15) / 25);
        }
        if (alpha > 0) {
          const foreground = color(source, sx, sy);
          if (alpha < 0.98 && !isPerson(foreground, backgroundAt(source, sy))) alpha = 0;
          red = Math.round(foreground[0] * alpha + red * (1 - alpha));
          green = Math.round(foreground[1] * alpha + green * (1 - alpha));
          blue = Math.round(foreground[2] * alpha + blue * (1 - alpha));
        }
      }
      output.setPixelAt(x + 1, y + 1, Image.rgbaToColor(red, green, blue, 255));
    }
  }
  return output;
}

export async function createCorporateProfilePhoto(templateBytes: Uint8Array, selfieBytes: Uint8Array) {
  const [template, selfie] = await Promise.all([Image.decode(templateBytes), Image.decode(selfieBytes)]);
  return await composeCorporateProfilePhoto(template, selfie).contain(768, 768).encodeJPEG(78);
}
