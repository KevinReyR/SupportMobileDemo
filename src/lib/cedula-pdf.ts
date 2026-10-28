import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { PDFDocument } from "pdf-lib";
import { Platform } from "react-native";

import type { ContractorPdfFile } from "../services/data";

const MAX_DOCUMENT_PDF_BYTES = 1_048_576;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PDF_PAGE_MARGIN = 36;

function base64ByteLength(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.ceil((value.length * 3) / 4) - padding;
}

export async function buildPdfFromPhotos(photoUris: string[], name: string): Promise<ContractorPdfFile> {
  if (photoUris.length < 1 || photoUris.length > 2 || photoUris.some((uri) => !uri)) {
    throw new Error("Selecciona una o dos fotos para generar el PDF.");
  }
  const attempts = [
    { width: 1400, compress: 0.72 },
    { width: 1150, compress: 0.58 },
    { width: 950, compress: 0.45 },
    { width: 800, compress: 0.36 },
  ];

  for (const attempt of attempts) {
    const images = await Promise.all(photoUris.map((uri) => manipulateAsync(
      uri,
      [{ resize: { width: attempt.width } }],
      {
        base64: true,
        compress: attempt.compress,
        format: SaveFormat.JPEG,
      },
    )));

    const pdf = await PDFDocument.create();
    for (const imageResult of images) {
      if (!imageResult.base64) throw new Error("No fue posible leer la foto seleccionada.");
      const jpg = await pdf.embedJpg(imageResult.base64);
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
    if (size <= MAX_DOCUMENT_PDF_BYTES) {
      let uri: string;
      if (Platform.OS === "web") {
        uri = `data:application/pdf;base64,${pdfBase64}`;
      } else {
        if (!FileSystem.cacheDirectory) throw new Error("No hay espacio temporal disponible para el PDF.");
        uri = `${FileSystem.cacheDirectory}documento-fotos-${Date.now()}.pdf`;
        await FileSystem.writeAsStringAsync(uri, pdfBase64, { encoding: FileSystem.EncodingType.Base64 });
      }
      return {
        uri,
        name,
        mimeType: "application/pdf",
        size,
      };
    }
  }

  throw new Error("No fue posible generar un PDF menor a 1 MB. Prueba con una foto más nítida o de menor resolución.");
}

export function buildCedulaPdfFromPhotos(frontUri: string, backUri?: string): Promise<ContractorPdfFile> {
  return buildPdfFromPhotos(backUri ? [frontUri, backUri] : [frontUri], "cedula-fotos.pdf");
}
