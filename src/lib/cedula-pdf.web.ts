import { PDFDocument } from "pdf-lib";
import type { ContractorPdfFile } from "../services/data";

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

export async function buildPdfFromPhotos(photoUris: string[], name: string): Promise<ContractorPdfFile> {
  if (photoUris.length < 1 || photoUris.length > 2 || photoUris.some(uri => !uri)) {
    throw new Error("Selecciona una o dos fotos para generar el PDF.");
  }
  const images = await Promise.all(photoUris.map(loadPhoto));
  for (const [maxWidth, quality] of [[1400, 0.72], [1150, 0.58], [950, 0.45], [800, 0.36]]) {
    const pdf = await PDFDocument.create();
    for (const image of images) {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, maxWidth / image.naturalWidth);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("El navegador no permite procesar las fotos.");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpg = await pdf.embedJpg(canvas.toDataURL("image/jpeg", quality));
      canvas.width = canvas.height = 0;
      const page = pdf.addPage([595.28, 841.89]);
      const fit = Math.min((595.28 - 72) / jpg.width, (841.89 - 72) / jpg.height);
      const width = jpg.width * fit;
      const height = jpg.height * fit;
      page.drawImage(jpg, { x: (595.28 - width) / 2, y: (841.89 - height) / 2, width, height });
    }
    const base64 = await pdf.saveAsBase64();
    const size = base64.length * 3 / 4 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
    if (size <= 1_048_576) return { uri: `data:application/pdf;base64,${base64}`, name, mimeType: "application/pdf", size };
  }
  throw new Error("No fue posible generar un PDF menor a 1 MB. Prueba con fotos de menor resolución.");
}

export function buildCedulaPdfFromPhotos(frontUri: string, backUri?: string): Promise<ContractorPdfFile> {
  return buildPdfFromPhotos(backUri ? [frontUri, backUri] : [frontUri], "cedula-fotos.pdf");
}
