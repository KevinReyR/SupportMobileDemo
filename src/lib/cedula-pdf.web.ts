import type { ContractorPdfFile } from "../services/data";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 36;
const MAX_PDF_BYTES = 1_048_576;

type PdfImage = { bytes: Uint8Array; width: number; height: number };

function loadPhoto(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.onload = image.onerror = null;
      reject(new Error("La foto tardó demasiado en cargar. Selecciónala nuevamente."));
    }, 20000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("No fue posible leer la foto. Prueba con una imagen JPG o PNG."));
    };
    image.crossOrigin = "anonymous";
    image.src = uri;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("El navegador no pudo convertir la foto a JPG."));
    }, "image/jpeg", quality);
  });
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function createPdf(images: PdfImage[]): Uint8Array {
  const objectCount = 2 + images.length * 3;
  const objects = new Map<number, Uint8Array>();
  const pageReferences = images.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  objects.set(1, ascii("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(2, ascii(`<< /Type /Pages /Kids [${pageReferences}] /Count ${images.length} >>`));

  images.forEach((image, index) => {
    const pageObject = 3 + index * 3;
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const fit = Math.min(
      (A4_WIDTH - PAGE_MARGIN * 2) / image.width,
      (A4_HEIGHT - PAGE_MARGIN * 2) / image.height,
    );
    const width = image.width * fit;
    const height = image.height * fit;
    const x = (A4_WIDTH - width) / 2;
    const y = (A4_HEIGHT - height) / 2;
    const content = ascii(`q\n${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im${index + 1} Do\nQ\n`);

    objects.set(pageObject, ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] ` +
      `/Resources << /XObject << /Im${index + 1} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
    ));
    objects.set(imageObject, joinBytes([
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      ),
      image.bytes,
      ascii("\nendstream"),
    ]));
    objects.set(contentObject, joinBytes([
      ascii(`<< /Length ${content.length} >>\nstream\n`),
      content,
      ascii("endstream"),
    ]));
  });

  const parts: Uint8Array[] = [ascii("%PDF-1.4\n%"), new Uint8Array([255, 255, 255, 255]), ascii("\n")];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  let length = parts.reduce((total, part) => total + part.length, 0);
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    const object = objects.get(objectNumber);
    if (!object) throw new Error("No fue posible construir el documento PDF.");
    const prefix = ascii(`${objectNumber} 0 obj\n`);
    const suffix = ascii("\nendobj\n");
    offsets[objectNumber] = length;
    parts.push(prefix, object, suffix);
    length += prefix.length + object.length + suffix.length;
  }

  const xrefOffset = length;
  parts.push(ascii([
    `xref\n0 ${objectCount + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("")));
  return joinBytes(parts);
}

async function prepareImage(image: HTMLImageElement, maxWidth: number, quality: number): Promise<PdfImage> {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("El navegador no permite procesar las fotos.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToJpeg(canvas, quality);
  const result = {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
  canvas.width = canvas.height = 0;
  return result;
}

export async function buildPdfFromPhotos(photoUris: string[], name: string): Promise<ContractorPdfFile> {
  if (photoUris.length < 1 || photoUris.length > 2 || photoUris.some(uri => !uri)) {
    throw new Error("Selecciona una o dos fotos para generar el PDF.");
  }
  const images = await Promise.all(photoUris.map(loadPhoto));
  for (const [maxWidth, quality] of [[1400, 0.72], [1150, 0.58], [950, 0.45], [800, 0.36]]) {
    const prepared = await Promise.all(images.map(image => prepareImage(image, maxWidth, quality)));
    const pdfBytes = createPdf(prepared);
    if (pdfBytes.length <= MAX_PDF_BYTES) {
      const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
      new Uint8Array(pdfBuffer).set(pdfBytes);
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      return { uri: URL.createObjectURL(blob), name, mimeType: "application/pdf", size: blob.size };
    }
  }
  throw new Error("No fue posible generar un PDF menor a 1 MB. Prueba con fotos de menor resolución.");
}

export function buildCedulaPdfFromPhotos(frontUri: string, backUri?: string): Promise<ContractorPdfFile> {
  return buildPdfFromPhotos(backUri ? [frontUri, backUri] : [frontUri], "cedula-fotos.pdf");
}
