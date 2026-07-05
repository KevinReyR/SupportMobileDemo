import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Linking from "expo-linking";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";

import PdfViewer from "./components/pdf-viewer";
import { buildCedulaPdfFromPhotos } from "./lib/cedula-pdf";
import { supabase } from "./lib/supabase";
import {
  cancelPersonnelRequest,
  createContractorDraft,
  createContractorDocumentSignedUrl,
  createOperation,
  createPersonnelRequest,
  finalizeOperation,
  loadAppData,
  loadClientContractorHistory,
  loadContractorDocuments,
  loadContractorHistory,
  loadContractorWorkwearMovements,
  loadContractorWorkwearSummary,
  loadAvailableContractorIds,
  loadOperationAssignments,
  loadStatisticsSummary,
  loadUserContext,
  loadContractorOnboardingForm,
  registerContractorWorkwearMovement,
  reviewOperation,
  sendContractorOnboardingEmail,
  selectContractorContractType,
  setUserActive,
  setUserRole,
  submitContractorOnboardingForm,
  terminateContractor,
  toggleUserClient,
  uploadContractorActivationDocument,
  uploadContractorDocument,
} from "./services/data";
import type { ContractorActivationDocumentType, ContractorDocumentTypeOption, ContractorPdfFile } from "./services/data";
import type {
  AppData,
  Assignment,
  ClientContractor,
  Contractor,
  ContractorDocument,
  ContractorHistory,
  ContractorOnboardingForm,
  ContractorOnboardingSubmission,
  Operation,
  OperationStatus,
  PersonnelRequest,
  Role,
  StatisticsSummary,
  UserContext,
  WorkwearMovement,
  WorkwearMovementType,
  WorkwearSummary,
} from "./types";

type Screen =
  | "operations"
  | "operation-detail"
  | "initial"
  | "final"
  | "requests"
  | "new-request"
  | "staff"
  | "create-contractor"
  | "contractor"
  | "document-preview"
  | "history-detail"
  | "statistics"
  | "users";
type IconName = React.ComponentProps<typeof Ionicons>["name"];

const C = {
  navy: "#15285A",
  navy2: "#203A78",
  orange: "#F0441E",
  ink: "#17213A",
  muted: "#677187",
  bg: "#F4F6FA",
  line: "#E4E8F0",
  white: "#FFFFFF",
  green: "#148A5B",
  greenBg: "#E8F7F0",
  yellow: "#9A6B00",
  yellowBg: "#FFF5D6",
  orangeBg: "#FFF0E8",
  red: "#C93636",
  redBg: "#FDECEC",
  blueBg: "#EAF0FF",
};

const MAX_CEDULA_PDF_BYTES = 1_048_576;

type CedulaSide = "front" | "back";

async function imageUriToBase64(uri: string) {
  const manipulated = await manipulateAsync(uri, [{ resize: { width: 900 } }], {
    compress: 0.72,
    format: SaveFormat.JPEG,
  });
  if (Platform.OS !== "web") {
    return FileSystem.readAsStringAsync(manipulated.uri, { encoding: FileSystem.EncodingType.Base64 });
  }
  const response = await fetch(manipulated.uri);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No fue posible leer la selfie."));
    reader.onloadend = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",").pop() ?? "" : value);
    };
    reader.readAsDataURL(blob);
  });
}

const EMPTY_DATA: AppData = {
  clients: [],
  documentTypes: [],
  operations: [],
  requests: [],
  contractors: [],
  clientContractors: [],
  areas: [],
  shifts: [],
  services: [],
  attendanceStatuses: [],
  workwearTypes: [],
  terminationReasons: [],
  contractorDocumentTypes: [],
  contractTypes: [],
  users: [],
};

const tabsByRole: Record<Role, { label: string; icon: IconName; screen: Screen }[]> = {
  Coordinador: [
    { label: "Operación", icon: "briefcase-outline", screen: "operations" },
    { label: "Solicitudes", icon: "document-text-outline", screen: "requests" },
    { label: "Personal", icon: "people-outline", screen: "staff" },
    { label: "Estadísticas", icon: "bar-chart-outline", screen: "statistics" },
  ],
  Cliente: [
    { label: "Operación", icon: "briefcase-outline", screen: "operations" },
    { label: "Solicitudes", icon: "document-text-outline", screen: "requests" },
    { label: "Personal", icon: "people-outline", screen: "staff" },
    { label: "Estadísticas", icon: "bar-chart-outline", screen: "statistics" },
  ],
  Director: [
    { label: "Operación", icon: "briefcase-outline", screen: "operations" },
    { label: "Personal", icon: "people-outline", screen: "staff" },
    { label: "Estadísticas", icon: "bar-chart-outline", screen: "statistics" },
  ],
  Administrador: [
    { label: "Usuarios", icon: "people-outline", screen: "users" },
  ],
};

const detailScreens: Screen[] = [
  "operation-detail",
  "initial",
  "final",
  "new-request",
  "contractor",
  "create-contractor",
  "document-preview",
  "history-detail",
];

function formatDate(value: string | null | undefined) {
  if (!value) return "Sin registro";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dateToIso(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoToDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function addDaysIso(value: string, days: number) {
  return dateToIso(addDays(isoToDate(value), days));
}

function monthStartIso(value: string) {
  const date = isoToDate(value);
  return dateToIso(new Date(date.getFullYear(), date.getMonth(), 1));
}

function formatMonth(value: string) {
  const label = new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
  }).format(isoToDate(value));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Ocurrió un error inesperado.";
  const postgresMessage = message.match(/P0001:\s*([^\n]+)/);
  if (postgresMessage?.[1]) return postgresMessage[1].trim();
  return message
    .replace(/^Failed to run sql query:\s*/i, "")
    .replace(/^ERROR:\s*/i, "")
    .trim();
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]);
}

function onboardingTokenFromUrl() {
  if (Platform.OS !== "web") return "";
  const location = (globalThis as any).location;
  if (!location) return "";
  const search = new URLSearchParams(location.search ?? "");
  const directToken = search.get("token");
  if (directToken && String(location.pathname ?? "").includes("onboarding")) return directToken;
  const hash = String(location.hash ?? "");
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
  return new URLSearchParams(hashQuery).get("token") ?? "";
}

export default function SupportApp() {
  const onboardingToken = onboardingTokenFromUrl();
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [context, setContext] = useState<UserContext | null>(null);
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [screen, setScreen] = useState<Screen>("operations");
  const [activeTab, setActiveTab] = useState<Screen>("operations");
  const [selectedOperationId, setSelectedOperationId] = useState<number | null>(null);
  const [selectedContractorId, setSelectedContractorId] = useState<number | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<ContractorDocument | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<ContractorHistory | null>(null);
  const mountedRef = useRef(true);
  const hydrationIdRef = useRef(0);

  const hydrate = useCallback(async (nextSession: Session | null) => {
    const hydrationId = ++hydrationIdRef.current;
    setSession(nextSession);
    if (!nextSession) {
      setContext(null);
      setData(EMPTY_DATA);
      setBooting(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextContext = await withTimeout(
        loadUserContext(nextSession.user.id),
        12_000,
        "No fue posible validar la sesión. Revisa tu conexión e inténtalo nuevamente.",
      );
      const nextData = await withTimeout(
        loadAppData(nextContext),
        15_000,
        "La carga inicial tardó demasiado. Puedes reintentar desde la aplicación.",
      );
      if (!mountedRef.current || hydrationId !== hydrationIdRef.current) return;
      const home: Screen = nextContext.roleCode === "ADMIN" ? "users" : "operations";
      setContext(nextContext);
      setData(nextData);
      setScreen(home);
      setActiveTab(home);
    } catch (cause) {
      if (!mountedRef.current || hydrationId !== hydrationIdRef.current) return;
      const message = errorMessage(cause);
      setError(message);
      setSession(null);
      setContext(null);
      setData(EMPTY_DATA);
    } finally {
      if (mountedRef.current && hydrationId === hydrationIdRef.current) {
        setLoading(false);
        setBooting(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let initialSessionHandled = false;
    const fallbackTimer = setTimeout(() => {
      if (!initialSessionHandled && mountedRef.current) {
        setError("No fue posible restaurar la sesión guardada. Intenta iniciar sesión nuevamente.");
        setBooting(false);
      }
    }, 8_000);

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mountedRef.current) return;
      if (event === "INITIAL_SESSION") {
        initialSessionHandled = true;
        clearTimeout(fallbackTimer);
      }

      // Let the auth callback release its internal lock before querying Supabase.
      setTimeout(() => {
        if (mountedRef.current) void hydrate(nextSession);
      }, 0);
    });

    return () => {
      mountedRef.current = false;
      clearTimeout(fallbackTimer);
      listener.subscription.unsubscribe();
    };
  }, [hydrate]);

  const refresh = useCallback(async () => {
    if (!context) return;
    setLoading(true);
    setError("");
    try {
      setData(await loadAppData(context));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [context]);

  const navigate = (next: Screen) => {
    setScreen(next);
    if (context && tabsByRole[context.role].some((tab) => tab.screen === next)) {
      setActiveTab(next);
    }
  };

  const openOperation = (id: number) => {
    setSelectedOperationId(id);
    navigate("operation-detail");
  };
  const openContractor = (id: number) => {
    setSelectedContractorId(id);
    navigate("contractor");
  };
  const openDocument = (document: ContractorDocument) => {
    setSelectedDocument(document);
    navigate("document-preview");
  };

  if (onboardingToken) return <PublicContractorOnboarding token={onboardingToken} />;
  if (booting) return <CenteredState label="Cargando Support Colombia..." />;
  if (!session || !context) {
    return <Login initialError={error} busy={loading} />;
  }

  const showTabs = !detailScreens.includes(screen);
  const selectedOperation = data.operations.find((item) => item.id === selectedOperationId) ?? null;
  const selectedContractor =
    data.contractors.find((item) => item.id === selectedContractorId) ?? null;
  const selectedClientContractor =
    data.clientContractors.find((item) => item.id === selectedContractorId) ?? null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
        <Header
          context={context}
          screen={screen}
          canGoBack={!showTabs}
          onBack={() => navigate(screen === "document-preview" ? "contractor" : activeTab)}
          onLogout={() => supabase.auth.signOut()}
        />
        {error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : (
          <View style={styles.body}>
            {screen === "operations" && (
              <Operations
                context={context}
                operations={data.operations}
                loading={loading}
                onRefresh={refresh}
                onOpen={openOperation}
                onInitial={() => navigate("initial")}
              />
            )}
            {screen === "operation-detail" && selectedOperation && (
              <OperationDetail
                context={context}
                operation={selectedOperation}
                onFinal={() => navigate("final")}
                onChanged={async () => {
                  await refresh();
                  navigate("operations");
                }}
              />
            )}
            {screen === "initial" && (
              <InitialOperation
                context={context}
                data={data}
                onSaved={async () => {
                  await refresh();
                  navigate("operations");
                }}
              />
            )}
            {screen === "final" && selectedOperation && (
              <FinalOperation
                operation={selectedOperation}
                contractors={data.contractors}
                onSaved={async () => {
                  await refresh();
                  navigate("operations");
                }}
              />
            )}
            {screen === "requests" && (
              <Requests
                context={context}
                requests={data.requests}
                loading={loading}
                onRefresh={refresh}
                onNew={() => navigate("new-request")}
                onCancelled={refresh}
              />
            )}
            {screen === "new-request" && (
              <NewRequest
                context={context}
                data={data}
                onSaved={async () => {
                  await refresh();
                  navigate("requests");
                }}
              />
            )}
            {screen === "staff" && (
              context.role === "Cliente" ? (
                <ClientStaff contractors={data.clientContractors} onOpen={openContractor} />
              ) : (
                <Staff
                  context={context}
                  contractors={data.contractors}
                  onOpen={openContractor}
                  onCreate={() => navigate("create-contractor")}
                />
              )
            )}
            {screen === "create-contractor" && (
              <CreateContractor
                documentTypes={data.documentTypes}
                onSaved={async (contractorId) => {
                  setSelectedContractorId(contractorId);
                  await refresh();
                  navigate("contractor");
                }}
              />
            )}
            {screen === "contractor" && context.role === "Cliente" && selectedClientContractor && (
              <ClientContractorProfile
                contractor={selectedClientContractor}
                onDocument={openDocument}
                onHistory={(history) => {
                  setSelectedHistory(history);
                  navigate("history-detail");
                }}
              />
            )}
            {screen === "contractor" && context.role !== "Cliente" && selectedContractor && (
              <ContractorProfile
                context={context}
                contractor={selectedContractor}
                terminationReasons={data.terminationReasons}
                documentTypes={data.contractorDocumentTypes as ContractorDocumentTypeOption[]}
                contractTypes={data.contractTypes}
                workwearTypes={data.workwearTypes}
                onDocument={openDocument}
                onChanged={refresh}
                onHistory={(history) => {
                  setSelectedHistory(history);
                  navigate("history-detail");
                }}
              />
            )}
            {screen === "document-preview" && selectedDocument && (
              <DocumentPreview document={selectedDocument} />
            )}
            {screen === "history-detail" && selectedHistory && (
              context.role === "Cliente" ? (
                <ClientHistoryDetail history={selectedHistory} />
              ) : (
                <HistoryDetail history={selectedHistory} />
              )
            )}
            {screen === "statistics" && (
              <Statistics context={context} data={data} />
            )}
            {screen === "users" && (
              <Users currentUserId={context.id} data={data} onChanged={refresh} />
            )}
          </View>
        )}
        {showTabs && (
          <BottomNav
            tabs={tabsByRole[context.role]}
            active={activeTab}
            onPress={navigate}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function PublicContractorOnboarding({ token }: { token: string }) {
  const [form, setForm] = useState<ContractorOnboardingForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [picker, setPicker] = useState<null | "blood" | "civil" | "transport" | "education" | "stratum" | "shirt" | "pant" | "shoe">(null);
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [selfieUri, setSelfieUri] = useState("");
  const [fields, setFields] = useState({
    bloodType: "",
    birthDate: "",
    birthPlace: "",
    civilStateId: 0,
    residenceDepartment: "",
    residenceCity: "",
    address: "",
    stratum: "",
    phone: "",
    transportTypeId: 0,
    educationLevelId: 0,
    eps: "",
    shirtSize: "",
    pantSize: "",
    shoeSize: "",
    pensionFund: "",
    emergencyContactName: "",
    emergencyContactRelationship: "",
    emergencyContactPhone: "",
    acceptsDataPolicy: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextForm = await loadContractorOnboardingForm(token);
      setForm(nextForm);
      setFields((current) => ({
        ...current,
        bloodType: current.bloodType || nextForm.catalogs.bloodTypes[0] || "",
        civilStateId: current.civilStateId || nextForm.catalogs.civilStates[0]?.id || 0,
        transportTypeId: current.transportTypeId || nextForm.catalogs.transportTypes[0]?.id || 0,
        educationLevelId: current.educationLevelId || nextForm.catalogs.educationLevels[0]?.id || 0,
        stratum: current.stratum || nextForm.catalogs.stratum[0] || "",
        shirtSize: current.shirtSize || nextForm.catalogs.shirtSizes[0] || "",
        pantSize: current.pantSize || nextForm.catalogs.pantSizes[0] || "",
        shoeSize: current.shoeSize || nextForm.catalogs.shoeSizes[0] || "",
      }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const stringOptions = (values: string[]) => values.map((name, index) => ({ id: index + 1, name }));
  const currentStringId = (values: string[], value: string) => Math.max(1, values.indexOf(value) + 1);
  const selectedName = (options: { id: number; name: string }[], id: number) =>
    options.find((option) => option.id === id)?.name ?? "Selecciona";
  const update = (key: keyof typeof fields, value: string | number | boolean) => {
    setFields((current) => ({ ...current, [key]: value }));
  };

  async function submit() {
    if (!form) return;
    const requiredText = [
      fields.bloodType,
      fields.birthDate,
      fields.birthPlace,
      fields.residenceDepartment,
      fields.residenceCity,
      fields.address,
      fields.stratum,
      fields.phone,
      fields.eps,
      fields.shirtSize,
      fields.pantSize,
      fields.shoeSize,
      fields.pensionFund,
      fields.emergencyContactName,
      fields.emergencyContactRelationship,
      fields.emergencyContactPhone,
    ];
    if (requiredText.some((value) => !String(value).trim()) || !fields.civilStateId || !fields.transportTypeId || !fields.educationLevelId) {
      Alert.alert("Completa el formulario", "Todos los campos son obligatorios.");
      return;
    }
    if (!selfieUri) {
      Alert.alert("Falta selfie", "Toma una foto frontal antes de enviar.");
      return;
    }
    if (!fields.acceptsDataPolicy) {
      Alert.alert("Acepta la política", "Debes aceptar la política de tratamiento de datos personales.");
      return;
    }
    setSaving(true);
    try {
      const selfieBase64 = await imageUriToBase64(selfieUri);
      const payload: ContractorOnboardingSubmission = {
        ...fields,
        selfieBase64,
        acceptsDataPolicy: fields.acceptsDataPolicy,
      };
      await submitContractorOnboardingForm(token, payload);
      setSubmitted(true);
    } catch (cause) {
      Alert.alert("No fue posible enviar", errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <CenteredState label="Cargando formulario..." />;
  if (submitted) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={54} color={C.green} />
          <Text style={styles.errorTitle}>Formulario enviado</Text>
          <Text style={styles.subtitle}>Gracias. Support Colombia recibió tu información correctamente.</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }
  if (error || !form) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={C.red} />
          <Text style={styles.errorTitle}>No pudimos abrir el formulario</Text>
          <Text style={styles.subtitle}>{error || "El enlace no está disponible."}</Text>
          <PrimaryButton label="Reintentar" icon="refresh-outline" onPress={load} />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  const pickerConfig = {
    blood: {
      title: "Tipo de sangre",
      options: stringOptions(form.catalogs.bloodTypes),
      selectedId: currentStringId(form.catalogs.bloodTypes, fields.bloodType),
      onSelect: (id: number) => update("bloodType", form.catalogs.bloodTypes[id - 1] ?? ""),
    },
    civil: {
      title: "Estado civil",
      options: form.catalogs.civilStates,
      selectedId: fields.civilStateId,
      onSelect: (id: number) => update("civilStateId", id),
    },
    transport: {
      title: "Medio de transporte",
      options: form.catalogs.transportTypes,
      selectedId: fields.transportTypeId,
      onSelect: (id: number) => update("transportTypeId", id),
    },
    education: {
      title: "Grado de escolaridad",
      options: form.catalogs.educationLevels,
      selectedId: fields.educationLevelId,
      onSelect: (id: number) => update("educationLevelId", id),
    },
    stratum: {
      title: "Estrato",
      options: stringOptions(form.catalogs.stratum),
      selectedId: currentStringId(form.catalogs.stratum, fields.stratum),
      onSelect: (id: number) => update("stratum", form.catalogs.stratum[id - 1] ?? ""),
    },
    shirt: {
      title: "Talla de camisa",
      options: stringOptions(form.catalogs.shirtSizes),
      selectedId: currentStringId(form.catalogs.shirtSizes, fields.shirtSize),
      onSelect: (id: number) => update("shirtSize", form.catalogs.shirtSizes[id - 1] ?? ""),
    },
    pant: {
      title: "Talla de pantalón",
      options: stringOptions(form.catalogs.pantSizes),
      selectedId: currentStringId(form.catalogs.pantSizes, fields.pantSize),
      onSelect: (id: number) => update("pantSize", form.catalogs.pantSizes[id - 1] ?? ""),
    },
    shoe: {
      title: "Talla de zapatos",
      options: stringOptions(form.catalogs.shoeSizes),
      selectedId: currentStringId(form.catalogs.shoeSizes, fields.shoeSize),
      onSelect: (id: number) => update("shoeSize", form.catalogs.shoeSizes[id - 1] ?? ""),
    },
  } as const;
  const activePicker = picker ? pickerConfig[picker] : null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
        <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled">
          <View style={styles.publicHero}>
            <Image source={require("../assets/support-icon.png")} style={styles.headerLogo} resizeMode="contain" />
            <View style={styles.flex}>
              <Text style={styles.eyebrow}>REGISTRO DE CONTRATISTA</Text>
              <Text style={styles.greeting}>Completa tus datos</Text>
              <Text style={styles.subtitle}>{form.contractor.name} ⋅ CC {form.contractor.document}</Text>
            </View>
          </View>
          <FormCard title="Información personal">
            <Choice label="Tipo de sangre *" value={fields.bloodType} icon="water-outline" onPress={() => setPicker("blood")} />
            <Choice label="Fecha de nacimiento *" value={fields.birthDate || "Selecciona fecha"} icon="calendar-outline" onPress={() => setCalendarOpen(true)} />
            <Label text="Lugar de nacimiento *" />
            <Input icon="location-outline" value={fields.birthPlace} onChangeText={(value) => update("birthPlace", value)} autoCapitalize="words" />
            <Choice label="Estado civil *" value={selectedName(form.catalogs.civilStates, fields.civilStateId)} icon="heart-outline" onPress={() => setPicker("civil")} />
          </FormCard>
          <FormCard title="Residencia y contacto">
            <Label text="Departamento de residencia *" />
            <Input icon="map-outline" value={fields.residenceDepartment} onChangeText={(value) => update("residenceDepartment", value)} autoCapitalize="words" />
            <Label text="Ciudad de residencia *" />
            <Input icon="business-outline" value={fields.residenceCity} onChangeText={(value) => update("residenceCity", value)} autoCapitalize="words" />
            <Label text="Dirección de residencia *" />
            <Input icon="home-outline" value={fields.address} onChangeText={(value) => update("address", value)} />
            <Choice label="Estrato *" value={fields.stratum} icon="layers-outline" onPress={() => setPicker("stratum")} />
            <Label text="Teléfono *" />
            <Input icon="call-outline" value={fields.phone} onChangeText={(value) => update("phone", value)} keyboardType="phone-pad" />
          </FormCard>
          <FormCard title="Información laboral y logística">
            <Choice label="Medio de transporte *" value={selectedName(form.catalogs.transportTypes, fields.transportTypeId)} icon="car-outline" onPress={() => setPicker("transport")} />
            <Choice label="Grado de escolaridad *" value={selectedName(form.catalogs.educationLevels, fields.educationLevelId)} icon="school-outline" onPress={() => setPicker("education")} />
            <Label text="EPS *" />
            <Input icon="medkit-outline" value={fields.eps} onChangeText={(value) => update("eps", value)} autoCapitalize="words" />
            <Label text="Fondo de pensiones *" />
            <Input icon="business-outline" value={fields.pensionFund} onChangeText={(value) => update("pensionFund", value)} autoCapitalize="words" />
            <Choice label="Talla de camisa *" value={fields.shirtSize} icon="shirt-outline" onPress={() => setPicker("shirt")} />
            <Choice label="Talla de pantalón *" value={fields.pantSize} icon="resize-outline" onPress={() => setPicker("pant")} />
            <Choice label="Talla de zapatos *" value={fields.shoeSize} icon="footsteps-outline" onPress={() => setPicker("shoe")} />
          </FormCard>
          <FormCard title="Contacto de emergencia">
            <Label text="Nombre *" />
            <Input icon="person-outline" value={fields.emergencyContactName} onChangeText={(value) => update("emergencyContactName", value)} autoCapitalize="words" />
            <Label text="Parentesco *" />
            <Input icon="people-outline" value={fields.emergencyContactRelationship} onChangeText={(value) => update("emergencyContactRelationship", value)} autoCapitalize="words" />
            <Label text="Teléfono *" />
            <Input icon="call-outline" value={fields.emergencyContactPhone} onChangeText={(value) => update("emergencyContactPhone", value)} keyboardType="phone-pad" />
          </FormCard>
          <FormCard title="Foto de perfil">
            <Notice icon="camera-outline" text="Tómate una foto frontal, con buena luz y el rostro centrado. Esta será tu foto de perfil." />
            <Pressable style={styles.uploadCard} onPress={() => setSelfieOpen(true)}>
              <View style={styles.pdfIcon}>
                <Ionicons name={selfieUri ? "checkmark-circle-outline" : "camera-outline"} size={23} color={selfieUri ? C.green : C.orange} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{selfieUri ? "Selfie lista" : "Tomar selfie"}</Text>
                <Text style={styles.cardMeta}>{selfieUri ? "Puedes repetir la foto si lo necesitas." : "Foto frontal obligatoria."}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={C.muted} />
            </Pressable>
            {selfieUri ? <Image source={{ uri: selfieUri }} style={styles.selfiePreview} resizeMode="cover" /> : null}
          </FormCard>
          <FormCard title="Tratamiento de datos personales">
            <Notice icon="document-text-outline" text="Lee la política antes de enviar. El check quedará guardado como evidencia de aceptación." />
            <SecondaryButton label="Ver política PDF" icon="open-outline" onPress={() => Linking.openURL(form.policy.url)} />
            <Pressable style={styles.policyCheckRow} onPress={() => update("acceptsDataPolicy", !fields.acceptsDataPolicy)}>
              <View style={[styles.checkbox, fields.acceptsDataPolicy && styles.checkboxOn]}>
                {fields.acceptsDataPolicy ? <Ionicons name="checkmark" size={14} color={C.white} /> : null}
              </View>
              <Text style={styles.noticeText}>{form.policy.acceptanceText}</Text>
            </Pressable>
          </FormCard>
          <PrimaryButton label={saving ? "Enviando..." : "Enviar información"} icon="send-outline" disabled={saving} onPress={submit} />
        </ScrollView>
        <CalendarModal
          visible={calendarOpen}
          selectedDate={fields.birthDate || null}
          defaultDate="1990-01-01"
          title="Fecha de nacimiento"
          onClose={() => setCalendarOpen(false)}
          onSelect={(date) => {
            update("birthDate", date);
            setCalendarOpen(false);
          }}
        />
        <DropdownModal
          visible={Boolean(activePicker)}
          title={activePicker?.title ?? ""}
          options={activePicker?.options ?? []}
          selectedId={activePicker?.selectedId ?? 0}
          onClose={() => setPicker(null)}
          onSelect={(id) => {
            activePicker?.onSelect(id);
            setPicker(null);
          }}
        />
        <SelfieCaptureModal
          visible={selfieOpen}
          currentUri={selfieUri}
          onClose={() => setSelfieOpen(false)}
          onReady={(uri) => {
            setSelfieUri(uri);
            setSelfieOpen(false);
          }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Login({ initialError, busy }: { initialError: string; busy: boolean }) {
  const [email, setEmail] = useState("coordinador.demo@supportcolombia.com");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(true);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(initialError);

  const signIn = async () => {
    setSubmitting(true);
    setMessage("");
    const result = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (result.error) setMessage("Correo o contraseña incorrectos.");
    setSubmitting(false);
  };

  const recover = async () => {
    if (!email.trim()) {
      setMessage("Ingresa tu correo para recuperar el acceso.");
      return;
    }
    const result = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    if (result.error) setMessage(result.error.message);
    else Alert.alert("Correo enviado", "Revisa tu bandeja para restablecer la contraseña.");
  };

  return (
    <SafeAreaProvider>
      <LinearGradient colors={["#F8FAFF", "#EEF2FA"]} style={styles.loginPage}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFF" />
        <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
          <Image
            source={require("../assets/login-logo.png")}
            style={styles.loginLogo}
            resizeMode="contain"
          />
          <View style={styles.loginCard}>
            <Text style={styles.loginTitle}>Bienvenido</Text>
            <Text style={styles.subtitle}>Ingresa a tu cuenta para continuar</Text>
            <Label text="Correo electrónico" />
            <Input icon="mail-outline" value={email} onChangeText={setEmail} autoCapitalize="none" />
            <Label text="Contraseña" />
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={20} color={C.muted} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={secure}
                style={styles.input}
              />
              <Pressable onPress={() => setSecure((value) => !value)}>
                <Ionicons name={secure ? "eye-outline" : "eye-off-outline"} size={20} color={C.muted} />
              </Pressable>
            </View>
            <View style={styles.loginOptions}>
              <Pressable style={styles.row} onPress={() => setRemember((value) => !value)}>
                <View style={[styles.checkbox, remember && styles.checkboxOn]}>
                  {remember && <Ionicons name="checkmark" color={C.white} size={14} />}
                </View>
                <Text style={styles.smallText}>Recordarme</Text>
              </Pressable>
              <Pressable onPress={recover}>
                <Text style={styles.link}>¿Olvidaste tu contraseña?</Text>
              </Pressable>
            </View>
            {message ? <Text style={styles.errorText}>{message}</Text> : null}
            <PrimaryButton
              label={submitting || busy ? "Ingresando..." : "Iniciar sesión"}
              icon="arrow-forward"
              disabled={submitting || busy}
              onPress={signIn}
            />
          </View>
          <Text style={styles.loginFooter}>Acceso seguro ⋅ Support Colombia 2026</Text>
        </ScrollView>
      </LinearGradient>
    </SafeAreaProvider>
  );
}

function Header({
  context,
  screen,
  canGoBack,
  onBack,
  onLogout,
}: {
  context: UserContext;
  screen: Screen;
  canGoBack: boolean;
  onBack: () => void;
  onLogout: () => void;
}) {
  const titles: Record<Screen, string> = {
    operations: "Operaciones",
    "operation-detail": context.role === "Director" ? "Revisión de operación" : "Detalle de operación",
    initial: "Registro inicial",
    final: "Registro final",
    requests: "Solicitudes",
    "new-request": "Nueva solicitud",
    staff: "Personal",
    "create-contractor": "Crear contratista",
    contractor: "Perfil del contratista",
    "document-preview": "Documento del contratista",
    "history-detail": "Detalle del turno",
    statistics: "Estadísticas",
    users: "Administración de usuarios",
  };
  const initials = `${context.name[0] ?? ""}${context.lastName[0] ?? ""}`.toUpperCase();
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {canGoBack ? (
          <Pressable onPress={onBack} style={styles.iconButton}>
            <Ionicons name="arrow-back" size={22} color={C.ink} />
          </Pressable>
        ) : (
          <Image source={require("../assets/support-logo.png")} style={styles.headerLogo} resizeMode="contain" />
        )}
        <View style={styles.flex}>
          <Text style={styles.headerTitle}>{titles[screen]}</Text>
          {!canGoBack && <Text style={styles.caption}>{context.role}</Text>}
        </View>
      </View>
      <Pressable style={styles.avatar} onPress={onLogout}>
        <Text style={styles.avatarText}>{initials}</Text>
      </Pressable>
    </View>
  );
}

function Operations({
  context,
  operations,
  loading,
  onRefresh,
  onOpen,
  onInitial,
}: {
  context: UserContext;
  operations: Operation[];
  loading: boolean;
  onRefresh: () => void;
  onOpen: (id: number) => void;
  onInitial: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const pending = operations.filter((item) => item.status === "PENDIENTE");
  const today = todayIso();
  const threeDayStart = dateToIso(addDays(isoToDate(today), -2));
  const visibleOperations = operations.filter((operation) =>
    selectedDate
      ? operation.date === selectedDate
      : operation.date >= threeDayStart && operation.date <= today,
  );
  const totalToday = operations
    .filter((item) => item.date === today)
    .reduce((total, item) => total + item.people, 0);
  return (
    <Page loading={loading} onRefresh={onRefresh}>
      <View>
        <Text style={styles.eyebrow}>OPERACIÓN EN TIEMPO REAL</Text>
        <Text style={styles.greeting}>
          {context.role === "Cliente"
            ? "Tu operación"
            : context.role === "Director"
              ? "Control operativo"
              : `Buenos días, ${context.name}`}
        </Text>
        <Text style={styles.subtitle}>Información protegida según tu perfil y clientes asignados.</Text>
      </View>
      {context.role !== "Cliente" && (
        <View style={styles.kpiRow}>
          <Kpi
            value={String(operations.filter((item) => item.status === "EN_CURSO").length)}
            label="Operaciones En curso"
            icon="time"
          />
          <Kpi value={String(pending.length)} label="Operaciones Pendientes" icon="alert-circle" />
          <Kpi value={String(totalToday)} label="Personal hoy" icon="people" />
        </View>
      )}
      {context.role === "Director" && pending.length > 0 && (
        <Pressable style={styles.alertCard} onPress={() => onOpen(pending[0].id)}>
          <Ionicons name="alert-circle" size={23} color={C.red} />
          <View style={styles.flex}>
            <Text style={styles.alertTitle}>{pending.length} operaciones esperan aprobación</Text>
            <Text style={styles.caption}>Toca para revisar la primera operación pendiente.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={C.red} />
        </Pressable>
      )}
      {context.role === "Coordinador" && (
        <SecondaryButton label="Registro inicial" icon="add-circle-outline" onPress={onInitial} />
      )}
      <View style={styles.historyHeader}>
        <View style={styles.flex}>
          <Text style={styles.sectionTitle}>Historial de operaciones</Text>
          <Text style={styles.caption}>{visibleOperations.length} registros</Text>
        </View>
        <Pressable style={styles.dateFilterButton} onPress={() => setCalendarVisible(true)}>
          <Ionicons name="calendar-outline" size={17} color={C.navy} />
          <Text style={styles.dateFilterText}>
            {selectedDate ? formatDate(selectedDate) : "Últimos 3 días"}
          </Text>
          <Ionicons name="chevron-down" size={15} color={C.navy} />
        </Pressable>
      </View>
      {visibleOperations.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          text={
            selectedDate
              ? `No hay operaciones para el ${formatDate(selectedDate)}.`
              : "No hay operaciones registradas en los últimos 3 días."
          }
        />
      ) : (
        visibleOperations.map((operation) => (
          <OperationCard
            key={operation.id}
            operation={operation}
            hideStatus={context.role === "Cliente"}
            onPress={() => onOpen(operation.id)}
          />
        ))
      )}
      <CalendarModal
        visible={calendarVisible}
        selectedDate={selectedDate}
        onClose={() => setCalendarVisible(false)}
        onSelect={(date) => {
          setSelectedDate(date);
          setCalendarVisible(false);
        }}
        onReset={() => {
          setSelectedDate(null);
          setCalendarVisible(false);
        }}
      />
    </Page>
  );
}

function CalendarModal({
  visible,
  selectedDate,
  defaultDate,
  title = "Filtrar por fecha",
  subtitle = "Selecciona el día que quieres visualizar.",
  resetLabel = "Mostrar últimos 3 días",
  onClose,
  onSelect,
  onReset,
}: {
  visible: boolean;
  selectedDate: string | null;
  defaultDate?: string;
  title?: string;
  subtitle?: string;
  resetLabel?: string;
  onClose: () => void;
  onSelect: (date: string) => void;
  onReset?: () => void;
}) {
  const initialDate = isoToDate(selectedDate ?? defaultDate ?? todayIso());
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(initialDate.getFullYear(), initialDate.getMonth(), 1),
  );
  const [selectingYear, setSelectingYear] = useState(false);

  useEffect(() => {
    if (visible) {
      const date = isoToDate(selectedDate ?? defaultDate ?? todayIso());
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      setSelectingYear(false);
    }
  }, [defaultDate, selectedDate, visible]);

  const selectedYear = selectedDate ? isoToDate(selectedDate).getFullYear() : null;
  const currentYear = isoToDate(todayIso()).getFullYear();
  const yearBlockStart = Math.floor(visibleMonth.getFullYear() / 12) * 12;
  const yearOptions = Array.from({ length: 12 }, (_, index) => yearBlockStart + index);
  const monthLabel = new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);
  const firstWeekday = visibleMonth.getDay();
  const daysInMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    0,
  ).getDate();
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) =>
    index < firstWeekday ? null : index - firstWeekday + 1,
  );

  const moveMonth = (offset: number) => {
    setVisibleMonth(
      new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1),
    );
  };
  const moveYear = (offset: number) => {
    setVisibleMonth(
      new Date(visibleMonth.getFullYear() + offset, visibleMonth.getMonth(), 1),
    );
  };
  const moveYearBlock = (offset: number) => {
    setVisibleMonth(
      new Date(visibleMonth.getFullYear() + offset * 12, visibleMonth.getMonth(), 1),
    );
  };
  const selectYear = (year: number) => {
    setVisibleMonth(new Date(year, visibleMonth.getMonth(), 1));
    setSelectingYear(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.calendarCard}>
          <View style={styles.between}>
            <View>
              <Text style={styles.formTitle}>{title}</Text>
              <Text style={styles.caption}>{subtitle}</Text>
            </View>
            <Pressable style={styles.iconButton} onPress={onClose}>
              <Ionicons name="close" size={20} color={C.ink} />
            </Pressable>
          </View>
          {selectingYear ? (
            <>
              <View style={styles.calendarNavigation}>
                <Pressable style={styles.calendarArrow} onPress={() => moveYearBlock(-1)}>
                  <Ionicons name="chevron-back" size={20} color={C.navy} />
                </Pressable>
                <View style={styles.calendarMonthButton}>
                  <Text style={styles.calendarMonth}>Selecciona el año</Text>
                  <Text style={styles.caption}>{yearBlockStart} - {yearBlockStart + 11}</Text>
                </View>
                <Pressable style={styles.calendarArrow} onPress={() => moveYearBlock(1)}>
                  <Ionicons name="chevron-forward" size={20} color={C.navy} />
                </Pressable>
              </View>
              <View style={styles.yearGrid}>
                {yearOptions.map((year) => {
                  const selected = year === selectedYear;
                  const isCurrent = year === currentYear;
                  return (
                    <Pressable
                      key={year}
                      style={[
                        styles.yearOption,
                        isCurrent && styles.calendarToday,
                        selected && styles.calendarDaySelected,
                      ]}
                      onPress={() => selectYear(year)}
                    >
                      <Text
                        style={[
                          styles.yearOptionText,
                          isCurrent && styles.calendarTodayText,
                          selected && styles.calendarDayTextSelected,
                        ]}
                      >
                        {year}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <SecondaryButton
                label="Volver al calendario"
                icon="calendar-outline"
                onPress={() => setSelectingYear(false)}
              />
            </>
          ) : (
            <>
              <View style={styles.calendarNavigation}>
                <Pressable style={styles.calendarArrowSmall} onPress={() => moveYear(-1)}>
                  <Ionicons name="play-back" size={17} color={C.navy} />
                </Pressable>
                <Pressable style={styles.calendarArrow} onPress={() => moveMonth(-1)}>
                  <Ionicons name="chevron-back" size={20} color={C.navy} />
                </Pressable>
                <Pressable style={styles.calendarMonthButton} onPress={() => setSelectingYear(true)}>
                  <Text style={styles.calendarMonth}>
                    {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
                  </Text>
                  <Text style={styles.caption}>Cambiar año</Text>
                </Pressable>
                <Pressable style={styles.calendarArrow} onPress={() => moveMonth(1)}>
                  <Ionicons name="chevron-forward" size={20} color={C.navy} />
                </Pressable>
                <Pressable style={styles.calendarArrowSmall} onPress={() => moveYear(1)}>
                  <Ionicons name="play-forward" size={17} color={C.navy} />
                </Pressable>
              </View>
              <View style={styles.calendarGrid}>
                {["D", "L", "M", "M", "J", "V", "S"].map((day, index) => (
                  <Text key={`${day}-${index}`} style={styles.calendarWeekday}>
                    {day}
                  </Text>
                ))}
                {cells.map((day, index) => {
                  if (!day) {
                    return <View key={`empty-${index}`} style={styles.calendarDay} />;
                  }
                  const isoDate = dateToIso(
                    new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day),
                  );
                  const selected = isoDate === selectedDate;
                  const isToday = isoDate === todayIso();
                  return (
                    <Pressable
                      key={isoDate}
                      style={[
                        styles.calendarDay,
                        isToday && styles.calendarToday,
                        selected && styles.calendarDaySelected,
                      ]}
                      onPress={() => onSelect(isoDate)}
                    >
                      <Text
                        style={[
                          styles.calendarDayText,
                          isToday && styles.calendarTodayText,
                          selected && styles.calendarDayTextSelected,
                        ]}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          {onReset && (
            <SecondaryButton
              label={resetLabel}
              icon="refresh-outline"
              onPress={onReset}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function OperationCard({
  operation,
  hideStatus,
  onPress,
}: {
  operation: Operation;
  hideStatus: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardTop}>
        <View style={styles.dateBadge}>
          <Text style={styles.dateDay}>{formatDate(operation.date).slice(0, 2)}</Text>
          <Ionicons name="calendar-outline" size={14} color={C.navy} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{operation.client}</Text>
          <Text style={styles.cardMeta}>{operation.area} ⋅ {operation.shift} ⋅ {operation.people} personas</Text>
          <Text style={styles.caption}>{formatDate(operation.date)}</Text>
        </View>
        {!hideStatus && <StatusBadge status={operation.status} />}
        <Ionicons name="chevron-forward" size={18} color={C.muted} />
      </View>
    </Pressable>
  );
}

function OperationDetail({
  context,
  operation,
  onFinal,
  onChanged,
}: {
  context: UserContext;
  operation: Operation;
  onFinal: () => void;
  onChanged: () => void;
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOperationAssignments(operation.id)
      .then(setAssignments)
      .catch((cause) => Alert.alert("No fue posible cargar", errorMessage(cause)))
      .finally(() => setLoading(false));
  }, [operation.id]);

  const decide = async (decision: "CERRADO" | "CAMBIOS_SOLICITADOS") => {
    if (decision === "CAMBIOS_SOLICITADOS" && !reviewText.trim()) {
      Alert.alert("Observación requerida", "Describe el cambio que debe realizar el coordinador.");
      return;
    }
    setSaving(true);
    try {
      await reviewOperation(operation.id, decision, reviewText);
      setReviewing(false);
      await onChanged();
    } catch (cause) {
      Alert.alert("No fue posible guardar", errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <View style={styles.heroCard}>
        <View style={styles.between}>
          <View>
            <Text style={styles.eyebrow}>OPERACIÓN #{operation.id}</Text>
            <Text style={styles.detailTitle}>{operation.client}</Text>
            <Text style={styles.subtitle}>{operation.area} ⋅ {operation.shift} ⋅ {formatDate(operation.date)}</Text>
          </View>
          {context.role !== "Cliente" && <StatusBadge status={operation.status} />}
        </View>
        <View style={styles.summaryRow}>
          <MiniStat label="Planeados" value={String(operation.people)} />
          <MiniStat label="Trabajaron" value={String(operation.worked)} />
          <MiniStat label="Extras" value={`${operation.extraHours} h`} />
        </View>
      </View>
      {operation.reviewObservations ? (
        <Notice icon="refresh-circle-outline" text={operation.reviewObservations} tone="error" />
      ) : null}
      <SectionTitle title="Personal de la operación" action={`${assignments.length} registros`} />
      {loading ? (
        <ActivityIndicator color={C.navy} />
      ) : assignments.length === 0 ? (
        <EmptyState icon="people-outline" text="No hay personal asignado." />
      ) : (
        assignments.map((assignment) => (
          <View key={assignment.assignmentId} style={styles.personRow}>
            <Initials name={assignment.contractorName} />
            <View style={styles.flex}>
              <Text style={styles.personName}>{assignment.contractorName}</Text>
              <Text style={styles.caption}>
                {assignment.attendanceStatus ?? "Planeado"} ⋅ {assignment.extraHours} horas extra
              </Text>
            </View>
            <Ionicons
              name={assignment.attendanceStatus === "AUSENTE" ? "close-circle" : "checkmark-circle"}
              color={assignment.attendanceStatus === "AUSENTE" ? C.red : C.green}
              size={21}
            />
          </View>
        ))
      )}
      <SectionTitle title="Observaciones" />
      <Notice icon="chatbubble-ellipses-outline" text={operation.observations || "Sin observaciones."} />
      {context.role === "Coordinador" &&
        (operation.status === "EN_CURSO" || operation.status === "CAMBIOS_SOLICITADOS") && (
          <PrimaryButton
            label="Registro final"
            icon="checkmark-circle-outline"
            onPress={onFinal}
          />
        )}
      {context.role === "Director" && operation.status === "PENDIENTE" && (
        <View style={styles.actionRow}>
          <SecondaryButton label="Solicitar cambios" icon="refresh-outline" onPress={() => setReviewing(true)} destructive />
          <PrimaryButton
            label="Aprobar"
            icon="checkmark"
            disabled={saving}
            onPress={() =>
              Alert.alert("Aprobar operación", "¿Confirmas que la información es correcta?", [
                { text: "Cancelar", style: "cancel" },
                { text: "Aprobar", onPress: () => decide("CERRADO") },
              ])
            }
          />
        </View>
      )}
      <Modal visible={reviewing} transparent animationType="fade" onRequestClose={() => setReviewing(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.formTitle}>Solicitar cambios</Text>
            <Text style={styles.subtitle}>La observación será visible para el coordinador.</Text>
            <TextInput
              value={reviewText}
              onChangeText={setReviewText}
              multiline
              placeholder="Describe la corrección requerida..."
              placeholderTextColor="#929BAD"
              style={styles.textArea}
            />
            <View style={styles.actionRow}>
              <SecondaryButton label="Cancelar" onPress={() => setReviewing(false)} />
              <PrimaryButton
                label="Enviar"
                icon="send"
                disabled={saving}
                onPress={() => decide("CAMBIOS_SOLICITADOS")}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Page>
  );
}

function InitialOperation({
  context,
  data,
  onSaved,
}: {
  context: UserContext;
  data: AppData;
  onSaved: () => void;
}) {
  const firstClient = context.clients[0];
  const activeContractors = data.contractors.filter((contractor) => contractor.active);
  const [clientId, setClientId] = useState(firstClient?.id ?? 0);
  const availableAreas = data.areas.filter((area) => area.clientId === clientId);
  const [areaId, setAreaId] = useState(availableAreas[0]?.id ?? 0);
  const availableShifts = data.shifts.filter((shift) => shift.areaId === areaId);
  const [shiftId, setShiftId] = useState(availableShifts[0]?.id ?? 0);
  const [contractorId, setContractorId] = useState(activeContractors[0]?.id ?? 0);
  const [openSelector, setOpenSelector] = useState<"client" | "area" | "shift" | "contractor" | null>(null);
  const [added, setAdded] = useState<Contractor[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const nextArea = data.areas.find((area) => area.clientId === clientId);
    setAreaId(nextArea?.id ?? 0);
  }, [clientId, data.areas]);

  useEffect(() => {
    const nextShift = data.shifts.find((shift) => shift.areaId === areaId);
    setShiftId(nextShift?.id ?? 0);
  }, [areaId, data.shifts]);

  useEffect(() => {
    if (!activeContractors.some((contractor) => contractor.id === contractorId)) {
      setContractorId(activeContractors[0]?.id ?? 0);
    }
  }, [activeContractors, contractorId]);

  const selectedContractor = data.contractors.find((item) => item.id === contractorId);

  const save = async () => {
    if (!clientId || !areaId || !shiftId || added.length === 0) {
      Alert.alert("Completa el registro", "Selecciona cliente, área, turno y al menos un contratista.");
      return;
    }
    setSaving(true);
    try {
      await createOperation({
        date: todayIso(),
        clientId,
        areaId,
        shiftId,
        contractorIds: added.map((item) => item.id),
      });
      Alert.alert("Registro guardado", "La operación quedó EN CURSO.");
      await onSaved();
    } catch (cause) {
      Alert.alert("No fue posible guardar", errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <FormCard title="Información de la operación">
        <Choice label="Fecha" value={formatDate(todayIso())} icon="calendar-outline" disabled />
        <Choice
          label="Cliente *"
          value={context.clients.find((item) => item.id === clientId)?.name ?? "Selecciona un cliente"}
          icon="business-outline"
          onPress={() => setOpenSelector("client")}
        />
        <Choice
          label="Área *"
          value={availableAreas.find((item) => item.id === areaId)?.name ?? "Selecciona un área"}
          icon="location-outline"
          disabled={!clientId || availableAreas.length === 0}
          onPress={() => setOpenSelector("area")}
        />
        <Choice
          label="Turno *"
          value={availableShifts.find((item) => item.id === shiftId)?.name ?? "Selecciona un turno"}
          icon="time-outline"
          disabled={!areaId || availableShifts.length === 0}
          onPress={() => setOpenSelector("shift")}
        />
        <Choice
          label="Contratista *"
          value={selectedContractor?.fullName ?? "Selecciona un contratista"}
          icon="person-outline"
          disabled={activeContractors.length === 0}
          onPress={() => setOpenSelector("contractor")}
        />
        <SecondaryButton
          label="Agregar contratista"
          icon="person-add-outline"
          onPress={() => {
            if (selectedContractor && !added.some((item) => item.id === selectedContractor.id)) {
              setAdded([...added, selectedContractor]);
            }
          }}
        />
      </FormCard>
      <SectionTitle title={`Personal agregado (${added.length})`} />
      <View style={styles.boundedList}>
        <ScrollView nestedScrollEnabled>
          {added.map((contractor) => (
            <View key={contractor.id} style={styles.personRow}>
              <Initials name={contractor.fullName} />
              <View style={styles.flex}>
                <Text style={styles.personName}>{contractor.fullName}</Text>
                <Text style={styles.caption}>
                  {context.clients.find((item) => item.id === clientId)?.name} ⋅ {availableAreas.find((item) => item.id === areaId)?.name} ⋅ {availableShifts.find((item) => item.id === shiftId)?.name}
                </Text>
              </View>
              <Pressable onPress={() => setAdded(added.filter((item) => item.id !== contractor.id))}>
                <Ionicons name="trash-outline" size={20} color={C.red} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </View>
      <PrimaryButton label={saving ? "Guardando..." : "Guardar registro inicial"} icon="save-outline" disabled={saving} onPress={save} />
      <DropdownModal
        visible={openSelector === "client"}
        title="Seleccionar cliente"
        options={context.clients}
        selectedId={clientId}
        onClose={() => setOpenSelector(null)}
        onSelect={(id) => {
          setClientId(id);
          setOpenSelector(null);
        }}
      />
      <DropdownModal
        visible={openSelector === "area"}
        title="Seleccionar Área"
        options={availableAreas}
        selectedId={areaId}
        onClose={() => setOpenSelector(null)}
        onSelect={(id) => {
          setAreaId(id);
          setOpenSelector(null);
        }}
      />
      <DropdownModal
        visible={openSelector === "shift"}
        title="Seleccionar turno"
        options={availableShifts}
        selectedId={shiftId}
        onClose={() => setOpenSelector(null)}
        onSelect={(id) => {
          setShiftId(id);
          setOpenSelector(null);
        }}
      />
      <DropdownModal
        visible={openSelector === "contractor"}
        title="Seleccionar contratista"
        options={activeContractors.map((contractor) => ({
          id: contractor.id,
          name: contractor.fullName,
          detail: contractor.document,
        }))}
        selectedId={contractorId}
        searchable
        searchPlaceholder="Buscar contratista por nombre"
        onClose={() => setOpenSelector(null)}
        onSelect={(id) => {
          setContractorId(id);
          setOpenSelector(null);
        }}
      />
    </Page>
  );
}

function FinalOperation({
  operation,
  contractors,
  onSaved,
}: {
  operation: Operation;
  contractors: Contractor[];
  onSaved: () => void;
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [observations, setObservations] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availableContractorIds, setAvailableContractorIds] = useState<number[]>([]);
  const [contractorSelectorVisible, setContractorSelectorVisible] = useState(false);

  const loadAssignments = useCallback(async () => {
    const rows = await loadOperationAssignments(operation.id);
    setAssignments(
      rows.map((row) => ({
        ...row,
        attendanceStatus: row.attendanceStatus ?? "ASISTIÓ",
      })),
    );
  }, [operation.id]);

  useEffect(() => {
    Promise.all([
      loadAssignments(),
      loadAvailableContractorIds(operation.id).then(setAvailableContractorIds),
    ])
      .catch((cause) => Alert.alert("No fue posible cargar", errorMessage(cause)))
      .finally(() => setLoading(false));
  }, [loadAssignments, operation.id]);

  const updateAssignment = (id: number, patch: Partial<Assignment>) => {
    setAssignments((rows) =>
      rows.map((row) => (row.assignmentId === id ? { ...row, ...patch } : row)),
    );
  };

  const save = () => {
    Alert.alert(
      "Enviar para aprobación",
      "La operación quedará PENDIENTE hasta la revisión del Director/Gerente.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Enviar",
          onPress: async () => {
            setSaving(true);
            try {
              await finalizeOperation(operation.id, assignments, observations);
              await onSaved();
            } catch (cause) {
              Alert.alert("No fue posible enviar", errorMessage(cause));
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Page>
      <FormCard title="Cierre de la operación">
        <Choice label="Fecha" value={formatDate(operation.date)} icon="calendar-outline" disabled />
        <Choice label="Cliente" value={operation.client} icon="business-outline" disabled />
        <Choice label="Área" value={operation.area} icon="location-outline" disabled />
        <Choice label="Turno" value={operation.shift} icon="time-outline" disabled />
      </FormCard>
      <SectionTitle title="Asistencia y novedades" action={`${assignments.length} personas`} />
      {loading ? <ActivityIndicator color={C.navy} /> : assignments.map((assignment) => (
        <View key={assignment.assignmentId} style={styles.formCard}>
          <View style={styles.personRowPlain}>
            <Initials name={assignment.contractorName} />
            <View style={styles.flex}>
              <Text style={styles.personName}>{assignment.contractorName}</Text>
              <Text style={styles.caption}>
                {assignment.areaName}
                {assignment.assignmentId < 0 ? " ⋅ Añadido durante la jornada" : ""}
              </Text>
            </View>
            {assignment.assignmentId < 0 && (
              <Pressable
                onPress={() =>
                  setAssignments((rows) =>
                    rows.filter((row) => row.assignmentId !== assignment.assignmentId),
                  )
                }
              >
                <Ionicons name="trash-outline" size={20} color={C.red} />
              </Pressable>
            )}
          </View>
          <Pressable
            style={styles.between}
            onPress={() =>
              updateAssignment(assignment.assignmentId, {
                attendanceStatus: assignment.attendanceStatus === "AUSENTE" ? "ASISTIÓ" : "AUSENTE",
              })
            }
          >
            <Text style={styles.fieldLabel}>Asistencia</Text>
            <StatusPill good={assignment.attendanceStatus !== "AUSENTE"} text={assignment.attendanceStatus ?? "ASISTIÓ"} />
          </Pressable>
          <View style={styles.between}>
            <Text style={styles.fieldLabel}>Registró horas extra</Text>
            <Switch
              value={assignment.extraHours > 0}
              onValueChange={(value) =>
                updateAssignment(assignment.assignmentId, { extraHours: value ? 1 : 0 })
              }
              trackColor={{ false: C.line, true: "#AAB8DB" }}
              thumbColor={assignment.extraHours > 0 ? C.navy : "#F4F4F4"}
            />
          </View>
          {assignment.extraHours > 0 && (
            <View style={styles.counter}>
              <Pressable onPress={() => updateAssignment(assignment.assignmentId, { extraHours: Math.max(0, assignment.extraHours - 1) })}>
                <Ionicons name="remove-circle-outline" size={25} color={C.navy} />
              </Pressable>
              <Text style={styles.counterValue}>{assignment.extraHours} horas</Text>
              <Pressable onPress={() => updateAssignment(assignment.assignmentId, { extraHours: assignment.extraHours + 1 })}>
                <Ionicons name="add-circle-outline" size={25} color={C.navy} />
              </Pressable>
            </View>
          )}
        </View>
      ))}
      {!loading && (
        <SecondaryButton
          label="Añadir contratista"
          icon="person-add-outline"
          onPress={() => setContractorSelectorVisible(true)}
        />
      )}
      <FormCard title="Observaciones generales">
        <TextInput
          value={observations}
          onChangeText={setObservations}
          multiline
          placeholder="Describe novedades relevantes..."
          placeholderTextColor="#929BAD"
          style={styles.textArea}
        />
      </FormCard>
      <PrimaryButton label={saving ? "Enviando..." : "Enviar para aprobación"} icon="send" disabled={saving || loading} onPress={save} />
      <DropdownModal
        visible={contractorSelectorVisible}
        title="Añadir contratista"
        options={contractors
          .filter(
            (contractor) =>
              contractor.active &&
              availableContractorIds.includes(contractor.id) &&
              !assignments.some((assignment) => assignment.contractorId === contractor.id),
          )
          .map((contractor) => ({
            id: contractor.id,
            name: contractor.fullName,
            detail: contractor.document,
          }))}
        selectedId={0}
        searchable
        searchPlaceholder="Buscar contratista por nombre"
        onClose={() => setContractorSelectorVisible(false)}
        onSelect={(contractorId) => {
          setContractorSelectorVisible(false);
          const contractor = contractors.find((item) => item.id === contractorId);
          if (!contractor) return;
          setAssignments((rows) => [
            ...rows,
            {
              assignmentId: -contractor.id,
              contractorId: contractor.id,
              contractorName: contractor.fullName,
              areaName: operation.area,
              attendanceStatus: "ASISTIÓ",
              workedQuantity: 1,
              extraHours: 0,
              observations: null,
            },
          ]);
        }}
      />
    </Page>
  );
}

function Requests({
  context,
  requests,
  loading,
  onRefresh,
  onNew,
  onCancelled,
}: {
  context: UserContext;
  requests: PersonnelRequest[];
  loading: boolean;
  onRefresh: () => void;
  onNew: () => void;
  onCancelled: () => void;
}) {
  return (
    <Page loading={loading} onRefresh={onRefresh}>
      <View style={styles.between}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>{context.role === "Cliente" ? "MIS SOLICITUDES" : "GESTIÓN DE COBERTURA"}</Text>
          <Text style={styles.greeting}>Solicitudes de personal</Text>
          <Text style={styles.subtitle}>Requerimientos visibles según tus clientes asignados.</Text>
        </View>
        {context.role === "Cliente" && (
          <Pressable style={styles.fab} onPress={onNew}>
            <Ionicons name="add" color={C.white} size={26} />
          </Pressable>
        )}
      </View>
      {requests.length === 0 ? (
        <EmptyState icon="document-text-outline" text="No hay solicitudes para mostrar." />
      ) : requests.map((request) => (
        <View key={request.id} style={styles.card}>
          <View style={styles.between}>
            <View>
              <Text style={styles.cardTitle}>{request.client}</Text>
              <Text style={styles.cardMeta}>{request.area}</Text>
            </View>
            <RequestBadge status={request.status} />
          </View>
          <Text style={styles.description}>{request.description}</Text>
          <View style={styles.between}>
            <Text style={styles.caption}>{request.quantity} personas ⋅ {formatDate(request.requiredDate)}</Text>
            {context.role === "Cliente" && request.status === "ABIERTA" && (
              <Pressable
                onPress={() =>
                  Alert.alert("Cancelar solicitud", "Esta acción solo aplica a solicitudes abiertas.", [
                    { text: "Volver", style: "cancel" },
                    {
                      text: "Cancelar solicitud",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await cancelPersonnelRequest(request.id);
                          await onCancelled();
                        } catch (cause) {
                          Alert.alert("No fue posible cancelar", errorMessage(cause));
                        }
                      },
                    },
                  ])
                }
              >
                <Text style={styles.destructiveLink}>Cancelar</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
    </Page>
  );
}

function NewRequest({
  context,
  data,
  onSaved,
}: {
  context: UserContext;
  data: AppData;
  onSaved: () => void;
}) {
  const client = context.clients[0];
  const areas = data.areas.filter((area) => area.clientId === client?.id);
  const [areaIndex, setAreaIndex] = useState(0);
  const [quantity, setQuantity] = useState("6");
  const [description, setDescription] = useState("Auxiliares con disponibilidad inmediata para apoyo operativo.");
  const [saving, setSaving] = useState(false);
  const area = areas[areaIndex];
  const requiredDate = addDaysIso(todayIso(), 2);

  const save = async () => {
    if (!client || !area || Number(quantity) <= 0 || !description.trim()) {
      Alert.alert("Completa la solicitud", "Todos los campos son obligatorios.");
      return;
    }
    setSaving(true);
    try {
      await createPersonnelRequest({
        clientId: client.id,
        areaId: area.id,
        quantity: Number(quantity),
        description: description.trim(),
        requiredDate,
        userId: context.id,
      });
      Alert.alert("Solicitud enviada", "El coordinador ya puede visualizarla.");
      await onSaved();
    } catch (cause) {
      Alert.alert("No fue posible enviar", errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <Notice icon="information-circle-outline" text="Tu coordinador recibirá la solicitud y podrá gestionar su atención." />
      <FormCard title="Datos del requerimiento">
        <Choice label="Empresa" value={client?.name ?? "Sin empresa"} icon="business-outline" disabled />
        <Choice label="Área *" value={area?.name ?? "Sin área"} icon="location-outline" onPress={() => setAreaIndex((value) => (value + 1) % Math.max(areas.length, 1))} />
        <Label text="Cantidad de personal *" />
        <Input icon="people-outline" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
        <Choice label="Fecha requerida" value={formatDate(requiredDate)} icon="calendar-outline" disabled />
        <Label text="Descripción del perfil *" />
        <TextInput value={description} onChangeText={setDescription} multiline style={styles.textArea} />
      </FormCard>
      <PrimaryButton label={saving ? "Enviando..." : "Enviar solicitud"} icon="send" disabled={saving} onPress={save} />
    </Page>
  );
}

function ClientStaff({
  contractors,
  onOpen,
}: {
  contractors: ClientContractor[];
  onOpen: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = contractors.filter((contractor) =>
    `${contractor.fullName} ${contractor.document}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Page>
      <View>
        <Text style={styles.eyebrow}>PERSONAL DE TU OPERACIÓN</Text>
        <Text style={styles.greeting}>Contratistas</Text>
        <Text style={styles.subtitle}>
          {contractors.length} contratistas con historial en tu empresa
        </Text>
      </View>
      <Input
        icon="search-outline"
        value={query}
        onChangeText={setQuery}
        placeholder="Nombre o cédula"
      />
      {visible.length === 0 ? (
        <EmptyState icon="people-outline" text="No encontramos contratistas relacionados con tu empresa." />
      ) : (
        visible.map((contractor) => (
          <Pressable key={contractor.id} style={styles.card} onPress={() => onOpen(contractor.id)}>
            <View style={styles.cardTop}>
              <Initials name={contractor.fullName} />
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{contractor.fullName}</Text>
                <Text style={styles.caption}>CC {contractor.document}</Text>
                <Text style={styles.cardMeta}>{contractor.lastArea}</Text>
                <Text style={styles.caption}>{formatDate(contractor.lastDate)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.muted} />
            </View>
          </Pressable>
        ))
      )}
    </Page>
  );
}

function CreateContractor({
  documentTypes,
  onSaved,
}: {
  documentTypes: AppData["documentTypes"];
  onSaved: (contractorId: number) => void;
}) {
  const [documentTypeId, setDocumentTypeId] = useState(documentTypes[0]?.id ?? 0);
  const [documentNumber, setDocumentNumber] = useState("");
  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [cedulaPdf, setCedulaPdf] = useState<ContractorPdfFile | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [birthDateCalendarOpen, setBirthDateCalendarOpen] = useState(false);
  const [cedulaSourceOpen, setCedulaSourceOpen] = useState(false);
  const [cedulaCaptureOpen, setCedulaCaptureOpen] = useState(false);
  const [pendingCedulaPick, setPendingCedulaPick] = useState(false);
  const [saving, setSaving] = useState(false);
  const pickingCedulaRef = useRef(false);

  useEffect(() => {
    if (!documentTypeId && documentTypes[0]) setDocumentTypeId(documentTypes[0].id);
  }, [documentTypeId, documentTypes]);

  const pickCedula = useCallback(async () => {
    if (pickingCedulaRef.current) return;
    pickingCedulaRef.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      if ((asset.size ?? 0) > 1_048_576) {
        Alert.alert("PDF demasiado grande", "La cédula debe pesar máximo 1 MB.");
        return;
      }
      const isPdf = asset.mimeType === "application/pdf" || asset.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        Alert.alert("Formato no válido", "Adjunta únicamente documentos PDF.");
        return;
      }
      setCedulaPdf({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      });
    } catch (cause) {
      Alert.alert("No fue posible adjuntar", errorMessage(cause));
    } finally {
      pickingCedulaRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!pendingCedulaPick || cedulaSourceOpen) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        setPendingCedulaPick(false);
        void pickCedula();
      }, 700);
    });
    return () => {
      task.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [cedulaSourceOpen, pendingCedulaPick, pickCedula]);

  const save = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!documentTypeId || !documentNumber.trim() || !name.trim() || !lastName.trim() || !birthDate || !phone.trim() || !normalizedEmail) {
      Alert.alert("Completa el contratista", "Todos los campos son obligatorios en esta fase.");
      return;
    }
    if (!emailValid) {
      Alert.alert("Correo no válido", "Verifica el formato del correo electrónico.");
      return;
    }
    if (!cedulaPdf) {
      Alert.alert("Adjunta la cédula", "La cédula en PDF es obligatoria para crear el contratista.");
      return;
    }
    setSaving(true);
    try {
      const contractorId = await createContractorDraft({
        documentTypeId,
        documentNumber,
        name,
        lastName,
        birthDate,
        phone,
        email: normalizedEmail,
        cedulaPdf,
      });
      Alert.alert("Contratista creado", "El contrato quedó PENDIENTE hasta que el Director adjunte el Certificado ARL.");
      await onSaved(contractorId);
    } catch (cause) {
      Alert.alert("No fue posible crear", errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <Notice
        icon="information-circle-outline"
        text="En esta fase solo se registran datos básicos y la cédula. El contrato quedará PENDIENTE."
      />
      <FormCard title="Datos básicos">
        <Choice
          label="Tipo de documento *"
          value={documentTypes.find((item) => item.id === documentTypeId)?.name ?? "Selecciona tipo"}
          icon="card-outline"
          disabled={documentTypes.length === 0}
          onPress={() => setSelectorOpen(true)}
        />
        <Label text="Documento *" />
        <Input icon="document-text-outline" value={documentNumber} onChangeText={setDocumentNumber} keyboardType="number-pad" />
        <Label text="Nombres *" />
        <Input icon="person-outline" value={name} onChangeText={setName} autoCapitalize="words" />
        <Label text="Apellidos *" />
        <Input icon="person-outline" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
        <Choice
          label="Fecha de nacimiento *"
          value={birthDate || "Selecciona fecha"}
          icon="calendar-outline"
          onPress={() => setBirthDateCalendarOpen(true)}
        />
        <Label text="Teléfono *" />
        <Input icon="call-outline" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Label text="Correo *" />
        <Input icon="mail-outline" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      </FormCard>
      <FormCard title="Documento obligatorio">
        <Pressable style={styles.uploadCard} onPress={() => setCedulaSourceOpen(true)}>
          <View style={styles.pdfIcon}>
            <Ionicons name="document-attach-outline" size={23} color={C.orange} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Cédula en PDF</Text>
            <Text style={styles.cardMeta}>
              {cedulaPdf
                ? cedulaPdf.name === "cedula-fotos.pdf"
                  ? "PDF generado desde fotos"
                  : cedulaPdf.name
                : "Cargar PDF o tomar foto"}
            </Text>
          </View>
          <Ionicons name="cloud-upload-outline" size={20} color={C.navy} />
        </Pressable>
      </FormCard>
      <PrimaryButton label={saving ? "Creando..." : "Guardar contratista"} icon="save-outline" disabled={saving} onPress={save} />
      <DropdownModal
        visible={selectorOpen}
        title="Tipo de documento"
        options={documentTypes}
        selectedId={documentTypeId}
        onClose={() => setSelectorOpen(false)}
        onSelect={(id) => {
          setDocumentTypeId(id);
          setSelectorOpen(false);
        }}
      />
      <CalendarModal
        visible={birthDateCalendarOpen}
        selectedDate={birthDate || null}
        defaultDate="1990-01-01"
        title="Fecha de nacimiento"
        subtitle="Selecciona la fecha de nacimiento del contratista."
        onClose={() => setBirthDateCalendarOpen(false)}
        onSelect={(date) => {
          setBirthDate(date);
          setBirthDateCalendarOpen(false);
        }}
      />
      <CedulaSourceModal
        visible={cedulaSourceOpen}
        onClose={() => setCedulaSourceOpen(false)}
        onPickPdf={() => {
          setPendingCedulaPick(true);
          setCedulaSourceOpen(false);
        }}
        onTakePhotos={() => {
          setCedulaSourceOpen(false);
          setCedulaCaptureOpen(true);
        }}
      />
      <CedulaCaptureFlow
        visible={cedulaCaptureOpen}
        onClose={() => setCedulaCaptureOpen(false)}
        onPdfReady={(file) => {
          setCedulaPdf(file);
          setCedulaCaptureOpen(false);
        }}
      />
    </Page>
  );
}

function CedulaSourceModal({
  visible,
  onClose,
  onPickPdf,
  onTakePhotos,
}: {
  visible: boolean;
  onClose: () => void;
  onPickPdf: () => void;
  onTakePhotos: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.between}>
            <View style={styles.flex}>
              <Text style={styles.formTitle}>Adjuntar cédula</Text>
              <Text style={styles.caption}>Elige cómo quieres crear el PDF obligatorio.</Text>
            </View>
            <Pressable style={styles.iconButton} onPress={onClose}>
              <Ionicons name="close" size={20} color={C.ink} />
            </Pressable>
          </View>
          <Pressable style={styles.sourceOption} onPress={onPickPdf}>
            <View style={styles.pdfIcon}>
              <Ionicons name="document-attach-outline" size={23} color={C.orange} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Cargar PDF</Text>
              <Text style={styles.cardMeta}>Selecciona un archivo PDF máximo 1 MB.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.muted} />
          </Pressable>
          <Pressable style={styles.sourceOption} onPress={onTakePhotos}>
            <View style={styles.pdfIcon}>
              <Ionicons name="camera-outline" size={23} color={C.orange} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Tomar foto</Text>
              <Text style={styles.cardMeta}>Captura frente y reverso para generar un PDF A4.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.muted} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function CedulaCaptureFlow({
  visible,
  onClose,
  onPdfReady,
}: {
  visible: boolean;
  onClose: () => void;
  onPdfReady: (file: ContractorPdfFile) => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [frontUri, setFrontUri] = useState("");
  const [backUri, setBackUri] = useState("");
  const [activeSide, setActiveSide] = useState<CedulaSide>("front");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (visible) {
      setFrontUri("");
      setBackUri("");
      setActiveSide("front");
      setCameraOpen(true);
      setGenerating(false);
    }
  }, [visible]);

  const ensurePermission = async () => {
    if (permission?.granted) return true;
    const result = await requestPermission();
    if (!result.granted) {
      Alert.alert("Permiso de cámara", "Necesitamos acceso a la cámara para tomar la foto de la cédula.");
      return false;
    }
    return true;
  };

  const openCamera = async (side: CedulaSide) => {
    if (!(await ensurePermission())) return;
    setActiveSide(side);
    setCameraOpen(true);
  };

  const takePhoto = async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.82,
        skipProcessing: false,
      });
      if (!photo?.uri) return;
      if (activeSide === "front") {
        setFrontUri(photo.uri);
        setActiveSide("back");
        setCameraOpen(true);
      } else {
        setBackUri(photo.uri);
        setCameraOpen(false);
      }
    } catch (cause) {
      Alert.alert("No fue posible tomar la foto", errorMessage(cause));
    }
  };

  const generatePdf = async () => {
    if (!frontUri || !backUri) {
      Alert.alert("Faltan fotos", "Toma la foto del frente y del reverso antes de generar el PDF.");
      return;
    }
    setGenerating(true);
    try {
      const file = await buildCedulaPdfFromPhotos(frontUri, backUri);
      onPdfReady(file);
    } catch (cause) {
      Alert.alert("No fue posible generar el PDF", errorMessage(cause));
    } finally {
      setGenerating(false);
    }
  };

  const activeLabel = activeSide === "front" ? "frente" : "reverso";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.cameraShell}>
        <View style={styles.cameraHeader}>
          <View style={styles.flex}>
            <Text style={styles.formTitle}>Foto de cédula</Text>
            <Text style={styles.caption}>Toma frente y reverso. Solo se guardará el PDF final.</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={onClose}>
            <Ionicons name="close" size={20} color={C.ink} />
          </Pressable>
        </View>
        {cameraOpen ? (
          <View style={styles.cameraStage}>
            {permission?.granted ? (
              <CameraView ref={cameraRef} style={styles.cameraView} facing="back" mode="picture" />
            ) : (
              <View style={styles.cameraPermission}>
                <Ionicons name="camera-outline" size={42} color={C.navy} />
                <Text style={styles.cardTitle}>Permiso de cámara requerido</Text>
                <Text style={styles.caption}>Autoriza la cámara para capturar la cédula.</Text>
                <PrimaryButton label="Permitir cámara" icon="camera-outline" onPress={ensurePermission} />
              </View>
            )}
            {permission?.granted ? (
              <View style={styles.cameraControls}>
                <Text style={styles.cameraInstruction}>Captura el {activeLabel} del documento</Text>
                <PrimaryButton label="Tomar foto" icon="camera" onPress={takePhoto} />
                <SecondaryButton label="Ver previsualización" icon="images-outline" onPress={() => setCameraOpen(false)} />
              </View>
            ) : null}
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.capturePreviewContent}>
            <Notice icon="document-text-outline" text="Previsualiza ambas imágenes antes de generar el PDF." />
            <CedulaPreviewSlot
              title="Frente del documento"
              uri={frontUri}
              onTake={() => openCamera("front")}
            />
            <CedulaPreviewSlot
              title="Reverso del documento"
              uri={backUri}
              onTake={() => openCamera("back")}
            />
            <PrimaryButton
              label={generating ? "Generando PDF..." : "Generar PDF de cédula"}
              icon="document-outline"
              disabled={generating || !frontUri || !backUri}
              onPress={generatePdf}
            />
            <SecondaryButton label="Cancelar" icon="close-outline" onPress={onClose} />
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function SelfieCaptureModal({
  visible,
  currentUri,
  onClose,
  onReady,
}: {
  visible: boolean;
  currentUri: string;
  onClose: () => void;
  onReady: (uri: string) => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [previewUri, setPreviewUri] = useState(currentUri);
  const [cameraOpen, setCameraOpen] = useState(!currentUri);

  useEffect(() => {
    if (visible) {
      setPreviewUri(currentUri);
      setCameraOpen(!currentUri);
    }
  }, [currentUri, visible]);

  const ensurePermission = async () => {
    if (permission?.granted) return true;
    const result = await requestPermission();
    if (!result.granted) {
      Alert.alert("Permiso de cámara", "Necesitamos acceso a la cámara para tomar tu foto de perfil.");
      return false;
    }
    return true;
  };

  const takePhoto = async () => {
    try {
      if (!(await ensurePermission())) return;
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.82,
        skipProcessing: false,
      });
      if (!photo?.uri) return;
      setPreviewUri(photo.uri);
      setCameraOpen(false);
    } catch (cause) {
      Alert.alert("No fue posible tomar la foto", errorMessage(cause));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.cameraShell}>
        <View style={styles.cameraHeader}>
          <View style={styles.flex}>
            <Text style={styles.formTitle}>Selfie de perfil</Text>
            <Text style={styles.caption}>Foto frontal, rostro centrado y buena iluminación.</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={onClose}>
            <Ionicons name="close" size={20} color={C.ink} />
          </Pressable>
        </View>
        {cameraOpen ? (
          <View style={styles.cameraStage}>
            {permission?.granted ? (
              <CameraView ref={cameraRef} style={styles.cameraView} facing="front" mode="picture" />
            ) : (
              <View style={styles.cameraPermission}>
                <Ionicons name="camera-outline" size={42} color={C.navy} />
                <Text style={styles.cardTitle}>Permiso de cámara requerido</Text>
                <Text style={styles.caption}>Autoriza la cámara para tomar la selfie.</Text>
                <PrimaryButton label="Permitir cámara" icon="camera-outline" onPress={ensurePermission} />
              </View>
            )}
            {permission?.granted ? (
              <View style={styles.cameraControls}>
                <Text style={styles.cameraInstruction}>Mira al frente y centra tu rostro</Text>
                <PrimaryButton label="Tomar foto" icon="camera" onPress={takePhoto} />
                {previewUri ? <SecondaryButton label="Ver previsualización" icon="image-outline" onPress={() => setCameraOpen(false)} /> : null}
              </View>
            ) : null}
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.capturePreviewContent}>
            <Notice icon="person-circle-outline" text="Revisa la foto antes de continuar. Puedes repetirla si quedó borrosa u oscura." />
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={styles.selfieLargePreview} resizeMode="cover" />
            ) : (
              <EmptyState icon="camera-outline" text="Aún no hay selfie." />
            )}
            <PrimaryButton label="Usar esta foto" icon="checkmark-circle-outline" disabled={!previewUri} onPress={() => previewUri && onReady(previewUri)} />
            <SecondaryButton label="Repetir foto" icon="camera-outline" onPress={() => setCameraOpen(true)} />
            <SecondaryButton label="Cancelar" icon="close-outline" onPress={onClose} />
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function CedulaPreviewSlot({ title, uri, onTake }: { title: string; uri: string; onTake: () => void }) {
  return (
    <View style={styles.previewCard}>
      <View style={styles.between}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.caption}>{uri ? "Foto lista para generar PDF." : "Foto pendiente."}</Text>
        </View>
        <SecondaryButton label={uri ? "Repetir" : "Tomar"} icon="camera-outline" onPress={onTake} />
      </View>
      {uri ? (
        <Image source={{ uri }} style={styles.cedulaPreviewImage} resizeMode="contain" />
      ) : (
        <View style={styles.emptyPreview}>
          <Ionicons name="image-outline" size={36} color={C.muted} />
          <Text style={styles.caption}>Aún no hay imagen</Text>
        </View>
      )}
    </View>
  );
}

function Staff({
  context,
  contractors,
  onOpen,
  onCreate,
}: {
  context: UserContext;
  contractors: Contractor[];
  onOpen: (id: number) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const pendingCount = contractors.filter((contractor) => contractor.contractStatus === "PENDIENTE").length;
  const visible = contractors.filter((contractor) =>
    `${contractor.fullName} ${contractor.document}`.toLowerCase().includes(query.toLowerCase()) &&
    (!pendingOnly || contractor.contractStatus === "PENDIENTE"),
  );
  return (
    <Page>
      <View style={styles.between}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>BASE DE TALENTO</Text>
          <Text style={styles.greeting}>Personal disponible</Text>
          <Text style={styles.subtitle}>{contractors.length} contratistas registrados</Text>
        </View>
        <Pressable style={styles.fab} onPress={onCreate}>
          <Ionicons name="add" color={C.white} size={26} />
        </Pressable>
      </View>
      {context.role === "Director" && pendingCount > 0 && (
        <Pressable style={styles.pendingContractorsCard} onPress={() => setPendingOnly((value) => !value)}>
          <Ionicons name="alert-circle-outline" size={22} color={C.orange} />
          <View style={styles.flex}>
            <Text style={styles.pendingContractorsTitle}>
              Hay {pendingCount} contratistas nuevos pendientes
            </Text>
            <Text style={styles.caption}>
              {pendingOnly ? "Mostrando pendientes. Toca para ver todos." : "Toca para revisarlos y adjuntar ARL."}
            </Text>
          </View>
          <Ionicons name={pendingOnly ? "close-circle-outline" : "chevron-forward"} size={19} color={C.orange} />
        </Pressable>
      )}
      <Input icon="search-outline" value={query} onChangeText={setQuery} placeholder="Nombre o documento" />
      {visible.length === 0 ? <EmptyState icon="people-outline" text="No encontramos contratistas." /> : visible.map((contractor) => (
        <Pressable key={contractor.id} style={styles.card} onPress={() => onOpen(contractor.id)}>
          <View style={styles.cardTop}>
            <Initials name={contractor.fullName} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{contractor.fullName}</Text>
              <Text style={styles.caption}>CC {contractor.document}</Text>
              <Text style={styles.cardMeta}>{contractor.lastClient} ⋅ {contractor.lastArea}</Text>
              <Text style={styles.caption}>{formatDate(contractor.lastDate)}</Text>
            </View>
            <ContractStatusPill status={contractor.contractStatus} />
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </View>
        </Pressable>
      ))}
    </Page>
  );
}

function ClientContractorProfile({
  contractor,
  onDocument,
  onHistory,
}: {
  contractor: ClientContractor;
  onDocument: (document: ContractorDocument) => void;
  onHistory: (history: ContractorHistory) => void;
}) {
  const [history, setHistory] = useState<ContractorHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadClientContractorHistory(contractor.id)
      .then(setHistory)
      .catch((cause) => Alert.alert("No fue posible cargar", errorMessage(cause)))
      .finally(() => setLoading(false));
  }, [contractor.id]);

  return (
    <Page>
      <LinearGradient colors={[C.navy, C.navy2]} style={styles.profileHero}>
        <View style={styles.profileInitials}>
          <Text style={styles.profileInitialsText}>{contractor.initials}</Text>
        </View>
        <Text style={styles.profileName}>{contractor.fullName}</Text>
        <Text style={styles.profileMeta}>CC {contractor.document}</Text>
      </LinearGradient>
      <InfoCard
        title="Información personal"
        rows={[
          ["Nombres", contractor.name],
          ["Apellidos", contractor.lastName],
          ["Cédula", contractor.document],
          ["Fecha de nacimiento", contractor.birthDate ?? "Sin registrar"],
          ["RH", contractor.rh ?? "Sin registrar"],
          ["Estado civil", contractor.civilState],
        ]}
      />
      <InfoCard title="Seguridad Social" rows={[
        ["EPS", contractor.eps ?? "Sin registrar"],
        ["ARL", contractor.arl ?? "Sin registrar"],
      ]} />
      <ContractorDocumentsSection contractorId={contractor.id} onOpen={onDocument} />
      <SectionTitle title="Historial de operaciones" action={`${history.length} registros`} />
      {loading ? (
        <ActivityIndicator color={C.navy} />
      ) : history.length === 0 ? (
        <EmptyState icon="calendar-outline" text="No hay historial para este contratista." />
      ) : (
        history.map((item) => (
          <Pressable key={item.assignmentId} style={styles.card} onPress={() => onHistory(item)}>
            <View style={styles.between}>
              <View>
                <Text style={styles.cardTitle}>{item.areaName}</Text>
                <Text style={styles.cardMeta}>{item.shiftName} ⋅ {formatDate(item.operationDate)}</Text>
                <Text style={styles.caption}>{item.attendanceStatus ?? "Sin dato"}</Text>
              </View>
              <Text style={styles.extra}>{item.extraHours} h extras</Text>
            </View>
          </Pressable>
        ))
      )}
    </Page>
  );
}

function ContractorProfile({
  context,
  contractor,
  terminationReasons,
  documentTypes,
  contractTypes,
  workwearTypes,
  onDocument,
  onChanged,
  onHistory,
}: {
  context: UserContext;
  contractor: Contractor;
  terminationReasons: AppData["terminationReasons"];
  documentTypes: ContractorDocumentTypeOption[];
  contractTypes: AppData["contractTypes"];
  workwearTypes: AppData["workwearTypes"];
  onDocument: (document: ContractorDocument) => void;
  onChanged: () => void;
  onHistory: (history: ContractorHistory) => void;
}) {
  const [history, setHistory] = useState<ContractorHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [terminationVisible, setTerminationVisible] = useState(false);
  useEffect(() => {
    loadContractorHistory(contractor.id)
      .then(setHistory)
      .catch((cause) => Alert.alert("No fue posible cargar", errorMessage(cause)))
      .finally(() => setLoading(false));
  }, [contractor.id]);
  return (
    <Page>
      <LinearGradient colors={[C.navy, C.navy2]} style={styles.profileHero}>
        <View style={styles.profileInitials}><Text style={styles.profileInitialsText}>{contractor.initials}</Text></View>
        <Text style={styles.profileName}>{contractor.fullName}</Text>
        <Text style={styles.profileMeta}>CC {contractor.document}</Text>
        <ContractStatusPill status={contractor.contractStatus} />
      </LinearGradient>
      <InfoCard title="Información personal" rows={[
        ["Nombres y apellidos", contractor.fullName],
        ["Fecha de nacimiento", contractor.birthDate ?? "Sin registrar"],
        ["RH", contractor.rh ?? "Sin registrar"],
        ["Estado civil", contractor.civilState],
      ]} />
      <InfoCard title="Seguridad Social" rows={[
        ["EPS", contractor.eps ?? "Sin registrar"],
        ["ARL", contractor.arl ?? "Sin registrar"],
      ]} />
      <InfoCard title="Información laboral" rows={[
        ["Fecha de contratación", formatDate(contractor.hireDate)],
        ["Terminación", contractor.terminationDate ? formatDate(contractor.terminationDate) : "Contrato vigente"],
        ["Disponibilidad", contractor.available ? "Disponible" : "No disponible"],
      ]} />
      <InfoCard title="Contacto y logística" rows={[
        ["Teléfono", contractor.phone ?? "Sin registrar"],
        ["Correo", contractor.email ?? "Sin registrar"],
        ["Ciudad", contractor.city],
        ["Transporte", contractor.transport],
      ]} />
      <ContractorWorkwearSection contractorId={contractor.id} workwearTypes={workwearTypes} />
      {context.role === "Director" && contractor.contractStatus === "PENDIENTE" && (
        <ContractorActivationDocumentsCard
          contractor={contractor}
          contractTypes={contractTypes}
          onChanged={onChanged}
        />
      )}
      {(context.role === "Director" || context.role === "Coordinador") && contractor.contractStatus !== "INACTIVO" && (
        <SecondaryButton
          label="Desvincular contratista"
          icon="person-remove-outline"
          destructive
          onPress={() => setTerminationVisible(true)}
        />
      )}
      <TerminateContractorModal
        visible={terminationVisible}
        contractor={contractor}
        reasons={terminationReasons}
        onClose={() => setTerminationVisible(false)}
        onTerminated={async () => {
          setTerminationVisible(false);
          await onChanged();
        }}
      />
      <ContractorDocumentsSection
        contractorId={contractor.id}
        onOpen={onDocument}
        uploadEnabled={
          (context.role === "Director" || context.role === "Coordinador") &&
          contractor.contractStatus !== "PENDIENTE"
        }
        documentTypes={documentTypes}
      />
      <SectionTitle title="Historial de operaciones" action={`${history.length} registros`} />
      {loading ? <ActivityIndicator color={C.navy} /> : history.length === 0 ? (
        <EmptyState icon="calendar-outline" text="No hay historial para este contratista." />
      ) : history.map((item) => (
        <Pressable key={item.assignmentId} style={styles.card} onPress={() => onHistory(item)}>
          <View style={styles.between}>
            <View>
              <Text style={styles.cardTitle}>{item.clientName}</Text>
              <Text style={styles.cardMeta}>{item.areaName} ⋅ {item.shiftName} ⋅ {formatDate(item.operationDate)}</Text>
            </View>
            <Text style={styles.extra}>{item.extraHours} h extras</Text>
          </View>
        </Pressable>
      ))}
    </Page>
  );
}

const workwearMovementOptions: { id: number; name: string; type: WorkwearMovementType }[] = [
  { id: 1, name: "Entrega", type: "ENTREGA" },
  { id: 2, name: "Devolución", type: "DEVOLUCION" },
  { id: 3, name: "Dada de baja", type: "BAJA" },
];

function workwearMovementLabel(type: WorkwearMovementType) {
  if (type === "DEVOLUCION") return "Devolución";
  if (type === "BAJA") return "Dada de baja";
  return "Entrega";
}

function workwearMovementSuccess(type: WorkwearMovementType) {
  if (type === "DEVOLUCION") return "Devolución registrada";
  if (type === "BAJA") return "Dotación dada de baja";
  return "Dotación entregada";
}

function ContractorWorkwearSection({
  contractorId,
  workwearTypes,
}: {
  contractorId: number;
  workwearTypes: AppData["workwearTypes"];
}) {
  const [summary, setSummary] = useState<WorkwearSummary[]>([]);
  const [movements, setMovements] = useState<WorkwearMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [registerVisible, setRegisterVisible] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const loadWorkwear = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryResult, movementResult] = await Promise.all([
        loadContractorWorkwearSummary(contractorId),
        loadContractorWorkwearMovements(contractorId),
      ]);
      setSummary(summaryResult);
      setMovements(movementResult);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [contractorId]);

  useEffect(() => {
    loadWorkwear();
  }, [loadWorkwear]);

  return (
    <View style={styles.documentsSection}>
      <View style={styles.historyHeader}>
        <Text style={styles.formTitle}>Dotación</Text>
        <Pressable style={styles.smallActionButton} onPress={() => setRegisterVisible(true)}>
          <Ionicons name="add-circle-outline" size={16} color={C.navy} />
          <Text style={styles.smallActionText}>Registrar dotación</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={C.navy} />
      ) : error ? (
        <Notice icon="alert-circle-outline" text={error} tone="error" />
      ) : (
        <>
          {summary.length === 0 ? (
            <EmptyState icon="shirt-outline" text="No hay movimientos de dotación para este contratista." />
          ) : (
            <View style={styles.workwearSummaryGrid}>
              {summary.map((item) => (
                <View key={item.workwearTypeId} style={styles.workwearSummaryCard}>
                  <Text style={styles.workwearSummaryTitle}>{item.workwearTypeName}</Text>
                  <Text style={styles.workwearSummaryValue}>{item.pendingQuantity}</Text>
                  <Text style={styles.caption}>Pendiente actual</Text>
                  <Text style={styles.workwearSummaryMeta}>
                    Entregado {item.deliveredQuantity} ⋅ Devuelto {item.returnedQuantity} ⋅ Baja {item.writtenOffQuantity}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.formCard}>
            <Pressable
              style={styles.historyHeader}
              onPress={() => setHistoryExpanded((current) => !current)}
            >
              <View>
                <Text style={styles.formTitle}>Historial de dotación</Text>
                <Text style={styles.caption}>{movements.length} registros</Text>
              </View>
              <Ionicons
                name={historyExpanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={C.navy}
              />
            </Pressable>
            {historyExpanded && (
              movements.length === 0 ? (
                <Text style={styles.caption}>Aún no hay historial registrado.</Text>
              ) : movements.map((movement) => (
                <View key={movement.id} style={styles.documentRow}>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>
                      {workwearMovementLabel(movement.movementType)} ⋅ {movement.workwearTypeName}
                    </Text>
                    <Text style={styles.caption}>
                      {formatDate(movement.movementDate)} ⋅ Cantidad {movement.quantity} ⋅ {movement.createdByName}
                    </Text>
                    <Text style={styles.cardMeta}>{movement.observations}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      )}

      <WorkwearMovementModal
        visible={registerVisible}
        workwearTypes={workwearTypes}
        summary={summary}
        onClose={() => setRegisterVisible(false)}
        onSaved={async (message) => {
          setRegisterVisible(false);
          await loadWorkwear();
          Alert.alert("Registro guardado", message);
        }}
        onRegister={async (input) => {
          await registerContractorWorkwearMovement({
            contractorId,
            ...input,
          });
        }}
      />
    </View>
  );
}

function WorkwearMovementModal({
  visible,
  workwearTypes,
  summary,
  onClose,
  onSaved,
  onRegister,
}: {
  visible: boolean;
  workwearTypes: AppData["workwearTypes"];
  summary: WorkwearSummary[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
  onRegister: (input: {
    workwearTypeId: number;
    movementType: WorkwearMovementType;
    movementDate: string;
    quantity: number;
    observations: string;
  }) => Promise<void>;
}) {
  const [movementType, setMovementType] = useState<WorkwearMovementType>("ENTREGA");
  const [workwearTypeId, setWorkwearTypeId] = useState(0);
  const [movementDate, setMovementDate] = useState(todayIso());
  const [quantity, setQuantity] = useState("1");
  const [observations, setObservations] = useState("");
  const [saving, setSaving] = useState(false);
  const [movementPickerVisible, setMovementPickerVisible] = useState(false);
  const [workwearPickerVisible, setWorkwearPickerVisible] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      setMovementType("ENTREGA");
      setWorkwearTypeId(workwearTypes[0]?.id ?? 0);
      setMovementDate(todayIso());
      setQuantity("1");
      setObservations("");
    }
  }, [visible, workwearTypes]);

  const selectedMovementId = workwearMovementOptions.find((option) => option.type === movementType)?.id ?? 1;
  const selectedWorkwear = workwearTypes.find((type) => type.id === workwearTypeId);
  const selectedSummary = summary.find((item) => item.workwearTypeId === workwearTypeId);
  const pendingQuantity = selectedSummary?.pendingQuantity ?? 0;
  const numericQuantity = Number(quantity);
  const baseVisible = visible && !movementPickerVisible && !workwearPickerVisible && !calendarVisible;

  async function saveMovement() {
    const trimmedObservation = observations.trim();
    if (!workwearTypeId) {
      Alert.alert("Falta información", "Selecciona el tipo de dotación.");
      return;
    }
    if (!Number.isInteger(numericQuantity) || numericQuantity <= 0) {
      Alert.alert("Cantidad no válida", "La cantidad debe ser un número entero mayor a cero.");
      return;
    }
    if ((movementType === "DEVOLUCION" || movementType === "BAJA") && numericQuantity > pendingQuantity) {
      Alert.alert("Saldo insuficiente", "La cantidad supera el saldo pendiente de dotación.");
      return;
    }
    if (!trimmedObservation) {
      Alert.alert("Falta observación", "Escribe una observación para registrar el movimiento.");
      return;
    }
    setSaving(true);
    try {
      await onRegister({
        workwearTypeId,
        movementType,
        movementDate,
        quantity: numericQuantity,
        observations: trimmedObservation,
      });
      await onSaved(workwearMovementSuccess(movementType));
    } catch (cause) {
      Alert.alert("No fue posible guardar", errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal visible={baseVisible} transparent animationType="fade" onRequestClose={onClose}>
        <KeyboardAvoidingView
          style={styles.modalKeyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.modalBackdrop}>
              <View style={styles.workwearModalCard}>
                <ScrollView
                  contentContainerStyle={styles.workwearModalContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
            <View style={styles.historyHeader}>
              <Text style={styles.formTitle}>Registrar dotación</Text>
              <Pressable style={styles.iconButton} onPress={onClose}>
                <Ionicons name="close" size={20} color={C.ink} />
              </Pressable>
            </View>
            <Choice
              label="Tipo de movimiento *"
              icon="swap-horizontal-outline"
              value={workwearMovementLabel(movementType)}
              onPress={() => setMovementPickerVisible(true)}
            />
            <Choice
              label="Tipo de dotación *"
              icon="shirt-outline"
              value={selectedWorkwear?.name ?? "Selecciona dotación"}
              onPress={() => setWorkwearPickerVisible(true)}
            />
            {(movementType === "DEVOLUCION" || movementType === "BAJA") && (
              <Notice
                icon="information-circle-outline"
                text={`Saldo pendiente para ${selectedWorkwear?.name ?? "este tipo"}: ${pendingQuantity}`}
              />
            )}
            <Choice
              label="Fecha *"
              icon="calendar-outline"
              value={movementDate}
              onPress={() => setCalendarVisible(true)}
            />
            <Label text="Cantidad *" />
            <Input
              icon="layers-outline"
              value={quantity}
              onChangeText={(value) => setQuantity(value.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              placeholder="Cantidad"
            />
            <Label text="Observación *" />
            <TextInput
              value={observations}
              onChangeText={setObservations}
              multiline
              style={[styles.textArea, styles.workwearTextArea]}
              placeholder="Describe la entrega, devolución o baja"
              placeholderTextColor="#929BAD"
            />
            <View style={styles.actionRow}>
              <Pressable style={styles.secondaryButton} onPress={onClose} disabled={saving}>
                <Ionicons name="close" size={19} color={C.navy} />
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable style={[styles.primaryButton, styles.flex, saving && styles.buttonDisabled]} onPress={saveMovement} disabled={saving}>
                {saving ? <ActivityIndicator color={C.white} /> : <Ionicons name="save-outline" size={19} color={C.white} />}
                <Text style={styles.primaryButtonText}>Guardar</Text>
              </Pressable>
            </View>
                </ScrollView>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
      <DropdownModal
        visible={movementPickerVisible}
        title="Tipo de movimiento"
        options={workwearMovementOptions}
        selectedId={selectedMovementId}
        onClose={() => setMovementPickerVisible(false)}
        onSelect={(id) => {
          setMovementType(workwearMovementOptions.find((option) => option.id === id)?.type ?? "ENTREGA");
          setMovementPickerVisible(false);
        }}
      />
      <DropdownModal
        visible={workwearPickerVisible}
        title="Tipo de dotación"
        options={workwearTypes}
        selectedId={workwearTypeId}
        onClose={() => setWorkwearPickerVisible(false)}
        onSelect={(id) => {
          setWorkwearTypeId(id);
          setWorkwearPickerVisible(false);
        }}
      />
      <CalendarModal
        visible={calendarVisible}
        title="Fecha del movimiento"
        selectedDate={movementDate}
        onClose={() => setCalendarVisible(false)}
        onSelect={(date) => {
          setMovementDate(date);
          setCalendarVisible(false);
        }}
      />
    </>
  );
}

function ContractorDocumentsSection({
  contractorId,
  onOpen,
  uploadEnabled = false,
  documentTypes = [],
}: {
  contractorId: number;
  onOpen: (document: ContractorDocument) => void;
  uploadEnabled?: boolean;
  documentTypes?: ContractorDocumentTypeOption[];
}) {
  const [documents, setDocuments] = useState<ContractorDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadVisible, setUploadVisible] = useState(false);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDocuments(await loadContractorDocuments(contractorId));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [contractorId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  return (
    <View style={styles.documentsSection}>
      <View style={styles.historyHeader}>
        <SectionTitle title="Documentos" action={`${documents.length} archivos`} />
        {uploadEnabled && (
          <Pressable style={styles.smallActionButton} onPress={() => setUploadVisible(true)}>
            <Ionicons name="cloud-upload-outline" size={16} color={C.navy} />
            <Text style={styles.smallActionText}>Subir documento</Text>
          </Pressable>
        )}
      </View>
      {loading ? (
        <ActivityIndicator color={C.navy} />
      ) : error ? (
        <View style={styles.documentError}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryLink} onPress={loadDocuments}>
            <Ionicons name="refresh" size={16} color={C.navy} />
            <Text style={styles.link}>Reintentar</Text>
          </Pressable>
        </View>
      ) : documents.length === 0 ? (
        <EmptyState icon="document-outline" text="No hay documentos disponibles." />
      ) : (
        documents.map((document) => (
          <Pressable
            key={document.id}
            style={styles.documentRow}
            onPress={() => onOpen(document)}
          >
            <View style={styles.pdfIcon}>
              <Ionicons name="document-text" size={23} color={C.orange} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{document.typeName}</Text>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {document.originalName}
              </Text>
              <Text style={styles.caption}>
                Actualizado {formatDate(document.updatedAt)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        ))
      )}
      <ContractorDocumentUploadModal
        visible={uploadVisible}
        contractorId={contractorId}
        documentTypes={documentTypes}
        onClose={() => setUploadVisible(false)}
        onUploaded={async () => {
          setUploadVisible(false);
          await loadDocuments();
        }}
      />
    </View>
  );
}

function ContractorActivationCard({
  contractorId,
  onChanged,
}: {
  contractorId: number;
  onChanged: () => void;
}) {
  const [arlPdf, setArlPdf] = useState<ContractorPdfFile | null>(null);
  const [saving, setSaving] = useState(false);

  const pickArl = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      if ((asset.size ?? 0) > 1_048_576) {
        Alert.alert("PDF demasiado grande", "El Certificado ARL debe pesar máximo 1 MB.");
        return;
      }
      const isPdf = asset.mimeType === "application/pdf" || asset.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        Alert.alert("Formato no válido", "Adjunta únicamente documentos PDF.");
        return;
      }
      setArlPdf({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      });
    } catch (cause) {
      Alert.alert("No fue posible adjuntar", errorMessage(cause));
    }
  };

  const save = async () => {
    if (!arlPdf) {
      Alert.alert("Adjunta el ARL", "El Certificado ARL en PDF es obligatorio para activar el contrato.");
      return;
    }
    setSaving(true);
    try {
      await uploadContractorActivationDocument(contractorId, "CERTIFICADO_ARL", arlPdf);
      Alert.alert("Contrato activado", "El contratista ya quedó disponible para operaciones.");
      await onChanged();
    } catch (cause) {
      Alert.alert("No fue posible activar", errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.activationCard}>
      <View style={styles.row}>
        <Ionicons name="shield-checkmark-outline" size={22} color={C.orange} />
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Activación pendiente</Text>
          <Text style={styles.caption}>Adjunta el Certificado ARL en PDF para pasar el contrato a ACTIVO.</Text>
        </View>
      </View>
      <Pressable style={styles.uploadCard} onPress={pickArl}>
        <View style={styles.pdfIcon}>
          <Ionicons name="document-attach-outline" size={23} color={C.orange} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Certificado ARL</Text>
          <Text style={styles.cardMeta}>
            {arlPdf ? arlPdf.name : "Adjuntar archivo PDF máximo 1 MB"}
          </Text>
        </View>
        <Ionicons name="cloud-upload-outline" size={20} color={C.navy} />
      </Pressable>
      <PrimaryButton label={saving ? "Activando..." : "Guardar ARL y activar"} icon="checkmark-circle-outline" disabled={saving} onPress={save} />
    </View>
  );
}

function ContractorDocumentUploadModal({
  visible,
  contractorId,
  documentTypes,
  onClose,
  onUploaded,
}: {
  visible: boolean;
  contractorId: number;
  documentTypes: ContractorDocumentTypeOption[];
  onClose: () => void;
  onUploaded: () => void | Promise<void>;
}) {
  const [documentTypeCode, setDocumentTypeCode] = useState("");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<ContractorPdfFile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setDocumentTypeCode(documentTypes[0]?.code ?? "");
      setSelectedFile(null);
      setSaving(false);
    }
  }, [documentTypes, visible]);

  const selectedType = documentTypes.find((type) => type.code === documentTypeCode) ?? null;

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      if ((asset.size ?? 0) > 1_048_576) {
        Alert.alert("PDF demasiado grande", "El documento debe pesar máximo 1 MB.");
        return;
      }
      const isPdf = asset.mimeType === "application/pdf" || asset.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        Alert.alert("Formato no válido", "Adjunta únicamente documentos PDF.");
        return;
      }
      setSelectedFile({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      });
    } catch (cause) {
      Alert.alert("No fue posible adjuntar", errorMessage(cause));
    }
  };

  const save = async () => {
    if (!selectedType) {
      Alert.alert("Selecciona el tipo", "Debes seleccionar el tipo de documento.");
      return;
    }
    if (!selectedFile) {
      Alert.alert("Adjunta el PDF", "Debes adjuntar un documento PDF para guardar.");
      return;
    }
    setSaving(true);
    try {
      await uploadContractorDocument(contractorId, selectedType.code, selectedFile);
      Alert.alert("Documento guardado", "Se guardó el nuevo documento y se mostrará como el último de su tipo.");
      await onUploaded();
    } catch (cause) {
      Alert.alert("No fue posible guardar", errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal visible={visible && !selectorOpen} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.between}>
              <View style={styles.flex}>
                <Text style={styles.formTitle}>Subir documento</Text>
                <Text style={styles.caption}>El histórico se conserva; se mostrará el último documento por tipo.</Text>
              </View>
              <Pressable style={styles.iconButton} onPress={onClose}>
                <Ionicons name="close" size={20} color={C.ink} />
              </Pressable>
            </View>
            <Choice
              label="Tipo de documento *"
              value={selectedType?.name ?? "Selecciona tipo"}
              icon="document-text-outline"
              disabled={documentTypes.length === 0}
              onPress={() => setSelectorOpen(true)}
            />
            <Pressable style={styles.uploadCard} onPress={pickDocument}>
              <View style={styles.pdfIcon}>
                <Ionicons name="document-attach-outline" size={23} color={C.orange} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>Documento en PDF</Text>
                <Text style={styles.cardMeta}>{selectedFile ? selectedFile.name : "Adjuntar archivo PDF máximo 1 MB"}</Text>
              </View>
              <Ionicons name="cloud-upload-outline" size={20} color={C.navy} />
            </Pressable>
            <View style={styles.actionRow}>
              <SecondaryButton label="Cancelar" icon="close-outline" onPress={onClose} />
              <PrimaryButton
                label={saving ? "Guardando..." : "Guardar"}
                icon="save-outline"
                disabled={saving}
                onPress={save}
              />
            </View>
          </View>
        </View>
      </Modal>
      <DropdownModal
        visible={selectorOpen}
        title="Tipo de documento"
        options={documentTypes}
        selectedId={selectedType?.id ?? 0}
        onClose={() => setSelectorOpen(false)}
        onSelect={(id) => {
          setDocumentTypeCode(documentTypes.find((type) => type.id === id)?.code ?? "");
          setSelectorOpen(false);
        }}
      />
    </>
  );
}

function TerminateContractorModal({
  visible,
  contractor,
  reasons,
  onClose,
  onTerminated,
}: {
  visible: boolean;
  contractor: Contractor;
  reasons: AppData["terminationReasons"];
  onClose: () => void;
  onTerminated: () => Promise<void>;
}) {
  const [terminationDate, setTerminationDate] = useState(todayIso());
  const [reasonId, setReasonId] = useState(0);
  const [observations, setObservations] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const showBaseModal = visible && !calendarOpen && !reasonOpen;

  useEffect(() => {
    if (visible) {
      setTerminationDate(todayIso());
      setReasonId(0);
      setObservations("");
    }
  }, [visible]);

  const selectedReason = reasons.find((reason) => reason.id === reasonId);

  const confirmTermination = async () => {
    if (!terminationDate || !reasonId || !observations.trim()) {
      Alert.alert("Completa la desvinculación", "La fecha, la causa y la observación son obligatorias.");
      return;
    }

    Alert.alert(
      "Confirmar desvinculación",
      `¿Deseas desvincular a ${contractor.fullName} y cancelar su contrato actual?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Desvincular",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            try {
              await terminateContractor({
                contractorId: contractor.id,
                terminationDate,
                reasonId,
                observations,
              });
              Alert.alert("Contratista desvinculado", "El contrato quedó en estado INACTIVO.");
              await onTerminated();
            } catch (cause) {
              Alert.alert("No fue posible desvincular", errorMessage(cause));
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  return (
    <>
      <Modal visible={showBaseModal} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.terminationCard}>
            <ScrollView
              contentContainerStyle={styles.terminationContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.between}>
                <View style={styles.flex}>
                  <Text style={styles.formTitle}>Desvincular contratista</Text>
                  <Text style={styles.terminationName}>{contractor.fullName}</Text>
                </View>
                <Pressable style={styles.iconButton} onPress={onClose}>
                  <Ionicons name="close" size={20} color={C.ink} />
                </Pressable>
              </View>
              <Choice
                label="Fecha de desvinculación *"
                value={terminationDate}
                icon="calendar-outline"
                onPress={() => setCalendarOpen(true)}
              />
              <Choice
                label="Causa de desvinculación *"
                value={selectedReason?.name ?? "Selecciona una causa"}
                icon="list-outline"
                disabled={reasons.length === 0}
                onPress={() => setReasonOpen(true)}
              />
              <Label text="Observación *" />
              <TextInput
                value={observations}
                onChangeText={setObservations}
                multiline
                placeholder="Describe la causa de la desvinculación"
                placeholderTextColor="#929BAD"
                style={[styles.textArea, styles.terminationTextArea]}
              />
              <View style={styles.terminationActions}>
                <View style={styles.flex}>
                  <SecondaryButton label="Cancelar" icon="close-outline" onPress={onClose} />
                </View>
                <View style={styles.flex}>
                  <PrimaryButton
                    label={saving ? "Desvinculando..." : "Confirmar"}
                    icon="person-remove-outline"
                    disabled={saving}
                    onPress={confirmTermination}
                  />
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <CalendarModal
        visible={calendarOpen}
        selectedDate={terminationDate}
        title="Fecha de desvinculación"
        subtitle="Selecciona la fecha de finalización del contrato."
        onClose={() => setCalendarOpen(false)}
        onSelect={(date) => {
          setTerminationDate(date);
          setCalendarOpen(false);
        }}
      />
      <DropdownModal
        visible={reasonOpen}
        title="Causa de desvinculación"
        options={reasons}
        selectedId={reasonId}
        onClose={() => setReasonOpen(false)}
        onSelect={(id) => {
          setReasonId(id);
          setReasonOpen(false);
        }}
      />
    </>
  );
}

const activationDocumentOptions: { typeCode: ContractorActivationDocumentType; title: string }[] = [
  { typeCode: "CERTIFICADO_ARL", title: "Certificado ARL" },
  { typeCode: "ANTECEDENTES_POLICIA", title: "Antecedentes Policía" },
  { typeCode: "ANTECEDENTES_PROCURADURIA", title: "Antecedentes Procuraduría" },
];

function ContractorActivationDocumentsCard({
  contractor,
  contractTypes,
  onChanged,
}: {
  contractor: Contractor;
  contractTypes: AppData["contractTypes"];
  onChanged: () => void;
}) {
  const [selectedFiles, setSelectedFiles] = useState<Partial<Record<ContractorActivationDocumentType, ContractorPdfFile>>>({});
  const [existingCodes, setExistingCodes] = useState<ContractorActivationDocumentType[]>([]);
  const [contractTypeId, setContractTypeId] = useState(contractor.contractTypeId ?? contractTypes[0]?.id ?? 0);
  const [contractTypePickerVisible, setContractTypePickerVisible] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [saving, setSaving] = useState(false);
  const selectedContractType = contractTypes.find((type) => type.id === contractTypeId);
  const contractTypeChanged = Boolean(contractTypeId && contractTypeId !== contractor.contractTypeId);

  const refreshDocuments = useCallback(async () => {
    setLoadingDocuments(true);
    try {
      const documents = await loadContractorDocuments(contractor.id);
      setExistingCodes(
        activationDocumentOptions
          .map((item) => item.typeCode)
          .filter((code) => documents.some((document) => document.typeCode === code)),
      );
    } catch (cause) {
      Alert.alert("No fue posible cargar documentos", errorMessage(cause));
    } finally {
      setLoadingDocuments(false);
    }
  }, [contractor.id]);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    setContractTypeId(contractor.contractTypeId ?? contractTypes[0]?.id ?? 0);
  }, [contractTypes, contractor.contractTypeId, contractor.id]);

  const pickDocument = async (typeCode: ContractorActivationDocumentType, title: string) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      if ((asset.size ?? 0) > 1_048_576) {
        Alert.alert("PDF demasiado grande", `${title} debe pesar máximo 1 MB.`);
        return;
      }
      const isPdf = asset.mimeType === "application/pdf" || asset.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        Alert.alert("Formato no válido", "Adjunta únicamente documentos PDF.");
        return;
      }
      setSelectedFiles((current) => ({
        ...current,
        [typeCode]: {
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType,
          size: asset.size,
        },
      }));
    } catch (cause) {
      Alert.alert("No fue posible adjuntar", errorMessage(cause));
    }
  };

  const save = async () => {
    const pendingUploads = activationDocumentOptions.filter((item) => selectedFiles[item.typeCode]);
    if (!contractTypeId) {
      Alert.alert("Selecciona el tipo", "Debes seleccionar el tipo de contrato del contratista.");
      return;
    }
    if (pendingUploads.length === 0 && !contractTypeChanged) {
      Alert.alert("Sin cambios", "Selecciona un tipo de contrato diferente o adjunta al menos un documento en PDF.");
      return;
    }
    setSaving(true);
    try {
      let activatedByContractType = false;
      if (contractTypeChanged) {
        activatedByContractType = await selectContractorContractType(contractor.id, contractTypeId);
      }
      for (const item of pendingUploads) {
        const file = selectedFiles[item.typeCode];
        if (file) {
          await uploadContractorActivationDocument(contractor.id, item.typeCode, file);
        }
      }
      setSelectedFiles({});
      const documents = await loadContractorDocuments(contractor.id);
      const completed = activationDocumentOptions.every((item) =>
        documents.some((document) => document.typeCode === item.typeCode),
      );
      let onboardingMessage = "";
      if (completed || activatedByContractType) {
        try {
          const email = await sendContractorOnboardingEmail(contractor.id);
          onboardingMessage = email
            ? ` Se envió el formulario de datos a ${email}.`
            : " Se envió el formulario de datos al correo registrado.";
        } catch (cause) {
          onboardingMessage = ` No fue posible enviar el formulario por correo: ${errorMessage(cause)}`;
        }
      }
      setExistingCodes(
        activationDocumentOptions
          .map((item) => item.typeCode)
          .filter((code) => documents.some((document) => document.typeCode === code)),
      );
      Alert.alert(
        completed || activatedByContractType ? "Contrato activado" : "Documentos guardados",
        completed || activatedByContractType
          ? `El contratista ya quedó disponible para operaciones.${onboardingMessage}`
          : pendingUploads.length === 0
            ? "Tipo de contrato guardado. Aún faltan documentos para activar."
            : "Tipo de contrato y documentos guardados. Aún faltan documentos para activar.",
      );
      await onChanged();
    } catch (cause) {
      Alert.alert("No fue posible guardar", errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <View style={styles.activationCard}>
      <View style={styles.row}>
        <Ionicons name="shield-checkmark-outline" size={22} color={C.orange} />
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Activación pendiente</Text>
          <Text style={styles.caption}>El contratista se activará solo cuando estén los tres documentos.</Text>
        </View>
      </View>
      <Choice
        label="Tipo de contrato *"
        value={selectedContractType?.name ?? "Selecciona tipo de contrato"}
        icon="briefcase-outline"
        disabled={contractTypes.length === 0}
        onPress={() => setContractTypePickerVisible(true)}
      />
      {loadingDocuments ? (
        <ActivityIndicator color={C.navy} />
      ) : (
        activationDocumentOptions.map((item) => {
          const selectedFile = selectedFiles[item.typeCode];
          const saved = existingCodes.includes(item.typeCode);
          return (
            <Pressable
              key={item.typeCode}
              style={styles.uploadCard}
              onPress={() => pickDocument(item.typeCode, item.title)}
            >
              <View style={styles.pdfIcon}>
                <Ionicons
                  name={saved ? "checkmark-circle-outline" : "document-attach-outline"}
                  size={23}
                  color={saved ? C.green : C.orange}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardMeta}>
                  {selectedFile ? selectedFile.name : saved ? "Guardado. Puedes adjuntar otro PDF." : "Adjuntar archivo PDF máximo 1 MB"}
                </Text>
              </View>
              <Ionicons name="cloud-upload-outline" size={20} color={C.navy} />
            </Pressable>
          );
        })
      )}
      <PrimaryButton
        label={saving ? "Guardando..." : "Guardar activación"}
        icon="checkmark-circle-outline"
        disabled={saving || loadingDocuments || contractTypes.length === 0}
        onPress={save}
      />
    </View>
    <DropdownModal
      visible={contractTypePickerVisible}
      title="Tipo de contrato"
      options={contractTypes}
      selectedId={contractTypeId}
      onClose={() => setContractTypePickerVisible(false)}
      onSelect={(id) => {
        setContractTypeId(id);
        setContractTypePickerVisible(false);
      }}
    />
    </>
  );
}

function DocumentPreview({ document }: { document: ContractorDocument }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSignedUrl = useCallback(async () => {
    setLoading(true);
    setError("");
    setUrl("");
    try {
      setUrl(await createContractorDocumentSignedUrl(document));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [document]);

  useEffect(() => {
    void loadSignedUrl();
  }, [loadSignedUrl]);

  return (
    <View style={styles.documentPreview}>
      <View style={styles.documentPreviewHeader}>
        <View style={styles.pdfIcon}>
          <Ionicons name="document-text" size={23} color={C.orange} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{document.typeName}</Text>
          <Text style={styles.caption} numberOfLines={1}>
            {document.originalName}
          </Text>
        </View>
      </View>
      {loading ? (
        <View style={styles.documentPreviewState}>
          <ActivityIndicator size="large" color={C.navy} />
          <Text style={styles.subtitle}>Preparando vista previa segura...</Text>
        </View>
      ) : error ? (
        <View style={styles.documentPreviewState}>
          <Ionicons name="alert-circle-outline" size={42} color={C.red} />
          <Text style={styles.errorTitle}>No pudimos abrir el documento</Text>
          <Text style={styles.subtitle}>{error}</Text>
          <View style={styles.previewRetryButton}>
            <PrimaryButton label="Reintentar" icon="refresh" onPress={loadSignedUrl} />
          </View>
        </View>
      ) : (
        <PdfViewer
          uri={url}
          onError={(message) => {
            setUrl("");
            setError(message);
          }}
        />
      )}
    </View>
  );
}

function HistoryDetail({ history }: { history: ContractorHistory }) {
  return (
    <Page>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>TURNO REGISTRADO</Text>
        <Text style={styles.detailTitle}>{history.clientName}</Text>
        <Text style={styles.subtitle}>{history.areaName} ⋅ {history.shiftName} ⋅ {formatDate(history.operationDate)}</Text>
        <View style={styles.summaryRow}>
          <MiniStat label="Asistencia" value={history.attendanceStatus ?? "Sin dato"} />
          <MiniStat label="Extras" value={`${history.extraHours} h`} />
        </View>
      </View>
      <SectionTitle title="Observaciones" />
      <Notice icon="chatbubble-ellipses-outline" text={history.observations || "Sin observaciones."} />
    </Page>
  );
}

function ClientHistoryDetail({ history }: { history: ContractorHistory }) {
  return (
    <Page>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>TURNO REGISTRADO</Text>
        <Text style={styles.detailTitle}>{history.areaName}</Text>
        <Text style={styles.subtitle}>{history.shiftName} ⋅ {formatDate(history.operationDate)}</Text>
        <View style={styles.summaryRow}>
          <MiniStat label="Asistencia" value={history.attendanceStatus ?? "Sin dato"} />
          <MiniStat label="Extras" value={`${history.extraHours} h`} />
        </View>
      </View>
    </Page>
  );
}

function Statistics({ context, data }: { context: UserContext; data: AppData }) {
  const defaultMonth = monthStartIso(todayIso());
  const fixedClientId = context.role === "Cliente" ? context.clients[0]?.id ?? 0 : 0;
  const [month, setMonth] = useState(defaultMonth);
  const [clientId, setClientId] = useState(fixedClientId);
  const [contractorId, setContractorId] = useState(0);
  const [openFilter, setOpenFilter] = useState<"month" | "client" | "contractor" | null>(null);
  const [summary, setSummary] = useState<StatisticsSummary | null>(null);
  const [contractorOptions, setContractorOptions] = useState<StatisticsSummary["contractorOptions"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clientOptions = context.role === "Director" ? data.clients : context.clients;
  const selectedClientName =
    clientId === 0
      ? "Todas las empresas"
      : clientOptions.find((client) => client.id === clientId)?.name ?? "Todas las empresas";
  const selectedContractorName =
    contractorId === 0
      ? "Todos los contratistas"
      : contractorOptions.find((contractor) => contractor.id === contractorId)?.name ?? "Todos los contratistas";

  const refreshStatistics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResult, optionsResult] = await Promise.all([
        loadStatisticsSummary({
          month,
          clientId: clientId || null,
          contractorId: contractorId || null,
        }),
        loadStatisticsSummary({
          month,
          clientId: clientId || null,
          contractorId: null,
        }),
      ]);
      setSummary(summaryResult);
      setContractorOptions(optionsResult.contractorOptions);
    } catch (cause) {
      setError(errorMessage(cause));
      setSummary(null);
      setContractorOptions([]);
    } finally {
      setLoading(false);
    }
  }, [clientId, contractorId, month]);

  useEffect(() => {
    refreshStatistics();
  }, [refreshStatistics]);

  const hasData = summary
    ? summary.saleTotal > 0 ||
      summary.costTotal > 0 ||
      summary.contractorsWorked > 0 ||
      summary.activeContractors > 0 ||
      summary.assignedOperations > 0 ||
      summary.workedShifts > 0 ||
      summary.extraHours > 0
    : false;

  const selectMonth = (date: string) => {
    setMonth(monthStartIso(date));
    setContractorId(0);
    setOpenFilter(null);
  };

  return (
    <Page>
      <View>
        <Text style={styles.eyebrow}>ESTADÍSTICAS</Text>
        <Text style={styles.greeting}>
          {context.role === "Director" ? "Resultados financieros" : "Resultados operativos"}
        </Text>
        <Text style={styles.subtitle}>
          {context.role === "Director"
            ? "Venta y costos de operaciones cerradas."
            : "Operaciones, turnos, extras y contratistas visibles según tu perfil."}
        </Text>
      </View>
      <FormCard title="Filtros">
        <Choice
          label="Mes"
          value={formatMonth(month)}
          icon="calendar-outline"
          onPress={() => setOpenFilter("month")}
        />
        {context.role !== "Cliente" && (
          <Choice
            label="Empresa"
            value={selectedClientName}
            icon="business-outline"
            onPress={() => setOpenFilter("client")}
          />
        )}
        <Choice
          label="Contratista"
          value={selectedContractorName}
          icon="person-outline"
          disabled={contractorOptions.length === 0}
          onPress={() => setOpenFilter("contractor")}
        />
      </FormCard>
      {loading ? (
        <View style={styles.centerCard}><ActivityIndicator color={C.navy} /></View>
      ) : error ? (
        <Notice icon="cloud-offline-outline" tone="error" text={error} />
      ) : !summary || !hasData ? (
        <EmptyState icon="bar-chart-outline" text="No hay estadísticas para los filtros seleccionados." />
      ) : (
        <>
          <View style={styles.statsGrid}>
            {context.role === "Director" ? (
              <>
                <Stat value={formatCurrency(summary.saleTotal)} label="Venta" icon="cash-outline" />
                <Stat value={formatCurrency(summary.costTotal)} label="Costos" icon="receipt-outline" />
                <Stat value={String(summary.contractorsWorked)} label="Contratistas" icon="people" />
              </>
            ) : (
              <>
                <Stat value={String(summary.contractorsWorked)} label="Contratistas" icon="people" />
                <Stat value={String(summary.assignedOperations)} label="Operaciones" icon="briefcase-outline" />
                <Stat value={String(summary.workedShifts)} label="Turnos trabajados" icon="checkmark-circle-outline" />
                <Stat value={`${summary.extraHours} h`} label="Horas extra" icon="time-outline" />
                {context.role === "Coordinador" && (
                  <Stat value={String(summary.activeContractors)} label="Contratistas activos" icon="shield-checkmark-outline" />
                )}
              </>
            )}
          </View>
          <Notice
            icon="bulb-outline"
            text={
              context.role === "Director"
                ? `La venta y los costos corresponden a operaciones cerradas de ${formatMonth(month)}.`
                : `Las métricas corresponden a operaciones visibles de ${formatMonth(month)}.`
            }
          />
        </>
      )}
      <CalendarModal
        visible={openFilter === "month"}
        selectedDate={month}
        title="Seleccionar mes"
        subtitle="Elige cualquier día del mes que quieres visualizar."
        onClose={() => setOpenFilter(null)}
        onSelect={selectMonth}
      />
      <DropdownModal
        visible={openFilter === "client"}
        title="Seleccionar empresa"
        options={[{ id: 0, name: "Todas las empresas" }, ...clientOptions]}
        selectedId={clientId}
        onClose={() => setOpenFilter(null)}
        onSelect={(id) => {
          setClientId(id);
          setContractorId(0);
          setOpenFilter(null);
        }}
      />
      <DropdownModal
        visible={openFilter === "contractor"}
        title="Seleccionar contratista"
        options={[
          { id: 0, name: "Todos los contratistas" },
          ...contractorOptions.map((contractor) => ({
            id: contractor.id,
            name: contractor.name,
            detail: contractor.document,
          })),
        ]}
        selectedId={contractorId}
        searchable
        searchPlaceholder="Buscar por nombre o documento"
        onClose={() => setOpenFilter(null)}
        onSelect={(id) => {
          setContractorId(id);
          setOpenFilter(null);
        }}
      />
    </Page>
  );
}

function Users({
  currentUserId,
  data,
  onChanged,
}: {
  currentUserId: string;
  data: AppData;
  onChanged: () => void;
}) {
  return (
    <Page>
      <View>
        <Text style={styles.eyebrow}>CONTROL DE ACCESO</Text>
        <Text style={styles.greeting}>Usuarios y perfiles</Text>
        <Text style={styles.subtitle}>Versión 1: consulta y activación de usuarios existentes.</Text>
      </View>
      {data.users.map((user) => (
        <View key={user.id} style={styles.card}>
          <View style={styles.cardTop}>
            <Initials name={user.name} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{user.name}</Text>
              <Text style={styles.caption}>{user.email}</Text>
              <Text style={styles.cardMeta}>{user.role}{user.clients.length ? ` ⋅ ${user.clients.join(", ")}` : ""}</Text>
            </View>
            <Switch
              value={user.active}
              disabled={user.id === currentUserId}
              onValueChange={async (active) => {
                try {
                  await setUserActive(user.id, active);
                  await onChanged();
                } catch (cause) {
                  Alert.alert("No fue posible actualizar", errorMessage(cause));
                }
              }}
              trackColor={{ false: "#EDB8B8", true: "#A9D8C4" }}
              thumbColor={user.active ? C.green : C.red}
            />
          </View>
          <View style={styles.adminActions}>
            <Pressable
              disabled={user.id === currentUserId}
              style={[styles.adminRoleButton, user.id === currentUserId && styles.buttonDisabled]}
              onPress={async () => {
                const roles = ["Administrador", "Director/Gerente", "Coordinador", "Cliente"];
                const currentIndex = Math.max(0, roles.indexOf(user.role));
                const nextRole = roles[(currentIndex + 1) % roles.length];
                try {
                  await setUserRole(user.id, nextRole);
                  await onChanged();
                } catch (cause) {
                  Alert.alert("No fue posible asignar el perfil", errorMessage(cause));
                }
              }}
            >
              <Ionicons name="shield-checkmark-outline" size={17} color={C.navy} />
              <Text style={styles.adminRoleText}>Cambiar perfil</Text>
            </Pressable>
            <View style={styles.clientChips}>
              {data.clients.map((client) => {
                const assigned = user.clientIds.includes(client.id);
                return (
                  <Pressable
                    key={client.id}
                    style={[styles.clientChip, assigned && styles.clientChipActive]}
                    onPress={async () => {
                      try {
                        await toggleUserClient(user.id, client.id, !assigned);
                        await onChanged();
                      } catch (cause) {
                        Alert.alert("No fue posible asignar el cliente", errorMessage(cause));
                      }
                    }}
                  >
                    <Text style={[styles.clientChipText, assigned && styles.clientChipTextActive]}>
                      {client.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      ))}
    </Page>
  );
}

function Page({
  children,
  loading = false,
  onRefresh,
}: {
  children: React.ReactNode;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      refreshControl={onRefresh ? <RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={C.navy} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

function Input(props: React.ComponentProps<typeof TextInput> & { icon: IconName }) {
  const { icon, ...inputProps } = props;
  return (
    <View style={styles.inputWrap}>
      <Ionicons name={icon} size={20} color={C.muted} />
      <TextInput placeholderTextColor="#929BAD" style={styles.input} {...inputProps} />
    </View>
  );
}

function DropdownModal({
  visible,
  title,
  options,
  selectedId,
  searchable = false,
  searchPlaceholder = "Buscar",
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  options: { id: number; name: string; detail?: string }[];
  selectedId: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  onClose: () => void;
  onSelect: (id: number) => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  const normalizedQuery = query.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const visibleOptions = options.filter((option) => {
    const normalizedName = option.name.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return normalizedName.includes(normalizedQuery);
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.dropdownCard}>
          <View style={styles.between}>
            <Text style={styles.formTitle}>{title}</Text>
            <Pressable style={styles.iconButton} onPress={onClose}>
              <Ionicons name="close" size={20} color={C.ink} />
            </Pressable>
          </View>
          {searchable && (
            <Input
              icon="search-outline"
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              autoCapitalize="words"
              autoCorrect={false}
            />
          )}
          <ScrollView
            style={styles.dropdownList}
            contentContainerStyle={styles.dropdownListContent}
            keyboardShouldPersistTaps="handled"
          >
            {visibleOptions.length === 0 ? (
              <View style={styles.dropdownEmpty}>
                <Ionicons name="search-outline" size={25} color={C.muted} />
                <Text style={styles.subtitle}>No se encontraron resultados.</Text>
              </View>
            ) : (
              visibleOptions.map((option) => {
                const selected = option.id === selectedId;
                return (
                  <Pressable
                    key={option.id}
                    style={[styles.dropdownOption, selected && styles.dropdownOptionSelected]}
                    onPress={() => onSelect(option.id)}
                  >
                    <View style={styles.flex}>
                      <Text style={[styles.dropdownOptionText, selected && styles.dropdownOptionTextSelected]}>
                        {option.name}
                      </Text>
                      {option.detail ? <Text style={styles.caption}>Documento: {option.detail}</Text> : null}
                    </View>
                    <Ionicons
                      name={selected ? "checkmark-circle" : "chevron-forward"}
                      size={20}
                      color={selected ? C.navy : C.muted}
                    />
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Choice({
  label,
  value,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  value: string;
  icon: IconName;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View>
      <Label text={label} />
      <Pressable style={[styles.inputWrap, disabled && styles.disabled]} onPress={onPress} disabled={disabled}>
        <Ionicons name={icon} size={19} color={disabled ? "#9AA2B2" : C.navy} />
        <Text style={styles.choiceText}>{value}</Text>
        {!disabled && <Ionicons name="chevron-down" size={18} color={C.muted} />}
      </Pressable>
    </View>
  );
}

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.formCard}><Text style={styles.formTitle}>{title}</Text>{children}</View>;
}

function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable style={[styles.primaryButton, disabled && styles.buttonDisabled]} onPress={onPress} disabled={disabled}>
      {icon && <Ionicons name={icon} size={19} color={C.white} />}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  icon,
  onPress,
  destructive,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  destructive?: boolean;
}) {
  const color = destructive ? C.red : C.navy;
  return (
    <Pressable style={[styles.secondaryButton, destructive && styles.destructiveButton]} onPress={onPress}>
      {icon && <Ionicons name={icon} size={19} color={color} />}
      <Text style={[styles.secondaryButtonText, destructive && { color: C.red }]}>{label}</Text>
    </Pressable>
  );
}

function StatusBadge({ status }: { status: OperationStatus }) {
  const config = {
    CERRADO: [C.green, C.greenBg, "checkmark-circle-outline"],
    EN_CURSO: [C.yellow, C.yellowBg, "time-outline"],
    PENDIENTE: [C.red, C.redBg, "alert-circle-outline"],
    CAMBIOS_SOLICITADOS: [C.orange, C.orangeBg, "refresh-outline"],
  }[status] as [string, string, IconName];
  return (
    <View style={[styles.badge, { backgroundColor: config[1] }]}>
      <Ionicons name={config[2]} size={13} color={config[0]} />
      <Text style={[styles.badgeText, { color: config[0] }]}>{status.replaceAll("_", " ")}</Text>
    </View>
  );
}

function RequestBadge({ status }: { status: PersonnelRequest["status"] }) {
  const good = status === "ATENDIDA";
  const bad = status === "CANCELADA";
  return <StatusPill good={good} text={status} neutral={!good && !bad} />;
}

function ContractStatusPill({ status }: { status: Contractor["contractStatus"] }) {
  if (status === "ACTIVO") return <StatusPill good text="ACTIVO" />;
  if (status === "PENDIENTE") return <StatusPill good={false} neutral text="PENDIENTE" />;
  return <StatusPill good={false} text="INACTIVO" />;
}

function StatusPill({ good, text, neutral = false }: { good: boolean; text: string; neutral?: boolean }) {
  const color = neutral ? C.yellow : good ? C.green : C.red;
  const background = neutral ? C.yellowBg : good ? C.greenBg : C.redBg;
  return <View style={[styles.pill, { backgroundColor: background }]}><Text style={[styles.pillText, { color }]}>{text}</Text></View>;
}

function Kpi({ value, label, icon }: { value: string; label: string; icon: IconName }) {
  return (
    <View style={styles.kpi}>
      <Ionicons name={icon} size={21} color={C.navy} />
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

function Stat({ value, label, icon }: { value: string; label: string; icon: IconName }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIcon}><Ionicons name={icon} size={20} color={C.navy} /></View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <View style={styles.miniStat}><Text style={styles.miniValue}>{value}</Text><Text style={styles.caption}>{label}</Text></View>;
}

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return <View style={styles.between}><Text style={styles.sectionTitle}>{title}</Text>{action && <Text style={styles.link}>{action}</Text>}</View>;
}

function Notice({ icon, text, tone }: { icon: IconName; text: string; tone?: "error" }) {
  return (
    <View style={[styles.notice, tone === "error" && styles.noticeError]}>
      <Ionicons name={icon} size={20} color={tone === "error" ? C.red : C.navy} />
      <Text style={[styles.noticeText, tone === "error" && { color: C.red }]}>{text}</Text>
    </View>
  );
}

function InfoCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>{title}</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.infoRow}>
          <Text style={styles.caption}>{label}</Text>
          <Text style={styles.infoValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function Initials({ name }: { name: string }) {
  const initials = name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <View style={styles.initials}><Text style={styles.initialsText}>{initials}</Text></View>;
}

function Label({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  return <View style={styles.empty}><Ionicons name={icon} size={32} color={C.muted} /><Text style={styles.subtitle}>{text}</Text></View>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <View style={styles.center}><Ionicons name="cloud-offline-outline" size={42} color={C.red} /><Text style={styles.errorTitle}>No pudimos cargar la información</Text><Text style={styles.subtitle}>{message}</Text><PrimaryButton label="Reintentar" icon="refresh" onPress={onRetry} /></View>;
}

function CenteredState({ label }: { label: string }) {
  return <SafeAreaProvider><SafeAreaView style={styles.center}><ActivityIndicator size="large" color={C.navy} /><Text style={styles.subtitle}>{label}</Text></SafeAreaView></SafeAreaProvider>;
}

function BottomNav({
  tabs,
  active,
  onPress,
}: {
  tabs: { label: string; icon: IconName; screen: Screen }[];
  active: Screen;
  onPress: (screen: Screen) => void;
}) {
  return (
    <View style={styles.bottomNav}>
      {tabs.map((tab) => {
        const selected = active === tab.screen;
        return (
          <Pressable key={tab.screen} style={styles.tab} onPress={() => onPress(tab.screen)}>
            <View style={[styles.tabIcon, selected && styles.tabIconActive]}>
              <Ionicons name={tab.icon} size={20} color={selected ? C.white : C.muted} />
            </View>
            <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1 },
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  page: { flex: 1 },
  pageContent: { padding: 18, paddingBottom: 34, gap: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 28, backgroundColor: C.bg },
  loginPage: { flex: 1 },
  loginScroll: { flexGrow: 1, justifyContent: "center", padding: 22, gap: 24 },
  loginLogo: { width: 280, height: 120, alignSelf: "center" },
  loginCard: { backgroundColor: C.white, borderRadius: 24, padding: 22, gap: 12, shadowColor: C.ink, shadowOpacity: 0.08, shadowRadius: 20, elevation: 4 },
  loginTitle: { color: C.ink, fontSize: 24, fontWeight: "800" },
  loginOptions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  loginFooter: { textAlign: "center", color: "#929BAD", fontSize: 11 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: C.navy, borderColor: C.navy },
  header: { minHeight: 68, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: C.bg },
  headerLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 11 },
  headerLogo: { width: 34, height: 34 },
  headerTitle: { color: C.ink, fontSize: 18, fontWeight: "800" },
  publicHero: { backgroundColor: C.white, borderRadius: 22, padding: 17, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: C.line },
  avatar: { width: 39, height: 39, borderRadius: 13, backgroundColor: C.navy, alignItems: "center", justifyContent: "center" },
  avatarText: { color: C.white, fontSize: 12, fontWeight: "900" },
  iconButton: { width: 39, height: 39, borderRadius: 13, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: C.orange, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  greeting: { color: C.ink, fontSize: 24, fontWeight: "800", marginTop: 4 },
  detailTitle: { color: C.ink, fontSize: 25, fontWeight: "900", marginTop: 3 },
  subtitle: { color: C.muted, fontSize: 13, lineHeight: 19 },
  caption: { color: C.muted, fontSize: 10, lineHeight: 15 },
  smallText: { color: C.muted, fontSize: 13 },
  link: { color: C.navy, fontSize: 11, fontWeight: "800" },
  destructiveLink: { color: C.red, fontSize: 11, fontWeight: "800" },
  errorText: { color: C.red, fontSize: 12, lineHeight: 17 },
  errorTitle: { color: C.ink, fontSize: 18, fontWeight: "800", textAlign: "center" },
  inputWrap: { minHeight: 52, borderWidth: 1, borderColor: C.line, borderRadius: 14, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10, backgroundColor: "#FBFCFE" },
  input: { flex: 1, color: C.ink, fontSize: 14, paddingVertical: 10 },
  disabled: { backgroundColor: "#F1F3F7" },
  choiceText: { flex: 1, color: C.ink, fontSize: 13 },
  fieldLabel: { color: C.ink, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  textArea: { minHeight: 100, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 13, color: C.ink, fontSize: 12, lineHeight: 18, textAlignVertical: "top", backgroundColor: "#FBFCFE" },
  primaryButton: { flex: 1, minHeight: 52, borderRadius: 15, paddingHorizontal: 14, backgroundColor: C.navy, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryButtonText: { color: C.white, fontSize: 13, fontWeight: "800" },
  secondaryButton: { flex: 1, minHeight: 52, borderRadius: 15, paddingHorizontal: 12, backgroundColor: C.white, borderWidth: 1.5, borderColor: C.navy, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  secondaryButtonText: { color: C.navy, fontSize: 12, fontWeight: "800" },
  destructiveButton: { borderColor: C.red },
  buttonDisabled: { opacity: 0.45 },
  actionRow: { flexDirection: "row", gap: 10 },
  kpiRow: { flexDirection: "row", gap: 10 },
  kpi: { flex: 1, minHeight: 105, borderRadius: 17, padding: 13, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, gap: 5 },
  kpiValue: { color: C.ink, fontSize: 22, fontWeight: "900" },
  card: { backgroundColor: C.white, borderRadius: 18, padding: 14, gap: 11, borderWidth: 1, borderColor: C.line },
  centerCard: { minHeight: 120, backgroundColor: C.white, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  cardTitle: { color: C.ink, fontSize: 15, fontWeight: "800" },
  cardMeta: { color: C.muted, fontSize: 11, marginTop: 3 },
  description: { color: C.muted, fontSize: 12, lineHeight: 18 },
  dateBadge: { width: 45, height: 50, borderRadius: 13, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center" },
  dateDay: { color: C.navy, fontSize: 17, fontWeight: "900" },
  badge: { maxWidth: 112, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 4 },
  badgeText: { fontSize: 8, fontWeight: "900", flexShrink: 1 },
  pill: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6 },
  pillText: { fontSize: 8, fontWeight: "900" },
  alertCard: { borderRadius: 17, padding: 14, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: C.redBg, borderWidth: 1, borderColor: "#F5CDCD" },
  alertTitle: { color: C.red, fontSize: 13, fontWeight: "800" },
  pendingContractorsCard: { borderRadius: 17, padding: 14, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: C.orangeBg, borderWidth: 1, borderColor: "#FFD4C4" },
  pendingContractorsTitle: { color: C.orange, fontSize: 13, fontWeight: "800" },
  heroCard: { backgroundColor: C.white, borderRadius: 20, padding: 18, gap: 18, borderWidth: 1, borderColor: C.line },
  summaryRow: { flexDirection: "row", paddingTop: 14, borderTopWidth: 1, borderTopColor: C.line },
  miniStat: { flex: 1, alignItems: "center" },
  miniValue: { color: C.ink, fontSize: 16, fontWeight: "900", textAlign: "center" },
  sectionTitle: { color: C.ink, fontSize: 16, fontWeight: "800" },
  historyHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  smallActionButton: { minHeight: 38, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, flexDirection: "row", alignItems: "center", gap: 6 },
  smallActionText: { color: C.navy, fontSize: 10, fontWeight: "800" },
  dateFilterButton: { minHeight: 42, maxWidth: "58%", paddingHorizontal: 11, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, flexDirection: "row", alignItems: "center", gap: 6 },
  dateFilterText: { color: C.navy, fontSize: 10, fontWeight: "800", flexShrink: 1 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 13, borderRadius: 15, backgroundColor: C.blueBg, borderWidth: 1, borderColor: "#CED9F6" },
  noticeError: { backgroundColor: C.redBg, borderColor: "#F5CDCD" },
  noticeText: { flex: 1, color: C.navy, fontSize: 11, lineHeight: 17 },
  policyCheckRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 13, borderRadius: 15, backgroundColor: C.blueBg, borderWidth: 1, borderColor: "#CED9F6" },
  personRow: { backgroundColor: C.white, borderRadius: 15, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: C.line, marginBottom: 8 },
  personRowPlain: { flexDirection: "row", alignItems: "center", gap: 11 },
  personName: { color: C.ink, fontSize: 13, fontWeight: "800" },
  initials: { width: 42, height: 42, borderRadius: 13, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center" },
  initialsText: { color: C.navy, fontSize: 12, fontWeight: "900" },
  formCard: { backgroundColor: C.white, borderRadius: 20, padding: 17, gap: 12, borderWidth: 1, borderColor: C.line },
  formTitle: { color: C.ink, fontSize: 16, fontWeight: "800" },
  uploadCard: { minHeight: 74, borderRadius: 16, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#FBFCFE", borderWidth: 1, borderColor: C.line },
  sourceOption: { minHeight: 76, borderRadius: 16, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#FBFCFE", borderWidth: 1, borderColor: C.line },
  cameraShell: { flex: 1, backgroundColor: C.bg },
  cameraHeader: { minHeight: 76, paddingHorizontal: 18, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.line },
  cameraStage: { flex: 1, backgroundColor: "#080B12" },
  cameraView: { flex: 1 },
  cameraPermission: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24, backgroundColor: C.bg },
  cameraControls: { padding: 18, gap: 10, backgroundColor: C.white },
  cameraInstruction: { color: C.ink, fontSize: 15, fontWeight: "800", textAlign: "center" },
  capturePreviewContent: { padding: 18, gap: 14 },
  previewCard: { backgroundColor: C.white, borderRadius: 18, padding: 14, gap: 12, borderWidth: 1, borderColor: C.line },
  cedulaPreviewImage: { width: "100%", height: 220, borderRadius: 14, backgroundColor: "#F8FAFF" },
  selfiePreview: { width: 116, height: 116, borderRadius: 24, alignSelf: "center", backgroundColor: "#F8FAFF" },
  selfieLargePreview: { width: "100%", height: 420, borderRadius: 22, backgroundColor: "#F8FAFF" },
  emptyPreview: { height: 160, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: C.line, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FBFCFE" },
  activationCard: { backgroundColor: C.white, borderRadius: 20, padding: 17, gap: 12, borderWidth: 1, borderColor: "#FFD4C4" },
  boundedList: { maxHeight: 250 },
  counter: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: C.bg, borderRadius: 13, padding: 10 },
  counterValue: { color: C.ink, fontSize: 13, fontWeight: "800" },
  fab: { width: 49, height: 49, borderRadius: 16, backgroundColor: C.orange, alignItems: "center", justifyContent: "center" },
  profileHero: { borderRadius: 22, padding: 22, alignItems: "center", gap: 8 },
  profileInitials: { width: 74, height: 74, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.4)" },
  profileInitialsText: { color: C.white, fontSize: 23, fontWeight: "900" },
  profileName: { color: C.white, fontSize: 21, fontWeight: "900" },
  profileMeta: { color: "#C6D0E8", fontSize: 11 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingTop: 9, borderTopWidth: 1, borderTopColor: "#F0F2F6" },
  infoValue: { color: C.ink, fontSize: 11, fontWeight: "700", maxWidth: "58%", textAlign: "right" },
  extra: { color: C.navy, fontSize: 11, fontWeight: "900" },
  documentsSection: { gap: 10 },
  workwearSummaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  workwearSummaryCard: { width: "48.5%", minWidth: 138, backgroundColor: C.white, borderRadius: 14, padding: 10, gap: 2, borderWidth: 1, borderColor: C.line },
  workwearSummaryTitle: { color: C.ink, fontSize: 12, fontWeight: "900" },
  workwearSummaryValue: { color: C.navy, fontSize: 18, fontWeight: "900", lineHeight: 22 },
  workwearSummaryMeta: { color: C.muted, fontSize: 9, lineHeight: 13 },
  documentRow: { minHeight: 76, backgroundColor: C.white, borderRadius: 17, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: C.line },
  pdfIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.orangeBg, alignItems: "center", justifyContent: "center" },
  documentError: { gap: 8, padding: 14, borderRadius: 15, backgroundColor: C.redBg, borderWidth: 1, borderColor: "#F5CDCD" },
  retryLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  documentPreview: { flex: 1, backgroundColor: C.bg },
  documentPreviewHeader: { minHeight: 74, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.line },
  documentPreviewState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 28 },
  previewRetryButton: { width: "100%", maxWidth: 280, flexDirection: "row" },
  adminActions: { gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line },
  adminRoleButton: { flexDirection: "row", alignItems: "center", gap: 7 },
  adminRoleText: { color: C.navy, fontSize: 11, fontWeight: "800" },
  clientChips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  clientChip: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 99, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg },
  clientChipActive: { borderColor: C.navy, backgroundColor: C.blueBg },
  clientChipText: { color: C.muted, fontSize: 9, fontWeight: "700" },
  clientChipTextActive: { color: C.navy },
  statsFilterRow: { flexDirection: "row", gap: 10 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { width: "48.4%", backgroundColor: C.white, borderRadius: 17, padding: 14, borderWidth: 1, borderColor: C.line },
  statIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  statValue: { color: C.ink, fontSize: 21, fontWeight: "900" },
  chartCard: { backgroundColor: C.white, borderRadius: 19, padding: 16, borderWidth: 1, borderColor: C.line, gap: 8 },
  barChart: { minHeight: 150, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", marginTop: 12 },
  barGroup: { alignItems: "center", gap: 5 },
  barGhost: { width: 30, borderRadius: 8, backgroundColor: "#EFF2F7", justifyContent: "flex-end", overflow: "hidden" },
  barFill: { width: "100%", borderRadius: 8, backgroundColor: C.navy },
  empty: { minHeight: 150, borderRadius: 18, borderWidth: 1, borderStyle: "dashed", borderColor: C.line, alignItems: "center", justifyContent: "center", gap: 10, padding: 20 },
  modalKeyboardAvoider: { flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(23,33,58,0.45)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 440, borderRadius: 22, padding: 18, backgroundColor: C.white, gap: 14 },
  workwearModalCard: { width: "100%", maxWidth: 440, maxHeight: "88%", borderRadius: 22, backgroundColor: C.white, overflow: "hidden" },
  workwearModalContent: { padding: 18, gap: 14 },
  workwearTextArea: { minHeight: 76 },
  dropdownCard: { width: "100%", maxWidth: 440, maxHeight: "78%", borderRadius: 22, padding: 18, backgroundColor: C.white, gap: 14 },
  terminationCard: { width: "100%", maxWidth: 440, maxHeight: "88%", borderRadius: 22, backgroundColor: C.white, overflow: "hidden" },
  terminationContent: { padding: 18, gap: 14 },
  terminationName: { color: C.ink, fontSize: 15, lineHeight: 21, fontWeight: "800", marginTop: 4 },
  terminationTextArea: { minHeight: 82 },
  terminationActions: { flexDirection: "row", gap: 10, paddingTop: 2 },
  dropdownList: { maxHeight: 390 },
  dropdownListContent: { gap: 8 },
  dropdownOption: { minHeight: 58, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: "#FBFCFE", flexDirection: "row", alignItems: "center", gap: 10 },
  dropdownOptionSelected: { borderColor: C.navy, backgroundColor: C.blueBg },
  dropdownOptionText: { color: C.ink, fontSize: 13, fontWeight: "700" },
  dropdownOptionTextSelected: { color: C.navy, fontWeight: "900" },
  dropdownEmpty: { minHeight: 130, alignItems: "center", justifyContent: "center", gap: 9 },
  calendarCard: { width: "100%", maxWidth: 420, borderRadius: 22, padding: 18, backgroundColor: C.white, gap: 16 },
  calendarNavigation: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calendarArrow: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.blueBg },
  calendarArrowSmall: { width: 32, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#F8FAFF" },
  calendarMonthButton: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  calendarMonth: { color: C.ink, fontSize: 15, fontWeight: "800" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarWeekday: { width: "14.2857%", paddingVertical: 8, color: C.muted, fontSize: 10, fontWeight: "800", textAlign: "center" },
  calendarDay: { width: "14.2857%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  calendarToday: { borderWidth: 1, borderColor: C.navy },
  calendarDaySelected: { backgroundColor: C.navy },
  calendarDayText: { color: C.ink, fontSize: 12, fontWeight: "700" },
  calendarTodayText: { color: C.navy, fontWeight: "900" },
  calendarDayTextSelected: { color: C.white },
  yearGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  yearOption: { width: "31.8%", minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#F8FAFF" },
  yearOptionText: { color: C.ink, fontSize: 13, fontWeight: "800" },
  bottomNav: { minHeight: 68, backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.line, flexDirection: "row", paddingHorizontal: 8, paddingTop: 7 },
  tab: { flex: 1, alignItems: "center", gap: 3 },
  tabIcon: { width: 36, height: 30, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  tabIconActive: { backgroundColor: C.navy },
  tabLabel: { color: C.muted, fontSize: 8, fontWeight: "600" },
  tabLabelActive: { color: C.navy, fontWeight: "800" },
});

