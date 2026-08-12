import React from "react";
import {
  Activity,
  BadgeDollarSign,
  BatteryCharging,
  BookOpen,
  CircleDollarSign,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trophy,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CollapsiblePanel, PanelHeader } from "../components/Common";
import {
  calculateBookStrategy,
  defaultBookStrategyInputs,
  type BookStrategyInputs,
  type BookStrategyPoint,
  type BookStrategyResult,
  type EnhancerUseMode,
} from "../utils/bookStrategy";

type EnergyMode = "total" | "breakdown";
type EnhancerModeKind = EnhancerUseMode["kind"];
type PopoutKind = "energy" | "perks" | "investment" | "prices";

const CHART_Y_AXIS_WIDTH = 58;
const CHART_RIGHT_MARGIN = 18;

type BookStrategyForm = {
  startingStat: string;
  dailyEnergy: string;
  startingEnergy: string;
  happiness: string;
  naturalEnergy: string;
  xanaxPerDay: string;
  dailyRefill: string;
  otherDailyEnergy: string;
  privateIslandPercent: string;
  generalEducationPercent: string;
  statEducationPercent: string;
  steadfastPercent: string;
  customPerksPercent: string;
  gymMultiplier: string;
  statEnhancerPrice: string;
  fhcPrice: string;
  investmentEnabled: boolean;
  annualRoiPercent: string;
  graphDurationDays: string;
  bookBonusPercent: string;
  enhancerMode: EnhancerModeKind;
  enhancerTargetStat: string;
  enhancerTargetDay: string;
};

const FIXED_ENERGY_PER_XANAX = 250;
const DEFAULT_FORM = formFromInputs(defaultBookStrategyInputs);

export function BookStrategy() {
  const [form, setForm] = React.useState<BookStrategyForm>(DEFAULT_FORM);
  const [energyMode, setEnergyMode] = React.useState<EnergyMode>("total");
  const [openPopout, setOpenPopout] = React.useState<PopoutKind | null>(null);
  const [methodologyOpen, setMethodologyOpen] = React.useState(false);
  const [isDraggingEnhancerDay, setIsDraggingEnhancerDay] = React.useState(false);
  const [chartWidth, setChartWidth] = React.useState(0);
  const chartRef = React.useRef<HTMLDivElement | null>(null);
  const inputs = React.useMemo(() => inputsFromForm(form, energyMode), [energyMode, form]);
  const result = React.useMemo(() => calculateBookStrategy(inputs), [inputs]);
  const enhancerMarkerDay = result.enhancerUse.day;
  const enhancerMarkerLeft =
    enhancerMarkerDay !== null
      ? CHART_Y_AXIS_WIDTH +
        (enhancerMarkerDay / Math.max(1, result.inputs.graphDurationDays)) *
        Math.max(1, chartWidth - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN)
      : null;

  function updateField<K extends keyof BookStrategyForm>(field: K, value: BookStrategyForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetDefaults() {
    setForm(DEFAULT_FORM);
    setEnergyMode("total");
    setOpenPopout(null);
    setIsDraggingEnhancerDay(false);
  }

  const dailyEnergy = energyMode === "breakdown" ? calculatedDailyEnergy(form) : parseNumber(form.dailyEnergy, 0);

  const updateEnhancerTargetFromClientX = React.useCallback((clientX: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const plotLeft = rect.left + CHART_Y_AXIS_WIDTH;
    const plotWidth = Math.max(1, rect.width - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN);
    const rawRatio = (clientX - plotLeft) / plotWidth;
    const rawDay = rawRatio * result.inputs.graphDurationDays;
    const day = clampNumber(Math.round(rawDay), result.inputs.bookDurationDays, result.inputs.graphDurationDays);

    setForm((current) => ({
      ...current,
      enhancerMode: "targetDay",
      enhancerTargetDay: String(day),
    }));
  }, [result.inputs.bookDurationDays, result.inputs.graphDurationDays]);

  React.useEffect(() => {
    const element = chartRef.current;
    if (!element) {
      return undefined;
    }

    const updateWidth = () => setChartWidth(element.getBoundingClientRect().width);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!isDraggingEnhancerDay) {
      return undefined;
    }

    function handlePointerMove(event: PointerEvent) {
      updateEnhancerTargetFromClientX(event.clientX);
    }

    function handlePointerUp() {
      setIsDraggingEnhancerDay(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isDraggingEnhancerDay, updateEnhancerTargetFromClientX]);

  return (
    <>
      <section className="hero-panel compact-hero-panel book-strategy-hero">
        <div>
          <p className="eyebrow">Calculator</p>
          <h2>Book Strategy</h2>
          <p>
            Expected stat growth from FHC-heavy book training versus saving the cash for later stat enhancers.
          </p>
        </div>
        <button type="button" className="panel-action-button" onClick={resetDefaults}>
          <RotateCcw size={15} />
          Reset
        </button>
      </section>

      <section className="book-strategy-layout">
        <div className="book-strategy-controls">
          <section className="panel book-strategy-panel book-strategy-input-panel">
            <PanelHeader
              icon={<SlidersHorizontal size={17} />}
              title="Inputs"
              control={
                <div className="book-strategy-popout-actions">
                  <PopoutButton
                    icon={<BatteryCharging size={15} />}
                    label="Energy"
                    active={openPopout === "energy"}
                    onClick={() => setOpenPopout((current) => current === "energy" ? null : "energy")}
                  />
                  <PopoutButton
                    icon={<Sparkles size={15} />}
                    label="Perks"
                    active={openPopout === "perks"}
                    onClick={() => setOpenPopout((current) => current === "perks" ? null : "perks")}
                  />
                  <PopoutButton
                    icon={<CircleDollarSign size={15} />}
                    label="Investment"
                    active={openPopout === "investment"}
                    onClick={() => setOpenPopout((current) => current === "investment" ? null : "investment")}
                  />
                  <PopoutButton
                    icon={<BadgeDollarSign size={15} />}
                    label="Prices"
                    active={openPopout === "prices"}
                    onClick={() => setOpenPopout((current) => current === "prices" ? null : "prices")}
                  />
                </div>
              }
            />
            <div className="book-strategy-input-grid">
              <NumberField label="Starting stat" value={form.startingStat} onChange={(value) => updateField("startingStat", value)} />
              <NumberField label="Happiness" value={form.happiness} onChange={(value) => updateField("happiness", value)} />
              <NumberField label="Graph duration (days)" value={form.graphDurationDays} onChange={(value) => updateField("graphDurationDays", value)} />
              <NumberField label="Gym dots" value={form.gymMultiplier} onChange={(value) => updateField("gymMultiplier", value)} />
              <NumberField label="Book bonus %" value={form.bookBonusPercent} onChange={(value) => updateField("bookBonusPercent", value)} />
            </div>
            {openPopout === "energy" ? (
              <div className="book-strategy-popout" role="dialog" aria-label="Energy">
                <div className="book-strategy-popout-heading">
                  <strong>Energy</strong>
                  <span>{formatEnergy(dailyEnergy)} daily</span>
                </div>
                <div className="segmented-control" aria-label="Daily energy source">
                  <button
                    type="button"
                    className={energyMode === "total" ? "active" : ""}
                    onClick={() => setEnergyMode("total")}
                  >
                    Total
                  </button>
                  <button
                    type="button"
                    className={energyMode === "breakdown" ? "active" : ""}
                    onClick={() => setEnergyMode("breakdown")}
                  >
                    Breakdown
                  </button>
                </div>
                {energyMode === "total" ? (
                  <NumberField label="Daily energy" value={form.dailyEnergy} onChange={(value) => updateField("dailyEnergy", value)} />
                ) : (
                  <div className="book-strategy-popout-grid">
                    <NumberField label="Natural" value={form.naturalEnergy} onChange={(value) => updateField("naturalEnergy", value)} />
                    <NumberField label="Xanax/day" value={form.xanaxPerDay} onChange={(value) => updateField("xanaxPerDay", value)} />
                    <NumberField label="Daily refill" value={form.dailyRefill} onChange={(value) => updateField("dailyRefill", value)} />
                    <NumberField label="Other" value={form.otherDailyEnergy} onChange={(value) => updateField("otherDailyEnergy", value)} />
                  </div>
                )}
                <div className="book-strategy-popout-grid">
                  <NumberField label="Starting energy" value={form.startingEnergy} onChange={(value) => updateField("startingEnergy", value)} />
                </div>
              </div>
            ) : null}
            {openPopout === "perks" ? (
              <div className="book-strategy-popout" role="dialog" aria-label="Perks">
                <div className="book-strategy-popout-grid">
                  <NumberField label="Property" suffix="%" value={form.privateIslandPercent} onChange={(value) => updateField("privateIslandPercent", value)} />
                  <NumberField label="Education (General)" suffix="%" value={form.generalEducationPercent} onChange={(value) => updateField("generalEducationPercent", value)} />
                  <NumberField label="Education (Stat Specific)" suffix="%" value={form.statEducationPercent} onChange={(value) => updateField("statEducationPercent", value)} />
                  <NumberField label="Faction Steadfast" suffix="%" value={form.steadfastPercent} onChange={(value) => updateField("steadfastPercent", value)} />
                  <NumberField label="Job Perks" suffix="%" value={form.customPerksPercent} onChange={(value) => updateField("customPerksPercent", value)} />
                </div>
              </div>
            ) : null}
            {openPopout === "investment" ? (
              <div className="book-strategy-popout" role="dialog" aria-label="Investment">
                <label className="book-strategy-check">
                  <input
                    type="checkbox"
                    checked={form.investmentEnabled}
                    onChange={(event) => updateField("investmentEnabled", event.target.checked)}
                  />
                  <span>Enable Investment</span>
                </label>
                <div className="book-strategy-popout-grid">
                  <NumberField label="Annual ROI" suffix="%" value={form.annualRoiPercent} onChange={(value) => updateField("annualRoiPercent", value)} disabled={!form.investmentEnabled} />
                </div>
              </div>
            ) : null}
            {openPopout === "prices" ? (
              <div className="book-strategy-popout" role="dialog" aria-label="Prices">
                <div className="book-strategy-popout-grid">
                  <NumberField label="FHC price" value={form.fhcPrice} onChange={(value) => updateField("fhcPrice", value)} />
                  <NumberField label="Enhancer price" value={form.statEnhancerPrice} onChange={(value) => updateField("statEnhancerPrice", value)} />
                </div>
              </div>
            ) : null}
          </section>

          <EnhancerTimingPanel
            result={result}
            form={form}
            onEarliestOvertake={() => {
              setForm((current) => ({ ...current, enhancerMode: "earliestOvertake" }));
            }}
            onUseDayChange={(value) => {
              setForm((current) => ({
                ...current,
                enhancerMode: "targetDay",
                enhancerTargetDay: value,
              }));
            }}
            onUseStatChange={(value) => {
              setForm((current) => ({
                ...current,
                enhancerMode: "targetStat",
                enhancerTargetStat: value,
              }));
            }}
          />
        </div>

        <section className="panel book-strategy-chart-panel">
          <PanelHeader icon={<Activity size={17} />} title="Expected growth" aside={`${formatCompact(result.inputs.graphDurationDays)} days`} />
          <div
            className={`book-strategy-chart ${isDraggingEnhancerDay ? "is-dragging-enhancer" : ""}`}
            ref={chartRef}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.series} margin={{ top: 12, right: 18, left: 0, bottom: 14 }}>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--chart-axis)" }}
                  tickFormatter={(value) => formatCompact(Number(value))}
                  type="number"
                  domain={[0, result.inputs.graphDurationDays]}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--chart-axis)" }}
                  tickFormatter={(value) => formatCompact(Number(value))}
                  width={58}
                />
                <Tooltip content={<BookStrategyTooltip />} />
                <Legend wrapperStyle={{ color: "var(--text-muted)", fontWeight: 800 }} />
                <ReferenceArea x1={0} x2={result.inputs.bookDurationDays} fill="#fb7185" fillOpacity={0.1} />
                <ReferenceLine x={result.inputs.bookDurationDays} stroke="#fb7185" strokeDasharray="4 4" />
                {result.enhancerUse.day !== null && result.enhancerUse.day <= result.inputs.graphDurationDays ? (
                  <ReferenceLine x={result.enhancerUse.day} stroke="#22c55e" strokeDasharray="4 4" />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="strategyOneStat"
                  name="Strategy 1: FHCs"
                  stroke="#fb7185"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="strategyTwoStat"
                  name="Strategy 2: enhancers"
                  stroke="#22d3ee"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
            {enhancerMarkerDay !== null && enhancerMarkerLeft !== null && chartWidth > 0 && enhancerMarkerDay <= result.inputs.graphDurationDays ? (
              <div
                className="book-strategy-enhancer-drag-target"
                style={{ left: `${enhancerMarkerLeft}px` }}
                role="slider"
                tabIndex={0}
                aria-label="Enhancer use day"
                aria-valuemin={result.inputs.bookDurationDays}
                aria-valuemax={result.inputs.graphDurationDays}
                aria-valuenow={Math.round(enhancerMarkerDay)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  setIsDraggingEnhancerDay(true);
                  updateEnhancerTargetFromClientX(event.clientX);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                    return;
                  }

                  event.preventDefault();
                  const direction = event.key === "ArrowLeft" ? -1 : 1;
                  const nextDay = clampNumber(
                    Math.round(enhancerMarkerDay) + direction,
                    result.inputs.bookDurationDays,
                    result.inputs.graphDurationDays,
                  );
                  setForm((current) => ({
                    ...current,
                    enhancerMode: "targetDay",
                    enhancerTargetDay: String(nextDay),
                  }));
                }}
              >
                <span className="book-strategy-enhancer-handle">
                  <Sparkles size={14} />
                </span>
              </div>
            ) : null}
          </div>
        </section>

        <SummaryPanel result={result} />

        <CollapsiblePanel
          title="Methodology"
          collapsed={!methodologyOpen}
          onToggle={() => setMethodologyOpen((current) => !current)}
        >
          <div className="book-strategy-methodology">
            <p>
              Uses Vladar's community gym formula, a constant happiness value, 50-energy trains, and no random term.
            </p>
            <p>
              Strategy 1 uses {formatCompact(result.fhcPlan.totalFhcs)} FHCs during the 31-day book window.
            </p>
            <p>
              Strategy 2 keeps the FHC budget, applies Investment growth if enabled, and buys all affordable stat
              enhancers at a selected point.
            </p>
          </div>
        </CollapsiblePanel>
      </section>
    </>
  );
}

function SummaryPanel({ result }: { result: BookStrategyResult }) {
  const enhancerDetail = result.enhancerUse.day === null
    ? "No overtake in range"
    : `Day ${formatCompact(result.enhancerUse.day)}`;
  const winnerLabel =
    result.winningStrategy === "tied"
      ? "Tied"
      : result.winningStrategy === "strategyTwo"
        ? "Strategy 2"
        : "Strategy 1";
  const endpointDay = formatCompact(result.inputs.graphDurationDays);
  const outcomeLabel = result.winningStrategy === "tied"
    ? "Strategies tied"
    : `${winnerLabel} ahead by ${formatSignedStat(Math.abs(result.endpoint.difference))}`;

  return (
    <section className="panel book-strategy-summary-panel">
      <PanelHeader icon={<Trophy size={17} />} title="Summary" aside={`Day ${endpointDay}`} />
      <div className="book-strategy-ending-grid">
        <SummaryEndingCard
          accent="strategy-one"
          label="Strategy 1: FHCs"
          value={formatStat(result.endpoint.strategyOneStat)}
          detail={`Ending stat at day ${endpointDay}`}
        />
        <SummaryEndingCard
          accent="strategy-two"
          label="Strategy 2: enhancers"
          value={formatStat(result.endpoint.strategyTwoStat)}
          detail={`Ending stat at day ${endpointDay}`}
        />
      </div>
      <div className={`book-strategy-summary-outcome is-${result.winningStrategy}`}>
        {outcomeLabel}
      </div>
      <div className="book-strategy-summary-support-grid">
        <SummaryItem
          icon={<BadgeDollarSign size={16} />}
          label="FHC budget"
          value={formatMoney(result.fhcPlan.cost)}
          detail={`${formatCompact(result.fhcPlan.totalFhcs)} coupons`}
        />
        <SummaryItem
          icon={<BookOpen size={16} />}
          label="FHC lead at book end"
          value={formatSignedStat(result.bookEnd.lead)}
          detail={`${formatStat(result.bookEnd.strategyOneStat)} vs ${formatStat(result.bookEnd.strategyTwoStat)}`}
        />
        <SummaryItem
          icon={<Sparkles size={16} />}
          label="Enhancers used"
          value={formatCompact(result.enhancerUse.enhancersUsed)}
          detail={enhancerDetail}
        />
      </div>
    </section>
  );
}

function EnhancerTimingPanel({
  result,
  form,
  onEarliestOvertake,
  onUseDayChange,
  onUseStatChange,
}: {
  result: BookStrategyResult;
  form: BookStrategyForm;
  onEarliestOvertake: () => void;
  onUseDayChange: (value: string) => void;
  onUseStatChange: (value: string) => void;
}) {
  const resultDay = result.enhancerUse.day === null ? "" : String(Math.round(result.enhancerUse.day));
  const resultStat = result.enhancerUse.strategyTwoBeforeEnhancers === null
    ? ""
    : formatInputCompact(result.enhancerUse.strategyTwoBeforeEnhancers);
  const useDayValue = form.enhancerMode === "targetDay" ? form.enhancerTargetDay : resultDay;
  const useStatValue = form.enhancerMode === "targetStat" ? form.enhancerTargetStat : resultStat;

  return (
    <section className="panel book-strategy-panel book-strategy-timing-panel">
      <PanelHeader icon={<Sparkles size={17} />} title="Enhancer Timing" />
      <button
        type="button"
        className={`book-strategy-mode-button ${form.enhancerMode === "earliestOvertake" ? "active" : ""}`}
        onClick={onEarliestOvertake}
      >
        Earliest overtake
      </button>
      <div className="book-strategy-input-grid book-strategy-timing-grid">
        <NumberField label="Use day" value={useDayValue} onChange={onUseDayChange} />
        <NumberField label="Use stat" value={useStatValue} onChange={onUseStatChange} />
      </div>
    </section>
  );
}

function SummaryEndingCard({
  accent,
  label,
  value,
  detail,
}: {
  accent: "strategy-one" | "strategy-two";
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={`book-strategy-ending-card is-${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function SummaryItem({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="book-strategy-summary-item">
      <span className="book-strategy-summary-icon">{icon}</span>
      <span className="book-strategy-summary-label">{label}</span>
      <strong>{value}</strong>
      <span className="book-strategy-summary-detail">{detail}</span>
    </div>
  );
}

function BookStrategyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: BookStrategyPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="chart-tooltip-card book-strategy-tooltip">
      <strong>Day {formatCompact(point.day)}</strong>
      <span>Strategy 1: {formatStat(point.strategyOneStat)}</span>
      <span>Strategy 2: {formatStat(point.strategyTwoStat)}</span>
      <span>Investment: {formatMoney(point.investmentBalance)}</span>
      <span>Affordable enhancers: {formatCompact(point.enhancersAffordable)}</span>
      <span>Difference: {formatSignedStat(point.difference)}</span>
    </div>
  );
}

function PopoutButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`book-strategy-popout-button ${active ? "active" : ""}`}
      aria-expanded={active}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <label className="book-strategy-field">
      <span>{label}</span>
      <div>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </label>
  );
}

function inputsFromForm(form: BookStrategyForm, energyMode: EnergyMode): BookStrategyInputs {
  return {
    ...defaultBookStrategyInputs,
    startingStat: parseNumber(form.startingStat, defaultBookStrategyInputs.startingStat),
    dailyEnergy: energyMode === "breakdown"
      ? calculatedDailyEnergy(form)
      : parseNumber(form.dailyEnergy, defaultBookStrategyInputs.dailyEnergy),
    startingEnergy: parseNumber(form.startingEnergy, defaultBookStrategyInputs.startingEnergy),
    happiness: parseNumber(form.happiness, defaultBookStrategyInputs.happiness),
    privateIslandPercent: parseNumber(form.privateIslandPercent, defaultBookStrategyInputs.privateIslandPercent),
    generalEducationPercent: parseNumber(form.generalEducationPercent, defaultBookStrategyInputs.generalEducationPercent),
    statEducationPercent: parseNumber(form.statEducationPercent, defaultBookStrategyInputs.statEducationPercent),
    steadfastPercent: parseNumber(form.steadfastPercent, defaultBookStrategyInputs.steadfastPercent),
    customPerksPercent: parseNumber(form.customPerksPercent, defaultBookStrategyInputs.customPerksPercent),
    statEnhancerPrice: parseNumber(form.statEnhancerPrice, defaultBookStrategyInputs.statEnhancerPrice),
    fhcPrice: parseNumber(form.fhcPrice, defaultBookStrategyInputs.fhcPrice),
    investmentEnabled: form.investmentEnabled,
    annualRoiPercent: parseNumber(form.annualRoiPercent, defaultBookStrategyInputs.annualRoiPercent),
    graphDurationDays: parseNumber(form.graphDurationDays, defaultBookStrategyInputs.graphDurationDays),
    bookBonusPercent: parseNumber(form.bookBonusPercent, defaultBookStrategyInputs.bookBonusPercent),
    gymMultiplier: parseNumber(form.gymMultiplier, defaultBookStrategyInputs.gymMultiplier),
    enhancerUseMode: enhancerModeFromForm(form),
  };
}

function enhancerModeFromForm(form: BookStrategyForm): EnhancerUseMode {
  if (form.enhancerMode === "targetStat") {
    return { kind: "targetStat", stat: parseNumber(form.enhancerTargetStat, defaultBookStrategyInputs.startingStat) };
  }

  if (form.enhancerMode === "targetDay") {
    return { kind: "targetDay", day: parseNumber(form.enhancerTargetDay, defaultBookStrategyInputs.bookDurationDays) };
  }

  return { kind: "earliestOvertake" };
}

function formFromInputs(inputs: BookStrategyInputs): BookStrategyForm {
  return {
    startingStat: formatInputCompact(inputs.startingStat),
    dailyEnergy: String(inputs.dailyEnergy),
    startingEnergy: String(inputs.startingEnergy),
    happiness: String(inputs.happiness),
    naturalEnergy: "720",
    xanaxPerDay: "3",
    dailyRefill: "150",
    otherDailyEnergy: "0",
    privateIslandPercent: String(inputs.privateIslandPercent),
    generalEducationPercent: String(inputs.generalEducationPercent),
    statEducationPercent: String(inputs.statEducationPercent),
    steadfastPercent: String(inputs.steadfastPercent),
    customPerksPercent: String(inputs.customPerksPercent),
    gymMultiplier: String(inputs.gymMultiplier),
    statEnhancerPrice: formatInputCompact(inputs.statEnhancerPrice),
    fhcPrice: formatInputCompact(inputs.fhcPrice),
    investmentEnabled: inputs.investmentEnabled,
    annualRoiPercent: String(inputs.annualRoiPercent),
    graphDurationDays: String(inputs.graphDurationDays),
    bookBonusPercent: String(inputs.bookBonusPercent),
    enhancerMode: inputs.enhancerUseMode.kind,
    enhancerTargetStat: "3.411b",
    enhancerTargetDay: "334",
  };
}

function calculatedDailyEnergy(form: BookStrategyForm): number {
  return (
    parseNumber(form.naturalEnergy, 0) +
    parseNumber(form.xanaxPerDay, 0) * FIXED_ENERGY_PER_XANAX +
    parseNumber(form.dailyRefill, 0) +
    parseNumber(form.otherDailyEnergy, 0)
  );
}

function parseNumber(value: string, fallback: number): number {
  const normalized = value.trim().toLowerCase().replace(/[$,%\s,_]/g, "");
  if (!normalized) {
    return fallback;
  }

  const match = normalized.match(/^(-?(?:\d+|\d*\.\d+))(k|m|b|t)?$/);
  if (!match) {
    return fallback;
  }

  const multiplier = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
    t: 1_000_000_000_000,
  }[match[2] ?? ""] ?? 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatEnergy(value: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value);
}

function formatMoney(value: number): string {
  return `$${formatCompact(value)}`;
}

function formatStat(value: number): string {
  return formatCompact(value);
}

function formatSignedStat(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatStat(Math.abs(value))}`;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${trimFixed(value / 1_000_000_000_000)}t`;
  }
  if (abs >= 1_000_000_000) {
    return `${trimFixed(value / 1_000_000_000)}b`;
  }
  if (abs >= 1_000_000) {
    return `${trimFixed(value / 1_000_000)}m`;
  }

  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: abs < 10 ? 2 : 1 }).format(value);
}

function formatInputCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${formatInputScaled(value / 1_000_000_000_000)}t`;
  }
  if (abs >= 1_000_000_000) {
    return `${formatInputScaled(value / 1_000_000_000)}b`;
  }
  if (abs >= 1_000_000) {
    return `${formatInputScaled(value / 1_000_000)}m`;
  }
  if (abs >= 1_000) {
    return `${formatInputScaled(value / 1_000)}k`;
  }

  return String(Math.round(value));
}

function formatInputScaled(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function trimFixed(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(value) >= 100 ? 1 : 2,
  }).format(value);
}
