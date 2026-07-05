import type { ContractorPdfFile } from "../services/data";

export async function buildCedulaPdfFromPhotos(
  _frontUri: string,
  _backUri: string,
): Promise<ContractorPdfFile> {
  throw new Error("La generación de PDF desde fotos está disponible en la app móvil.");
}
