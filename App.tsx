import React, { useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

type Role = "Coordinador" | "Cliente" | "Director" | "Administrador";
type Screen =
  | "login"
  | "operations"
  | "operation-detail"
  | "initial"
  | "final"
  | "requests"
  | "new-request"
  | "staff"
  | "contractor"
  | "history-detail"
  | "statistics"
  | "users";
type IconName = React.ComponentProps<typeof Ionicons>["name"];

const C = {
  navy: "#15285A",
  navy2: "#203A78",
  orange: "#F0441E",
  magenta: "#9E315C",
  ink: "#17213A",
  muted: "#677187",
  bg: "#F4F6FA",
  line: "#E4E8F0",
  white: "#FFFFFF",
  green: "#148A5B",
  greenBg: "#E8F7F0",
  yellow: "#9A6B00",
  yellowBg: "#FFF5D6",
  red: "#C93636",
  redBg: "#FDECEC",
  blueBg: "#EAF0FF",
};

const operations = [
  { id: 1, date: "09/06/2026", client: "Grupo Éxito", area: "Logística", people: 42, status: "EN CURSO" },
  { id: 2, date: "09/06/2026", client: "Nutresa", area: "Producción", people: 28, status: "PENDIENTE" },
  { id: 3, date: "08/06/2026", client: "Grupo Éxito", area: "Bodega", people: 36, status: "CERRADO" },
  { id: 4, date: "07/06/2026", client: "Postobón", area: "Despachos", people: 19, status: "CERRADO" },
];

const requests = [
  { id: 1, client: "Grupo Éxito", area: "Logística", qty: 12, date: "12/06/2026", status: "ABIERTA", description: "Auxiliares de bodega con experiencia en picking y packing." },
  { id: 2, client: "Nutresa", area: "Producción", qty: 8, date: "11/06/2026", status: "ASIGNADA", description: "Operarios para línea de empaque, turno nocturno." },
  { id: 3, client: "Postobón", area: "Despachos", qty: 5, date: "10/06/2026", status: "ATENDIDA", description: "Personal de cargue y descargue con disponibilidad inmediata." },
];

const contractors = [
  { id: 1, initials: "AM", name: "Andrés Martínez", document: "1.045.882.310", client: "Grupo Éxito", area: "Logística", date: "09/06/2026", active: true },
  { id: 2, initials: "LC", name: "Laura Castaño", document: "1.152.409.872", client: "Nutresa", area: "Producción", date: "09/06/2026", active: true },
  { id: 3, initials: "JR", name: "Jhon Ramírez", document: "71.682.441", client: "Postobón", area: "Despachos", date: "07/06/2026", active: true },
  { id: 4, initials: "SP", name: "Sandra Pérez", document: "43.987.221", client: "Grupo Éxito", area: "Bodega", date: "28/05/2026", active: false },
];

const roleTabs: Record<Role, { label: string; icon: IconName; screen: Screen }[]> = {
  Coordinador: [
    { label: "Operación", icon: "briefcase-outline", screen: "operations" },
    { label: "Solicitudes", icon: "document-text-outline", screen: "requests" },
    { label: "Personal", icon: "people-outline", screen: "staff" },
    { label: "Estadísticas", icon: "bar-chart-outline", screen: "statistics" },
  ],
  Cliente: [
    { label: "Operación", icon: "briefcase-outline", screen: "operations" },
    { label: "Solicitudes", icon: "document-text-outline", screen: "requests" },
    { label: "Estadísticas", icon: "bar-chart-outline", screen: "statistics" },
  ],
  Director: [
    { label: "Operación", icon: "briefcase-outline", screen: "operations" },
    { label: "Estadísticas", icon: "bar-chart-outline", screen: "statistics" },
  ],
  Administrador: [
    { label: "Usuarios", icon: "people-outline", screen: "users" },
    { label: "Perfil", icon: "person-outline", screen: "users" },
  ],
};

export default function App() {
  const [role, setRole] = useState<Role>("Coordinador");
  const [screen, setScreen] = useState<Screen>("login");
  const [activeTab, setActiveTab] = useState<Screen>("operations");

  const navigate = (next: Screen) => {
    setScreen(next);
    if (roleTabs[role].some((tab) => tab.screen === next)) setActiveTab(next);
  };
  const signIn = () => {
    const home = role === "Administrador" ? "users" : "operations";
    setScreen(home);
    setActiveTab(home);
  };

  if (screen === "login") {
    return <SafeAreaProvider><Login role={role} setRole={setRole} onLogin={signIn} /></SafeAreaProvider>;
  }

  const details: Screen[] = ["operation-detail", "initial", "final", "new-request", "contractor", "history-detail"];
  const showTabs = !details.includes(screen);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
        <AppHeader role={role} screen={screen} canGoBack={!showTabs} onBack={() => navigate(activeTab)} onLogout={() => setScreen("login")} />
        <View style={styles.appBody}>
          {screen === "operations" && <Operations role={role} navigate={navigate} />}
          {screen === "operation-detail" && <OperationDetail role={role} navigate={navigate} />}
          {screen === "initial" && <OperationForm final={false} navigate={navigate} />}
          {screen === "final" && <OperationForm final navigate={navigate} />}
          {screen === "requests" && <Requests role={role} navigate={navigate} />}
          {screen === "new-request" && <NewRequest navigate={navigate} />}
          {screen === "staff" && <Staff navigate={navigate} />}
          {screen === "contractor" && <ContractorProfile navigate={navigate} />}
          {screen === "history-detail" && <HistoryDetail />}
          {screen === "statistics" && <Statistics role={role} />}
          {screen === "users" && <Users />}
        </View>
        {showTabs && <BottomNav tabs={roleTabs[role]} active={activeTab} onPress={navigate} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Login({ role, setRole, onLogin }: { role: Role; setRole: (role: Role) => void; onLogin: () => void }) {
  const [remember, setRemember] = useState(true);
  const [secure, setSecure] = useState(true);
  return (
    <LinearGradient colors={["#F8FAFF", "#EEF2FA"]} style={styles.loginPage}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFF" />
      <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brandLockup}>
          <View style={styles.logoHalo}><Image source={require("./assets/login-logo.png")} style={styles.loginLogo} resizeMode="contain" /></View>
        </View>
        <View style={styles.loginCard}>
          <Text style={styles.loginTitle}>Bienvenido</Text>
          <Text style={styles.loginSubtitle}>Ingresa a tu cuenta para continuar</Text>
          <FieldLabel text="Correo electrónico" />
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={20} color={C.muted} />
            <TextInput defaultValue="coordinacion@supportcolombia.com" autoCapitalize="none" keyboardType="email-address" style={styles.input} />
          </View>
          <FieldLabel text="Contraseña" />
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={20} color={C.muted} />
            <TextInput defaultValue="support2026" secureTextEntry={secure} style={styles.input} />
            <Pressable onPress={() => setSecure(!secure)} hitSlop={10}><Ionicons name={secure ? "eye-outline" : "eye-off-outline"} size={20} color={C.muted} /></Pressable>
          </View>
          <View style={styles.loginOptions}>
            <Pressable style={styles.remember} onPress={() => setRemember(!remember)}>
              <View style={[styles.checkbox, remember && styles.checkboxOn]}>{remember && <Ionicons name="checkmark" color={C.white} size={14} />}</View>
              <Text style={styles.rememberText}>Recordarme</Text>
            </Pressable>
            <Pressable onPress={() => Alert.alert("Recuperar acceso", "Enviaremos instrucciones al correo registrado.")}><Text style={styles.forgot}>¿Olvidaste tu contraseña?</Text></Pressable>
          </View>
          <PrimaryButton label="Iniciar sesión" icon="arrow-forward" onPress={onLogin} />
          <Text style={styles.demoLabel}>Selecciona un perfil para explorar la demo</Text>
          <View style={styles.roleGrid}>
            {(["Coordinador", "Cliente", "Director", "Administrador"] as Role[]).map((item) => (
              <Pressable key={item} onPress={() => setRole(item)} style={[styles.roleChip, role === item && styles.roleChipActive]}>
                <Text style={[styles.roleChipText, role === item && styles.roleChipTextActive]}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Text style={styles.loginFooter}>Acceso seguro · Support Colombia 2026</Text>
      </ScrollView>
    </LinearGradient>
  );
}

function AppHeader({ role, screen, canGoBack, onBack, onLogout }: { role: Role; screen: Screen; canGoBack: boolean; onBack: () => void; onLogout: () => void }) {
  const titles: Partial<Record<Screen, string>> = {
    operations: "Operaciones", "operation-detail": role === "Director" ? "Revisión de operación" : "Detalle de operación",
    initial: "Registro inicial", final: "Registro final", requests: "Solicitudes", "new-request": "Nueva solicitud",
    staff: "Personal", contractor: "Perfil del contratista", "history-detail": "Detalle del turno",
    statistics: "Estadísticas", users: "Administración de usuarios",
  };
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {canGoBack ? <Pressable onPress={onBack} style={styles.iconButton}><Ionicons name="arrow-back" size={22} color={C.ink} /></Pressable>
          : <Image source={require("./assets/support-logo.png")} style={styles.headerLogo} resizeMode="contain" />}
        <View><Text style={styles.headerTitle}>{titles[screen]}</Text>{!canGoBack && <Text style={styles.headerRole}>{role}</Text>}</View>
      </View>
      <View style={styles.headerActions}>
        <Pressable style={styles.iconButton}><Ionicons name="notifications-outline" size={21} color={C.ink} /><View style={styles.notificationDot} /></Pressable>
        <Pressable style={styles.avatar} onPress={onLogout}><Text style={styles.avatarText}>{role === "Administrador" ? "AD" : role === "Director" ? "DG" : role === "Cliente" ? "CL" : "MC"}</Text></Pressable>
      </View>
    </View>
  );
}

function Operations({ role, navigate }: { role: Role; navigate: (screen: Screen) => void }) {
  const visible = role === "Cliente" ? operations.filter((item) => item.client === "Grupo Éxito") : operations;
  return (
    <Page>
      <View><Text style={styles.eyebrow}>MARTES, 9 DE JUNIO</Text><Text style={styles.greeting}>{role === "Cliente" ? "Tu operación de hoy" : role === "Director" ? "Control de la operación" : "Buenos días, Marcela"}</Text></View>
      {role !== "Cliente" && <View style={styles.kpiRow}><KpiCard value="70" label="Personal hoy" icon="people" tone="blue" /><KpiCard value="3" label="En curso" icon="time" tone="yellow" /><KpiCard value="2" label="Pendientes" icon="alert-circle" tone="red" /></View>}
      {role === "Cliente" && (
        <LinearGradient colors={[C.navy, C.navy2]} style={styles.clientHero}>
          <View><Text style={styles.clientHeroLabel}>PERSONAL ACTIVO HOY</Text><Text style={styles.clientHeroNumber}>42</Text><Text style={styles.clientHeroMeta}>2 áreas operando · Grupo Éxito</Text></View>
          <View style={styles.heroIcon}><Ionicons name="people" size={28} color={C.white} /></View>
        </LinearGradient>
      )}
      {role === "Director" && (
        <Pressable style={styles.pendingBanner} onPress={() => navigate("operation-detail")}>
          <View style={styles.pendingIcon}><Ionicons name="alert-circle" size={22} color={C.red} /></View>
          <View style={{ flex: 1 }}><Text style={styles.pendingTitle}>2 operaciones esperan aprobación</Text><Text style={styles.pendingText}>La más antigua fue enviada hace 42 minutos</Text></View>
          <Ionicons name="chevron-forward" size={20} color={C.red} />
        </Pressable>
      )}
      <View style={styles.chips}><FilterChip label="Hoy" active /><FilterChip label="Cliente" /><FilterChip label="Área" />{role !== "Cliente" && <FilterChip label="Estado" />}</View>
      {role === "Coordinador" && (
        <View style={styles.actionPair}>
          <Pressable style={styles.secondaryAction} onPress={() => navigate("initial")}><Ionicons name="add-circle-outline" size={20} color={C.navy} /><Text style={styles.secondaryActionText}>Registro inicial</Text></Pressable>
          <Pressable style={styles.primaryAction} onPress={() => navigate("final")}><Ionicons name="checkmark-circle-outline" size={20} color={C.white} /><Text style={styles.primaryActionText}>Registro final</Text></Pressable>
        </View>
      )}
      <SectionHeader title={role === "Director" ? "Operaciones recientes" : "Historial de operaciones"} action="Ver calendario" />
      <View style={styles.listGap}>{visible.map((item) => <OperationCard key={item.id} item={item} role={role} onPress={() => navigate("operation-detail")} />)}</View>
    </Page>
  );
}

function OperationCard({ item, role, onPress }: { item: typeof operations[0]; role: Role; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardTop}>
        <View style={styles.dateBadge}><Text style={styles.dateBadgeDay}>{item.date.slice(0, 2)}</Text><Text style={styles.dateBadgeMonth}>JUN</Text></View>
        <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{item.client}</Text><View style={styles.metaRow}><Ionicons name="location-outline" size={15} color={C.muted} /><Text style={styles.cardMeta}>{item.area}</Text><View style={styles.dot} /><Ionicons name="people-outline" size={15} color={C.muted} /><Text style={styles.cardMeta}>{item.people} personas</Text></View></View>
        {role !== "Cliente" && <StatusBadge status={item.status} />}
      </View>
      <View style={styles.cardBottom}><Text style={styles.cardDate}>{item.date === "09/06/2026" ? "Hoy" : item.date}</Text><View style={styles.row}>{role === "Coordinador" && item.date === "09/06/2026" && <><Ionicons name="create-outline" size={18} color={C.navy} /><Ionicons name="trash-outline" size={18} color={C.red} /></>}<Ionicons name="chevron-forward" size={19} color={C.muted} /></View></View>
    </Pressable>
  );
}

function OperationDetail({ role, navigate }: { role: Role; navigate: (screen: Screen) => void }) {
  return (
    <Page bottomPadding={role === "Director" ? 130 : 32}>
      <View style={styles.detailHero}>
        <View style={styles.detailHeroTop}><View><Text style={styles.eyebrow}>OPERACIÓN #SC-2409</Text><Text style={styles.detailTitle}>Nutresa</Text><Text style={styles.detailSubtitle}>Producción · 09/06/2026</Text></View>{role !== "Cliente" && <StatusBadge status="PENDIENTE" />}</View>
        <View style={styles.detailStats}><MiniStat label="Planeados" value="30" /><MiniStat label="Trabajaron" value="28" /><MiniStat label="Extras" value="14 h" /><MiniStat label="Cobertura" value="93%" /></View>
      </View>
      {role === "Director" && <View style={styles.infoBanner}><Ionicons name="information-circle" size={20} color={C.navy} /><Text style={styles.infoText}>Revisa asistencia, extras y observaciones antes de tomar una decisión.</Text></View>}
      <SectionHeader title="Personal de la operación" action="28 registros" />
      <View style={styles.listGap}>{contractors.slice(0, 3).map((person, index) => (
        <View key={person.id} style={styles.personRow}><View style={styles.smallAvatar}><Text style={styles.smallAvatarText}>{person.initials}</Text></View><View style={{ flex: 1 }}><Text style={styles.personName}>{person.name}</Text><Text style={styles.personMeta}>{index === 2 ? "Ausente" : "Asistió"} · {index === 0 ? "2 horas extra" : "Sin extras"}</Text></View><Ionicons name={index === 2 ? "close-circle" : "checkmark-circle"} color={index === 2 ? C.red : C.green} size={21} /></View>
      ))}</View>
      <SectionHeader title="Observaciones" />
      <View style={styles.noteCard}><Ionicons name="chatbubble-ellipses-outline" size={19} color={C.navy} /><Text style={styles.noteText}>Dos personas no asistieron por incapacidad. Se cubrió una vacante con personal disponible.</Text></View>
      {role === "Director" && <>
        <SectionHeader title="Historial de revisión" />
        <View style={styles.timeline}><View style={styles.timelineDot} /><View><Text style={styles.timelineTitle}>Enviado por Marcela Correa</Text><Text style={styles.timelineMeta}>09/06/2026 · 5:18 p. m.</Text></View></View>
        <View style={styles.reviewActions}>
          <Pressable style={styles.requestChanges} onPress={() => Alert.alert("Solicitar cambios", "La observación será obligatoria en la versión conectada.")}><Ionicons name="refresh-outline" size={20} color={C.red} /><Text style={styles.requestChangesText}>Solicitar cambios</Text></Pressable>
          <Pressable style={styles.approve} onPress={() => Alert.alert("Aprobar operación", "¿Confirmas que la información es correcta?", [{ text: "Cancelar", style: "cancel" }, { text: "Aprobar", onPress: () => Alert.alert("Operación aprobada") }])}><Ionicons name="checkmark" size={20} color={C.white} /><Text style={styles.approveText}>Aprobar</Text></Pressable>
        </View>
      </>}
      {role === "Cliente" && <Pressable style={styles.fullSecondary} onPress={() => navigate("operations")}><Ionicons name="download-outline" size={19} color={C.navy} /><Text style={styles.fullSecondaryText}>Descargar resumen</Text></Pressable>}
    </Page>
  );
}

function OperationForm({ final, navigate }: { final: boolean; navigate: (screen: Screen) => void }) {
  const [extra, setExtra] = useState(final);
  const [added, setAdded] = useState(contractors.slice(0, 2));
  const save = () => Alert.alert(final ? "Enviar para aprobación" : "Guardar registro inicial", final ? "La operación quedará PENDIENTE hasta la revisión del Director/Gerente." : "Se guardará la planeación de personal para hoy.", [{ text: "Cancelar", style: "cancel" }, { text: final ? "Enviar" : "Guardar", onPress: () => navigate("operations") }]);
  return (
    <Page bottomPadding={110}>
      <View style={styles.stepper}><Step number="1" label="Información" active /><View style={styles.stepLine} /><Step number="2" label="Personal" active={final} /><View style={styles.stepLine} /><Step number="3" label={final ? "Cierre" : "Guardar"} /></View>
      <View style={styles.formCard}>
        <View style={styles.formHeading}><View><Text style={styles.formTitle}>{final ? "Cierre de la operación" : "Información de la operación"}</Text><Text style={styles.formSubtitle}>Los campos con * son obligatorios</Text></View><View style={styles.todayBadge}><Text style={styles.todayBadgeText}>HOY</Text></View></View>
        <SelectField label="Fecha" value="09/06/2026" icon="calendar-outline" disabled />
        <SelectField label="Cliente *" value="Grupo Éxito" icon="business-outline" />
        <SelectField label="Área *" value="Logística" icon="location-outline" />
        {!final && <SelectField label="Contratista *" value="Buscar por nombre o documento" icon="search-outline" muted />}
        {!final && <Pressable style={styles.addButton} onPress={() => setAdded([...added, contractors[Math.min(added.length, contractors.length - 1)]])}><Ionicons name="person-add-outline" size={19} color={C.navy} /><Text style={styles.addButtonText}>Agregar contratista</Text></Pressable>}
      </View>
      <SectionHeader title={final ? "Asistencia y novedades" : `Personal agregado (${added.length})`} action={final ? "28 personas" : "Lista del registro"} />
      <View style={styles.formList}>{added.map((person, index) => (
        <View key={`${person.id}-${index}`} style={styles.assignmentCard}>
          <View style={styles.assignmentTop}><View style={styles.smallAvatar}><Text style={styles.smallAvatarText}>{person.initials}</Text></View><View style={{ flex: 1 }}><Text style={styles.personName}>{person.name}</Text><Text style={styles.personMeta}>Grupo Éxito · Logística</Text></View>{!final && <Pressable onPress={() => setAdded(added.filter((_, i) => i !== index))}><Ionicons name="trash-outline" size={19} color={C.red} /></Pressable>}</View>
          {final && <View style={styles.finalFields}><View style={styles.attendanceRow}><Text style={styles.miniLabel}>Asistencia</Text><View style={styles.presentChip}><Ionicons name="checkmark" size={14} color={C.green} /><Text style={styles.presentText}>Asistió</Text></View></View>{index === 0 && <><View style={styles.switchRow}><Text style={styles.switchLabel}>Registró horas extra</Text><Switch value={extra} onValueChange={setExtra} trackColor={{ false: C.line, true: "#AAB8DB" }} thumbColor={extra ? C.navy : "#F4F4F4"} /></View>{extra && <SelectField label="Horas extra" value="2" icon="time-outline" />}</>}</View>}
        </View>
      ))}</View>
      {final && <View style={styles.formCard}><FieldLabel text="Observaciones generales" /><TextInput multiline numberOfLines={4} placeholder="Describe novedades relevantes de la operación..." placeholderTextColor="#9AA2B2" style={styles.textArea} /><View style={styles.summaryStrip}><MiniStat label="Planeados" value="30" /><MiniStat label="Trabajaron" value="28" /><MiniStat label="Extras" value="14 h" /></View></View>}
      <View style={styles.stickyAction}><PrimaryButton label={final ? "Enviar para aprobación" : "Guardar registro inicial"} icon={final ? "send" : "save-outline"} onPress={save} /></View>
    </Page>
  );
}

function Requests({ role, navigate }: { role: Role; navigate: (screen: Screen) => void }) {
  const visible = role === "Cliente" ? requests.filter((item) => item.client === "Grupo Éxito") : requests;
  return (
    <Page>
      <View style={styles.screenIntro}><View style={{ flex: 1 }}><Text style={styles.eyebrow}>{role === "Cliente" ? "MIS SOLICITUDES" : "GESTIÓN DE COBERTURA"}</Text><Text style={styles.greeting}>{role === "Cliente" ? "Personal que necesitas" : "Solicitudes de personal"}</Text><Text style={styles.introText}>{role === "Cliente" ? "Crea y consulta tus requerimientos de talento." : "Prioriza y asigna los requerimientos de tus clientes."}</Text></View>{role === "Cliente" && <Pressable style={styles.fabInline} onPress={() => navigate("new-request")}><Ionicons name="add" color={C.white} size={25} /></Pressable>}</View>
      <View style={styles.chips}><FilterChip label="Todas" active /><FilterChip label="Abiertas" /><FilterChip label="Cliente" /><FilterChip label="Fecha" /></View>
      <View style={styles.listGap}>{visible.map((item) => (
        <Pressable key={item.id} style={styles.requestCard}>
          <View style={styles.requestTop}><View style={styles.requestIcon}><Ionicons name="document-text-outline" size={21} color={C.navy} /></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{item.client}</Text><Text style={styles.requestArea}>{item.area}</Text></View><RequestBadge status={item.status} /></View>
          <Text style={styles.requestDescription}>{item.description}</Text>
          <View style={styles.requestBottom}><View style={styles.requestMetric}><Ionicons name="people-outline" size={17} color={C.muted} /><Text style={styles.requestMetricValue}>{item.qty} personas</Text></View><View style={styles.requestMetric}><Ionicons name="calendar-outline" size={17} color={C.muted} /><Text style={styles.requestMetricValue}>{item.date}</Text></View><Ionicons name="chevron-forward" size={19} color={C.muted} /></View>
        </Pressable>
      ))}</View>
    </Page>
  );
}

function NewRequest({ navigate }: { navigate: (screen: Screen) => void }) {
  return (
    <Page bottomPadding={110}>
      <View style={styles.infoBanner}><Ionicons name="information-circle" size={20} color={C.navy} /><Text style={styles.infoText}>Tu coordinador recibirá la solicitud y te notificará cuando el personal sea asignado.</Text></View>
      <View style={styles.formCard}><Text style={styles.formTitle}>Datos del requerimiento</Text><SelectField label="Empresa" value="Grupo Éxito" icon="business-outline" disabled /><SelectField label="Área *" value="Selecciona un área" icon="location-outline" muted /><SelectField label="Cantidad de personal *" value="12" icon="people-outline" /><SelectField label="Fecha requerida *" value="12/06/2026" icon="calendar-outline" /><FieldLabel text="Descripción del perfil *" /><TextInput multiline numberOfLines={5} defaultValue="Auxiliares de bodega con experiencia en picking y packing. Disponibilidad para turno de 2:00 p. m. a 10:00 p. m." style={styles.textArea} /></View>
      <View style={styles.stickyAction}><PrimaryButton label="Enviar solicitud" icon="send" onPress={() => Alert.alert("Solicitud enviada", "Te notificaremos cuando el personal sea asignado.", [{ text: "Entendido", onPress: () => navigate("requests") }])} /></View>
    </Page>
  );
}

function Staff({ navigate }: { navigate: (screen: Screen) => void }) {
  return (
    <Page>
      <View><Text style={styles.eyebrow}>BASE DE TALENTO</Text><Text style={styles.greeting}>Personal disponible</Text><Text style={styles.introText}>1.248 contratistas registrados</Text></View>
      <View style={styles.searchBar}><Ionicons name="search-outline" size={20} color={C.muted} /><TextInput placeholder="Nombre, documento o cliente" placeholderTextColor="#929BAD" style={styles.searchInput} /><Ionicons name="options-outline" size={20} color={C.navy} /></View>
      <View style={styles.chips}><FilterChip label="Todos" active /><FilterChip label="Activos" /><FilterChip label="Disponibles" /><FilterChip label="Cliente" /></View>
      <View style={styles.listGap}>{contractors.map((person) => (
        <Pressable key={person.id} style={styles.contractorCard} onPress={() => navigate("contractor")}>
          <View style={styles.contractorAvatar}><Text style={styles.contractorAvatarText}>{person.initials}</Text></View>
          <View style={{ flex: 1 }}><View style={styles.row}><Text style={styles.contractorName}>{person.name}</Text><View style={[styles.statusDot, { backgroundColor: person.active ? C.green : C.red }]} /></View><Text style={styles.contractorDoc}>CC {person.document}</Text><View style={styles.contractorMeta}><Text style={styles.metaCaption}>Último turno</Text><Text style={styles.metaValue}>{person.client} · {person.area}</Text><Text style={styles.metaDate}>{person.date}</Text></View></View>
          <Ionicons name="chevron-forward" size={19} color={C.muted} />
        </Pressable>
      ))}</View>
    </Page>
  );
}

function ContractorProfile({ navigate }: { navigate: (screen: Screen) => void }) {
  return (
    <Page>
      <LinearGradient colors={[C.navy, C.navy2]} style={styles.profileHero}><View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>AM</Text></View><Text style={styles.profileName}>Andrés Martínez</Text><Text style={styles.profileDoc}>CC 1.045.882.310</Text><View style={styles.activeBadge}><View style={styles.activeDot} /><Text style={styles.activeBadgeText}>ACTIVO · DISPONIBLE</Text></View></LinearGradient>
      <InfoSection title="Información personal" icon="person-outline" rows={[["Nombres y apellidos", "Andrés Felipe Martínez"], ["Tipo de sangre", "O+"], ["Estado civil", "Soltero"]]} />
      <InfoSection title="Información laboral" icon="briefcase-outline" rows={[["Fecha de contratación", "15/01/2025"], ["Terminación de contrato", "Indefinido"], ["Disponibilidad", "Inmediata"]]} />
      <InfoSection title="Contacto y logística" icon="call-outline" rows={[["Teléfono", "+57 300 458 2190"], ["Correo", "andres.martinez@email.com"], ["Ciudad", "Medellín"], ["Transporte", "Motocicleta"]]} />
      <InfoSection title="Dotación" icon="shirt-outline" rows={[["Camisa", "M"], ["Pantalón", "32"], ["Zapatos", "41"]]} horizontal />
      <SectionHeader title="Historial de operaciones" action="Ver todo" />
      <View style={styles.listGap}>{[["09/06/2026", "Grupo Éxito", "Logística", "2 h"], ["08/06/2026", "Grupo Éxito", "Bodega", "0 h"], ["05/06/2026", "Nutresa", "Producción", "1 h"]].map((row, index) => (
        <Pressable key={index} style={styles.historyRow} onPress={() => navigate("history-detail")}><View style={styles.historyDate}><Text style={styles.historyDay}>{row[0].slice(0, 2)}</Text><Text style={styles.historyMonth}>JUN</Text></View><View style={{ flex: 1 }}><Text style={styles.personName}>{row[1]}</Text><Text style={styles.personMeta}>{row[2]}</Text></View><View><Text style={styles.extraValue}>{row[3]}</Text><Text style={styles.metaCaption}>Extras</Text></View><Ionicons name="chevron-forward" size={18} color={C.muted} /></Pressable>
      ))}</View>
    </Page>
  );
}

function HistoryDetail() {
  return (
    <Page>
      <View style={styles.detailHero}><Text style={styles.eyebrow}>TURNO COMPLETADO</Text><Text style={styles.detailTitle}>Grupo Éxito</Text><Text style={styles.detailSubtitle}>Logística · 09/06/2026</Text><View style={styles.detailStats}><MiniStat label="Asistencia" value="Sí" /><MiniStat label="Entrada" value="7:00" /><MiniStat label="Salida" value="17:00" /><MiniStat label="Extras" value="2 h" /></View></View>
      <SectionHeader title="Observaciones" /><View style={styles.noteCard}><Ionicons name="chatbubble-ellipses-outline" size={19} color={C.navy} /><Text style={styles.noteText}>Apoyó cierre de inventario durante dos horas adicionales. Jornada completada sin novedades.</Text></View>
      <SectionHeader title="Registrado por" /><View style={styles.personRow}><View style={styles.smallAvatar}><Text style={styles.smallAvatarText}>MC</Text></View><View><Text style={styles.personName}>Marcela Correa</Text><Text style={styles.personMeta}>Coordinadora · 09/06/2026, 5:18 p. m.</Text></View></View>
    </Page>
  );
}

function Statistics({ role }: { role: Role }) {
  return (
    <Page>
      <View><Text style={styles.eyebrow}>RENDIMIENTO OPERATIVO</Text><Text style={styles.greeting}>{role === "Cliente" ? "Resultados de tu operación" : "Panorama general"}</Text><Text style={styles.introText}>Datos actualizados hoy a las 6:30 p. m.</Text></View>
      <View style={styles.chips}><FilterChip label="Últimos 30 días" active />{role !== "Cliente" && <FilterChip label="Cliente" />}<FilterChip label="Área" /></View>
      <View style={styles.statsGrid}><StatCard value="94%" label="Cobertura" change="+3,2%" icon="trending-up" /><StatCard value="1.248" label="Turnos cubiertos" change="+86" icon="people" /><StatCard value="186 h" label="Horas extra" change="-8,4%" icon="time" /><StatCard value="2,6%" label="Ausentismo" change="-0,7%" icon="pulse" /></View>
      <View style={styles.chartCard}><View style={styles.chartHeader}><View><Text style={styles.chartTitle}>Planeado vs. trabajado</Text><Text style={styles.chartSubtitle}>Últimas 5 semanas</Text></View><View style={styles.chartLegend}><View style={styles.legendDot} /><Text style={styles.legendText}>Trabajado</Text></View></View><View style={styles.barChart}>{[72, 86, 78, 94, 88].map((height, index) => <View key={index} style={styles.barGroup}><View style={styles.barGhost}><LinearGradient colors={[C.navy2, C.navy]} style={[styles.bar, { height }]} /></View><Text style={styles.barLabel}>S{index + 1}</Text></View>)}</View></View>
      <View style={styles.insightCard}><LinearGradient colors={["#FFF2EC", "#FFF8F5"]} style={styles.insightIcon}><Ionicons name="sparkles" size={21} color={C.orange} /></LinearGradient><View style={{ flex: 1 }}><Text style={styles.insightTitle}>Insight de la semana</Text><Text style={styles.insightText}>La cobertura aumentó 3,2%. Logística concentra el 41% del personal y mantiene el mejor cumplimiento.</Text></View></View>
      <View style={styles.chartCard}><Text style={styles.chartTitle}>Distribución por área</Text><ProgressRow label="Logística" value="41%" width="41%" color={C.navy} /><ProgressRow label="Producción" value="32%" width="32%" color={C.magenta} /><ProgressRow label="Despachos" value="18%" width="18%" color={C.orange} /><ProgressRow label="Otros" value="9%" width="9%" color="#AAB2C2" /></View>
    </Page>
  );
}

function Users() {
  const users = [["MC", "Marcela Correa", "Coordinador", "4 clientes", true], ["JG", "Julián Gómez", "Director", "Acceso global", true], ["CE", "Carolina Escobar", "Cliente", "Grupo Éxito", true], ["AR", "Andrea Restrepo", "Coordinador", "2 clientes", false]] as const;
  return (
    <Page>
      <View style={styles.screenIntro}><View style={{ flex: 1 }}><Text style={styles.eyebrow}>CONTROL DE ACCESOS</Text><Text style={styles.greeting}>Usuarios</Text><Text style={styles.introText}>32 usuarios · 29 activos</Text></View><Pressable style={styles.fabInline} onPress={() => Alert.alert("Crear usuario", "Formulario listo para conectar al backend.")}><Ionicons name="person-add" color={C.white} size={22} /></Pressable></View>
      <View style={styles.searchBar}><Ionicons name="search-outline" size={20} color={C.muted} /><TextInput placeholder="Buscar usuario o correo" placeholderTextColor="#929BAD" style={styles.searchInput} /><Ionicons name="options-outline" size={20} color={C.navy} /></View>
      <View style={styles.chips}><FilterChip label="Todos" active /><FilterChip label="Activos" /><FilterChip label="Perfil" /><FilterChip label="Cliente" /></View>
      <View style={styles.listGap}>{users.map((user) => <Pressable key={user[1]} style={styles.userCard}><View style={styles.contractorAvatar}><Text style={styles.contractorAvatarText}>{user[0]}</Text></View><View style={{ flex: 1 }}><Text style={styles.contractorName}>{user[1]}</Text><Text style={styles.contractorDoc}>{user[2]} · {user[3]}</Text><Text style={styles.lastAccess}>Último ingreso: hoy, 8:14 a. m.</Text></View><View style={[styles.userStatus, { backgroundColor: user[4] ? C.greenBg : C.redBg }]}><Text style={{ color: user[4] ? C.green : C.red, fontSize: 10, fontWeight: "800" }}>{user[4] ? "ACTIVO" : "INACTIVO"}</Text></View></Pressable>)}</View>
    </Page>
  );
}

function Page({ children, bottomPadding = 32 }: { children: React.ReactNode; bottomPadding?: number }) {
  return <ScrollView style={styles.page} contentContainerStyle={[styles.pageContent, { paddingBottom: bottomPadding }]} contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}>{children}</ScrollView>;
}
function BottomNav({ tabs, active, onPress }: { tabs: { label: string; icon: IconName; screen: Screen }[]; active: Screen; onPress: (screen: Screen) => void }) {
  return <SafeAreaView edges={["bottom"]} style={styles.navSafe}><View style={styles.bottomNav}>{tabs.map((tab) => { const selected = active === tab.screen; return <Pressable key={tab.label} style={styles.tab} onPress={() => onPress(tab.screen)}><View style={[styles.tabIcon, selected && styles.tabIconActive]}><Ionicons name={selected ? tab.icon.replace("-outline", "") as IconName : tab.icon} size={21} color={selected ? C.white : C.muted} /></View><Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text></Pressable>; })}</View></SafeAreaView>;
}
function PrimaryButton({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  return <Pressable onPress={onPress}><LinearGradient colors={[C.navy2, C.navy]} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{label}</Text><Ionicons name={icon} size={20} color={C.white} /></LinearGradient></Pressable>;
}
function FieldLabel({ text }: { text: string }) { return <Text style={styles.fieldLabel}>{text}</Text>; }
function SelectField({ label, value, icon, disabled, muted }: { label: string; value: string; icon: IconName; disabled?: boolean; muted?: boolean }) {
  return <View><FieldLabel text={label} /><View style={[styles.selectField, disabled && styles.selectDisabled]}><Ionicons name={icon} size={19} color={disabled ? "#A4ABBA" : C.navy} /><Text style={[styles.selectValue, muted && { color: "#929BAD" }]}>{value}</Text>{!disabled && <Ionicons name="chevron-down" size={17} color={C.muted} />}</View></View>;
}
function KpiCard({ value, label, icon, tone }: { value: string; label: string; icon: IconName; tone: "blue" | "yellow" | "red" }) {
  const color = tone === "blue" ? C.navy : tone === "yellow" ? C.yellow : C.red; const bg = tone === "blue" ? C.blueBg : tone === "yellow" ? C.yellowBg : C.redBg;
  return <View style={styles.kpiCard}><View style={[styles.kpiIcon, { backgroundColor: bg }]}><Ionicons name={icon} size={18} color={color} /></View><Text style={styles.kpiValue}>{value}</Text><Text style={styles.kpiLabel}>{label}</Text></View>;
}
function StatusBadge({ status }: { status: string }) {
  const closed = status === "CERRADO"; const progress = status === "EN CURSO"; const color = closed ? C.green : progress ? C.yellow : C.red; const bg = closed ? C.greenBg : progress ? C.yellowBg : C.redBg;
  return <View style={[styles.badge, { backgroundColor: bg }]}><View style={[styles.badgeDot, { backgroundColor: color }]} /><Text style={[styles.badgeText, { color }]}>{status}</Text></View>;
}
function RequestBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = { ABIERTA: [C.red, C.redBg], ASIGNADA: [C.yellow, C.yellowBg], ATENDIDA: [C.green, C.greenBg] }; const [color, bg] = map[status] ?? [C.muted, C.bg];
  return <View style={[styles.requestBadge, { backgroundColor: bg }]}><Text style={[styles.requestBadgeText, { color }]}>{status}</Text></View>;
}
function FilterChip({ label, active }: { label: string; active?: boolean }) {
  return <Pressable style={[styles.filterChip, active && styles.filterChipActive]}><Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>{!["Hoy", "Todas", "Todos", "Últimos 30 días"].includes(label) && <Ionicons name="chevron-down" size={13} color={active ? C.white : C.muted} />}</Pressable>;
}
function SectionHeader({ title, action }: { title: string; action?: string }) { return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text>{action && <Text style={styles.sectionAction}>{action}</Text>}</View>; }
function MiniStat({ label, value }: { label: string; value: string }) { return <View style={styles.miniStat}><Text style={styles.miniStatValue}>{value}</Text><Text style={styles.miniStatLabel}>{label}</Text></View>; }
function Step({ number, label, active }: { number: string; label: string; active?: boolean }) { return <View style={styles.step}><View style={[styles.stepCircle, active && styles.stepCircleActive]}><Text style={[styles.stepNumber, active && styles.stepNumberActive]}>{number}</Text></View><Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text></View>; }
function InfoSection({ title, icon, rows, horizontal }: { title: string; icon: IconName; rows: string[][]; horizontal?: boolean }) {
  return <View style={styles.infoSection}><View style={styles.infoSectionTitle}><View style={styles.infoSectionIcon}><Ionicons name={icon} size={18} color={C.navy} /></View><Text style={styles.sectionTitle}>{title}</Text></View><View style={horizontal ? styles.horizontalInfo : undefined}>{rows.map((row) => <View key={row[0]} style={[styles.infoRow, horizontal && styles.horizontalInfoItem]}><Text style={styles.infoLabel}>{row[0]}</Text><Text style={styles.infoValue}>{row[1]}</Text></View>)}</View></View>;
}
function StatCard({ value, label, change, icon }: { value: string; label: string; change: string; icon: IconName }) { return <View style={styles.statCard}><View style={styles.statIcon}><Ionicons name={icon} size={19} color={C.navy} /></View><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text><Text style={styles.statChange}>{change} vs. periodo anterior</Text></View>; }
function ProgressRow({ label, value, width, color }: { label: string; value: string; width: `${number}%`; color: string }) { return <View style={styles.progressGroup}><View style={styles.progressLabels}><Text style={styles.progressLabel}>{label}</Text><Text style={styles.progressValue}>{value}</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { width, backgroundColor: color }]} /></View></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, appBody: { flex: 1 }, page: { flex: 1, backgroundColor: C.bg }, pageContent: { padding: 18, gap: 16 }, row: { flexDirection: "row", alignItems: "center", gap: 10 }, listGap: { gap: 12 },
  loginPage: { flex: 1 }, loginScroll: { flexGrow: 1, padding: 24, justifyContent: "center", gap: 24 }, brandLockup: { alignItems: "center", gap: 6 }, logoHalo: { width: 280, height: 112, alignItems: "center", justifyContent: "center" }, loginLogo: { width: 250, height: 94 },
  loginCard: { backgroundColor: C.white, borderRadius: 24, padding: 22, gap: 12, boxShadow: "0 14px 36px rgba(23,33,58,0.09)" }, loginTitle: { color: C.ink, fontSize: 24, fontWeight: "800" }, loginSubtitle: { color: C.muted, fontSize: 14, marginBottom: 8 }, fieldLabel: { color: C.ink, fontSize: 13, fontWeight: "700", marginTop: 4 }, inputWrap: { height: 52, borderWidth: 1, borderColor: C.line, borderRadius: 14, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10, backgroundColor: "#FBFCFE" }, input: { flex: 1, fontSize: 14, color: C.ink, paddingVertical: 0 },
  loginOptions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, remember: { flexDirection: "row", alignItems: "center", gap: 8 }, checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: C.line, alignItems: "center", justifyContent: "center" }, checkboxOn: { backgroundColor: C.navy, borderColor: C.navy }, rememberText: { color: C.muted, fontSize: 13 }, forgot: { color: C.navy, fontSize: 13, fontWeight: "700" },
  primaryButton: { height: 54, borderRadius: 15, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 4 }, primaryButtonText: { color: C.white, fontSize: 15, fontWeight: "800" }, demoLabel: { color: C.muted, fontSize: 11, textAlign: "center", marginTop: 8 }, roleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }, roleChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line }, roleChipActive: { backgroundColor: C.blueBg, borderColor: "#B9C9F5" }, roleChipText: { color: C.muted, fontSize: 11, fontWeight: "700" }, roleChipTextActive: { color: C.navy }, loginFooter: { textAlign: "center", color: "#929BAD", fontSize: 11 },
  header: { height: 68, paddingHorizontal: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: C.bg }, headerLeft: { flexDirection: "row", alignItems: "center", gap: 11, flex: 1 }, headerLogo: { width: 34, height: 34 }, headerTitle: { color: C.ink, fontSize: 18, fontWeight: "800" }, headerRole: { color: C.muted, fontSize: 11, marginTop: 1 }, headerActions: { flexDirection: "row", alignItems: "center", gap: 8 }, iconButton: { width: 39, height: 39, borderRadius: 13, backgroundColor: C.white, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.line }, notificationDot: { position: "absolute", width: 7, height: 7, borderRadius: 4, backgroundColor: C.orange, right: 8, top: 8 }, avatar: { width: 39, height: 39, borderRadius: 13, backgroundColor: C.navy, alignItems: "center", justifyContent: "center" }, avatarText: { color: C.white, fontWeight: "800", fontSize: 12 },
  eyebrow: { color: C.orange, fontSize: 10, fontWeight: "900", letterSpacing: 1 }, greeting: { color: C.ink, fontSize: 24, fontWeight: "800", marginTop: 4 }, introText: { color: C.muted, fontSize: 13, marginTop: 5, lineHeight: 19 }, kpiRow: { flexDirection: "row", gap: 10 }, kpiCard: { flex: 1, backgroundColor: C.white, borderRadius: 17, padding: 12, minHeight: 112, borderWidth: 1, borderColor: C.line }, kpiIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 9 }, kpiValue: { color: C.ink, fontSize: 22, fontWeight: "800" }, kpiLabel: { color: C.muted, fontSize: 10, marginTop: 2 },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, filterChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 13, height: 36, borderRadius: 99, borderWidth: 1, borderColor: C.line, backgroundColor: C.white }, filterChipActive: { backgroundColor: C.navy, borderColor: C.navy }, filterChipText: { color: C.muted, fontSize: 12, fontWeight: "700" }, filterChipTextActive: { color: C.white },
  actionPair: { flexDirection: "row", gap: 10 }, secondaryAction: { flex: 1, minHeight: 52, borderRadius: 15, borderWidth: 1.5, borderColor: C.navy, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7, backgroundColor: C.white }, secondaryActionText: { color: C.navy, fontSize: 12, fontWeight: "800" }, primaryAction: { flex: 1, minHeight: 52, borderRadius: 15, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7, backgroundColor: C.navy }, primaryActionText: { color: C.white, fontSize: 12, fontWeight: "800" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }, sectionTitle: { color: C.ink, fontSize: 16, fontWeight: "800" }, sectionAction: { color: C.navy, fontSize: 11, fontWeight: "700" }, card: { backgroundColor: C.white, borderRadius: 18, padding: 14, gap: 13, borderWidth: 1, borderColor: C.line }, cardTop: { flexDirection: "row", alignItems: "center", gap: 12 }, dateBadge: { width: 45, height: 50, borderRadius: 13, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center" }, dateBadgeDay: { color: C.navy, fontSize: 17, fontWeight: "900" }, dateBadgeMonth: { color: C.navy, fontSize: 9, fontWeight: "800" }, cardTitle: { color: C.ink, fontSize: 15, fontWeight: "800" }, metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5, flexWrap: "wrap" }, cardMeta: { color: C.muted, fontSize: 11 }, dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#B3BBC9" }, badge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6 }, badgeDot: { width: 6, height: 6, borderRadius: 3 }, badgeText: { fontSize: 8, fontWeight: "900" }, cardBottom: { paddingTop: 10, borderTopWidth: 1, borderTopColor: "#EFF1F5", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, cardDate: { color: C.muted, fontSize: 11 },
  clientHero: { borderRadius: 20, padding: 19, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, clientHeroLabel: { color: "#B9C7E8", fontSize: 9, fontWeight: "900", letterSpacing: 1 }, clientHeroNumber: { color: C.white, fontSize: 36, fontWeight: "900" }, clientHeroMeta: { color: "#D9E0F1", fontSize: 11 }, heroIcon: { width: 52, height: 52, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.13)", alignItems: "center", justifyContent: "center" }, pendingBanner: { borderRadius: 17, padding: 14, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: C.redBg, borderWidth: 1, borderColor: "#F5CDCD" }, pendingIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.white, alignItems: "center", justifyContent: "center" }, pendingTitle: { color: C.red, fontSize: 13, fontWeight: "800" }, pendingText: { color: "#8B6262", fontSize: 10, marginTop: 2 },
  detailHero: { backgroundColor: C.white, borderRadius: 20, padding: 18, gap: 18, borderWidth: 1, borderColor: C.line }, detailHeroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }, detailTitle: { color: C.ink, fontSize: 25, fontWeight: "900", marginTop: 3 }, detailSubtitle: { color: C.muted, fontSize: 13, marginTop: 3 }, detailStats: { flexDirection: "row", paddingTop: 15, borderTopWidth: 1, borderTopColor: C.line }, miniStat: { flex: 1, alignItems: "center" }, miniStatValue: { color: C.ink, fontSize: 16, fontWeight: "900" }, miniStatLabel: { color: C.muted, fontSize: 9, marginTop: 3 }, infoBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 13, borderRadius: 15, backgroundColor: C.blueBg, borderWidth: 1, borderColor: "#CED9F6" }, infoText: { flex: 1, color: C.navy, fontSize: 11, lineHeight: 17 },
  personRow: { backgroundColor: C.white, borderRadius: 15, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: C.line }, smallAvatar: { width: 39, height: 39, borderRadius: 12, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center" }, smallAvatarText: { color: C.navy, fontSize: 12, fontWeight: "900" }, personName: { color: C.ink, fontSize: 13, fontWeight: "800" }, personMeta: { color: C.muted, fontSize: 10, marginTop: 3 }, noteCard: { backgroundColor: C.white, borderRadius: 15, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderColor: C.line }, noteText: { color: C.muted, fontSize: 12, lineHeight: 18, flex: 1 },
  timeline: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.white, borderRadius: 15, padding: 14, borderWidth: 1, borderColor: C.line }, timelineDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.yellow, borderWidth: 3, borderColor: C.yellowBg }, timelineTitle: { color: C.ink, fontSize: 12, fontWeight: "700" }, timelineMeta: { color: C.muted, fontSize: 10, marginTop: 3 }, reviewActions: { flexDirection: "row", gap: 10 }, requestChanges: { flex: 1.3, height: 54, borderRadius: 15, borderWidth: 1.5, borderColor: C.red, backgroundColor: C.white, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 }, requestChangesText: { color: C.red, fontSize: 12, fontWeight: "800" }, approve: { flex: 1, height: 54, borderRadius: 15, backgroundColor: C.green, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 }, approveText: { color: C.white, fontSize: 13, fontWeight: "800" }, fullSecondary: { height: 52, borderRadius: 15, borderWidth: 1.5, borderColor: C.navy, backgroundColor: C.white, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, fullSecondaryText: { color: C.navy, fontSize: 13, fontWeight: "800" },
  stepper: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", paddingVertical: 4 }, step: { alignItems: "center", gap: 5, width: 70 }, stepCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" }, stepCircleActive: { backgroundColor: C.navy, borderColor: C.navy }, stepNumber: { color: C.muted, fontSize: 11, fontWeight: "800" }, stepNumberActive: { color: C.white }, stepLabel: { color: C.muted, fontSize: 9 }, stepLabelActive: { color: C.navy, fontWeight: "700" }, stepLine: { height: 1, width: 38, backgroundColor: C.line, marginTop: 15 },
  formCard: { backgroundColor: C.white, borderRadius: 20, padding: 17, gap: 12, borderWidth: 1, borderColor: C.line }, formHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, formTitle: { color: C.ink, fontSize: 16, fontWeight: "800" }, formSubtitle: { color: C.muted, fontSize: 10, marginTop: 3 }, todayBadge: { backgroundColor: C.blueBg, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 }, todayBadgeText: { color: C.navy, fontSize: 8, fontWeight: "900" }, selectField: { height: 50, borderRadius: 13, borderWidth: 1, borderColor: C.line, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 9, marginTop: 6, backgroundColor: "#FBFCFE" }, selectDisabled: { backgroundColor: "#F3F4F7" }, selectValue: { color: C.ink, flex: 1, fontSize: 13 }, addButton: { height: 48, borderRadius: 13, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#AEBBDD", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#F8FAFF" }, addButtonText: { color: C.navy, fontSize: 12, fontWeight: "800" }, formList: { gap: 10, maxHeight: 370 }, assignmentCard: { backgroundColor: C.white, borderRadius: 16, padding: 13, borderWidth: 1, borderColor: C.line, gap: 12 }, assignmentTop: { flexDirection: "row", alignItems: "center", gap: 10 }, finalFields: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, gap: 10 }, attendanceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, miniLabel: { color: C.muted, fontSize: 11, fontWeight: "700" }, presentChip: { backgroundColor: C.greenBg, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5, flexDirection: "row", gap: 4, alignItems: "center" }, presentText: { color: C.green, fontSize: 10, fontWeight: "800" }, switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, switchLabel: { color: C.ink, fontSize: 12, fontWeight: "700" }, textArea: { minHeight: 100, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 13, color: C.ink, fontSize: 12, lineHeight: 18, textAlignVertical: "top", backgroundColor: "#FBFCFE" }, summaryStrip: { flexDirection: "row", backgroundColor: C.bg, borderRadius: 13, paddingVertical: 12 }, stickyAction: { backgroundColor: C.bg, paddingTop: 2 },
  screenIntro: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, fabInline: { width: 49, height: 49, borderRadius: 16, backgroundColor: C.orange, alignItems: "center", justifyContent: "center" }, requestCard: { backgroundColor: C.white, borderRadius: 18, padding: 15, gap: 12, borderWidth: 1, borderColor: C.line }, requestTop: { flexDirection: "row", alignItems: "center", gap: 10 }, requestIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center" }, requestArea: { color: C.muted, fontSize: 11, marginTop: 2 }, requestDescription: { color: C.muted, fontSize: 12, lineHeight: 18 }, requestBottom: { flexDirection: "row", alignItems: "center", gap: 15, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line }, requestMetric: { flexDirection: "row", alignItems: "center", gap: 5 }, requestMetricValue: { color: C.muted, fontSize: 10 }, requestBadge: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 99 }, requestBadgeText: { fontSize: 8, fontWeight: "900" },
  searchBar: { height: 52, borderRadius: 15, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }, searchInput: { flex: 1, color: C.ink, fontSize: 13 }, contractorCard: { backgroundColor: C.white, borderRadius: 17, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: C.line }, contractorAvatar: { width: 48, height: 48, borderRadius: 15, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center" }, contractorAvatarText: { color: C.navy, fontSize: 13, fontWeight: "900" }, contractorName: { color: C.ink, fontSize: 13, fontWeight: "800" }, contractorDoc: { color: C.muted, fontSize: 10, marginTop: 3 }, contractorMeta: { marginTop: 9, gap: 2 }, metaCaption: { color: "#939CAD", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.5 }, metaValue: { color: C.ink, fontSize: 10, fontWeight: "600" }, metaDate: { color: C.muted, fontSize: 9 }, statusDot: { width: 7, height: 7, borderRadius: 4 },
  profileHero: { borderRadius: 22, padding: 22, alignItems: "center" }, profileAvatar: { width: 74, height: 74, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.4)" }, profileAvatarText: { color: C.white, fontSize: 23, fontWeight: "900" }, profileName: { color: C.white, fontSize: 21, fontWeight: "900", marginTop: 12 }, profileDoc: { color: "#C6D0E8", fontSize: 11, marginTop: 3 }, activeBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.13)", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6, marginTop: 12 }, activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#5BE0A6" }, activeBadgeText: { color: C.white, fontSize: 8, fontWeight: "900" },
  infoSection: { backgroundColor: C.white, borderRadius: 18, padding: 16, gap: 12, borderWidth: 1, borderColor: C.line }, infoSectionTitle: { flexDirection: "row", alignItems: "center", gap: 9 }, infoSectionIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center" }, infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#F0F2F6" }, infoLabel: { color: C.muted, fontSize: 11 }, infoValue: { color: C.ink, fontSize: 11, fontWeight: "700", maxWidth: "58%", textAlign: "right" }, horizontalInfo: { flexDirection: "row", gap: 8 }, horizontalInfoItem: { flex: 1, flexDirection: "column", gap: 4, alignItems: "center", borderTopWidth: 0, backgroundColor: C.bg, borderRadius: 12, padding: 10 }, historyRow: { backgroundColor: C.white, borderRadius: 15, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: C.line }, historyDate: { width: 42, height: 44, borderRadius: 12, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center" }, historyDay: { color: C.navy, fontSize: 15, fontWeight: "900" }, historyMonth: { color: C.navy, fontSize: 8, fontWeight: "800" }, extraValue: { color: C.ink, fontSize: 12, fontWeight: "900", textAlign: "center" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, statCard: { width: "48.5%", backgroundColor: C.white, borderRadius: 17, padding: 14, borderWidth: 1, borderColor: C.line }, statIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: C.blueBg, alignItems: "center", justifyContent: "center", marginBottom: 10 }, statValue: { color: C.ink, fontSize: 21, fontWeight: "900" }, statLabel: { color: C.muted, fontSize: 10, marginTop: 2 }, statChange: { color: C.green, fontSize: 8, fontWeight: "700", marginTop: 7 }, chartCard: { backgroundColor: C.white, borderRadius: 19, padding: 16, borderWidth: 1, borderColor: C.line, gap: 15 }, chartHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }, chartTitle: { color: C.ink, fontSize: 14, fontWeight: "800" }, chartSubtitle: { color: C.muted, fontSize: 9, marginTop: 3 }, chartLegend: { flexDirection: "row", gap: 5, alignItems: "center" }, legendDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.navy }, legendText: { color: C.muted, fontSize: 8 }, barChart: { height: 150, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around" }, barGroup: { alignItems: "center", gap: 6 }, barGhost: { width: 28, height: 118, borderRadius: 8, backgroundColor: "#EFF2F7", justifyContent: "flex-end", overflow: "hidden" }, bar: { width: "100%", borderRadius: 8 }, barLabel: { color: C.muted, fontSize: 9 }, insightCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 18, padding: 15, backgroundColor: C.white, borderWidth: 1, borderColor: "#F4D9CF" }, insightIcon: { width: 41, height: 41, borderRadius: 13, alignItems: "center", justifyContent: "center" }, insightTitle: { color: C.ink, fontSize: 12, fontWeight: "800" }, insightText: { color: C.muted, fontSize: 10, lineHeight: 16, marginTop: 4 }, progressGroup: { gap: 6 }, progressLabels: { flexDirection: "row", justifyContent: "space-between" }, progressLabel: { color: C.muted, fontSize: 10 }, progressValue: { color: C.ink, fontSize: 10, fontWeight: "800" }, progressTrack: { height: 7, backgroundColor: "#EEF1F5", borderRadius: 99, overflow: "hidden" }, progressFill: { height: "100%", borderRadius: 99 },
  userCard: { backgroundColor: C.white, borderRadius: 17, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: C.line }, userStatus: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6 }, lastAccess: { color: "#959EAE", fontSize: 9, marginTop: 8 }, navSafe: { backgroundColor: C.white }, bottomNav: { minHeight: 67, backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.line, flexDirection: "row", paddingHorizontal: 8, paddingTop: 7 }, tab: { flex: 1, alignItems: "center", gap: 3 }, tabIcon: { width: 36, height: 30, borderRadius: 11, alignItems: "center", justifyContent: "center" }, tabIconActive: { backgroundColor: C.navy }, tabLabel: { color: C.muted, fontSize: 8, fontWeight: "600" }, tabLabelActive: { color: C.navy, fontWeight: "800" },
});
