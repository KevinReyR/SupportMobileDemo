import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Polyline,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import { loadDirectorDashboard } from "../services/data";
import type {
  DirectorDashboard,
  DirectorDashboardBreakdown,
  DirectorDashboardClient,
  DirectorDashboardDailyPoint,
} from "../types";

type DashboardPage = "executive" | "operations" | "clients";
type SortKey = keyof Pick<
  DirectorDashboardClient,
  | "name"
  | "saleTotal"
  | "costTotal"
  | "marginTotal"
  | "marginPercent"
  | "operations"
  | "workedShifts"
  | "coveragePercent"
>;

const NAVY = "#062B55";
const BLUE = "#0E4386";
const CYAN = "#08A7D5";
const GREEN = "#0A9B42";
const ORANGE = "#F3A712";
const RED = "#CF3E4F";
const INK = "#092653";
const MUTED = "#66758D";
const BORDER = "#DFE6EF";
const BG = "#F5F8FC";
const PALETTE = [BLUE, CYAN, GREEN, ORANGE, "#6D55D9", "#9AA4B2", RED];

const money = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
const number = (value: number, digits = 0) =>
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits }).format(
    value,
  );
const percent = (value: number) => `${number(value, 1)}%`;
const dateLabel = (value: string) =>
  value
    ? new Intl.DateTimeFormat("es-CO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${value}T00:00:00Z`))
    : "";
const monthStart = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
const isoToday = () => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
};
const change = (current: number, previous: number) =>
  previous === 0
    ? current === 0
      ? 0
      : 100
    : ((current - previous) * 100) / Math.abs(previous);

function NativeWebControl({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return React.createElement(
    "select",
    {
      value,
      "aria-label": ariaLabel,
      onChange: (event: any) => onChange(event.target.value),
      style: {
        border: 0,
        outline: "none",
        width: "100%",
        color: INK,
        background: "transparent",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      },
    },
    options.map((option) =>
      React.createElement(
        "option",
        { key: option.value, value: option.value },
        option.label,
      ),
    ),
  );
}

function DateControl({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return React.createElement("input", {
    type: "date",
    value,
    "aria-label": label,
    onChange: (event: any) => onChange(event.target.value),
    style: {
      border: 0,
      outline: "none",
      width: "100%",
      color: INK,
      background: "transparent",
      fontSize: 14,
      fontWeight: 600,
    },
  });
}

function FilterBox({
  icon,
  label,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.filterBox}>
      <Ionicons name={icon} size={20} color={BLUE} />
      <View style={styles.flex}>
        <Text style={styles.filterLabel}>{label}</Text>
        {children}
      </View>
    </View>
  );
}

function Delta({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const positive = value >= 0;
  return (
    <View style={styles.deltaRow}>
      <Ionicons
        name={positive ? "arrow-up" : "arrow-down"}
        size={15}
        color={positive ? GREEN : RED}
      />
      <Text style={[styles.delta, { color: positive ? GREEN : RED }]}>
        {number(Math.abs(value), 1)}
        {suffix}
      </Text>
      <Text style={styles.deltaCaption}>vs. período anterior</Text>
    </View>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 180;
  const height = 38;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values
    .map(
      (value, index) =>
        `${(index * width) / Math.max(values.length - 1, 1)},${height - 4 - ((value - min) / span) * (height - 8)}`,
    )
    .join(" ");
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Polyline points={points} fill="none" stroke={color} strokeWidth={2.2} />
    </Svg>
  );
}

function KpiCard({
  title,
  value,
  icon,
  color,
  delta,
  series,
}: {
  title: string;
  value: string;
  icon: string;
  color: string;
  delta: number;
  series: number[];
}) {
  return (
    <View style={styles.kpiCard}>
      <View style={styles.kpiHeader}>
        <View style={[styles.iconCircle, { backgroundColor: `${color}18` }]}>
          <Ionicons name={icon as any} size={23} color={color} />
        </View>
        <Text style={styles.kpiTitle}>{title}</Text>
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Delta value={delta} />
      <Sparkline values={series} color={color} />
    </View>
  );
}

function Card({
  title,
  subtitle,
  children,
  style,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  style?: any;
}) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.cardTitle}>{title}</Text>
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

function LineChart({
  data,
  series,
}: {
  data: DirectorDashboardDailyPoint[];
  series: {
    key: keyof DirectorDashboardDailyPoint;
    label: string;
    color: string;
  }[];
}) {
  const width = 760;
  const height = 235;
  const left = 55;
  const top = 20;
  const bottom = 36;
  const chartW = width - left - 16;
  const chartH = height - top - bottom;
  const values = data.flatMap((row) =>
    series.map((item) => Number(row[item.key]) || 0),
  );
  const max = Math.max(...values, 1);
  const x = (index: number) =>
    left + (index * chartW) / Math.max(data.length - 1, 1);
  const y = (value: number) => top + chartH - (value / max) * chartH;
  return (
    <View>
      <View style={styles.legend}>
        {series.map((item) => (
          <View key={String(item.key)} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={styles.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <G key={tick}>
            <Line
              x1={left}
              x2={width - 16}
              y1={top + chartH * tick}
              y2={top + chartH * tick}
              stroke="#DDE5EF"
              strokeDasharray="4 4"
            />
            <SvgText
              x={left - 8}
              y={top + chartH * tick + 4}
              textAnchor="end"
              fontSize="10"
              fill={MUTED}
            >
              {number(max * (1 - tick))}
            </SvgText>
          </G>
        ))}
        {series.map((item) => (
          <Polyline
            key={String(item.key)}
            points={data
              .map(
                (row, index) => `${x(index)},${y(Number(row[item.key]) || 0)}`,
              )
              .join(" ")}
            fill="none"
            stroke={item.color}
            strokeWidth={2.7}
          />
        ))}
        {data
          .filter(
            (_, index) =>
              index % Math.max(1, Math.ceil(data.length / 7)) === 0 ||
              index === data.length - 1,
          )
          .map((row) => {
            const index = data.indexOf(row);
            return (
              <SvgText
                key={row.date}
                x={x(index)}
                y={height - 8}
                textAnchor="middle"
                fontSize="10"
                fill={MUTED}
              >
                {row.date.slice(5).split("-").reverse().join("/")}
              </SvgText>
            );
          })}
      </Svg>
    </View>
  );
}

function DonutChart({ data }: { data: DirectorDashboardBreakdown[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const r = 58;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={styles.donutRow}>
      <Svg width={190} height={190} viewBox="0 0 190 190">
        <G rotation="-90" origin="95,95">
          {data.map((item, index) => {
            const length = total ? (item.value / total) * circumference : 0;
            const node = (
              <Circle
                key={item.name}
                cx={95}
                cy={95}
                r={r}
                fill="none"
                stroke={PALETTE[index % PALETTE.length]}
                strokeWidth={24}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return node;
          })}
        </G>
        <SvgText x={95} y={89} textAnchor="middle" fontSize="12" fill={MUTED}>
          Total
        </SvgText>
        <SvgText
          x={95}
          y={110}
          textAnchor="middle"
          fontSize="16"
          fontWeight="700"
          fill={INK}
        >
          {money(total)}
        </SvgText>
      </Svg>
      <View style={styles.donutLegend}>
        {data.map((item, index) => (
          <View key={item.name} style={styles.breakdownRow}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: PALETTE[index % PALETTE.length] },
              ]}
            />
            <Text style={styles.breakdownName}>{item.name}</Text>
            <Text style={styles.breakdownValue}>{money(item.value)}</Text>
            <Text style={styles.breakdownPercent}>
              {total ? percent((item.value * 100) / total) : "0%"}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function HorizontalBars({
  data,
  valueLabel = number,
  color = GREEN,
}: {
  data: DirectorDashboardBreakdown[];
  valueLabel?: (value: number) => string;
  color?: string;
}) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <View style={styles.barList}>
      {data.map((item) => (
        <View key={item.name} style={styles.barRow}>
          <Text style={styles.barName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  backgroundColor: color,
                  width: `${Math.max(2, (item.value / max) * 100)}%`,
                },
              ]}
            />
          </View>
          <Text style={styles.barValue}>{valueLabel(item.value)}</Text>
        </View>
      ))}
    </View>
  );
}

function StatusTile({
  title,
  value,
  icon,
  color,
  detail,
}: {
  title: string;
  value: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
  detail: string;
}) {
  return (
    <View style={styles.statusTile}>
      <Text style={styles.statusTitle}>{title}</Text>
      <View style={styles.statusValueRow}>
        <View style={[styles.iconCircle, { backgroundColor: `${color}18` }]}>
          <Ionicons name={icon} size={24} color={color} />
        </View>
        <Text style={styles.statusValue}>{value}</Text>
      </View>
      <Text style={styles.statusDetail}>{detail}</Text>
    </View>
  );
}

function ScatterPlot({ clients }: { clients: DirectorDashboardClient[] }) {
  const width = 650;
  const height = 260;
  const left = 55;
  const bottom = 36;
  const chartW = width - left - 20;
  const chartH = height - 24 - bottom;
  const maxX = Math.max(...clients.map((item) => item.operations), 1);
  const maxY = Math.max(...clients.map((item) => item.marginPercent), 1);
  const minY = Math.min(...clients.map((item) => item.marginPercent), 0);
  const spanY = maxY - minY || 1;
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Line x1={left} x2={left} y1={15} y2={height - bottom} stroke={BORDER} />
      <Line
        x1={left}
        x2={width - 10}
        y1={height - bottom}
        y2={height - bottom}
        stroke={BORDER}
      />
      {clients.map((item, index) => {
        const x = left + (item.operations / maxX) * chartW;
        const y = 15 + ((maxY - item.marginPercent) / spanY) * chartH;
        return (
          <G key={item.id}>
            <Circle
              cx={x}
              cy={y}
              r={Math.min(16, 6 + Math.sqrt(Math.max(item.saleTotal, 0)) / 900)}
              fill={`${PALETTE[index % PALETTE.length]}BB`}
            />
            <SvgText
              x={x}
              y={y - 12}
              textAnchor="middle"
              fontSize="9"
              fill={INK}
            >
              {item.name}
            </SvgText>
          </G>
        );
      })}
      <SvgText
        x={width / 2}
        y={height - 8}
        textAnchor="middle"
        fontSize="11"
        fill={MUTED}
      >
        Operaciones cerradas
      </SvgText>
      <SvgText
        x={12}
        y={height / 2}
        rotation="-90"
        origin={`12,${height / 2}`}
        textAnchor="middle"
        fontSize="11"
        fill={MUTED}
      >
        Margen %
      </SvgText>
    </Svg>
  );
}

async function exportWorkbook(report: DirectorDashboard) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Clientes y finanzas");
  sheet.addRow(["Support Colombia — Clientes y finanzas"]);
  sheet.addRow([
    `Período: ${report.period.startDate} a ${report.period.endDate}`,
  ]);
  sheet.addRow([]);
  const headers = [
    "Cliente",
    "Venta",
    "Costo",
    "Nómina",
    "Margen",
    "Margen %",
    "Operaciones",
    "Turnos",
    "Horas extra",
    "Descargues",
    "Unidades",
    "Cobertura %",
    "Variación venta %",
    "Variación margen %",
  ];
  sheet.addRow(headers);
  report.clients.forEach((client) =>
    sheet.addRow([
      client.name,
      client.saleTotal,
      client.costTotal,
      client.payrollTotal,
      client.marginTotal,
      client.marginPercent,
      client.operations,
      client.workedShifts,
      client.extraHours,
      client.dischargeOperations,
      client.dischargedUnits,
      client.coveragePercent,
      client.saleChangePercent,
      client.marginChangePercent,
    ]),
  );
  sheet.addRow([
    "TOTAL",
    report.current.saleTotal,
    report.current.costTotal,
    report.current.payrollTotal,
    report.current.marginTotal,
    report.current.marginPercent,
    report.current.operationsClosed,
    report.current.workedShifts,
    report.current.extraHours,
    report.current.dischargeOperations,
    report.current.dischargedUnits,
    report.current.coveragePercent,
  ]);
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: "FF092653" } };
  sheet.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(4).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0E4386" },
  };
  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 28 : 16;
  });
  [2, 3, 4, 5].forEach((column) => {
    sheet.getColumn(column).numFmt = '"$"#,##0';
  });
  [6, 12, 13, 14].forEach((column) => {
    sheet.getColumn(column).numFmt = '0.0"%"';
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `opera360-clientes-${report.period.startDate}-${report.period.endDate}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function DirectorWebDashboard() {
  const today = isoToday();
  const [startDate, setStartDate] = useState(
    monthStart(new Date(`${today}T12:00:00`)),
  );
  const [endDate, setEndDate] = useState(today);
  const [clientId, setClientId] = useState("0");
  const [areaId, setAreaId] = useState("0");
  const [operationType, setOperationType] = useState("");
  const [page, setPage] = useState<DashboardPage>("executive");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [report, setReport] = useState<DirectorDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("saleTotal");
  const [ascending, setAscending] = useState(false);
  const [tablePage, setTablePage] = useState(0);
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-opera360-print", "true");
    style.textContent = `@media print {
      @page { size: landscape; margin: 8mm; }
      body * { visibility: hidden !important; }
      [data-dashboard-print-root="true"], [data-dashboard-print-root="true"] * { visibility: visible !important; }
      [data-dashboard-print-root="true"] { position: absolute !important; inset: 0 !important; width: 100% !important; min-height: auto !important; background: white !important; }
      [data-dashboard-print-root="true"] > div:first-child { display: none !important; }
      [data-dashboard-print-root="true"] > div:last-child { overflow: visible !important; }
      [data-dashboard-print-root="true"] button { display: none !important; }
      [data-dashboard-print-root="true"] svg { break-inside: avoid; }
    }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const refresh = useCallback(async () => {
    if (!startDate || !endDate || startDate > endDate) {
      setError("La fecha inicial no puede ser posterior a la fecha final.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      setReport(
        await loadDirectorDashboard({
          startDate,
          endDate,
          clientId: Number(clientId) || null,
          areaId: Number(areaId) || null,
          operationType: operationType || null,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible cargar el dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, [areaId, clientId, endDate, operationType, startDate]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    setAreaId("0");
  }, [clientId]);
  const sortedClients = useMemo(
    () =>
      [...(report?.clients ?? [])].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const result =
          typeof av === "string"
            ? av.localeCompare(String(bv), "es")
            : Number(av) - Number(bv);
        return ascending ? result : -result;
      }),
    [ascending, report?.clients, sortKey],
  );
  const rows = sortedClients.slice(tablePage * 8, tablePage * 8 + 8);
  const totalPages = Math.max(1, Math.ceil(sortedClients.length / 8));
  const financeDelta = (
    key:
      | "saleTotal"
      | "costTotal"
      | "payrollTotal"
      | "marginTotal"
      | "marginPercent",
  ) => (report ? change(report.current[key], report.previous[key]) : 0);
  const series = report?.dailySeries ?? [];
  const nav = [
    {
      id: "executive" as const,
      label: "Resumen ejecutivo",
      icon: "home-outline" as const,
    },
    {
      id: "operations" as const,
      label: "Operación y personal",
      icon: "people-outline" as const,
    },
    {
      id: "clients" as const,
      label: "Clientes y finanzas",
      icon: "business-outline" as const,
    },
  ];
  const filters = report?.filters;
  const DashboardRoot = View as any;

  return (
    <DashboardRoot
      style={styles.shell}
      dataSet={{ dashboardPrintRoot: "true" }}
    >
      <View
        style={[styles.sidebar, sidebarCollapsed && styles.sidebarCollapsed]}
      >
        <View style={styles.navList}>
          {nav.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setPage(item.id)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: page === item.id }}
              style={[
                styles.navItem,
                sidebarCollapsed && styles.navItemCollapsed,
                page === item.id && styles.navItemActive,
              ]}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={page === item.id ? "#fff" : "#BFD7F2"}
              />
              {!sidebarCollapsed ? (
                <Text
                  style={[
                    styles.navText,
                    page === item.id && styles.navTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
        <View style={styles.sidebarBottom}>
          {!sidebarCollapsed ? (
            <View style={styles.sidebarNotice}>
              <Ionicons
                name="shield-checkmark-outline"
                size={17}
                color="#8FC7EE"
              />
              <Text style={styles.sidebarFooterText}>
                Información exclusiva del Director
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={() => setSidebarCollapsed((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={
              sidebarCollapsed
                ? "Mostrar panel lateral"
                : "Ocultar panel lateral"
            }
            accessibilityState={{ expanded: !sidebarCollapsed }}
            style={[
              styles.sidebarToggle,
              sidebarCollapsed && styles.sidebarToggleCollapsed,
            ]}
          >
            <Ionicons
              name={sidebarCollapsed ? "chevron-forward" : "chevron-back"}
              size={19}
              color="#D7E9F8"
            />
            {!sidebarCollapsed ? (
              <Text style={styles.sidebarToggleText}>Ocultar panel</Text>
            ) : null}
          </Pressable>
        </View>
      </View>
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
      >
        <View style={styles.topRow}>
          <View>
            <Text style={styles.pageTitle}>
              {page === "executive"
                ? "Resumen ejecutivo"
                : page === "operations"
                  ? "Operación y personal"
                  : "Clientes y finanzas"}
            </Text>
            <Text style={styles.periodText}>
              Período actual:{" "}
              <Text style={styles.linkText}>
                {dateLabel(startDate)} – {dateLabel(endDate)}
              </Text>
              {report
                ? `  ·  Comparado con ${dateLabel(report.period.previousStartDate)} – ${dateLabel(report.period.previousEndDate)}`
                : ""}
            </Text>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              style={styles.actionButton}
              onPress={() => window.print()}
            >
              <Ionicons name="document-text-outline" size={17} color={BLUE} />
              <Text style={styles.actionText}>PDF</Text>
            </Pressable>
            <Pressable
              style={styles.actionButton}
              disabled={!report}
              onPress={() => report && exportWorkbook(report)}
            >
              <Ionicons name="grid-outline" size={17} color={GREEN} />
              <Text style={styles.actionText}>Excel</Text>
            </Pressable>
            {report ? (
              <View style={styles.updated}>
                <Ionicons name="refresh-outline" size={17} color={BLUE} />
                <Text style={styles.updatedText}>
                  Actualizado{`\n`}
                  {report.generatedAt.replace("T", " ")}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.filters}>
          <FilterBox icon="calendar-outline" label="Desde">
            <DateControl
              value={startDate}
              onChange={setStartDate}
              label="Fecha inicial"
            />
          </FilterBox>
          <FilterBox icon="calendar-outline" label="Hasta">
            <DateControl
              value={endDate}
              onChange={setEndDate}
              label="Fecha final"
            />
          </FilterBox>
          <FilterBox icon="people-outline" label="Cliente">
            <NativeWebControl
              ariaLabel="Cliente"
              value={clientId}
              onChange={setClientId}
              options={[
                { value: "0", label: "Todos" },
                ...(filters?.clients ?? []).map((item) => ({
                  value: String(item.id),
                  label: item.name,
                })),
              ]}
            />
          </FilterBox>
          <FilterBox icon="business-outline" label="Área">
            <NativeWebControl
              ariaLabel="Área"
              value={areaId}
              onChange={setAreaId}
              options={[
                { value: "0", label: "Todas" },
                ...(filters?.areas ?? []).map((item) => ({
                  value: String(item.id),
                  label: item.name,
                })),
              ]}
            />
          </FilterBox>
          <FilterBox icon="briefcase-outline" label="Tipo de operación">
            <NativeWebControl
              ariaLabel="Tipo de operación"
              value={operationType}
              onChange={setOperationType}
              options={[
                { value: "", label: "Todos" },
                ...(filters?.operationTypes ?? []).map((item) => ({
                  value: item.code,
                  label: item.name,
                })),
              ]}
            />
          </FilterBox>
        </View>
        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator size="large" color={BLUE} />
            <Text style={styles.stateText}>
              Preparando indicadores gerenciales…
            </Text>
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Ionicons name="cloud-offline-outline" size={38} color={RED} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retry} onPress={refresh}>
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : !report ? null : page === "executive" ? (
          <>
            <View style={styles.kpiGrid}>
              <KpiCard
                title="Venta"
                value={money(report.current.saleTotal)}
                icon="cash-outline"
                color={BLUE}
                delta={financeDelta("saleTotal")}
                series={series.map((item) => item.saleTotal)}
              />
              <KpiCard
                title="Costo"
                value={money(report.current.costTotal)}
                icon="pricetag-outline"
                color={CYAN}
                delta={financeDelta("costTotal")}
                series={series.map((item) => item.costTotal)}
              />
              <KpiCard
                title="Margen bruto"
                value={money(report.current.marginTotal)}
                icon="trending-up-outline"
                color={GREEN}
                delta={financeDelta("marginTotal")}
                series={series.map((item) => item.marginTotal)}
              />
              <KpiCard
                title="Margen"
                value={percent(report.current.marginPercent)}
                icon="percent-outline"
                color={CYAN}
                delta={
                  report.current.marginPercent - report.previous.marginPercent
                }
                series={series.map((item) =>
                  item.saleTotal
                    ? (item.marginTotal * 100) / item.saleTotal
                    : 0,
                )}
              />
              <KpiCard
                title="Nómina"
                value={money(report.current.payrollTotal)}
                icon="people-outline"
                color={BLUE}
                delta={financeDelta("payrollTotal")}
                series={series.map((item) => item.payrollTotal)}
              />
            </View>
            <View style={styles.twoColumns}>
              <Card
                title="Venta, costo y margen por día"
                style={styles.wideCard}
              >
                <LineChart
                  data={series}
                  series={[
                    { key: "saleTotal", label: "Venta", color: BLUE },
                    { key: "costTotal", label: "Costo", color: CYAN },
                    { key: "marginTotal", label: "Margen", color: GREEN },
                  ]}
                />
              </Card>
              <Card title="Composición del costo" style={styles.mediumCard}>
                {report.costComposition.length ? (
                  <DonutChart data={report.costComposition} />
                ) : (
                  <Text style={styles.empty}>Sin costos en el período.</Text>
                )}
              </Card>
            </View>
            <View style={styles.bottomGrid}>
              <Card title="Margen por cliente" style={styles.wideCard}>
                <HorizontalBars
                  data={report.clients.slice(0, 8).map((item) => ({
                    name: item.name,
                    value: item.marginTotal,
                  }))}
                  valueLabel={money}
                />
              </Card>
              <StatusTile
                title="Operaciones cerradas"
                value={number(report.current.operationsClosed)}
                icon="checkmark-circle-outline"
                color={CYAN}
                detail={`Promedio ${money(report.current.operationsClosed ? report.current.saleTotal / report.current.operationsClosed : 0)}`}
              />
              <StatusTile
                title="Operaciones pendientes"
                value={number(report.current.operationsPending)}
                icon="hourglass-outline"
                color={ORANGE}
                detail={`Venta actual ${money(report.current.saleTotal)}`}
              />
              <StatusTile
                title="Cobertura de personal"
                value={percent(report.current.coveragePercent)}
                icon="people-circle-outline"
                color={CYAN}
                detail={`${number(report.current.workedShifts)} de ${number(report.current.plannedShifts)} turnos`}
              />
            </View>
          </>
        ) : page === "operations" ? (
          <>
            <View style={styles.kpiGrid}>
              <KpiCard
                title="Turnos planeados"
                value={number(report.current.plannedShifts)}
                icon="calendar-outline"
                color={BLUE}
                delta={change(
                  report.current.plannedShifts,
                  report.previous.plannedShifts,
                )}
                series={series.map((item) => item.plannedShifts)}
              />
              <KpiCard
                title="Turnos trabajados"
                value={number(report.current.workedShifts)}
                icon="checkmark-done-outline"
                color={GREEN}
                delta={change(
                  report.current.workedShifts,
                  report.previous.workedShifts,
                )}
                series={series.map((item) => item.workedShifts)}
              />
              <KpiCard
                title="Cobertura"
                value={percent(report.current.coveragePercent)}
                icon="people-outline"
                color={CYAN}
                delta={
                  report.current.coveragePercent -
                  report.previous.coveragePercent
                }
                series={series.map((item) =>
                  item.plannedShifts
                    ? (item.workedShifts * 100) / item.plannedShifts
                    : 0,
                )}
              />
              <KpiCard
                title="Ausencias"
                value={number(report.current.absences)}
                icon="person-remove-outline"
                color={RED}
                delta={change(
                  report.current.absences,
                  report.previous.absences,
                )}
                series={series.map((item) => item.absences)}
              />
              <KpiCard
                title="Horas extra"
                value={number(report.current.extraHours, 1)}
                icon="time-outline"
                color={ORANGE}
                delta={change(
                  report.current.extraHours,
                  report.previous.extraHours,
                )}
                series={series.map((item) => item.extraHours)}
              />
              <KpiCard
                title="Unidades descargadas"
                value={number(report.current.dischargedUnits)}
                icon="cube-outline"
                color="#6D55D9"
                delta={change(
                  report.current.dischargedUnits,
                  report.previous.dischargedUnits,
                )}
                series={series.map((item) => item.dischargedUnits)}
              />
            </View>
            <View style={styles.twoColumns}>
              <Card
                title="Turnos planeados vs. trabajados"
                style={styles.wideCard}
              >
                <LineChart
                  data={series}
                  series={[
                    { key: "plannedShifts", label: "Planeados", color: BLUE },
                    { key: "workedShifts", label: "Trabajados", color: GREEN },
                  ]}
                />
              </Card>
              <Card title="Cobertura por cliente" style={styles.mediumCard}>
                <HorizontalBars
                  data={report.clients.slice(0, 8).map((item) => ({
                    name: item.name,
                    value: item.coveragePercent,
                  }))}
                  valueLabel={percent}
                  color={CYAN}
                />
              </Card>
            </View>
            <View style={styles.threeColumns}>
              <Card title="Estado contractual">
                <DonutChart data={report.contractStatus} />
              </Card>
              <Card title="Antigüedad del contrato">
                <HorizontalBars data={report.tenure} />
              </Card>
              <Card title="Tipo de contrato">
                <HorizontalBars data={report.contractTypes} color={BLUE} />
              </Card>
            </View>
            <View style={styles.twoColumns}>
              <Card title="Carga por tipo de operación" style={styles.wideCard}>
                <HorizontalBars
                  data={report.operationTypes.map((item) => ({
                    name: item.operationTypeName,
                    value:
                      item.operationType === "TURNO"
                        ? item.workedShifts
                        : item.dischargedUnits,
                  }))}
                />
              </Card>
              <Card title="Resumen operacional" style={styles.mediumCard}>
                <View style={styles.summaryList}>
                  {report.operationTypes.map((item) => (
                    <View key={item.operationType} style={styles.summaryRow}>
                      <Text style={styles.summaryName}>
                        {item.operationTypeName}
                      </Text>
                      <Text style={styles.summaryValue}>
                        {number(item.operations)} operaciones
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            </View>
          </>
        ) : (
          <>
            <View style={styles.kpiGrid}>
              <KpiCard
                title="Venta"
                value={money(report.current.saleTotal)}
                icon="cash-outline"
                color={BLUE}
                delta={financeDelta("saleTotal")}
                series={series.map((item) => item.saleTotal)}
              />
              <KpiCard
                title="Costo"
                value={money(report.current.costTotal)}
                icon="pricetag-outline"
                color={CYAN}
                delta={financeDelta("costTotal")}
                series={series.map((item) => item.costTotal)}
              />
              <KpiCard
                title="Nómina"
                value={money(report.current.payrollTotal)}
                icon="people-outline"
                color={ORANGE}
                delta={financeDelta("payrollTotal")}
                series={series.map((item) => item.payrollTotal)}
              />
              <KpiCard
                title="Margen bruto"
                value={money(report.current.marginTotal)}
                icon="trending-up-outline"
                color={GREEN}
                delta={financeDelta("marginTotal")}
                series={series.map((item) => item.marginTotal)}
              />
              <KpiCard
                title="Margen"
                value={percent(report.current.marginPercent)}
                icon="percent-outline"
                color={CYAN}
                delta={
                  report.current.marginPercent - report.previous.marginPercent
                }
                series={series.map((item) =>
                  item.saleTotal
                    ? (item.marginTotal * 100) / item.saleTotal
                    : 0,
                )}
              />
            </View>
            <View style={styles.twoColumns}>
              <Card title="Tendencia financiera" style={styles.wideCard}>
                <LineChart
                  data={series}
                  series={[
                    { key: "saleTotal", label: "Venta", color: BLUE },
                    { key: "costTotal", label: "Costo", color: CYAN },
                    { key: "marginTotal", label: "Margen", color: GREEN },
                  ]}
                />
              </Card>
              <Card title="Rentabilidad vs. volumen" style={styles.mediumCard}>
                <ScatterPlot clients={report.clients} />
              </Card>
            </View>
            <View style={styles.twoColumns}>
              <Card title="Venta por cliente" style={styles.wideCard}>
                <HorizontalBars
                  data={report.clients.slice(0, 10).map((item) => ({
                    name: item.name,
                    value: item.saleTotal,
                  }))}
                  valueLabel={money}
                  color={BLUE}
                />
              </Card>
              <Card title="Margen por cliente" style={styles.mediumCard}>
                <HorizontalBars
                  data={report.clients.slice(0, 10).map((item) => ({
                    name: item.name,
                    value: item.marginTotal,
                  }))}
                  valueLabel={money}
                  color={GREEN}
                />
              </Card>
            </View>
            <Card
              title="Detalle por cliente"
              subtitle="Selecciona un encabezado para ordenar la tabla."
            >
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                  {(
                    [
                      ["name", "Cliente"],
                      ["saleTotal", "Venta"],
                      ["costTotal", "Costo"],
                      ["marginTotal", "Margen"],
                      ["marginPercent", "Margen %"],
                      ["operations", "Operaciones"],
                      ["workedShifts", "Turnos"],
                      ["coveragePercent", "Cobertura"],
                    ] as [SortKey, string][]
                  ).map(([key, label]) => (
                    <Pressable
                      key={key}
                      style={[
                        styles.tableCell,
                        key === "name" && styles.clientCell,
                      ]}
                      onPress={() => {
                        if (sortKey === key) setAscending(!ascending);
                        else {
                          setSortKey(key);
                          setAscending(false);
                        }
                      }}
                    >
                      <Text style={styles.tableHeaderText}>
                        {label}
                        {sortKey === key ? (ascending ? " ↑" : " ↓") : ""}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {rows.map((client) => (
                  <View key={client.id} style={styles.tableRow}>
                    <Text style={[styles.tableCellText, styles.clientCell]}>
                      {client.name}
                    </Text>
                    <Text style={styles.tableCellText}>
                      {money(client.saleTotal)}
                    </Text>
                    <Text style={styles.tableCellText}>
                      {money(client.costTotal)}
                    </Text>
                    <Text
                      style={[
                        styles.tableCellText,
                        { color: client.marginTotal >= 0 ? GREEN : RED },
                      ]}
                    >
                      {money(client.marginTotal)}
                    </Text>
                    <Text style={styles.tableCellText}>
                      {percent(client.marginPercent)}
                    </Text>
                    <Text style={styles.tableCellText}>
                      {number(client.operations)}
                    </Text>
                    <Text style={styles.tableCellText}>
                      {number(client.workedShifts)}
                    </Text>
                    <Text style={styles.tableCellText}>
                      {percent(client.coveragePercent)}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.pagination}>
                <Pressable
                  disabled={tablePage === 0}
                  onPress={() => setTablePage(Math.max(0, tablePage - 1))}
                  style={styles.pageButton}
                >
                  <Ionicons name="chevron-back" size={17} color={INK} />
                </Pressable>
                <Text style={styles.pageText}>
                  Página {tablePage + 1} de {totalPages}
                </Text>
                <Pressable
                  disabled={tablePage + 1 >= totalPages}
                  onPress={() =>
                    setTablePage(Math.min(totalPages - 1, tablePage + 1))
                  }
                  style={styles.pageButton}
                >
                  <Ionicons name="chevron-forward" size={17} color={INK} />
                </Pressable>
              </View>
            </Card>
          </>
        )}
        <Text style={styles.footerNote}>
          Valores en COP. Las cifras pueden variar por redondeo. Información
          gerencial de acceso restringido.
        </Text>
      </ScrollView>
    </DashboardRoot>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: BG, minHeight: 720 },
  sidebar: {
    width: 225,
    backgroundColor: NAVY,
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  sidebarCollapsed: { width: 68, paddingHorizontal: 8 },
  navList: { gap: 9 },
  navItem: {
    minHeight: 50,
    borderRadius: 11,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  navItemCollapsed: {
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  navItemActive: { backgroundColor: "#0D4D91" },
  navText: { color: "#BFD7F2", fontSize: 14, fontWeight: "600" },
  navTextActive: { color: "#fff" },
  sidebarBottom: {
    marginTop: "auto",
    borderTopWidth: 1,
    borderTopColor: "#416182",
    paddingTop: 16,
    gap: 14,
  },
  sidebarNotice: {
    flexDirection: "row",
    gap: 8,
  },
  sidebarFooterText: { color: "#AFC9E1", fontSize: 11, flex: 1 },
  sidebarToggle: {
    minHeight: 42,
    borderRadius: 9,
    backgroundColor: "#0B467F",
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  sidebarToggleCollapsed: { paddingHorizontal: 0 },
  sidebarToggleText: { color: "#D7E9F8", fontSize: 12, fontWeight: "700" },
  content: { flex: 1 },
  contentInner: {
    padding: 22,
    gap: 16,
    maxWidth: 1600,
    width: "100%",
    alignSelf: "center",
  },
  flex: { flex: 1 },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 18,
  },
  pageTitle: { color: INK, fontSize: 30, fontWeight: "800" },
  periodText: { color: MUTED, fontSize: 13, marginTop: 5 },
  linkText: { color: CYAN, fontWeight: "700" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  actionButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 9,
    paddingHorizontal: 12,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionText: { color: INK, fontSize: 13, fontWeight: "700" },
  updated: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  updatedText: { color: INK, fontSize: 11 },
  filters: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  filterBox: {
    flex: 1,
    minWidth: 170,
    maxWidth: 280,
    minHeight: 58,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  filterLabel: {
    color: MUTED,
    fontSize: 10,
    textTransform: "uppercase",
    fontWeight: "700",
    marginBottom: 2,
  },
  state: {
    minHeight: 420,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  stateText: { color: MUTED },
  errorText: { color: RED, fontWeight: "600" },
  retry: {
    backgroundColor: BLUE,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: { color: "#fff", fontWeight: "700" },
  kpiGrid: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  kpiCard: {
    flex: 1,
    minWidth: 205,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 15,
  },
  kpiHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiTitle: { color: INK, fontWeight: "700", fontSize: 13 },
  kpiValue: { color: INK, fontWeight: "800", fontSize: 23, marginTop: 8 },
  deltaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 7,
  },
  delta: { fontWeight: "700", fontSize: 12 },
  deltaCaption: { color: MUTED, fontSize: 10, marginLeft: 3 },
  twoColumns: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  threeColumns: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  card: {
    flex: 1,
    minWidth: 300,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 16,
  },
  wideCard: { flex: 1.5, minWidth: 520 },
  mediumCard: { flex: 1, minWidth: 390 },
  cardTitle: { color: INK, fontSize: 16, fontWeight: "800", marginBottom: 3 },
  cardSubtitle: { color: MUTED, fontSize: 11, marginBottom: 9 },
  legend: { flexDirection: "row", gap: 16, marginVertical: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 11, color: INK },
  donutRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  donutLegend: { flex: 1, minWidth: 220 },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F7",
  },
  breakdownName: { color: INK, fontSize: 11, flex: 1 },
  breakdownValue: { color: INK, fontSize: 11, fontWeight: "600" },
  breakdownPercent: {
    color: MUTED,
    fontSize: 10,
    width: 42,
    textAlign: "right",
  },
  empty: { color: MUTED, paddingVertical: 45, textAlign: "center" },
  barList: { gap: 11, paddingTop: 14 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  barName: { width: 115, color: INK, fontSize: 11 },
  barTrack: {
    flex: 1,
    height: 16,
    backgroundColor: "#EDF1F6",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 3 },
  barValue: {
    width: 90,
    textAlign: "right",
    color: INK,
    fontWeight: "700",
    fontSize: 10,
  },
  bottomGrid: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  statusTile: {
    minWidth: 205,
    flex: 0.5,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 16,
  },
  statusTitle: { color: INK, fontWeight: "800", fontSize: 13 },
  statusValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 14,
  },
  statusValue: { color: INK, fontWeight: "800", fontSize: 28 },
  statusDetail: {
    borderTopWidth: 1,
    borderTopColor: "#E8EDF4",
    paddingTop: 10,
    color: MUTED,
    fontSize: 11,
  },
  summaryList: { marginTop: 12 },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#EDF1F5",
    paddingVertical: 13,
  },
  summaryName: { color: INK, fontWeight: "700" },
  summaryValue: { color: MUTED },
  table: { minWidth: 920, marginTop: 12 },
  tableRow: {
    flexDirection: "row",
    minHeight: 46,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E8EDF3",
  },
  tableHeader: { backgroundColor: "#EEF4FB", borderRadius: 6 },
  tableCell: { flex: 1, paddingHorizontal: 8 },
  tableCellText: { flex: 1, paddingHorizontal: 8, color: INK, fontSize: 11 },
  clientCell: { flex: 1.5 },
  tableHeaderText: { color: INK, fontWeight: "800", fontSize: 11 },
  pagination: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  pageButton: {
    width: 34,
    height: 34,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  pageText: { color: MUTED, fontSize: 11 },
  footerNote: { color: MUTED, fontSize: 10, marginTop: 2, marginBottom: 16 },
});
