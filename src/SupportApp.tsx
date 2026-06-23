import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";

import PdfViewer from "./components/pdf-viewer";
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
  loadAvailableContractorIds,
  loadOperationAssignments,
  loadUserContext,
  reviewOperation,
  setUserActive,
  setUserRole,
  toggleUserClient,
  uploadContractorArlDocument,
} from "./services/data";
import type { ContractorPdfFile } from "./services/data";
import type {
  AppData,
  Assignment,
  ClientContractor,
  Contractor,
  ContractorDocument,
  ContractorHistory,
  Operation,
  OperationStatus,
  PersonnelRequest,
  Role,
  UserContext,
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

export default function SupportApp() {
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
  title = "Filtrar por fecha",
  subtitle = "Selecciona el día que quieres visualizar.",
  resetLabel = "Mostrar últimos 3 días",
  onClose,
  onSelect,
  onReset,
}: {
  visible: boolean;
  selectedDate: string | null;
  title?: string;
  subtitle?: string;
  resetLabel?: string;
  onClose: () => void;
  onSelect: (date: string) => void;
  onReset?: () => void;
}) {
  const initialDate = selectedDate ? isoToDate(selectedDate) : isoToDate(todayIso());
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(initialDate.getFullYear(), initialDate.getMonth(), 1),
  );

  useEffect(() => {
    if (visible) {
      const date = selectedDate ? isoToDate(selectedDate) : isoToDate(todayIso());
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  }, [selectedDate, visible]);

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
          <View style={styles.calendarNavigation}>
            <Pressable style={styles.calendarArrow} onPress={() => moveMonth(-1)}>
              <Ionicons name="chevron-back" size={20} color={C.navy} />
            </Pressable>
            <Text style={styles.calendarMonth}>
              {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
            </Text>
            <Pressable style={styles.calendarArrow} onPress={() => moveMonth(1)}>
              <Ionicons name="chevron-forward" size={20} color={C.navy} />
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
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [cedulaPdf, setCedulaPdf] = useState<ContractorPdfFile | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!documentTypeId && documentTypes[0]) setDocumentTypeId(documentTypes[0].id);
  }, [documentTypeId, documentTypes]);

  const pickCedula = async () => {
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
    }
  };

  const save = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!documentTypeId || !documentNumber.trim() || !name.trim() || !lastName.trim() || !phone.trim() || !normalizedEmail) {
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
        <Label text="Teléfono *" />
        <Input icon="call-outline" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Label text="Correo *" />
        <Input icon="mail-outline" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      </FormCard>
      <FormCard title="Documento obligatorio">
        <Pressable style={styles.uploadCard} onPress={pickCedula}>
          <View style={styles.pdfIcon}>
            <Ionicons name="document-attach-outline" size={23} color={C.orange} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Cédula en PDF</Text>
            <Text style={styles.cardMeta}>
              {cedulaPdf ? cedulaPdf.name : "Adjuntar archivo PDF máximo 1 MB"}
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
    </Page>
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
  onDocument,
  onChanged,
  onHistory,
}: {
  context: UserContext;
  contractor: Contractor;
  onDocument: (document: ContractorDocument) => void;
  onChanged: () => void;
  onHistory: (history: ContractorHistory) => void;
}) {
  const [history, setHistory] = useState<ContractorHistory[]>([]);
  const [loading, setLoading] = useState(true);
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
      <InfoCard title="Dotación" rows={[
        ["Camisa", contractor.shirtSize ?? "-"],
        ["Pantalón", contractor.pantSize ?? "-"],
        ["Zapatos", contractor.shoeSize ?? "-"],
      ]} />
      {context.role === "Director" && contractor.contractStatus === "PENDIENTE" && (
        <ContractorActivationCard contractorId={contractor.id} onChanged={onChanged} />
      )}
      <ContractorDocumentsSection contractorId={contractor.id} onOpen={onDocument} />
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

function ContractorDocumentsSection({
  contractorId,
  onOpen,
}: {
  contractorId: number;
  onOpen: (document: ContractorDocument) => void;
}) {
  const [documents, setDocuments] = useState<ContractorDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      <SectionTitle title="Documentos" action={`${documents.length} archivos`} />
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
      await uploadContractorArlDocument(contractorId, arlPdf);
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
  const today = todayIso();
  const defaultStart = dateToIso(addDays(isoToDate(today), -29));
  const fixedClientId = context.role === "Cliente" ? context.clients[0]?.id ?? 0 : 0;
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(today);
  const [clientId, setClientId] = useState(fixedClientId);
  const [areaId, setAreaId] = useState(0);
  const [openFilter, setOpenFilter] = useState<"start" | "end" | "client" | "area" | null>(null);

  const availableAreas = data.areas.filter(
    (area) => clientId === 0 || area.clientId === clientId,
  );
  const filteredOperations = data.operations.filter(
    (operation) =>
      operation.date >= startDate &&
      operation.date <= endDate &&
      (clientId === 0 || operation.clientId === clientId) &&
      (areaId === 0 || operation.areaId === areaId),
  );
  const filteredRequests = data.requests.filter(
    (request) =>
      request.requiredDate >= startDate &&
      request.requiredDate <= endDate &&
      (clientId === 0 || request.clientId === clientId) &&
      (areaId === 0 || request.areaId === areaId),
  );
  const planned = filteredOperations.reduce((total, item) => total + item.people, 0);
  const worked = filteredOperations.reduce((total, item) => total + item.worked, 0);
  const extras = filteredOperations.reduce((total, item) => total + item.extraHours, 0);
  const coverage = planned ? Math.round((worked / planned) * 100) : 0;
  const openRequests = filteredRequests.filter((item) => item.status === "ABIERTA").length;
  const bars = filteredOperations.slice(0, 5).reverse();

  const selectStartDate = (date: string) => {
    if (date > endDate) {
      Alert.alert("Rango inválido", "La fecha inicial no puede ser posterior a la fecha final.");
      return;
    }
    setStartDate(date);
    setOpenFilter(null);
  };

  const selectEndDate = (date: string) => {
    if (date < startDate) {
      Alert.alert("Rango inválido", "La fecha final no puede ser anterior a la fecha inicial.");
      return;
    }
    setEndDate(date);
    setOpenFilter(null);
  };

  return (
    <Page>
      <View>
        <Text style={styles.eyebrow}>RENDIMIENTO OPERATIVO</Text>
        <Text style={styles.greeting}>{context.role === "Cliente" ? "Resultados de tu empresa" : "Panorama general"}</Text>
        <Text style={styles.subtitle}>Calculado desde operaciones, asignaciones y solicitudes visibles.</Text>
      </View>
      <FormCard title="Filtros">
        <View style={styles.statsFilterRow}>
          <View style={styles.flex}>
            <Choice
              label="Fecha inicial"
              value={formatDate(startDate)}
              icon="calendar-outline"
              onPress={() => setOpenFilter("start")}
            />
          </View>
          <View style={styles.flex}>
            <Choice
              label="Fecha final"
              value={formatDate(endDate)}
              icon="calendar-outline"
              onPress={() => setOpenFilter("end")}
            />
          </View>
        </View>
        {context.role !== "Cliente" && (
          <Choice
            label="Cliente"
            value={clientId === 0 ? "Todos los clientes" : data.clients.find((client) => client.id === clientId)?.name ?? "Todos los clientes"}
            icon="business-outline"
            onPress={() => setOpenFilter("client")}
          />
        )}
        <Choice
          label="Área"
          value={areaId === 0 ? "Todas las áreas" : availableAreas.find((area) => area.id === areaId)?.name ?? "Todas las áreas"}
          icon="location-outline"
          onPress={() => setOpenFilter("area")}
        />
      </FormCard>
      {filteredOperations.length === 0 ? (
        <EmptyState icon="bar-chart-outline" text="No hay operaciones para los filtros seleccionados." />
      ) : (
        <>
          <View style={styles.statsGrid}>
            <Stat value={`${coverage}%`} label="Cobertura" icon="trending-up" />
            <Stat value={String(worked)} label="Turnos trabajados" icon="people" />
            <Stat value={`${extras} h`} label="Horas extra" icon="time" />
            <Stat value={String(openRequests)} label="Solicitudes abiertas" icon="document-text" />
          </View>
          <View style={styles.chartCard}>
            <Text style={styles.formTitle}>Planeado vs. trabajado</Text>
            <Text style={styles.caption}>Últimas operaciones del periodo seleccionado</Text>
            <View style={styles.barChart}>
              {bars.map((item) => {
                const plannedHeight = Math.max(20, Math.min(120, item.people * 18));
                const workedHeight = item.people ? Math.round(plannedHeight * (item.worked / item.people)) : 0;
                return (
                  <View key={item.id} style={styles.barGroup}>
                    <View style={[styles.barGhost, { height: plannedHeight }]}>
                      <View style={[styles.barFill, { height: workedHeight }]} />
                    </View>
                    <Text style={styles.caption}>{item.area.slice(0, 4)}</Text>
                  </View>
                );
              })}
            </View>
          </View>
          <Notice
            icon="bulb-outline"
            text={
              coverage >= 90
                ? `La cobertura visible es ${coverage}%. La operación mantiene un nivel alto.`
                : `La cobertura visible es ${coverage}%. Revisa solicitudes abiertas y ausencias.`
            }
          />
        </>
      )}
      <CalendarModal
        visible={openFilter === "start"}
        selectedDate={startDate}
        title="Fecha inicial"
        subtitle="Selecciona el inicio del periodo."
        onClose={() => setOpenFilter(null)}
        onSelect={selectStartDate}
      />
      <CalendarModal
        visible={openFilter === "end"}
        selectedDate={endDate}
        title="Fecha final"
        subtitle="Selecciona el final del periodo."
        onClose={() => setOpenFilter(null)}
        onSelect={selectEndDate}
      />
      <DropdownModal
        visible={openFilter === "client"}
        title="Seleccionar cliente"
        options={[{ id: 0, name: "Todos los clientes" }, ...data.clients]}
        selectedId={clientId}
        onClose={() => setOpenFilter(null)}
        onSelect={(id) => {
          setClientId(id);
          setAreaId(0);
          setOpenFilter(null);
        }}
      />
      <DropdownModal
        visible={openFilter === "area"}
        title="Seleccionar Área"
        options={[{ id: 0, name: "Todas las Áreas" }, ...availableAreas]}
        selectedId={areaId}
        onClose={() => setOpenFilter(null)}
        onSelect={(id) => {
          setAreaId(id);
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
  dateFilterButton: { minHeight: 42, maxWidth: "58%", paddingHorizontal: 11, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, flexDirection: "row", alignItems: "center", gap: 6 },
  dateFilterText: { color: C.navy, fontSize: 10, fontWeight: "800", flexShrink: 1 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 13, borderRadius: 15, backgroundColor: C.blueBg, borderWidth: 1, borderColor: "#CED9F6" },
  noticeError: { backgroundColor: C.redBg, borderColor: "#F5CDCD" },
  noticeText: { flex: 1, color: C.navy, fontSize: 11, lineHeight: 17 },
  personRow: { backgroundColor: C.white, borderRadius: 15, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: C.line, marginBottom: 8 },
  personRowPlain: { flexDirection: "row", alignItems: "center", gap: 11 },
  personName: { color: C.ink, fontSize: 13, fontWeight: "800" },
  initials: { width: 42, height: 42, borderRadius: 13, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center" },
  initialsText: { color: C.navy, fontSize: 12, fontWeight: "900" },
  formCard: { backgroundColor: C.white, borderRadius: 20, padding: 17, gap: 12, borderWidth: 1, borderColor: C.line },
  formTitle: { color: C.ink, fontSize: 16, fontWeight: "800" },
  uploadCard: { minHeight: 74, borderRadius: 16, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#FBFCFE", borderWidth: 1, borderColor: C.line },
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
  modalBackdrop: { flex: 1, backgroundColor: "rgba(23,33,58,0.45)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 440, borderRadius: 22, padding: 18, backgroundColor: C.white, gap: 14 },
  dropdownCard: { width: "100%", maxWidth: 440, maxHeight: "78%", borderRadius: 22, padding: 18, backgroundColor: C.white, gap: 14 },
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
  calendarMonth: { color: C.ink, fontSize: 15, fontWeight: "800" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarWeekday: { width: "14.2857%", paddingVertical: 8, color: C.muted, fontSize: 10, fontWeight: "800", textAlign: "center" },
  calendarDay: { width: "14.2857%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  calendarToday: { borderWidth: 1, borderColor: C.navy },
  calendarDaySelected: { backgroundColor: C.navy },
  calendarDayText: { color: C.ink, fontSize: 12, fontWeight: "700" },
  calendarTodayText: { color: C.navy, fontWeight: "900" },
  calendarDayTextSelected: { color: C.white },
  bottomNav: { minHeight: 68, backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.line, flexDirection: "row", paddingHorizontal: 8, paddingTop: 7 },
  tab: { flex: 1, alignItems: "center", gap: 3 },
  tabIcon: { width: 36, height: 30, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  tabIconActive: { backgroundColor: C.navy },
  tabLabel: { color: C.muted, fontSize: 8, fontWeight: "600" },
  tabLabelActive: { color: C.navy, fontWeight: "800" },
});
