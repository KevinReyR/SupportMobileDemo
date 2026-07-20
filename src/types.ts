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
export type WorkwearMovementType = "ENTREGA" | "DEVOLUCION" | "BAJA";

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
  profilePhotoFileId: string | null;
  birthDate: string;
  birthPlace: string;
  phone: string | null;
  email: string | null;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  rh: string | null;
  eps: string | null;
  arl: string | null;
  pensionFund: string | null;
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
  contractTypeId: number | null;
  contractTypeName: string;
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

export interface WorkwearSummary {
  workwearTypeId: number;
  workwearTypeName: string;
  deliveredQuantity: number;
  returnedQuantity: number;
  writtenOffQuantity: number;
  pendingQuantity: number;
}

export interface WorkwearMovement {
  id: number;
  workwearTypeId: number;
  workwearTypeName: string;
  movementType: WorkwearMovementType;
  movementDate: string;
  quantity: number;
  observations: string;
  relatedDeliveryId: number | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface ClientContractor {
  id: number;
  name: string;
  lastName: string;
  fullName: string;
  initials: string;
  document: string;
  profilePhotoFileId: string | null;
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
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string | null;
  active: boolean;
  role: string;
  clients: string[];
  clientIds: number[];
}

export interface AdminClient extends NamedRecord {
  documentNumber: string | null;
  isActive: boolean;
}

export interface AdminArea extends NamedRecord {
  clientId: number;
  clientName: string;
  isActive: boolean;
}

export interface AdminShift extends NamedRecord {
  clientId: number;
  areaId: number;
  areaName: string;
  clientName: string;
  isActive: boolean;
}

export interface AdminServiceRate {
  id: number;
  clientId: number;
  areaId: number;
  shiftId: number;
  shiftName: string;
  areaName: string;
  clientName: string;
  salePrice: number;
  costPrice: number;
  validFrom: string;
  validTo: string | null;
}

export interface AdminExtraHourRate {
  id: number;
  clientId: number;
  areaId: number;
  areaName: string;
  clientName: string;
  salePrice: number;
  validFrom: string;
  validTo: string | null;
}

export interface AdminCostConcept {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string;
  status: "ACTIVO" | "INACTIVO";
}

export interface AdminCostRule {
  id: number;
  contractTypeId: number;
  contractTypeName: string;
  costConceptId: number;
  costConceptName: string;
  calculationType: "FIXED_AMOUNT" | "PERCENTAGE_OF_SALE" | "PERCENTAGE_OF_BASE_COST";
  value: number;
  validFrom: string;
  validTo: string | null;
  status: "ACTIVO" | "INACTIVO";
}

export interface AdminWorkwearType extends NamedRecord {
  description: string | null;
  isActive: boolean;
}

export interface AdminWorkwearMovement {
  id: number;
  contractorId: number;
  contractorName: string;
  workwearTypeId: number;
  workwearTypeName: string;
  movementType: WorkwearMovementType;
  movementDate: string;
  quantity: number;
  observations: string | null;
}

export interface AdminContractRecord {
  id: number;
  contractorId: number;
  contractorName: string;
  contractTypeId: number | null;
  contractTypeName: string;
  statusId: number | null;
  statusName: ContractStatus;
  startDate: string;
  endDate: string | null;
  observations: string | null;
}

export interface AdminData {
  clients: AdminClient[];
  areas: AdminArea[];
  shifts: AdminShift[];
  serviceRates: AdminServiceRate[];
  extraHourRates: AdminExtraHourRate[];
  costConcepts: AdminCostConcept[];
  costRules: AdminCostRule[];
  workwearTypes: AdminWorkwearType[];
  workwearMovements: AdminWorkwearMovement[];
  contracts: AdminContractRecord[];
}

export interface StatisticsContractorOption extends NamedRecord {
  document: string;
}

export interface StatisticsSummary {
  saleTotal: number;
  costTotal: number;
  contractorsWorked: number;
  activeContractors: number;
  assignedOperations: number;
  workedShifts: number;
  extraHours: number;
  contractorOptions: StatisticsContractorOption[];
}

export interface DirectorReportSeries {
  label: string;
  date?: string;
  saleTotal?: number;
  contractors?: number;
  workedShifts?: number;
  extraHours?: number;
  closedOperations?: number;
}

export type ReportTrendGranularity = "DAY" | "WEEK" | "MONTH";

export interface DirectorReportRankingItem extends NamedRecord {
  document?: string;
  clientName?: string;
  saleTotal?: number;
  costTotal?: number;
  payrollTotal?: number;
  contractors?: number;
  workedShifts?: number;
  extraHours?: number;
  absences?: number;
}

export interface DirectorReportsSummary {
  saleTotal: number;
  costTotal: number;
  payrollTotal: number;
  contractorsWorked: number;
  payrollContractors: number;
  operationsClosed: number;
  operationsPending: number;
  assignedOperations: number;
  workedShifts: number;
  plannedShifts: number;
  extraHours: number;
  absences: number;
  clientsCount: number;
  coveragePercent: number;
  trendGranularity: ReportTrendGranularity;
  trendSeries: DirectorReportSeries[];
  clientRanking: DirectorReportRankingItem[];
  contractorRanking: DirectorReportRankingItem[];
  payrollByClient: DirectorReportRankingItem[];
  payrollByContractor: DirectorReportRankingItem[];
  contractorOptions: StatisticsContractorOption[];
}

export interface OnboardingOption {
  id: number;
  name: string;
}

export interface ContractorOnboardingForm {
  status: "PENDING" | "DATA_SUBMITTED";
  contractor: {
    id: number;
    name: string;
    document: string;
    email: string;
  };
  catalogs: {
    civilStates: OnboardingOption[];
    transportTypes: OnboardingOption[];
    educationLevels: OnboardingOption[];
    bloodTypes: string[];
    stratum: string[];
    shirtSizes: string[];
    pantSizes: string[];
    shoeSizes: string[];
  };
  policy: {
    fileId: string | null;
    url: string;
    acceptanceText: string;
  };
}

export interface ContractorOnboardingContract {
  contractUrl: string;
  acceptanceText: string;
}

export interface ContractorOnboardingSubmission {
  bloodType: string;
  birthDate: string;
  birthPlace: string;
  civilStateId: number;
  residenceDepartment: string;
  residenceCity: string;
  address: string;
  stratum: string;
  phone: string;
  transportTypeId: number;
  educationLevelId: number;
  eps: string;
  shirtSize: string;
  pantSize: string;
  shoeSize: string;
  pensionFund: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  selfieBase64: string;
  acceptsDataPolicy: boolean;
}

export interface ContractorContractSignatureEvidence {
  browser: string;
  operatingSystem: string;
  userAgent: string;
  deviceFingerprint: string;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
  };
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
  attendanceStatuses: NamedRecord[];
  workwearTypes: NamedRecord[];
  terminationReasons: NamedRecord[];
  contractorDocumentTypes: NamedRecord[];
  contractTypes: NamedRecord[];
  users: AdminUser[];
}
