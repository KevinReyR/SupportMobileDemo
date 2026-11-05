import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { createCorporateProfilePhoto } from "./profile-photo.ts";

function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
}

Deno.test("edits selfie first with high fidelity and reference second", async () => {
  const jpeg = await new Image(1024, 1024).fill(0xffffffff).encodeJPEG(80);
  let binary = "";
  for (const byte of jpeg) binary += String.fromCharCode(byte);
  const fetcher = (async (url, init) => {
    assert(url === "https://api.openai.com/v1/images/edits", "edit endpoint");
    const form = init!.body as FormData;
    assert(form.get("input_fidelity") === "high", "high fidelity required");
    assert(form.get("model") === "gpt-image-1.5", "compatible model");
    const images = form.getAll("image[]") as File[];
    assert(images.length === 2 && images[0].name === "selfie.jpg", "selfie must be first");
    assert(images[1].name === "shirt-reference.png", "garment reference second");
    assert(!form.has("mask"), "no geometric face mask");
    return Response.json({ data: [{ b64_json: btoa(binary) }] });
  }) as typeof fetch;
  const output = await createCorporateProfilePhoto(new Uint8Array([1]), jpeg, { apiKey: "test", fetcher });
  const decoded = await Image.decode(output);
  assert(decoded.width === 768 && decoded.height === 768, "stored JPEG dimensions");
});

for (const status of [401, 429, 500, 200]) {
  Deno.test(`provider failure or empty result (${status}) never falls back to selfie`, async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return Response.json({}, { status });
    }) as typeof fetch;
    let rejected = false;
    try {
      await createCorporateProfilePhoto(new Uint8Array(), new Uint8Array(), { apiKey: "test", fetcher });
    } catch {
      rejected = true;
    }
    assert(rejected && calls === 1, "reject without fallback/retry");
  });
}
