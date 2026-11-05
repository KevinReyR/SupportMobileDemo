import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const PHOTO_ERROR = "No pudimos preparar la foto institucional. Intenta enviar nuevamente; tus datos no se han enviado.";
const PROMPT = `Edit ONLY the clothing in image 1 (the original selfie).
Image 1 is the base photograph and the sole source of the person's identity,
anatomy, pose, framing, head size, shoulders, neck length and proportions.
Image 2 is ONLY a garment and logo reference, NOT a body template.
Replace the existing clothing with the white Support Colombia institutional
button-down shirt shown in image 2, including its original logo, lettering,
colors and placement on the wearer's left chest. Fit the shirt naturally to
the ORIGINAL body and shoulders. Keep the collar BELOW the original jaw,
leaving the original neck visible. Match the garment lighting to the selfie.
Do not paste, replace, resize, reposition or regenerate the head or body.
Do not beautify, smooth skin, correct asymmetry, improve the face, change age,
expression, skin tone, hair, beard, ears, eyes, nose, mouth or eyebrows.
Preserve the face and exposed neck exactly as photographed, including texture,
imperfections, shadows and original proportions. Preserve the background and
camera framing. Do not add accessories. Return one photorealistic edited selfie.`;

// High input fidelity reduces unwanted edits; it does not guarantee pixel identity.
export async function createCorporateProfilePhoto(
  templateBytes: Uint8Array,
  selfieBytes: Uint8Array,
  options: { apiKey?: string; fetcher?: typeof fetch } = {},
) {
  const apiKey = options.apiKey ?? Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("La foto institucional no esta configurada. Contacta al coordinador.");

  const form = new FormData();
  form.set("model", "gpt-image-1.5");
  form.set("input_fidelity", "high");
  form.set("quality", "high");
  form.set("size", "1024x1024");
  form.set("output_format", "jpeg");
  form.set("n", "1");
  form.set("prompt", PROMPT);
  form.append("image[]", new Blob([new Uint8Array(selfieBytes)], { type: "image/jpeg" }), "selfie.jpg");
  form.append("image[]", new Blob([new Uint8Array(templateBytes)], { type: "image/png" }), "shirt-reference.png");

  const controller = new AbortController();
  // Leave time for Storage and contract generation before the Edge request expires.
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      // Never log selfies, credentials, or raw provider error bodies.
      console.error("corporate_photo_edit_failed", { status: response.status, requestId: response.headers.get("x-request-id") });
      throw new Error(PHOTO_ERROR);
    }
    const result = await response.json();
    const encoded = result?.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || !encoded.length) throw new Error(PHOTO_ERROR);
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const image = await Image.decode(bytes);
    if (image.width !== 1024 || image.height !== 1024) throw new Error(PHOTO_ERROR);
    return await image.resize(768, 768).encodeJPEG(90);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("La foto institucional tardo demasiado. Intenta enviar nuevamente en unos minutos.");
    }
    if (error instanceof Error && error.message === PHOTO_ERROR) throw error;
    throw new Error(PHOTO_ERROR);
  } finally {
    clearTimeout(timeout);
  }
}
