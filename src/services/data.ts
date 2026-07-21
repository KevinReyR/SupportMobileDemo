import { supabase } from "../lib/supabase";
import type {
  AdminUser,
  AdminData,
  AppData,
  Assignment,
  ClientContractor,
  ContractStatus,
  Contractor,
  ContractorContractSignatureEvidence,
  ContractorOnboardingForm,
  ContractorOnboardingContract,
  ContractorOnboardingSubmission,
  ContractorDocument,
  ContractorHistory,
  DirectorReportRankingItem,
  DirectorReportsSummary,
  Operation,
  PersonnelRequest,
  Role,
  RoleCode,
  StatisticsContractorOption,
  StatisticsSummary,
  UserContext,
  WorkwearMovement,
  WorkwearMovementType,
  WorkwearSummary,
} from "../types";

const rolePriority: RoleCode[] = ["ADMIN", "DIRECTOR", "COORDINATOR", "CLIENT"];
const roleNames: Record<RoleCode, Role> = {
  ADMIN: "Administrador",
  DIRECTOR: "Director",
  COORDINATOR: "Coordinador",
  CLIENT: "Cliente",
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function cleanText(value: string | null | undefined) {
  if (!value) return "";
  return value
    .split("\u00C3\u00A1").join("á")
    .split("\u00C3\u00A9").join("é")
    .split("\u00C3\u00AD").join("í")
    .split("\u00C3\u00B3").join("ó")
    .split("\u00C3\u00BA").join("ú")
    .split("\u00C3\u00B1").join("ñ")
    .split("\u00C3\u00BC").join("ü")
    .split("\u00C3\u0081").join("Á")
    .split("\u00C3\u0089").join("É")
    .split("\u00C3\u008D").join("Í")
    .split("\u00C3\u0093").join("Ó")
    .split("\u00C3\u009A").join("Ú")
    .split("\u00E2\u2039\u2026").join("⋅")
    .split("\u00C2\u00B7").join("⋅");
}

const CONTRACTOR_DOCUMENT_BUCKET = "contractor-documents";
const MAX_CONTRACTOR_DOCUMENT_BYTES = 1_048_576;
export type ContractorActivationDocumentType =
  | "CERTIFICADO_ARL"
  | "ANTECEDENTES_POLICIA"
  | "ANTECEDENTES_PROCURADURIA";
type ContractorUploadDocumentType = "CEDULA" | ContractorActivationDocumentType;
export type ContractorDocumentTypeOption = { id: number; name: string; code: string };

function normalizeContractStatus(value: string | null | undefined): ContractStatus {
  const normalized = cleanText(value).toUpperCase();
  if (normalized === "PENDIENTE" || normalized === "INACTIVO") return normalized;
  return "ACTIVO";
}

function uniqueToken() {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function validatePdfFile(file: ContractorPdfFile) {
  const name = file.name || "documento.pdf";
  const mimeType = file.mimeType || "application/pdf";
  const isPdf = mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
  if (!isPdf) throw new Error("El documento debe estar en formato PDF.");
  if (typeof file.size === "number" && file.size > MAX_CONTRACTOR_DOCUMENT_BYTES) {
    throw new Error("El PDF no puede superar 1 MB.");
  }
}

export interface ContractorPdfFile {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

export interface CreateContractorInput {
  documentTypeId: number;
  documentNumber: string;
  name: string;
  lastName: string;
  birthDate: string;
  phone: string;
  email: string;
  cedulaPdf: ContractorPdfFile;
}

export async function loadUserContext(userId: string): Promise<UserContext> {
  const [profileResult, rolesResult, clientsResult] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("id,name,last_name,email,is_active")
      .eq("id", userId)
      .single(),
    supabase.from("user_roles").select("roles(code)").eq("user_id", userId),
    supabase.from("user_clients").select("clients(id,name)").eq("user_id", userId),
  ]);

  fail(profileResult.error);
  fail(rolesResult.error);
  fail(clientsResult.error);

  const profile = profileResult.data as any;
  if (!profile?.is_active) throw new Error("Tu usuario está inactivo. Contacta al administrador.");

  const codes = (rolesResult.data ?? [])
    .map((row: any) => firstRelation(row.roles)?.code as RoleCode | undefined)
    .filter(Boolean) as RoleCode[];
  const roleCode = rolePriority.find((code) => codes.includes(code));
  if (!roleCode) throw new Error("El usuario no tiene un perfil asignado.");

  return {
    id: profile.id,
    name: cleanText(profile.name),
    lastName: cleanText(profile.last_name),
    email: profile.email,
    active: profile.is_active,
    roleCode,
    role: roleNames[roleCode],
    clients: (clientsResult.data ?? [])
      .map((row: any) => firstRelation(row.clients))
      .filter(Boolean)
      .map((client: any) => ({ id: client.id, name: cleanText(client.name) })),
  };
}

export async function loadAppData(context: UserContext): Promise<AppData> {
  const common = await Promise.all([
    supabase.from("clients").select("id,name").eq("is_active", true).order("id"),
    supabase.from("document_type").select("id,name").order("id"),
    supabase
      .from("operation")
      .select(
        "id,operation_date,client_id,area_id,operation_type_id,shift_id,service_unit_type_id,planned_units,actual_units,status,observations,review_observations,clients(name),area(name),operation_type(code,name),shift(name),service_unit_type(name),operation_assignment(id,planned_quantity,worked_quantity,extra_hours)",
      )
      .order("operation_date", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("personnel_request")
      .select("id,client_id,area_id,required_quantity,description,required_date,status,clients(name),area(name)")
      .order("required_date", { ascending: false }),
    supabase.from("area").select("id,name,client_id").eq("is_active", true).order("id"),
    supabase.from("shift").select("id,name,area_id").eq("is_active", true).order("area_id").order("id"),
    supabase.from("attendance_status").select("id,name").order("id"),
    supabase.from("workwear_type").select("id,name").order("name"),
    supabase.from("contractor_termination_reasons").select("id,name").eq("is_active", true).order("id"),
    supabase.from("contractor_document_types").select("id,name,code").eq("is_active", true).order("name"),
    supabase.from("contract_type").select("id,name").order("id"),
    supabase.from("service_unit_type").select("id,name").eq("is_active", true).order("name"),
  ]);

  common.forEach((result) => fail(result.error));

  const operations: Operation[] = (common[2].data ?? []).map((row: any) => {
    const assignments = row.operation_assignment ?? [];
    return {
      id: row.id,
      date: row.operation_date,
      clientId: row.client_id,
      client: cleanText(firstRelation<any>(row.clients)?.name),
      areaId: row.area_id,
      area: cleanText(firstRelation<any>(row.area)?.name),
      operationType: (firstRelation<any>(row.operation_type)?.code ?? "TURNO") as "TURNO" | "DESCARGUE",
      operationTypeName: cleanText(firstRelation<any>(row.operation_type)?.name) || "Turno",
      shiftId: row.shift_id,
      shift: cleanText(firstRelation<any>(row.shift)?.name) || "Sin turno",
      serviceUnitTypeId: row.service_unit_type_id ?? null,
      serviceUnitType: cleanText(firstRelation<any>(row.service_unit_type)?.name) || null,
      plannedUnits: row.planned_units === null ? null : Number(row.planned_units),
      actualUnits: row.actual_units === null ? null : Number(row.actual_units),
      people: assignments.length,
      worked: assignments.reduce(
        (total: number, assignment: any) => total + Number(assignment.worked_quantity ?? 0),
        0,
      ),
      extraHours: assignments.reduce(
        (total: number, assignment: any) => total + Number(assignment.extra_hours ?? 0),
        0,
      ),
      status: row.status,
      observations: row.observations,
      reviewObservations: row.review_observations,
    };
  });

  const requests: PersonnelRequest[] = (common[3].data ?? []).map((row: any) => ({
    id: row.id,
    clientId: row.client_id,
      client: cleanText(firstRelation<any>(row.clients)?.name),
    areaId: row.area_id,
      area: cleanText(firstRelation<any>(row.area)?.name),
    quantity: row.required_quantity,
      description: cleanText(row.description),
    requiredDate: row.required_date,
    status: row.status,
  }));

  let contractors: Contractor[] = [];
  let clientContractors: ClientContractor[] = [];
  if (context.roleCode !== "CLIENT") {
    const [contractorResult, assignmentResult, contractResult] = await Promise.all([
      supabase
        .from("contractor")
        .select(
          "id,name,last_name,document_number,profile_photo_file_id,birth_date,birth_place,residence_city,phone_number,email,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,rh,eps,arl,pension_fund,disponibility,shirt_size,pant_size,shoe_size,hire_date,termination_date,transport_type(name),civil_state_type(name)",
        )
        .order("name"),
      supabase
        .from("operation_assignment")
        .select("contractor_id,operation(operation_date,clients(name),area(name))")
        .is("deleted_at", null),
      supabase
        .from("contractor_contract")
        .select("id,contractor_id,start_date,end_date,status_id,contract_type,contract_status(name),contract_type_ref:contract_type(name)")
        .order("start_date", { ascending: false })
        .order("id", { ascending: false }),
    ]);
    fail(contractorResult.error);
    fail(assignmentResult.error);
    fail(contractResult.error);

    const lastAssignments = new Map<number, any>();
    for (const row of assignmentResult.data ?? []) {
      const operation = firstRelation<any>((row as any).operation);
      if (!operation) continue;
      const current = lastAssignments.get((row as any).contractor_id);
      if (!current || operation.operation_date > current.operation_date) {
        lastAssignments.set((row as any).contractor_id, operation);
      }
    }

    const latestContracts = new Map<
      number,
      { status: ContractStatus; typeId: number | null; typeName: string }
    >();
    for (const row of contractResult.data ?? []) {
      const contractorId = Number((row as any).contractor_id);
      if (!latestContracts.has(contractorId)) {
        latestContracts.set(contractorId, {
          status: normalizeContractStatus(firstRelation<any>((row as any).contract_status)?.name),
          typeId: (row as any).contract_type ?? null,
          typeName: cleanText(firstRelation<any>((row as any).contract_type_ref)?.name) || "Sin tipo",
        });
      }
    }

    contractors = (contractorResult.data ?? []).map((row: any) => {
      const latest = lastAssignments.get(row.id);
      const firstName = cleanText(row.name);
      const lastName = cleanText(row.last_name);
      const fullName = `${firstName} ${lastName}`.trim();
      const latestContract = latestContracts.get(row.id);
      return {
        id: row.id,
        name: firstName,
        lastName,
        fullName,
        initials: `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase(),
        document: row.document_number,
        profilePhotoFileId: row.profile_photo_file_id ?? null,
        birthDate: row.birth_date,
        birthPlace: cleanText(row.birth_place) || "Sin registrar",
        phone: row.phone_number,
        email: row.email,
        emergencyContactName: cleanText(row.emergency_contact_name) || "Sin registrar",
        emergencyContactRelationship: cleanText(row.emergency_contact_relationship) || "Sin registrar",
        emergencyContactPhone: cleanText(row.emergency_contact_phone) || "Sin registrar",
        rh: row.rh,
        eps: cleanText(row.eps) || null,
        arl: cleanText(row.arl) || null,
        pensionFund: cleanText(row.pension_fund) || null,
        transport: cleanText(firstRelation<any>(row.transport_type)?.name) || "Sin registrar",
        civilState: cleanText(firstRelation<any>(row.civil_state_type)?.name) || "Sin registrar",
        city: cleanText(row.residence_city) || "Sin registrar",
        available: Boolean(row.disponibility),
        shirtSize: row.shirt_size,
        pantSize: row.pant_size,
        shoeSize: row.shoe_size,
        hireDate: row.hire_date,
        terminationDate: row.termination_date,
        active: (latestContract?.status ?? "INACTIVO") === "ACTIVO",
        contractStatus: latestContract?.status ?? "INACTIVO",
        contractTypeId: latestContract?.typeId ?? null,
        contractTypeName: latestContract?.typeName ?? "Sin tipo",
        lastClient: cleanText(firstRelation<any>(latest?.clients)?.name) || "Sin operación",
        lastArea: cleanText(firstRelation<any>(latest?.area)?.name) || "Sin área",
        lastDate: latest?.operation_date ?? null,
      };
    });
  } else {
    const result = await supabase.rpc("get_client_contractors");
    fail(result.error);
    clientContractors = (result.data ?? []).map((row: any) => {
      const name = cleanText(row.first_name);
      const lastName = cleanText(row.last_name);
      return {
        id: Number(row.contractor_id),
        name,
        lastName,
        fullName: `${name} ${lastName}`.trim(),
        initials: `${name[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase(),
        document: cleanText(row.document_number),
        profilePhotoFileId: row.profile_photo_file_id ?? null,
        birthDate: row.birth_date,
        rh: cleanText(row.rh) || null,
        eps: cleanText(row.eps) || null,
        arl: cleanText(row.arl) || null,
        civilState: cleanText(row.civil_state) || "Sin registrar",
        lastArea: cleanText(row.last_area) || "Sin área",
        lastDate: row.last_operation_date,
      };
    });
  }

  let users: AdminUser[] = [];
  if (context.roleCode === "ADMIN") {
    const [profilesResult, rolesResult, clientsResult] = await Promise.all([
      supabase.from("user_profiles").select("id,name,last_name,email,phone_number,is_active").order("name"),
      supabase.from("user_roles").select("user_id,roles(name)"),
      supabase.from("user_clients").select("user_id,clients(id,name)"),
    ]);
    fail(profilesResult.error);
    fail(rolesResult.error);
    fail(clientsResult.error);
    users = (profilesResult.data ?? []).map((profile: any) => ({
      id: profile.id,
      firstName: cleanText(profile.name),
      lastName: cleanText(profile.last_name),
      name: `${cleanText(profile.name)} ${cleanText(profile.last_name)}`.trim(),
      email: profile.email,
      phone: profile.phone_number,
      active: profile.is_active,
      role:
        firstRelation<any>(
          (rolesResult.data ?? []).find((row: any) => row.user_id === profile.id)?.roles,
        )?.name ? cleanText(firstRelation<any>(
          (rolesResult.data ?? []).find((row: any) => row.user_id === profile.id)?.roles,
        )?.name) : "Sin perfil",
      clients: (clientsResult.data ?? [])
        .filter((row: any) => row.user_id === profile.id)
        .map((row: any) => cleanText(firstRelation<any>(row.clients)?.name))
        .filter(Boolean),
      clientIds: (clientsResult.data ?? [])
        .filter((row: any) => row.user_id === profile.id)
        .map((row: any) => firstRelation<any>(row.clients)?.id)
        .filter(Boolean),
    }));
  }

  return {
    clients: (common[0].data ?? []).map((client: any) => ({
      id: client.id,
      name: cleanText(client.name),
    })),
    documentTypes: (common[1].data ?? []).map((documentType: any) => ({
      id: documentType.id,
      name: cleanText(documentType.name),
    })),
    operations,
    requests,
    contractors,
    clientContractors,
    areas: (common[4].data ?? []).map((area: any) => ({
      id: area.id,
      name: cleanText(area.name),
      clientId: area.client_id,
    })),
    shifts: (common[5].data ?? []).map((shift: any) => ({
      id: shift.id,
      name: cleanText(shift.name),
      areaId: shift.area_id,
    })),
    attendanceStatuses: (common[6].data ?? []).map((status: any) => ({
      id: status.id,
      name: status.name,
    })),
    workwearTypes: (common[7].data ?? []).map((type: any) => ({
      id: type.id,
      name: cleanText(type.name),
    })),
    terminationReasons: (common[8].data ?? []).map((reason: any) => ({
      id: reason.id,
      name: cleanText(reason.name),
    })),
    contractorDocumentTypes: (common[9].data ?? [])
      .filter((documentType: any) => documentType.code !== "CONTRATO_FIRMADO")
      .map((documentType: any) => ({
        id: documentType.id,
        name: cleanText(documentType.name),
        code: documentType.code,
      })),
    contractTypes: (common[10].data ?? []).map((contractType: any) => ({
      id: contractType.id,
      name: cleanText(contractType.name),
    })),
    serviceUnitTypes: (common[11].data ?? []).map((unitType: any) => ({
      id: unitType.id,
      name: cleanText(unitType.name),
    })),
    users,
  };
}

function mapClientContractor(row: any): ClientContractor {
  const name = cleanText(row.first_name);
  const lastName = cleanText(row.last_name);
  return {
    id: Number(row.contractor_id),
    name,
    lastName,
    fullName: `${name} ${lastName}`.trim(),
    initials: `${name[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase(),
    document: cleanText(row.document_number),
    profilePhotoFileId: row.profile_photo_file_id ?? null,
    birthDate: row.birth_date,
    rh: cleanText(row.rh) || null,
    eps: cleanText(row.eps) || null,
    arl: cleanText(row.arl) || null,
    civilState: cleanText(row.civil_state) || "Sin registrar",
    lastArea: cleanText(row.last_area) || "Sin área",
    lastDate: row.last_operation_date,
  };
}

export async function loadContractorProfile(contractorId: number): Promise<Contractor> {
  const [contractorResult, assignmentResult, contractResult] = await Promise.all([
    supabase
      .from("contractor")
      .select(
        "id,name,last_name,document_number,profile_photo_file_id,birth_date,birth_place,residence_city,phone_number,email,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,rh,eps,arl,pension_fund,disponibility,shirt_size,pant_size,shoe_size,hire_date,termination_date,transport_type(name),civil_state_type(name)",
      )
      .eq("id", contractorId)
      .single(),
    supabase
      .from("operation_assignment")
      .select("id,contractor_id,operation(operation_date,clients(name),area(name))")
      .eq("contractor_id", contractorId)
      .is("deleted_at", null),
    supabase
      .from("contractor_contract")
      .select("id,contractor_id,start_date,end_date,status_id,contract_type,contract_status(name),contract_type_ref:contract_type(name)")
      .eq("contractor_id", contractorId)
      .order("start_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(1),
  ]);
  fail(contractorResult.error);
  fail(assignmentResult.error);
  fail(contractResult.error);

  const row = contractorResult.data as any;
  const latestAssignment = (assignmentResult.data ?? [])
    .map((assignment: any) => firstRelation<any>(assignment.operation))
    .filter(Boolean)
    .sort((left: any, right: any) => String(right.operation_date).localeCompare(String(left.operation_date)))[0];
  const contract = (contractResult.data ?? [])[0] as any;
  const contractStatus = contract
    ? normalizeContractStatus(firstRelation<any>(contract.contract_status)?.name)
    : "INACTIVO";
  const firstName = cleanText(row.name);
  const lastName = cleanText(row.last_name);

  return {
    id: Number(row.id),
    name: firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    initials: `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase(),
    document: cleanText(row.document_number),
    profilePhotoFileId: row.profile_photo_file_id ?? null,
    birthDate: row.birth_date,
    birthPlace: cleanText(row.birth_place) || "Sin registrar",
    phone: row.phone_number,
    email: row.email,
    emergencyContactName: cleanText(row.emergency_contact_name) || "Sin registrar",
    emergencyContactRelationship: cleanText(row.emergency_contact_relationship) || "Sin registrar",
    emergencyContactPhone: cleanText(row.emergency_contact_phone) || "Sin registrar",
    rh: row.rh,
    eps: cleanText(row.eps) || null,
    arl: cleanText(row.arl) || null,
    pensionFund: cleanText(row.pension_fund) || null,
    transport: cleanText(firstRelation<any>(row.transport_type)?.name) || "Sin registrar",
    civilState: cleanText(firstRelation<any>(row.civil_state_type)?.name) || "Sin registrar",
    city: cleanText(row.residence_city) || "Sin registrar",
    available: Boolean(row.disponibility),
    shirtSize: row.shirt_size,
    pantSize: row.pant_size,
    shoeSize: row.shoe_size,
    hireDate: row.hire_date,
    terminationDate: row.termination_date,
    active: contractStatus === "ACTIVO",
    contractStatus,
    contractTypeId: contract?.contract_type ?? null,
    contractTypeName: cleanText(firstRelation<any>(contract?.contract_type_ref)?.name) || "Sin tipo",
    lastClient: cleanText(firstRelation<any>(latestAssignment?.clients)?.name) || "Sin operación",
    lastArea: cleanText(firstRelation<any>(latestAssignment?.area)?.name) || "Sin área",
    lastDate: latestAssignment?.operation_date ?? null,
  };
}

export async function loadClientContractorProfile(contractorId: number): Promise<ClientContractor> {
  const result = await supabase.rpc("get_client_contractor", {
    p_contractor_id: contractorId,
  });
  fail(result.error);
  const row = (result.data ?? [])[0];
  if (!row) throw new Error("No tienes acceso a este contratista.");
  return mapClientContractor(row);
}

export async function loadOperationAssignments(operationId: number): Promise<Assignment[]> {
  const result = await supabase.rpc("get_operation_assignments", {
    p_operation_id: operationId,
  });
  fail(result.error);
  return (result.data ?? []).map((row: any) => ({
    assignmentId: row.assignment_id,
    contractorId: row.contractor_id,
    contractorName: cleanText(row.contractor_name),
    areaName: cleanText(row.area_name),
    attendanceStatus: cleanText(row.attendance_status) || null,
    workedQuantity: Number(row.worked_quantity ?? 0),
    extraHours: Number(row.extra_hours ?? 0),
    dischargedUnits: Number(row.discharged_units ?? 0),
    observations: cleanText(row.observations) || null,
  }));
}

export async function loadContractorHistory(contractorId: number): Promise<ContractorHistory[]> {
  const result = await supabase.rpc("get_contractor_history", {
    p_contractor_id: contractorId,
  });
  fail(result.error);
  return (result.data ?? []).map((row: any) => ({
    assignmentId: row.assignment_id,
    operationDate: row.operation_date,
    clientName: cleanText(row.client_name),
    areaName: cleanText(row.area_name),
    shiftName: cleanText(row.shift_name) || "Sin turno",
    attendanceStatus: cleanText(row.attendance_status) || null,
    extraHours: Number(row.extra_hours ?? 0),
    observations: cleanText(row.observations) || null,
  }));
}

export async function loadClientContractorHistory(contractorId: number): Promise<ContractorHistory[]> {
  const result = await supabase.rpc("get_client_contractor_history", {
    p_contractor_id: contractorId,
  });
  fail(result.error);
  return (result.data ?? []).map((row: any) => ({
    assignmentId: row.assignment_id,
    operationDate: row.operation_date,
    clientName: cleanText(row.client_name),
    areaName: cleanText(row.area_name),
    shiftName: cleanText(row.shift_name) || "Sin turno",
    attendanceStatus: cleanText(row.attendance_status) || null,
    extraHours: Number(row.extra_hours ?? 0),
    observations: null,
  }));
}

export async function loadContractorDocuments(
  contractorId: number,
): Promise<ContractorDocument[]> {
  const result = await supabase.rpc("get_contractor_documents", {
    p_contractor_id: contractorId,
  });
  fail(result.error);
  return (result.data ?? []).map((row: any) => ({
    id: row.document_id,
    typeCode: row.document_type_code,
    typeName: cleanText(row.document_type_name),
    fileId: row.file_id,
    provider: row.provider,
    bucket: row.bucket,
    path: row.path,
    originalName: cleanText(row.original_name) || "documento.pdf",
    mimeType: row.mime_type || "application/pdf",
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createContractorDocumentSignedUrl(
  document: ContractorDocument,
): Promise<string> {
  if (document.provider !== "supabase") {
    throw new Error("El proveedor de este documento no está disponible en la aplicación.");
  }
  const result = await supabase.storage
    .from(document.bucket)
    .createSignedUrl(document.path, 300);
  fail(result.error);
  if (!result.data?.signedUrl) {
    throw new Error("No fue posible generar el acceso temporal al documento.");
  }
  return result.data.signedUrl;
}

export async function createContractorProfilePhotoSignedUrl(
  fileId: string | null,
): Promise<string> {
  if (!fileId) return "";
  const fileResult = await supabase
    .from("app_files")
    .select("provider,bucket,path")
    .eq("id", fileId)
    .single();
  fail(fileResult.error);
  const file = fileResult.data as any;
  if (file.provider !== "supabase") {
    throw new Error("El proveedor de la foto no está disponible.");
  }
  const urlResult = await supabase.storage
    .from(file.bucket)
    .createSignedUrl(file.path, 300);
  fail(urlResult.error);
  if (!urlResult.data?.signedUrl) throw new Error("No fue posible generar la foto de perfil.");
  return urlResult.data.signedUrl;
}

async function uploadAndRegisterContractorPdf(
  contractorId: number,
  typeCode: ContractorUploadDocumentType | string,
  file: ContractorPdfFile,
) {
  validatePdfFile(file);
  const response = await fetch(file.uri);
  const content = await response.arrayBuffer();
  if (content.byteLength > MAX_CONTRACTOR_DOCUMENT_BYTES) {
    throw new Error("El PDF no puede superar 1 MB.");
  }

  const safeName = (file.name || `${typeCode.toLowerCase()}.pdf`)
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const path = `contractor/${contractorId}/${typeCode}/${uniqueToken()}.pdf`;
  const upload = await supabase.storage
    .from(CONTRACTOR_DOCUMENT_BUCKET)
    .upload(path, content, {
      contentType: "application/pdf",
      upsert: false,
    });
  fail(upload.error);

  const registration = await supabase.rpc("register_contractor_document", {
    p_contractor_id: contractorId,
    p_document_type_code: typeCode,
    p_bucket: CONTRACTOR_DOCUMENT_BUCKET,
    p_path: path,
    p_original_name: safeName || `${typeCode.toLowerCase()}.pdf`,
    p_mime_type: "application/pdf",
    p_size_bytes: content.byteLength,
  });
  fail(registration.error);
}

export async function createContractorDraft(input: CreateContractorInput): Promise<number> {
  validatePdfFile(input.cedulaPdf);
  const result = await supabase.rpc("create_contractor_draft", {
    p_document_type_id: input.documentTypeId,
    p_document_number: input.documentNumber.trim(),
    p_name: input.name.trim(),
    p_last_name: input.lastName.trim(),
    p_phone_number: input.phone.trim(),
    p_email: input.email.trim().toLowerCase(),
    p_birth_date: input.birthDate,
  });
  fail(result.error);
  const contractorId = Number(result.data);
  await uploadAndRegisterContractorPdf(contractorId, "CEDULA", input.cedulaPdf);
  return contractorId;
}

export async function uploadContractorActivationDocument(
  contractorId: number,
  typeCode: ContractorActivationDocumentType,
  file: ContractorPdfFile,
) {
  await uploadAndRegisterContractorPdf(contractorId, typeCode, file);
}

export async function selectContractorContractType(
  contractorId: number,
  contractTypeId: number,
): Promise<boolean> {
  const result = await supabase.rpc("select_contractor_contract_type", {
    p_contractor_id: contractorId,
    p_contract_type_id: contractTypeId,
  });
  fail(result.error);
  return Boolean(result.data);
}

export async function uploadContractorDocument(
  contractorId: number,
  typeCode: string,
  file: ContractorPdfFile,
) {
  await uploadAndRegisterContractorPdf(contractorId, typeCode, file);
}

export async function sendContractorOnboardingEmail(contractorId: number): Promise<string> {
  const result = await supabase.functions.invoke("send-contractor-onboarding-email", {
    body: { contractorId },
  });
  fail(result.error);
  if ((result.data as any)?.error) throw new Error((result.data as any).error);
  const email = (result.data as any)?.email;
  return typeof email === "string" ? email : "";
}

export async function loadContractorOnboardingForm(
  token: string,
): Promise<ContractorOnboardingForm> {
  const result = await supabase.functions.invoke("contractor-onboarding", {
    body: { action: "get", token },
  });
  fail(result.error);
  if ((result.data as any)?.error) throw new Error((result.data as any).error);
  return result.data as ContractorOnboardingForm;
}

export async function submitContractorOnboardingForm(
  token: string,
  payload: ContractorOnboardingSubmission,
) {
  const result = await supabase.functions.invoke("contractor-onboarding", {
    body: { action: "submit", token, payload },
  });
  fail(result.error);
  if ((result.data as any)?.error) throw new Error((result.data as any).error);
}

export async function loadContractorOnboardingContract(
  token: string,
): Promise<ContractorOnboardingContract> {
  const result = await supabase.functions.invoke("contractor-onboarding", {
    body: { action: "get-contract", token },
  });
  fail(result.error);
  if ((result.data as any)?.error) throw new Error((result.data as any).error);
  return result.data as ContractorOnboardingContract;
}

export async function signContractorOnboardingContract(
  token: string,
  signatureBase64: string,
  evidence: ContractorContractSignatureEvidence,
) {
  const result = await supabase.functions.invoke("contractor-onboarding", {
    body: { action: "sign-contract", token, signatureBase64, evidence },
  });
  fail(result.error);
  if ((result.data as any)?.error) throw new Error((result.data as any).error);
}

export async function loadContractorWorkwearSummary(contractorId: number): Promise<WorkwearSummary[]> {
  const result = await supabase.rpc("get_contractor_workwear_summary", {
    p_contractor_id: contractorId,
  });
  fail(result.error);
  return (result.data ?? []).map((row: any) => ({
    workwearTypeId: Number(row.workwear_type_id),
    workwearTypeName: cleanText(row.workwear_type_name),
    deliveredQuantity: Number(row.delivered_quantity ?? 0),
    returnedQuantity: Number(row.returned_quantity ?? 0),
    writtenOffQuantity: Number(row.written_off_quantity ?? 0),
    pendingQuantity: Number(row.pending_quantity ?? 0),
  }));
}

export async function loadContractorWorkwearMovements(contractorId: number): Promise<WorkwearMovement[]> {
  const result = await supabase.rpc("get_contractor_workwear_movements", {
    p_contractor_id: contractorId,
  });
  fail(result.error);
  return (result.data ?? []).map((row: any) => ({
    id: Number(row.movement_id),
    workwearTypeId: Number(row.workwear_type_id),
    workwearTypeName: cleanText(row.workwear_type_name),
    movementType: row.movement_type as WorkwearMovementType,
    movementDate: row.movement_date,
    quantity: Number(row.quantity ?? 0),
    observations: cleanText(row.observations),
    relatedDeliveryId: row.related_delivery_id === null ? null : Number(row.related_delivery_id),
    createdBy: row.created_by,
    createdByName: cleanText(row.created_by_name) || "Sin responsable",
    createdAt: row.created_at,
  }));
}

export async function registerContractorWorkwearMovement(input: {
  contractorId: number;
  workwearTypeId: number;
  movementType: WorkwearMovementType;
  movementDate: string;
  quantity: number;
  observations: string;
}) {
  const result = await supabase.rpc("register_contractor_workwear_movement", {
    p_contractor_id: input.contractorId,
    p_workwear_type_id: input.workwearTypeId,
    p_movement_type: input.movementType,
    p_movement_date: input.movementDate,
    p_quantity: input.quantity,
    p_observations: input.observations.trim(),
  });
  fail(result.error);
  return Number(result.data);
}

export async function createOperation(input: {
  date: string;
  clientId: number;
  areaId: number;
  shiftId: number;
  contractorIds: number[];
}) {
  const result = await supabase.rpc("create_operation_with_assignments", {
    p_operation_date: input.date,
    p_client_id: input.clientId,
    p_area_id: input.areaId,
    p_shift_id: input.shiftId,
    p_assignments: input.contractorIds.map((contractorId) => ({
      contractor_id: contractorId,
      planned_quantity: 1,
    })),
  });
  fail(result.error);
  return result.data as number;
}

export async function loadAvailableServiceUnits(areaId: number, date: string): Promise<{ id: number; name: string }[]> {
  if (!areaId) return [];
  const result = await supabase.rpc("get_available_service_units", {
    p_area_id: areaId,
    p_operation_date: date,
  });
  fail(result.error);
  return (result.data ?? []).map((row: any) => ({
    id: Number(row.service_unit_type_id),
    name: cleanText(row.service_unit_type_name),
  }));
}

export async function createDischargeOperation(input: {
  date: string;
  clientId: number;
  areaId: number;
  serviceUnitTypeId: number;
  plannedUnits: number;
  contractorIds: number[];
}) {
  const result = await supabase.rpc("create_discharge_operation_with_assignments", {
    p_operation_date: input.date,
    p_client_id: input.clientId,
    p_area_id: input.areaId,
    p_service_unit_type_id: input.serviceUnitTypeId,
    p_planned_units: input.plannedUnits,
    p_assignments: input.contractorIds.map((contractorId) => ({ contractor_id: contractorId })),
  });
  fail(result.error);
  return Number(result.data);
}

export async function finalizeOperation(
  operationId: number,
  assignments: Assignment[],
  observations: string,
) {
  const result = await supabase.rpc("finalize_operation", {
    p_operation_id: operationId,
    p_assignments: assignments.map((assignment) => ({
      assignment_id: assignment.assignmentId > 0 ? assignment.assignmentId : null,
      contractor_id: assignment.contractorId,
      attendance_status_id: assignment.attendanceStatus === "AUSENTE" ? 2 : 1,
      worked_quantity: assignment.attendanceStatus === "AUSENTE" ? 0 : 1,
      extra_hours: assignment.extraHours,
      observations: assignment.observations ?? "",
    })),
    p_observations: observations || null,
  });
  fail(result.error);
}

export async function finalizeDischargeOperation(
  operationId: number,
  actualUnits: number,
  assignments: Assignment[],
  observations: string,
) {
  const result = await supabase.rpc("finalize_discharge_operation", {
    p_operation_id: operationId,
    p_actual_units: actualUnits,
    p_assignments: assignments.map((assignment) => ({
      assignment_id: assignment.assignmentId > 0 ? assignment.assignmentId : null,
      contractor_id: assignment.contractorId,
      attendance_status_id: assignment.attendanceStatus === "AUSENTE" ? 2 : 1,
      discharged_units: assignment.attendanceStatus === "AUSENTE" ? 0 : assignment.dischargedUnits,
      observations: assignment.observations ?? "",
    })),
    p_observations: observations || null,
  });
  fail(result.error);
}

export async function loadAvailableContractorIds(operationId: number): Promise<number[]> {
  const result = await supabase.rpc("get_available_contractors_for_operation", {
    p_operation_id: operationId,
  });
  fail(result.error);
  return (result.data ?? []).map((row: any) => Number(row.contractor_id));
}

export async function loadAvailableDischargeContractorIds(operationId: number): Promise<number[]> {
  const result = await supabase.rpc("get_available_contractors_for_discharge", {
    p_operation_id: operationId,
  });
  fail(result.error);
  return (result.data ?? []).map((row: any) => Number(row.contractor_id));
}

export async function reviewOperation(
  operationId: number,
  decision: "CERRADO" | "CAMBIOS_SOLICITADOS",
  observations?: string,
) {
  const result = await supabase.rpc("review_operation", {
    p_operation_id: operationId,
    p_decision: decision,
    p_observations: observations ?? null,
  });
  fail(result.error);
}

export async function reviewDischargeOperation(
  operationId: number,
  decision: "CERRADO" | "CAMBIOS_SOLICITADOS",
  observations?: string,
) {
  const result = await supabase.rpc("review_discharge_operation", {
    p_operation_id: operationId,
    p_decision: decision,
    p_observations: observations ?? null,
  });
  fail(result.error);
}

export async function loadStatisticsSummary(input: {
  startDate: string;
  endDate: string;
  clientId: number | null;
  contractorId: number | null;
}): Promise<StatisticsSummary> {
  const args = {
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_client_id: input.clientId || null,
    p_contractor_id: input.contractorId || null,
  };
  const [result, dischargeResult] = await Promise.all([
    supabase.rpc("get_statistics_by_date_range", args),
    supabase.rpc("get_discharge_report_metrics", args),
  ]);
  fail(result.error);
  fail(dischargeResult.error);
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  const discharge = dischargeResult.data ?? {};
  const contractorOptions = new Map<number, StatisticsContractorOption>();
  [...(row?.contractor_options ?? []), ...(discharge?.contractor_options ?? [])].forEach((contractor: any) => {
    contractorOptions.set(Number(contractor.id), {
      id: Number(contractor.id), name: cleanText(contractor.name), document: cleanText(contractor.document),
    });
  });
  return {
    saleTotal: Number(row?.sale_total ?? 0) + Number(discharge?.sale_total ?? 0),
    costTotal: Number(row?.cost_total ?? 0) + Number(discharge?.cost_total ?? 0),
    contractorsWorked: contractorOptions.size,
    activeContractors: Number(row?.active_contractors ?? 0),
    assignedOperations: Number(row?.assigned_operations ?? 0),
    workedShifts: Math.max(0, Number(row?.worked_shifts ?? 0) - Number(discharge?.attendee_count ?? 0)),
    extraHours: Number(row?.extra_hours ?? 0),
    dischargeOperations: Number(discharge?.discharge_operations ?? 0),
    dischargedUnits: Number(discharge?.discharged_units ?? 0),
    contractorOptions: [...contractorOptions.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function mapDirectorSeries(items: any[] = []) {
  return items.map((item) => ({
    label: cleanText(item.label),
    date: item.date,
    saleTotal: Number(item.saleTotal ?? 0),
    contractors: Number(item.contractors ?? 0),
    workedShifts: Number(item.workedShifts ?? 0),
    extraHours: Number(item.extraHours ?? 0),
    closedOperations: Number(item.closedOperations ?? 0),
    dischargeOperations: Number(item.dischargeOperations ?? 0),
    dischargedUnits: Number(item.dischargedUnits ?? 0),
  }));
}

function mapDirectorRanking(items: any[] = []): DirectorReportRankingItem[] {
  return items.map((item) => ({
    id: Number(item.id),
    name: cleanText(item.name),
    document: cleanText(item.document),
    clientName: cleanText(item.clientName),
    saleTotal: Number(item.saleTotal ?? 0),
    costTotal: Number(item.costTotal ?? 0),
    payrollTotal: Number(item.payrollTotal ?? 0),
    contractors: Number(item.contractors ?? 0),
    workedShifts: Number(item.workedShifts ?? 0),
    extraHours: Number(item.extraHours ?? 0),
    absences: Number(item.absences ?? 0),
    dischargeOperations: Number(item.dischargeOperations ?? 0),
    dischargedUnits: Number(item.dischargedUnits ?? 0),
  }));
}

function mergeReportRanking(base: DirectorReportRankingItem[], dischargeItems: any[] = [], dischargeAttendance = new Map<number, number>()) {
  const merged = new Map<number, DirectorReportRankingItem>(base.map((item) => [item.id, { ...item }]));
  dischargeItems.forEach((raw) => {
    const id = Number(raw.id);
    const current = merged.get(id) ?? { id, name: cleanText(raw.name) };
    merged.set(id, {
      ...current,
      document: current.document || cleanText(raw.document),
      clientName: current.clientName || cleanText(raw.clientName),
      saleTotal: Number(current.saleTotal ?? 0) + Number(raw.saleTotal ?? 0),
      costTotal: Number(current.costTotal ?? 0) + Number(raw.costTotal ?? 0),
      payrollTotal: Number(current.payrollTotal ?? 0) + Number(raw.payrollTotal ?? 0),
      workedShifts: Math.max(0, Number(current.workedShifts ?? 0) - Number(dischargeAttendance.get(id) ?? raw.dischargeOperations ?? 0)),
      dischargeOperations: Number(raw.dischargeOperations ?? 0),
      dischargedUnits: Number(raw.dischargedUnits ?? 0),
    });
  });
  return [...merged.values()];
}

export async function loadDirectorReports(input: {
  startDate: string;
  endDate: string;
  clientId: number | null;
  contractorId: number | null;
}): Promise<DirectorReportsSummary> {
  const args = {
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_client_id: input.clientId || null,
    p_contractor_id: input.contractorId || null,
  };
  const [result, dischargeResult, dischargeTrendResult, dischargeClientAttendanceResult] = await Promise.all([
    supabase.rpc("get_director_reports", args),
    supabase.rpc("get_discharge_report_metrics", args),
    supabase.rpc("get_discharge_attendance_trend", args),
    supabase.rpc("get_discharge_client_attendance", args),
  ]);
  fail(result.error);
  fail(dischargeResult.error);
  fail(dischargeTrendResult.error);
  fail(dischargeClientAttendanceResult.error);
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  const discharge = dischargeResult.data ?? {};
  const contractorOptions = new Map<number, StatisticsContractorOption>();
  [...(row?.contractor_options ?? []), ...(discharge?.contractor_options ?? [])].forEach((contractor: any) => {
    contractorOptions.set(Number(contractor.id), { id: Number(contractor.id), name: cleanText(contractor.name), document: cleanText(contractor.document) });
  });
  const dischargeTrend = new Map((discharge?.trend_series ?? []).map((item: any) => [String(item.date), item]));
  const dischargeAttendanceTrend = new Map((dischargeTrendResult.data ?? []).map((item: any) => [String(item.date), Number(item.attendeeCount ?? 0)]));
  const dischargeClientAttendance = new Map<number, number>(
    (dischargeClientAttendanceResult.data ?? []).map((item: any) => [Number(item.id), Number(item.attendeeCount ?? 0)] as [number, number]),
  );
  const trendSeries = mapDirectorSeries(row?.trend_series ?? []).map((item) => {
    const extra: any = dischargeTrend.get(String(item.date));
    return {
      ...item,
      saleTotal: Number(item.saleTotal ?? 0) + Number(extra?.saleTotal ?? 0),
      workedShifts: Math.max(0, Number(item.workedShifts ?? 0) - Number(dischargeAttendanceTrend.get(String(item.date)) ?? 0)),
      dischargeOperations: Number(extra?.dischargeOperations ?? 0),
      dischargedUnits: Number(extra?.dischargedUnits ?? 0),
    };
  });
  const dischargePayrollClients = (discharge?.client_ranking ?? []).filter((item: any) => Number(item.payrollTotal ?? 0) > 0);
  const dischargePayrollContractors = (discharge?.contractor_ranking ?? []).filter((item: any) => Number(item.payrollTotal ?? 0) > 0);
  const payrollByClient = mergeReportRanking(mapDirectorRanking(row?.payroll_by_client ?? []), dischargePayrollClients, dischargeClientAttendance);
  const payrollByContractor = mergeReportRanking(mapDirectorRanking(row?.payroll_by_contractor ?? []), dischargePayrollContractors);
  return {
    saleTotal: Number(row?.sale_total ?? 0) + Number(discharge?.sale_total ?? 0),
    costTotal: Number(row?.cost_total ?? 0) + Number(discharge?.cost_total ?? 0),
    payrollTotal: Number(row?.payroll_total ?? 0) + Number(discharge?.payroll_total ?? 0),
    contractorsWorked: contractorOptions.size,
    payrollContractors: payrollByContractor.length,
    operationsClosed: Number(row?.operations_closed ?? 0),
    operationsPending: Number(row?.operations_pending ?? 0),
    assignedOperations: Number(row?.assigned_operations ?? 0),
    workedShifts: Math.max(0, Number(row?.worked_shifts ?? 0) - Number(discharge?.attendee_count ?? 0)),
    plannedShifts: Math.max(0, Number(row?.planned_shifts ?? 0) - Number(discharge?.assignment_count ?? 0)),
    extraHours: Number(row?.extra_hours ?? 0),
    dischargeOperations: Number(discharge?.discharge_operations ?? 0),
    dischargedUnits: Number(discharge?.discharged_units ?? 0),
    absences: Number(row?.absences ?? 0),
    clientsCount: Number(row?.clients_count ?? 0),
    coveragePercent: Number(row?.coverage_percent ?? 0),
    trendGranularity: row?.trend_granularity ?? "DAY",
    trendSeries,
    clientRanking: mergeReportRanking(mapDirectorRanking(row?.client_ranking ?? []), discharge?.client_ranking ?? [], dischargeClientAttendance),
    contractorRanking: mergeReportRanking(mapDirectorRanking(row?.contractor_ranking ?? []), discharge?.contractor_ranking ?? []),
    payrollByClient,
    payrollByContractor,
    contractorOptions: [...contractorOptions.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function createPersonnelRequest(input: {
  clientId: number;
  areaId: number;
  quantity: number;
  description: string;
  requiredDate: string;
  userId: string;
}) {
  const result = await supabase.from("personnel_request").insert({
    client_id: input.clientId,
    area_id: input.areaId,
    required_quantity: input.quantity,
    description: input.description,
    required_date: input.requiredDate,
    status: "ABIERTA",
    created_by: input.userId,
  });
  fail(result.error);
}

export async function cancelPersonnelRequest(requestId: number) {
  const result = await supabase
    .from("personnel_request")
    .update({ status: "CANCELADA" })
    .eq("id", requestId)
    .eq("status", "ABIERTA");
  fail(result.error);
}

export async function terminateContractor(input: {
  contractorId: number;
  terminationDate: string;
  reasonId: number;
  observations: string;
}) {
  const result = await supabase.rpc("terminate_contractor", {
    p_contractor_id: input.contractorId,
    p_termination_date: input.terminationDate,
    p_reason_id: input.reasonId,
    p_observations: input.observations.trim(),
  });
  fail(result.error);
}

export async function setUserActive(userId: string, active: boolean) {
  const result = await supabase
    .from("user_profiles")
    .update({ is_active: active })
    .eq("id", userId);
  fail(result.error);
}

export async function setUserRole(userId: string, roleName: string) {
  const roleIds: Record<string, number> = {
    Administrador: 1,
    Coordinador: 2,
    Cliente: 3,
    "Director/Gerente": 4,
  };
  const roleId = roleIds[roleName];
  if (!roleId) throw new Error("Perfil no válido.");

  const insertResult = await supabase
    .from("user_roles")
    .upsert({ user_id: userId, role_id: roleId }, { onConflict: "user_id,role_id" });
  fail(insertResult.error);

  const deleteResult = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .neq("role_id", roleId);
  fail(deleteResult.error);
}

export async function toggleUserClient(
  userId: string,
  clientId: number,
  assigned: boolean,
) {
  const result = assigned
    ? await supabase
        .from("user_clients")
        .upsert({ user_id: userId, client_id: clientId }, { onConflict: "user_id,client_id" })
    : await supabase
        .from("user_clients")
        .delete()
        .eq("user_id", userId)
        .eq("client_id", clientId);
  fail(result.error);
}

export async function createAdminUser(input: {
  name: string;
  lastName: string;
  email: string;
  phone: string;
  roleCode: RoleCode;
  clientIds: number[];
}) {
  const sessionResult = await supabase.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;
  if (!accessToken) {
    throw new Error("No hay una sesión activa de Administrador. Cierra sesión e ingresa nuevamente.");
  }
  const configuredWebUrl = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, "");
  const redirectTo = configuredWebUrl ? `${configuredWebUrl}/reset-password` : undefined;
  const result = await supabase.functions.invoke("admin-create-user", {
    body: { ...input, accessToken, redirectTo },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (result.error) {
    const context = (result.error as any).context;
    if (context?.json) {
      const body = await context.json().catch(() => null);
      if (body?.error) throw new Error(body.error);
    }
    throw result.error;
  }
  if ((result.data as any)?.error) throw new Error((result.data as any).error);
  return result.data as { userId: string; email: string };
}

export async function updateAdminUserProfile(input: {
  userId: string;
  name: string;
  lastName: string;
  email: string;
  phone: string;
}) {
  const result = await supabase
    .from("user_profiles")
    .update({
      name: input.name.trim(),
      last_name: input.lastName.trim(),
      email: input.email.trim().toLowerCase(),
      phone_number: input.phone.trim() || null,
    })
    .eq("id", input.userId);
  fail(result.error);
}

export async function loadAdminData(): Promise<AdminData> {
  const [
    clientsResult,
    areasResult,
    shiftsResult,
    serviceRatesResult,
    extraRatesResult,
    serviceUnitTypesResult,
    serviceUnitRatesResult,
    costConceptsResult,
    costRulesResult,
    workwearResult,
    workwearMovementsResult,
    contractsResult,
  ] = await Promise.all([
    supabase.from("clients").select("id,name,document_number,is_active").order("name"),
    supabase.from("area").select("id,name,client_id,is_active,clients(name)").order("name"),
    supabase.from("shift").select("id,name,area_id,is_active,area(name,client_id,clients(name))").order("name"),
    supabase
      .from("service_rates")
      .select("id,shift_id,sale_price,cost_price,valid_from,valid_to,shift(name,area_id,area(name,client_id,clients(name)))")
      .order("valid_from", { ascending: false }),
    supabase
      .from("area_extra_hour_rates")
      .select("id,area_id,sale_price,valid_from,valid_to,area(name,client_id,clients(name))")
      .order("valid_from", { ascending: false }),
    supabase.from("service_unit_type").select("id,code,name,description,is_active").order("name"),
    supabase
      .from("service_unit_rates")
      .select("id,area_id,service_unit_type_id,sale_price,cost_price,valid_from,valid_to,area(name,client_id,clients(name)),service_unit_type(name)")
      .order("valid_from", { ascending: false }),
    supabase.from("cost_concepts").select("id,code,name,description,category,status").order("category").order("code"),
    supabase
      .from("contract_type_cost_rules")
      .select("id,contract_type_id,cost_concept_id,calculation_type,value,valid_from,valid_to,status,contract_type(name),cost_concepts(name)")
      .order("valid_from", { ascending: false }),
    supabase.from("workwear_type").select("id,name,description,is_active").order("name"),
    supabase
      .from("contractor_workwear_movements")
      .select("id,contractor_id,workwear_type_id,movement_type,movement_date,quantity,observations,contractor(name,last_name),workwear_type(name)")
      .order("movement_date", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("contractor_contract")
      .select("id,contractor_id,contract_type,status_id,start_date,end_date,observations,contractor(name,last_name),contract_status(name),contract_type_ref:contract_type(name)")
      .order("start_date", { ascending: false }),
  ]);

  [
    clientsResult,
    areasResult,
    shiftsResult,
    serviceRatesResult,
    extraRatesResult,
    serviceUnitTypesResult,
    serviceUnitRatesResult,
    costConceptsResult,
    costRulesResult,
    workwearResult,
    workwearMovementsResult,
    contractsResult,
  ].forEach((result) => fail(result.error));

  return {
    clients: (clientsResult.data ?? []).map((row: any) => ({
      id: row.id,
      name: cleanText(row.name),
      documentNumber: row.document_number,
      isActive: Boolean(row.is_active),
    })),
    areas: (areasResult.data ?? []).map((row: any) => ({
      id: row.id,
      name: cleanText(row.name),
      clientId: row.client_id,
      clientName: cleanText(firstRelation<any>(row.clients)?.name),
      isActive: Boolean(row.is_active),
    })),
    shifts: (shiftsResult.data ?? []).map((row: any) => {
      const area = firstRelation<any>(row.area);
      return {
        id: row.id,
        name: cleanText(row.name),
        clientId: area?.client_id,
        areaId: row.area_id,
        areaName: cleanText(area?.name),
        clientName: cleanText(firstRelation<any>(area?.clients)?.name),
        isActive: Boolean(row.is_active),
      };
    }),
    serviceRates: (serviceRatesResult.data ?? []).map((row: any) => {
      const shift = firstRelation<any>(row.shift);
      const area = firstRelation<any>(shift?.area);
      return {
        id: row.id,
        clientId: area?.client_id,
        areaId: shift?.area_id,
        shiftId: row.shift_id,
        shiftName: cleanText(shift?.name),
        areaName: cleanText(area?.name),
        clientName: cleanText(firstRelation<any>(area?.clients)?.name),
        salePrice: Number(row.sale_price ?? 0),
        costPrice: Number(row.cost_price ?? 0),
        validFrom: row.valid_from,
        validTo: row.valid_to,
      };
    }),
    extraHourRates: (extraRatesResult.data ?? []).map((row: any) => {
      const area = firstRelation<any>(row.area);
      return {
        id: row.id,
        clientId: area?.client_id,
        areaId: row.area_id,
        areaName: cleanText(area?.name),
        clientName: cleanText(firstRelation<any>(area?.clients)?.name),
        salePrice: Number(row.sale_price ?? 0),
        validFrom: row.valid_from,
        validTo: row.valid_to,
      };
    }),
    serviceUnitTypes: (serviceUnitTypesResult.data ?? []).map((row: any) => ({
      id: row.id,
      code: row.code,
      name: cleanText(row.name),
      description: cleanText(row.description) || null,
      isActive: row.is_active !== false,
    })),
    serviceUnitRates: (serviceUnitRatesResult.data ?? []).map((row: any) => {
      const area = firstRelation<any>(row.area);
      return {
        id: row.id,
        clientId: area?.client_id,
        areaId: row.area_id,
        serviceUnitTypeId: row.service_unit_type_id,
        serviceUnitTypeName: cleanText(firstRelation<any>(row.service_unit_type)?.name),
        areaName: cleanText(area?.name),
        clientName: cleanText(firstRelation<any>(area?.clients)?.name),
        salePrice: Number(row.sale_price ?? 0),
        costPrice: Number(row.cost_price ?? 0),
        validFrom: row.valid_from,
        validTo: row.valid_to,
      };
    }),
    costConcepts: (costConceptsResult.data ?? []).map((row: any) => ({
      id: row.id,
      code: row.code,
      name: cleanText(row.name),
      description: cleanText(row.description) || null,
      category: row.category,
      status: row.status ?? "ACTIVO",
    })),
    costRules: (costRulesResult.data ?? []).map((row: any) => ({
      id: row.id,
      contractTypeId: row.contract_type_id,
      contractTypeName: cleanText(firstRelation<any>(row.contract_type)?.name),
      costConceptId: row.cost_concept_id,
      costConceptName: cleanText(firstRelation<any>(row.cost_concepts)?.name),
      calculationType: row.calculation_type,
      value: Number(row.value ?? 0),
      validFrom: row.valid_from,
      validTo: row.valid_to,
      status: row.status ?? "ACTIVO",
    })),
    workwearTypes: (workwearResult.data ?? []).map((row: any) => ({
      id: row.id,
      name: cleanText(row.name),
      description: cleanText(row.description) || null,
      isActive: row.is_active !== false,
    })),
    workwearMovements: (workwearMovementsResult.data ?? []).map((row: any) => {
      const contractor = firstRelation<any>(row.contractor);
      return {
        id: row.id,
        contractorId: row.contractor_id,
        contractorName: `${cleanText(contractor?.name)} ${cleanText(contractor?.last_name)}`.trim() || "Sin contratista",
        workwearTypeId: row.workwear_type_id,
        workwearTypeName: cleanText(firstRelation<any>(row.workwear_type)?.name),
        movementType: row.movement_type,
        movementDate: row.movement_date,
        quantity: Number(row.quantity ?? 0),
        observations: cleanText(row.observations) || null,
      };
    }),
    contracts: (contractsResult.data ?? []).map((row: any) => {
      const contractor = firstRelation<any>(row.contractor);
      return {
        id: row.id,
        contractorId: row.contractor_id,
        contractorName: `${cleanText(contractor?.name)} ${cleanText(contractor?.last_name)}`.trim(),
        contractTypeId: row.contract_type ?? null,
        contractTypeName: cleanText(firstRelation<any>(row.contract_type_ref)?.name) || "Sin tipo",
        statusId: row.status_id ?? null,
        statusName: normalizeContractStatus(firstRelation<any>(row.contract_status)?.name),
        startDate: row.start_date,
        endDate: row.end_date,
        observations: cleanText(row.observations) || null,
      };
    }),
  };
}

export async function saveAdminClient(input: {
  id?: number;
  name: string;
  documentNumber: string;
  isActive: boolean;
}) {
  const payload = {
    name: input.name.trim(),
    document_number: input.documentNumber.trim() || null,
    is_active: input.isActive,
  };
  const result = input.id
    ? await supabase.from("clients").update(payload).eq("id", input.id)
    : await supabase.from("clients").insert(payload);
  fail(result.error);
}

export async function saveAdminArea(input: {
  id?: number;
  clientId: number;
  name: string;
  isActive: boolean;
}) {
  const payload = {
    client_id: input.clientId,
    name: input.name.trim(),
    is_active: input.isActive,
  };
  const result = input.id
    ? await supabase.from("area").update(payload).eq("id", input.id)
    : await supabase.from("area").insert(payload);
  fail(result.error);
}

export async function saveAdminShift(input: {
  id?: number;
  areaId: number;
  name: string;
  isActive: boolean;
}) {
  const payload = {
    area_id: input.areaId,
    name: input.name.trim(),
    is_active: input.isActive,
  };
  const result = input.id
    ? await supabase.from("shift").update(payload).eq("id", input.id)
    : await supabase.from("shift").insert(payload);
  fail(result.error);
}

export async function saveAdminServiceRate(input: {
  id?: number;
  shiftId: number;
  salePrice: number;
  costPrice: number;
  validFrom: string;
  validTo: string | null;
}) {
  const payload = {
    shift_id: input.shiftId,
    sale_price: input.salePrice,
    cost_price: input.costPrice,
    valid_from: input.validFrom,
    valid_to: input.validTo || null,
  };
  const result = input.id
    ? await supabase.from("service_rates").update(payload).eq("id", input.id)
    : await supabase.from("service_rates").insert(payload);
  fail(result.error);
}

export async function saveAdminExtraHourRate(input: {
  id?: number;
  areaId: number;
  salePrice: number;
  validFrom: string;
  validTo: string | null;
}) {
  const payload = {
    area_id: input.areaId,
    sale_price: input.salePrice,
    valid_from: input.validFrom,
    valid_to: input.validTo || null,
  };
  const result = input.id
    ? await supabase.from("area_extra_hour_rates").update(payload).eq("id", input.id)
    : await supabase.from("area_extra_hour_rates").insert(payload);
  fail(result.error);
}

export async function saveAdminServiceUnitType(input: {
  id?: number;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
}) {
  const payload = {
    code: input.code.trim().toUpperCase().replace(/\s+/g, "_"),
    name: input.name.trim(),
    description: input.description.trim() || null,
    is_active: input.isActive,
  };
  const result = input.id
    ? await supabase.from("service_unit_type").update(payload).eq("id", input.id)
    : await supabase.from("service_unit_type").insert(payload);
  fail(result.error);
}

export async function saveAdminServiceUnitRate(input: {
  id?: number;
  areaId: number;
  serviceUnitTypeId: number;
  salePrice: number;
  costPrice: number;
  validFrom: string;
  validTo: string | null;
}) {
  const payload = {
    area_id: input.areaId,
    service_unit_type_id: input.serviceUnitTypeId,
    sale_price: input.salePrice,
    cost_price: input.costPrice,
    valid_from: input.validFrom,
    valid_to: input.validTo || null,
  };
  const result = input.id
    ? await supabase.from("service_unit_rates").update(payload).eq("id", input.id)
    : await supabase.from("service_unit_rates").insert(payload);
  fail(result.error);
}

export async function saveAdminCostConcept(input: {
  id?: number;
  code: string;
  name: string;
  description: string;
  category: string;
  status: "ACTIVO" | "INACTIVO";
}) {
  const payload = {
    code: input.code.trim().toUpperCase().replace(/\s+/g, "_"),
    name: input.name.trim(),
    description: input.description.trim() || null,
    category: input.category.trim().toUpperCase().replace(/\s+/g, "_"),
    status: input.status,
  };
  const result = input.id
    ? await supabase.from("cost_concepts").update(payload).eq("id", input.id)
    : await supabase.from("cost_concepts").insert(payload);
  fail(result.error);
}

export async function saveAdminCostRule(input: {
  id?: number;
  contractTypeId: number;
  costConceptId: number;
  calculationType: string;
  value: number;
  validFrom: string;
  validTo: string | null;
  status: "ACTIVO" | "INACTIVO";
}) {
  const payload = {
    contract_type_id: input.contractTypeId,
    cost_concept_id: input.costConceptId,
    calculation_type: input.calculationType,
    value: input.value,
    valid_from: input.validFrom,
    valid_to: input.validTo || null,
    status: input.status,
  };
  const result = input.id
    ? await supabase.from("contract_type_cost_rules").update(payload).eq("id", input.id)
    : await supabase.from("contract_type_cost_rules").insert(payload);
  fail(result.error);
}

export async function saveAdminWorkwearType(input: {
  id?: number;
  name: string;
  description: string;
  isActive: boolean;
}) {
  const payload = {
    name: input.name.trim(),
    description: input.description.trim() || null,
    is_active: input.isActive,
  };
  const result = input.id
    ? await supabase.from("workwear_type").update(payload).eq("id", input.id)
    : await supabase.from("workwear_type").insert(payload);
  fail(result.error);
}

export async function updateAdminContractor(input: {
  id: number;
  name: string;
  lastName: string;
  birthDate: string;
  phone: string;
  email: string;
  rh: string;
  eps: string;
  arl: string;
  shirtSize: string;
  pantSize: string;
  shoeSize: string;
  available: boolean;
}) {
  const result = await supabase
    .from("contractor")
    .update({
      name: input.name.trim(),
      last_name: input.lastName.trim(),
      birth_date: input.birthDate,
      phone_number: input.phone.trim() || null,
      email: input.email.trim().toLowerCase() || null,
      rh: input.rh.trim() || null,
      eps: input.eps.trim() || null,
      arl: input.arl.trim() || null,
      shirt_size: input.shirtSize.trim() || null,
      pant_size: input.pantSize.trim() || null,
      shoe_size: input.shoeSize.trim() || null,
      disponibility: input.available,
    })
    .eq("id", input.id);
  fail(result.error);
}

export async function saveAdminContract(input: {
  id?: number;
  contractorId: number;
  contractTypeId: number;
  statusId: number;
  startDate: string;
  endDate: string | null;
  observations: string;
}) {
  const payload = {
    contractor_id: input.contractorId,
    contract_type: input.contractTypeId,
    status_id: input.statusId,
    start_date: input.startDate,
    end_date: input.endDate || null,
    observations: input.observations.trim() || null,
  };
  const result = input.id
    ? await supabase.from("contractor_contract").update(payload).eq("id", input.id)
    : await supabase.from("contractor_contract").insert(payload);
  fail(result.error);
}
