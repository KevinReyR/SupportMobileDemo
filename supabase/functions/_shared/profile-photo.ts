import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const OUTPUT_SIZE = 1024;
const TEMPLATE_OFFSET_Y = 110;
const EDGE_FEATHER_PX = 10;

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

function shirtOverlayAlpha(x: number, y: number, width: number, height: number) {
  const normalizedX = x / width;
  const normalizedY = y / height;
  const featherX = EDGE_FEATHER_PX / width;
  const featherY = EDGE_FEATHER_PX / height;
  const distanceFromCenter = Math.abs(normalizedX - 0.5);
  const shoulderDistance = clamp(distanceFromCenter / 0.5);
  const shirtTop = 0.39 + 0.18 * shoulderDistance ** 1.55;
  const belowShirtEdge = smoothstep(shirtTop - featherY, shirtTop + featherY, normalizedY);

  if (belowShirtEdge <= 0) return 0;

  const protectedPerson = personProtectionAlpha(normalizedX, normalizedY, featherX, featherY);
  return belowShirtEdge * (1 - protectedPerson);
}

export function composeCorporateProfilePhoto(template: Image, selfie: Image) {
  const source = selfie.width === OUTPUT_SIZE && selfie.height === OUTPUT_SIZE
    ? selfie
    : selfie.cover(OUTPUT_SIZE, OUTPUT_SIZE);
  const result = source.clone();
  const templateHeight = Math.round(template.height * (OUTPUT_SIZE / template.width));
  const shirtTemplate = template.resize(OUTPUT_SIZE, templateHeight);

  for (let targetY = 1; targetY <= OUTPUT_SIZE; targetY += 1) {
    const templateY = targetY - TEMPLATE_OFFSET_Y;
    if (templateY < 1 || templateY > shirtTemplate.height) continue;

    for (let targetX = 1; targetX <= OUTPUT_SIZE; targetX += 1) {
      const alpha = shirtOverlayAlpha(targetX - 1, targetY - 1, OUTPUT_SIZE, OUTPUT_SIZE);
      if (alpha <= 0) continue;

      const [shirtR, shirtG, shirtB] = Image.colorToRGBA(shirtTemplate.getPixelAt(targetX, templateY));
      const [selfieR, selfieG, selfieB] = Image.colorToRGBA(result.getPixelAt(targetX, targetY));
      result.setPixelAt(
        targetX,
        targetY,
        Image.rgbaToColor(
          blendChannel(shirtR, selfieR, alpha),
          blendChannel(shirtG, selfieG, alpha),
          blendChannel(shirtB, selfieB, alpha),
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
