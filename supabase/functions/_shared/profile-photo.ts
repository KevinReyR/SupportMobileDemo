import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const OUTPUT_SIZE = 1024;
const TEMPLATE_OFFSET_Y = 110;
const EDGE_FEATHER_PX = 10;
const PERSON_SCALE = 0.86;
const PERSON_ANCHOR_X = 0.5;
const PERSON_ANCHOR_Y = 0.27;

type Point = readonly [number, number];

const LEFT_COLLAR: readonly Point[] = [
  [0.369, 0.43],
  [0.39, 0.488],
  [0.412, 0.527],
  [0.388, 0.596],
  [0.342, 0.508],
];

const RIGHT_COLLAR: readonly Point[] = LEFT_COLLAR.map(([x, y]) => [1 - x, y]);

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const ratio = clamp((value - edge0) / (edge1 - edge0));
  return ratio * ratio * (3 - 2 * ratio);
}

function blendChannel(foreground: number, background: number, alpha: number) {
  return Math.round(foreground * alpha + background * (1 - alpha));
}

function reflectIndex(value: number, length: number) {
  if (value < 0) return Math.min(length - 1, -value - 1);
  if (value >= length) return Math.max(0, 2 * length - value - 1);
  return value;
}

function pointInsidePolygon(x: number, y: number, polygon: readonly Point[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [currentX, currentY] = polygon[current];
    const [previousX, previousY] = polygon[previous];
    const crossesEdge = currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (crossesEdge) inside = !inside;
  }
  return inside;
}

function distanceToSegment(x: number, y: number, start: Point, end: Point) {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const squaredLength = deltaX * deltaX + deltaY * deltaY;
  const position = squaredLength === 0
    ? 0
    : clamp(((x - start[0]) * deltaX + (y - start[1]) * deltaY) / squaredLength);
  return Math.hypot(x - (start[0] + position * deltaX), y - (start[1] + position * deltaY));
}

function featheredPolygonAlpha(x: number, y: number, polygon: readonly Point[]) {
  if (!pointInsidePolygon(x, y, polygon)) return 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let current = 0; current < polygon.length; current += 1) {
    distance = Math.min(
      distance,
      distanceToSegment(x, y, polygon[current], polygon[(current + 1) % polygon.length]),
    );
  }
  return smoothstep(0, EDGE_FEATHER_PX / OUTPUT_SIZE, distance);
}

function collarForegroundAlpha(normalizedX: number, normalizedY: number) {
  return Math.max(
    featheredPolygonAlpha(normalizedX, normalizedY, LEFT_COLLAR),
    featheredPolygonAlpha(normalizedX, normalizedY, RIGHT_COLLAR),
  );
}

function personProtectionAlpha(
  normalizedX: number,
  normalizedY: number,
  featherX: number,
  featherY: number,
) {
  const headDistance = Math.sqrt(
    ((normalizedX - 0.5) / 0.26) ** 2 + ((normalizedY - 0.27) / 0.27) ** 2,
  );
  const headProtection = 1 - smoothstep(0.96, 1.04, headDistance);
  const neckHalfWidth = normalizedY <= 0.58
    ? 0.15 - 0.04 * clamp((normalizedY - 0.43) / 0.15)
    : 0.11 * (1 - clamp((normalizedY - 0.58) / 0.11));
  const insideNeckWidth = 1 - smoothstep(
    neckHalfWidth,
    neckHalfWidth + featherX,
    Math.abs(normalizedX - 0.5),
  );
  const belowNeckTop = smoothstep(0.43 - featherY, 0.43 + featherY, normalizedY);
  const aboveNeckBottom = 1 - smoothstep(0.66, 0.69, normalizedY);
  const neckProtection = insideNeckWidth * belowNeckTop * aboveNeckBottom;

  return Math.max(headProtection, neckProtection);
}

function shirtOverlayAlpha(
  x: number,
  y: number,
  width: number,
  height: number,
  scaledSize: number,
  offsetX: number,
  offsetY: number,
) {
  const normalizedX = x / width;
  const normalizedY = y / height;
  const featherX = EDGE_FEATHER_PX / width;
  const featherY = EDGE_FEATHER_PX / height;
  const distanceFromCenter = Math.abs(normalizedX - 0.5);
  const shoulderDistance = clamp(distanceFromCenter / 0.5);
  const shirtTop = 0.39 + 0.18 * shoulderDistance ** 1.55;
  const belowShirtEdge = smoothstep(shirtTop - featherY, shirtTop + featherY, normalizedY);

  if (belowShirtEdge <= 0) return 0;

  const scaledX = x - offsetX;
  const scaledY = y - offsetY;
  const isInsideScaledSelfie = scaledX >= 0 && scaledX < scaledSize && scaledY >= 0 && scaledY < scaledSize;
  const protectedPerson = isInsideScaledSelfie
    ? personProtectionAlpha(
      scaledX / scaledSize,
      scaledY / scaledSize,
      EDGE_FEATHER_PX / scaledSize,
      EDGE_FEATHER_PX / scaledSize,
    )
    : 0;
  return belowShirtEdge * (1 - protectedPerson);
}

export function composeCorporateProfilePhoto(template: Image, selfie: Image) {
  const source = selfie.width === OUTPUT_SIZE && selfie.height === OUTPUT_SIZE
    ? selfie
    : selfie.cover(OUTPUT_SIZE, OUTPUT_SIZE);
  const scaledSize = Math.round(OUTPUT_SIZE * PERSON_SCALE);
  const offsetX = Math.round((OUTPUT_SIZE - scaledSize) * PERSON_ANCHOR_X);
  const offsetY = Math.round((OUTPUT_SIZE - scaledSize) * PERSON_ANCHOR_Y);
  const scaledSelfie = source.resize(scaledSize, scaledSize);
  const result = new Image(OUTPUT_SIZE, OUTPUT_SIZE);
  const templateHeight = Math.round(template.height * (OUTPUT_SIZE / template.width));
  const shirtTemplate = template.resize(OUTPUT_SIZE, templateHeight);

  for (let targetY = 1; targetY <= OUTPUT_SIZE; targetY += 1) {
    const scaledY = reflectIndex(targetY - 1 - offsetY, scaledSize);
    const templateY = targetY - TEMPLATE_OFFSET_Y;

    for (let targetX = 1; targetX <= OUTPUT_SIZE; targetX += 1) {
      const scaledX = reflectIndex(targetX - 1 - offsetX, scaledSize);
      const [selfieR, selfieG, selfieB] = Image.colorToRGBA(
        scaledSelfie.getPixelAt(scaledX + 1, scaledY + 1),
      );
      let resultR = selfieR;
      let resultG = selfieG;
      let resultB = selfieB;

      if (templateY >= 1 && templateY <= shirtTemplate.height) {
        const [shirtR, shirtG, shirtB] = Image.colorToRGBA(shirtTemplate.getPixelAt(targetX, templateY));
        const shirtAlpha = shirtOverlayAlpha(
          targetX - 1,
          targetY - 1,
          OUTPUT_SIZE,
          OUTPUT_SIZE,
          scaledSize,
          offsetX,
          offsetY,
        );
        resultR = blendChannel(shirtR, resultR, shirtAlpha);
        resultG = blendChannel(shirtG, resultG, shirtAlpha);
        resultB = blendChannel(shirtB, resultB, shirtAlpha);

        const collarAlpha = collarForegroundAlpha(
          (targetX - 1) / OUTPUT_SIZE,
          (targetY - 1) / OUTPUT_SIZE,
        );
        resultR = blendChannel(shirtR, resultR, collarAlpha);
        resultG = blendChannel(shirtG, resultG, collarAlpha);
        resultB = blendChannel(shirtB, resultB, collarAlpha);
      }

      result.setPixelAt(
        targetX,
        targetY,
        Image.rgbaToColor(
          resultR,
          resultG,
          resultB,
          255,
        ),
      );
    }
  }

  return result;
}

async function encodeCompressedProfilePhoto(image: Image) {
  const attempts = [
    { size: 768, quality: 78 },
    { size: 640, quality: 70 },
    { size: 512, quality: 66 },
  ];
  let current = image;
  let lastBytes: Uint8Array | null = null;

  for (const attempt of attempts) {
    if (current.width > attempt.size || current.height > attempt.size) {
      current = current.contain(attempt.size, attempt.size);
    }
    lastBytes = await current.encodeJPEG(attempt.quality);
    if (lastBytes.byteLength <= 1_500_000) return lastBytes;
  }

  return lastBytes ?? await image.encodeJPEG(66);
}

export async function createCorporateProfilePhoto(templateBytes: Uint8Array, selfieBytes: Uint8Array) {
  const [template, selfie] = await Promise.all([
    Image.decode(templateBytes),
    Image.decode(selfieBytes),
  ]);
  return await encodeCompressedProfilePhoto(composeCorporateProfilePhoto(template, selfie));
}
