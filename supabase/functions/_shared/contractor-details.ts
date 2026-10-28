export const CONTRACTOR_REGISTRATION_FIELDS = {
  residence_department: "Departamento",
  residence_city: "Ciudad",
  neighborhood: "Barrio",
  address: "Direccion",
  pension_fund: "Fondo de pensiones",
  eps: "EPS",
} as const;

export function missingContractorRegistrationDetails(row: Record<string, unknown>): string[] {
  return Object.entries(CONTRACTOR_REGISTRATION_FIELDS)
    .filter(([column]) => !String(row[column] ?? "").trim())
    .map(([, label]) => label);
}
