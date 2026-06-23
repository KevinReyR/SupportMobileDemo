export type RoleCode = "ADMIN" | "DIRECTOR" | "COORDINATOR" | "CLIENT";
export type Role = "Administrador" | "Director" | "Coordinador" | "Cliente";
export type OperationStatus =
  | "EN_CURSO"
  | "PENDIENTE"
  | "CAMBIOS_SOLICITADOS"
  | "CERRADO";
export type RequestStatus = "ABIERTA" | "ASIGNADA" | "ATENDIDA" | "CANCELADA";

export interface NamedRecord {
  id: number;
  name: string;
}

export type ContractStatus = "ACTIVO" | "PENDIENTE" | "INACTIVO";

export interface UserContext {
  id: string;
  name: string;
  lastName: string;
  email: string;
  active: boolean;
  roleCode: RoleCode;
  role: Role;
  clients: NamedRecord[];
}

export interface Operation {
  id: number;
  date: string;
  clientId: number;
  client: string;
  areaId: number;
  area: string;
  shiftId: number;
  shift: string;
  people: number;
  worked: number;
  extraHours: number;
  status: OperationStatus;
  observations: string | null;
  reviewObservations: string | null;
}

export interface Assignment {
  assignmentId: number;
  contractorId: number;
  contractorName: string;
  areaName: string;
  attendanceStatus: string | null;
  workedQuantity: number;
  extraHours: number;
  observations: string | null;
}

export interface PersonnelRequest {
  id: number;
  clientId: number;
  client: string;
  areaId: number;
  area: string;
  quantity: number;
  description: string;
  requiredDate: string;
  status: RequestStatus;
}

export interface Contractor {
  id: number;
  name: string;
  lastName: string;
  fullName: string;
  initials: string;
  document: string;
  birthDate: string;
  phone: string | null;
  email: string | null;
  rh: string | null;
  eps: string | null;
  arl: string | null;
  transport: string;
  civilState: string;
  city: string;
  available: boolean;
  shirtSize: string | null;
  pantSize: string | null;
  shoeSize: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  active: boolean;
  contractStatus: ContractStatus;
  lastClient: string;
  lastArea: string;
  lastDate: string | null;
}

export interface ContractorHistory {
  assignmentId: number;
  operationDate: string;
  clientName: string;
  areaName: string;
  shiftName: string;
  attendanceStatus: string | null;
  extraHours: number;
  observations: string | null;
}

export interface ContractorDocument {
  id: string;
  typeCode: string;
  typeName: string;
  fileId: string;
  provider: string;
  bucket: string;
  path: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientContractor {
  id: number;
  name: string;
  lastName: string;
  fullName: string;
  initials: string;
  document: string;
  birthDate: string;
  rh: string | null;
  eps: string | null;
  arl: string | null;
  civilState: string;
  lastArea: string;
  lastDate: string | null;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: string;
  clients: string[];
  clientIds: number[];
}

export interface AppData {
  clients: NamedRecord[];
  documentTypes: NamedRecord[];
  operations: Operation[];
  requests: PersonnelRequest[];
  contractors: Contractor[];
  clientContractors: ClientContractor[];
  areas: (NamedRecord & { clientId: number })[];
  shifts: (NamedRecord & { areaId: number })[];
  services: { id: number; areaId: number }[];
  attendanceStatuses: NamedRecord[];
  users: AdminUser[];
}
