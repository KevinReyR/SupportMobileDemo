import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { PDFDocument } from "pdf-lib";

import type { ContractorPdfFile } from "../services/data";

const MAX_CEDULA_PDF_BYTES = 1_048_576;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PDF_PAGE_MARGIN = 36;

async function imageToBase64(uri: string) {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

function base64ByteLength(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.ceil((value.length * 3) / 4) - padding;
}

export async function buildCedulaPdfFromPhotos(
  frontUri: string,
  backUri: string,
): Promise<ContractorPdfFile> {
  const attempts = [
    { width: 1400, compress: 0.72 },
    { width: 1150, compress: 0.58 },
    { width: 950, compress: 0.45 },
    { width: 800, compress: 0.36 },
  ];

  for (const attempt of attempts) {
    const [frontImage, backImage] = await Promise.all([
      manipulateAsync(frontUri, [{ resize: { width: attempt.width } }], {
        compress: attempt.compress,
        format: SaveFormat.JPEG,
      }),
      manipulateAsync(backUri, [{ resize: { width: attempt.width } }], {
        compress: attempt.compress,
        format: SaveFormat.JPEG,
      }),
    ]);

    const pdf = await PDFDocument.create();
    for (const imageResult of [frontImage, backImage]) {
      const jpgBase64 = await imageToBase64(imageResult.uri);
      const jpg = await pdf.embedJpg(jpgBase64);
      const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
      const availableWidth = A4_WIDTH - PDF_PAGE_MARGIN * 2;
      const availableHeight = A4_HEIGHT - PDF_PAGE_MARGIN * 2;
      const scale = Math.min(availableWidth / jpg.width, availableHeight / jpg.height);
      const width = jpg.width * scale;
      const height = jpg.height * scale;
      page.drawImage(jpg, {
        x: (A4_WIDTH - width) / 2,
        y: (A4_HEIGHT - height) / 2,
        width,
        height,
      });
    }

    const pdfBase64 = await pdf.saveAsBase64({ dataUri: false });
    const size = base64ByteLength(pdfBase64);
    if (size <= MAX_CEDULA_PDF_BYTES) {
      const uri = `${FileSystem.cacheDirectory ?? ""}cedula-fotos-${Date.now()}.pdf`;
      await FileSystem.writeAsStringAsync(uri, pdfBase64, { encoding: FileSystem.EncodingType.Base64 });
      return {
        uri,
        name: "cedula-fotos.pdf",
        mimeType: "application/pdf",
        size,
      };
    }
  }

  throw new Error("No fue posible generar un PDF menor a 1 MB. Repite las fotos con mejor encuadre o iluminación.");
}
