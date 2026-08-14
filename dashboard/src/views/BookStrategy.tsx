import React from "react";
import {
  Activity,
  BadgeDollarSign,
  BatteryCharging,
  BookOpen,
  Building2,
  CircleDollarSign,
  Dumbbell,
  GraduationCap,
  Home,
  RotateCcw,
  ShieldCheck,
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
  bookTimingStatAtDayWithoutBook,
  calculateBookTimingComparison,
  calculateBookStrategy,
  defaultBookTimingComparisonInputs,
  defaultBookStrategyInputs,
  findEnhancerLeadMilestone,
  type BookTimingComparisonInputs,
  type BookTimingComparisonPoint,
  type BookTimingComparisonResult,
  type BookStrategyInputs,
  type BookStrategyPoint,
  type BookStrategyResult,
  type EnhancerUseMode,
} from "../utils/bookStrategy";

type BookStrategyMode = "enhancers" | "timing";
type EnergyMode = "total" | "breakdown";
type EnhancerModeKind = EnhancerUseMode["kind"];
type PopoutKind = "energy" | "perks" | "investment" | "prices";
type BookTimingPopoutKind = "energy" | "perks";

const CHART_Y_AXIS_WIDTH = 58;
const CHART_RIGHT_MARGIN = 18;
const LEAD_MILESTONE_TARGETS = [25_000_000, 50_000_000, 100_000_000] as const;
const LEAD_MILESTONE_MAX_DAY = 3_650;

type ChartClickState = {
  activeLabel?: number | string | null;
  activePayload?: Array<{ payload?: { day?: number | string | null } }>;
} | null;

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
  postBookTrainingMonthsOutOfFour: string;
  enhancerMode: EnhancerModeKind;
  enhancerTargetStat: string;
  enhancerTargetDay: string;
};

type BookTimingForm = {
  lowStat: string;
  delayedBookTargetStat: string;
  dailyEnergy: string;
  naturalEnergy: string;
  xanaxPerDay: string;
  dailyRefill: string;
  otherDailyEnergy: string;
  privateIslandPercent: string;
  generalEducationPercent: string;
  statEducationPercent: string;
  steadfastPercent: string;
  customPerksPercent: string;
  graphDurationDays: string;
  bookBonusPercent: string;
};

type SharedPopoutField =
  | "dailyEnergy"
  | "naturalEnergy"
  | "xanaxPerDay"
  | "dailyRefill"
  | "otherDailyEnergy"
  | "privateIslandPercent"
  | "generalEducationPercent"
  | "statEducationPercent"
  | "steadfastPercent"
  | "customPerksPercent";

const FIXED_ENERGY_PER_XANAX = 250;
const DEFAULT_FORM = formFromInputs(defaultBookStrategyInputs);
const DEFAULT_TIMING_FORM = timingFormFromInputs(defaultBookTimingComparisonInputs);
const SHARED_POPOUT_FIELDS = new Set<string>([
  "dailyEnergy",
  "naturalEnergy",
  "xanaxPerDay",
  "dailyRefill",
  "otherDailyEnergy",
  "privateIslandPercent",
  "generalEducationPercent",
  "statEducationPercent",
  "steadfastPercent",
  "customPerksPercent",
]);

export function BookStrategy() {
  const [mode, setMode] = React.useState<BookStrategyMode>("enhancers");
  const [form, setForm] = React.useState<BookStrategyForm>(DEFAULT_FORM);
  const [timingForm, setTimingForm] = React.useState<BookTimingForm>(DEFAULT_TIMING_FORM);
  const [energyMode, setEnergyMode] = React.useState<EnergyMode>("total");
  const [timingEnergyMode, setTimingEnergyMode] = React.useState<EnergyMode>("total");
  const [openPopout, setOpenPopout] = React.useState<PopoutKind | null>(null);
  const [openTimingPopout, setOpenTimingPopout] = React.useState<BookTimingPopoutKind | null>(null);
  const [methodologyOpen, setMethodologyOpen] = React.useState(false);
  const [isDraggingEnhancerDay, setIsDraggingEnhancerDay] = React.useState(false);
  const [chartWidth, setChartWidth] = React.useState(0);
  const chartRef = React.useRef<HTMLDivElement | null>(null);
  const pendingDragClientXRef = React.useRef<number | null>(null);
  const dragAnimationFrameRef = React.useRef<number | null>(null);
  const inputs = React.useMemo(() => inputsFromForm(form, energyMode), [energyMode, form]);
  const result = React.useMemo(() => calculateBookStrategy(inputs), [inputs]);
  const enhancerMarkerDay = result.enhancerUse.day;
  const enhancerMarkerLeft =
    enhancerMarkerDay !== null
      ? CHART_Y_AXIS_WIDTH +
        (enhancerMarkerDay / Math.max(1, result.inputs.graphDurationDays)) *
        Math.max(1, chartWidth - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN)
      : null;

  function isSharedPopoutField(field: PropertyKey): field is SharedPopoutField {
    return typeof field === "string" && SHARED_POPOUT_FIELDS.has(field);
  }

  function updateSharedPopoutField(field: SharedPopoutField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setTimingForm((current) => ({ ...current, [field]: value }));
  }

  function updateField<K extends keyof BookStrategyForm>(field: K, value: BookStrategyForm[K]) {
    if (isSharedPopoutField(field) && typeof value === "string") {
      updateSharedPopoutField(field, value);
      return;
    }

    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateTimingField<K extends keyof BookTimingForm>(field: K, value: BookTimingForm[K]) {
    if (isSharedPopoutField(field) && typeof value === "string") {
      updateSharedPopoutField(field, value);
      return;
    }

    setTimingForm((current) => ({ ...current, [field]: value }));
  }

  function updateSharedEnergyMode(nextMode: EnergyMode) {
    setEnergyMode(nextMode);
    setTimingEnergyMode(nextMode);
  }

  function resetDefaults() {
    setForm(DEFAULT_FORM);
    setTimingForm(DEFAULT_TIMING_FORM);
    setEnergyMode("total");
    setTimingEnergyMode("total");
    setOpenPopout(null);
    setOpenTimingPopout(null);
    setIsDraggingEnhancerDay(false);
  }

  const dailyEnergy = energyMode === "breakdown" ? calculatedDailyEnergy(form) : parseNumber(form.dailyEnergy, 0);

  const setEnhancerTargetDay = React.useCallback((rawDay: number) => {
    if (
      !Number.isFinite(rawDay) ||
      rawDay < result.inputs.bookDurationDays ||
      rawDay > result.inputs.graphDurationDays
    ) {
      return;
    }

    const day = clampNumber(rawDay, result.inputs.bookDurationDays, result.inputs.graphDurationDays);
    const formattedDay = formatDayInput(day);
    setForm((current) => (
      current.enhancerMode === "targetDay" && current.enhancerTargetDay === formattedDay
        ? current
        : {
            ...current,
            enhancerMode: "targetDay",
            enhancerTargetDay: formattedDay,
          }
    ));
  }, [result.inputs.bookDurationDays, result.inputs.graphDurationDays]);

  const updateEnhancerTargetFromClientX = React.useCallback((clientX: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const plotLeft = rect.left + CHART_Y_AXIS_WIDTH;
    const plotWidth = Math.max(1, rect.width - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN);
    const rawRatio = (clientX - plotLeft) / plotWidth;
    const rawDay = rawRatio * result.inputs.graphDurationDays;
    setEnhancerTargetDay(Math.round(rawDay));
  }, [result.inputs.graphDurationDays, setEnhancerTargetDay]);

  const scheduleEnhancerTargetFromClientX = React.useCallback((clientX: number) => {
    pendingDragClientXRef.current = clientX;
    if (dragAnimationFrameRef.current !== null) {
      return;
    }

    dragAnimationFrameRef.current = window.requestAnimationFrame(() => {
      dragAnimationFrameRef.current = null;
      const nextClientX = pendingDragClientXRef.current;
      pendingDragClientXRef.current = null;
      if (nextClientX !== null) {
        updateEnhancerTargetFromClientX(nextClientX);
      }
    });
  }, [updateEnhancerTargetFromClientX]);

  const flushScheduledEnhancerTarget = React.useCallback(() => {
    if (dragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAnimationFrameRef.current);
      dragAnimationFrameRef.current = null;
    }

    const nextClientX = pendingDragClientXRef.current;
    pendingDragClientXRef.current = null;
    if (nextClientX !== null) {
      updateEnhancerTargetFromClientX(nextClientX);
    }
  }, [updateEnhancerTargetFromClientX]);

  const handleChartClick = React.useCallback((state: unknown) => {
    const chartState = state as ChartClickState;
    const payloadDay = chartState?.activePayload?.find((item) => item.payload?.day !== undefined)?.payload?.day;
    const day = Number(payloadDay ?? chartState?.activeLabel);
    setEnhancerTargetDay(day);
  }, [setEnhancerTargetDay]);

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
      scheduleEnhancerTargetFromClientX(event.clientX);
    }

    function handlePointerUp() {
      flushScheduledEnhancerTarget();
      setIsDraggingEnhancerDay(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      if (dragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAnimationFrameRef.current);
        dragAnimationFrameRef.current = null;
      }
      pendingDragClientXRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [flushScheduledEnhancerTarget, isDraggingEnhancerDay, scheduleEnhancerTargetFromClientX]);

  return (
    <>
      <section className="hero-panel compact-hero-panel book-strategy-hero">
        <div>
          <p className="eyebrow">Calculator</p>
          <h2>Book Strategy</h2>
          <p>
            Compares expected stat growth from FHC book training versus saving the cash for later stat enhancers
          </p>
        </div>
        <button type="button" className="panel-action-button" onClick={resetDefaults}>
          <RotateCcw size={15} />
          Reset
        </button>
      </section>

      <section className="book-strategy-layout">
        <div className="book-strategy-mode-tabs" role="tablist" aria-label="Book strategy comparison">
          <button
            type="button"
            className={mode === "enhancers" ? "active" : ""}
            onClick={() => setMode("enhancers")}
            role="tab"
            aria-selected={mode === "enhancers"}
          >
            Enhancers
          </button>
          <button
            type="button"
            className={mode === "timing" ? "active" : ""}
            onClick={() => setMode("timing")}
            role="tab"
            aria-selected={mode === "timing"}
          >
            Book Timing
          </button>
        </div>

        {mode === "enhancers" ? (
          <>
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
              <NumberField label="Months spent training stat out of 4" value={form.postBookTrainingMonthsOutOfFour} onChange={(value) => updateField("postBookTrainingMonthsOutOfFour", value)} />
              <div className="book-strategy-toggle-field">
                <span>Investment</span>
                <label className={`book-strategy-check book-strategy-investment-toggle ${form.investmentEnabled ? "" : "is-off"}`}>
                  <input
                    type="checkbox"
                    checked={form.investmentEnabled}
                    onChange={(event) => updateField("investmentEnabled", event.target.checked)}
                  />
                  <span>Enable Investment</span>
                </label>
              </div>
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
                    onClick={() => updateSharedEnergyMode("total")}
                  >
                    Total
                  </button>
                  <button
                    type="button"
                    className={energyMode === "breakdown" ? "active" : ""}
                    onClick={() => updateSharedEnergyMode("breakdown")}
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
              <LineChart
                data={result.series}
                margin={{ top: 12, right: 18, left: 0, bottom: 14 }}
                onClick={handleChartClick}
              >
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
                  name="FHCs"
                  stroke="#fb7185"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="strategyTwoStat"
                  name="Enhancers"
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
              Uses Vladar's community gym formula, constant 5,000 happiness, 50-energy trains, and no random term.
            </p>
            <p>
              A fuller model using 150/250-energy batches, happiness loss from training, and happiness regeneration from
              various sources was tested. At a 500m starting stat, it differed from this simplified model by about 1%,
              and the invested break-even date was unchanged.
            </p>
            <p>
              Using 2.5% as the threshold for a meaningful difference, break-even timing only differed by more than 2.5%
              below approximately 130k starting stats without Investment, or 100k with 25% Investment. The FHC advantage
              itself only changed by more than 2.5% below approximately 31k starting stats. These mechanics are excluded
              because they add complexity without materially changing results.
            </p>
            <p>
              After the book window, target-stat training uses {formatCompact(result.inputs.postBookTrainingMonthsOutOfFour)}
              {result.inputs.postBookTrainingMonthsOutOfFour === 1 ? " month" : " months"} out of four.
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
          </>
        ) : (
          <BookTimingComparisonView
            form={timingForm}
            energyMode={timingEnergyMode}
            openPopout={openTimingPopout}
            methodologyOpen={methodologyOpen}
            onFieldChange={updateTimingField}
            onEnergyModeChange={updateSharedEnergyMode}
            onPopoutChange={setOpenTimingPopout}
            onMethodologyToggle={() => setMethodologyOpen((current) => !current)}
          />
        )}
      </section>
    </>
  );
}

function BookTimingComparisonView({
  form,
  energyMode,
  openPopout,
  methodologyOpen,
  onFieldChange,
  onEnergyModeChange,
  onPopoutChange,
  onMethodologyToggle,
}: {
  form: BookTimingForm;
  energyMode: EnergyMode;
  openPopout: BookTimingPopoutKind | null;
  methodologyOpen: boolean;
  onFieldChange: <K extends keyof BookTimingForm>(field: K, value: BookTimingForm[K]) => void;
  onEnergyModeChange: (mode: EnergyMode) => void;
  onPopoutChange: (popout: BookTimingPopoutKind | null) => void;
  onMethodologyToggle: () => void;
}) {
  const [isDraggingDelayedBook, setIsDraggingDelayedBook] = React.useState(false);
  const [chartWidth, setChartWidth] = React.useState(0);
  const chartRef = React.useRef<HTMLDivElement | null>(null);
  const pendingDragClientXRef = React.useRef<number | null>(null);
  const dragAnimationFrameRef = React.useRef<number | null>(null);
  const inputs = React.useMemo(() => timingInputsFromForm(form, energyMode), [energyMode, form]);
  const result = React.useMemo(() => calculateBookTimingComparison(inputs), [inputs]);
  const dailyEnergy = energyMode === "breakdown" ? calculatedTimingDailyEnergy(form) : parseNumber(form.dailyEnergy, 0);
  const delayedBookEndDay = result.delayedBook.endDay;
  const delayedBookShadeEndDay = delayedBookEndDay === null
    ? null
    : Math.min(delayedBookEndDay, result.inputs.graphDurationDays);
  const shouldShowDelayedBookWindow =
    result.delayedBookStartDay !== null &&
    delayedBookShadeEndDay !== null &&
    result.delayedBookStartDay < delayedBookShadeEndDay;
  const delayedBookHandleDay =
    result.delayedBookStartDay !== null && delayedBookShadeEndDay !== null
      ? (result.delayedBookStartDay + delayedBookShadeEndDay) / 2
      : null;
  const delayedBookHandleLeft =
    delayedBookHandleDay !== null
      ? CHART_Y_AXIS_WIDTH +
        (delayedBookHandleDay / Math.max(1, result.inputs.graphDurationDays)) *
        Math.max(1, chartWidth - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN)
      : null;

  const setDelayedBookStartDay = React.useCallback((rawDay: number) => {
    if (!Number.isFinite(rawDay)) {
      return;
    }

    const day = clampNumber(rawDay, 0, result.inputs.graphDurationDays);
    const targetStat = bookTimingStatAtDayWithoutBook(result.inputs, day);
    onFieldChange("delayedBookTargetStat", formatInputCompact(targetStat));
  }, [onFieldChange, result.inputs]);

  const updateDelayedBookTargetFromClientX = React.useCallback((clientX: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const plotLeft = rect.left + CHART_Y_AXIS_WIDTH;
    const plotWidth = Math.max(1, rect.width - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN);
    const rawRatio = (clientX - plotLeft) / plotWidth;
    const handleCenterDay = rawRatio * result.inputs.graphDurationDays;
    setDelayedBookStartDay(handleCenterDay - result.inputs.bookDurationDays / 2);
  }, [result.inputs.bookDurationDays, result.inputs.graphDurationDays, setDelayedBookStartDay]);

  const scheduleDelayedBookTargetFromClientX = React.useCallback((clientX: number) => {
    pendingDragClientXRef.current = clientX;
    if (dragAnimationFrameRef.current !== null) {
      return;
    }

    dragAnimationFrameRef.current = window.requestAnimationFrame(() => {
      dragAnimationFrameRef.current = null;
      const nextClientX = pendingDragClientXRef.current;
      pendingDragClientXRef.current = null;
      if (nextClientX !== null) {
        updateDelayedBookTargetFromClientX(nextClientX);
      }
    });
  }, [updateDelayedBookTargetFromClientX]);

  const flushScheduledDelayedBookTarget = React.useCallback(() => {
    if (dragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAnimationFrameRef.current);
      dragAnimationFrameRef.current = null;
    }

    const nextClientX = pendingDragClientXRef.current;
    pendingDragClientXRef.current = null;
    if (nextClientX !== null) {
      updateDelayedBookTargetFromClientX(nextClientX);
    }
  }, [updateDelayedBookTargetFromClientX]);

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
    if (!isDraggingDelayedBook) {
      return undefined;
    }

    function handlePointerMove(event: PointerEvent) {
      scheduleDelayedBookTargetFromClientX(event.clientX);
    }

    function handlePointerUp() {
      flushScheduledDelayedBookTarget();
      setIsDraggingDelayedBook(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      if (dragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAnimationFrameRef.current);
        dragAnimationFrameRef.current = null;
      }
      pendingDragClientXRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [flushScheduledDelayedBookTarget, isDraggingDelayedBook, scheduleDelayedBookTargetFromClientX]);

  return (
    <>
      <section className="panel book-strategy-panel book-strategy-input-panel">
        <PanelHeader
          icon={<SlidersHorizontal size={17} />}
          title="Book Timing Inputs"
          control={
            <div className="book-strategy-popout-actions">
              <PopoutButton
                icon={<BatteryCharging size={15} />}
                label="Energy"
                active={openPopout === "energy"}
                onClick={() => onPopoutChange(openPopout === "energy" ? null : "energy")}
              />
              <PopoutButton
                icon={<Sparkles size={15} />}
                label="Perks"
                active={openPopout === "perks"}
                onClick={() => onPopoutChange(openPopout === "perks" ? null : "perks")}
              />
            </div>
          }
        />
        <div className="book-strategy-input-grid">
          <NumberField label="Low stat" value={form.lowStat} onChange={(value) => onFieldChange("lowStat", value)} />
          <NumberField label="Use later at stat" value={form.delayedBookTargetStat} onChange={(value) => onFieldChange("delayedBookTargetStat", value)} />
          <NumberField label="Graph duration (days)" value={form.graphDurationDays} onChange={(value) => onFieldChange("graphDurationDays", value)} />
          <NumberField label="Book bonus %" value={form.bookBonusPercent} onChange={(value) => onFieldChange("bookBonusPercent", value)} />
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
                onClick={() => onEnergyModeChange("total")}
              >
                Total
              </button>
              <button
                type="button"
                className={energyMode === "breakdown" ? "active" : ""}
                onClick={() => onEnergyModeChange("breakdown")}
              >
                Breakdown
              </button>
            </div>
            {energyMode === "total" ? (
              <NumberField label="Daily energy" value={form.dailyEnergy} onChange={(value) => onFieldChange("dailyEnergy", value)} />
            ) : (
              <div className="book-strategy-popout-grid">
                <NumberField label="Natural" value={form.naturalEnergy} onChange={(value) => onFieldChange("naturalEnergy", value)} />
                <NumberField label="Xanax/day" value={form.xanaxPerDay} onChange={(value) => onFieldChange("xanaxPerDay", value)} />
                <NumberField label="Daily refill" value={form.dailyRefill} onChange={(value) => onFieldChange("dailyRefill", value)} />
                <NumberField label="Other" value={form.otherDailyEnergy} onChange={(value) => onFieldChange("otherDailyEnergy", value)} />
              </div>
            )}
          </div>
        ) : null}
        {openPopout === "perks" ? (
          <div className="book-strategy-popout" role="dialog" aria-label="Perks">
            <div className="book-strategy-popout-grid">
              <NumberField label="Property" suffix="%" value={form.privateIslandPercent} onChange={(value) => onFieldChange("privateIslandPercent", value)} />
              <NumberField label="Education (General)" suffix="%" value={form.generalEducationPercent} onChange={(value) => onFieldChange("generalEducationPercent", value)} />
              <NumberField label="Education (Stat Specific)" suffix="%" value={form.statEducationPercent} onChange={(value) => onFieldChange("statEducationPercent", value)} />
              <NumberField label="Faction Steadfast" suffix="%" value={form.steadfastPercent} onChange={(value) => onFieldChange("steadfastPercent", value)} />
              <NumberField label="Job Perks" suffix="%" value={form.customPerksPercent} onChange={(value) => onFieldChange("customPerksPercent", value)} />
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel book-strategy-chart-panel">
        <PanelHeader icon={<Activity size={17} />} title="Book timing growth" aside={`${formatCompact(result.inputs.graphDurationDays)} days`} />
        <div
          className={`book-strategy-chart ${isDraggingDelayedBook ? "is-dragging-book-timing" : ""}`}
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
              <Tooltip content={<BookTimingTooltip />} />
              <Legend wrapperStyle={{ color: "var(--text-muted)", fontWeight: 800 }} />
              <ReferenceArea x1={0} x2={result.inputs.bookDurationDays} fill="#f59e0b" fillOpacity={0.12} />
              {shouldShowDelayedBookWindow ? (
                <ReferenceArea
                  x1={result.delayedBookStartDay ?? 0}
                  x2={delayedBookShadeEndDay ?? 0}
                  fill="#22d3ee"
                  fillOpacity={0.12}
                />
              ) : null}
              {result.delayedBookStartDay !== null && result.delayedBookStartDay <= result.inputs.graphDurationDays ? (
                <ReferenceLine x={result.delayedBookStartDay} stroke="#22d3ee" strokeDasharray="4 4" />
              ) : null}
              <Line
                type="monotone"
                dataKey="useNowStat"
                name="Use now"
                stroke="#f59e0b"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="waitStat"
                name="Wait"
                stroke="#22d3ee"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
          {shouldShowDelayedBookWindow && delayedBookHandleLeft !== null && chartWidth > 0 ? (
            <div
              className="book-timing-book-drag-target"
              style={{ left: `${delayedBookHandleLeft}px` }}
              role="slider"
              tabIndex={0}
              aria-label="Later book use day"
              aria-valuemin={0}
              aria-valuemax={result.inputs.graphDurationDays}
              aria-valuenow={Math.round(result.delayedBookStartDay ?? 0)}
              onPointerDown={(event) => {
                event.preventDefault();
                setIsDraggingDelayedBook(true);
                updateDelayedBookTargetFromClientX(event.clientX);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                  return;
                }

                event.preventDefault();
                const direction = event.key === "ArrowLeft" ? -1 : 1;
                const nextDay = clampNumber(
                  Math.round(result.delayedBookStartDay ?? 0) + direction,
                  0,
                  result.inputs.graphDurationDays,
                );
                setDelayedBookStartDay(nextDay);
              }}
            >
              <span className="book-timing-book-handle">
                <BookOpen size={14} />
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <BookTimingSummaryPanel result={result} />
      <BookTimingReasonsPanel />

      <CollapsiblePanel
        title="Methodology"
        collapsed={!methodologyOpen}
        onToggle={onMethodologyToggle}
      >
        <div className="book-strategy-methodology">
          <p>
            Uses Vladar's community gym formula, a constant 5000 happiness value, George's Gym (7.3 dots) & 50-energy trains.
          </p>
          <p>
            Both paths use the same daily energy with no stacking.
          </p>
          <p>
            "Use now" applies the book from day 0. "Wait" trains normally until the selected start, then applies the same
            31-day book window.
          </p>
        </div>
      </CollapsiblePanel>
    </>
  );
}

function BookTimingReasonsPanel() {
  const reasons = [
    {
      icon: <GraduationCap size={17} />,
      title: "Complete gym-gain education",
      detail: "Relevant Sports Science courses improve all training.",
    },
    {
      icon: <Dumbbell size={17} />,
      title: "Unlock a better gym",
      detail: "Unlocking a better or specialist gym increases your base gains.",
    },
    {
      icon: <Building2 size={17} />,
      title: "Join a training company",
      detail: "Company perks can increase gym gains or reduce happiness loss.",
    },
    {
      icon: <ShieldCheck size={17} />,
      title: "Wait for higher Steadfast",
      detail: "Higher stat-specific Steadfast increases the return from all training.",
    },
    {
      icon: <Home size={17} />,
      title: "Move to a Private Island",
      detail: "Higher base happiness and the swimming-pool perk improve gym gains.",
    },
  ];

  return (
    <section className="panel book-timing-reasons-panel">
      <PanelHeader icon={<BookOpen size={17} />} title="Reasons to Delay" />
      <p>
        Waiting can be worthwhile if your training conditions will improve before using the book. A higher starting stat
        alone is not a reason to delay.
      </p>
      <div className="book-timing-reason-grid">
        {reasons.map((reason) => (
          <div className="book-timing-reason-item" key={reason.title}>
            <span>{reason.icon}</span>
            <strong>{reason.title}</strong>
            <small>{reason.detail}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryPanel({ result }: { result: BookStrategyResult }) {
  const earliestInputs = React.useMemo<BookStrategyInputs>(() => ({
    ...result.inputs,
    enhancerUseMode: { kind: "earliestOvertake" },
  }), [
    result.inputs.startingStat,
    result.inputs.dailyEnergy,
    result.inputs.startingEnergy,
    result.inputs.happiness,
    result.inputs.privateIslandPercent,
    result.inputs.generalEducationPercent,
    result.inputs.statEducationPercent,
    result.inputs.steadfastPercent,
    result.inputs.customPerksPercent,
    result.inputs.statEnhancerPrice,
    result.inputs.fhcPrice,
    result.inputs.investmentEnabled,
    result.inputs.annualRoiPercent,
    result.inputs.graphDurationDays,
    result.inputs.bookDurationDays,
    result.inputs.bookBonusPercent,
    result.inputs.gymMultiplier,
    result.inputs.energyPerTrain,
    result.inputs.fhcEnergy,
    result.inputs.fhcCooldownHours,
    result.inputs.maxBoosterCooldownHours,
    result.inputs.postBookTrainingMonthsOutOfFour,
  ]);
  const earliestResult = React.useMemo(
    () => calculateBookStrategy(earliestInputs),
    [earliestInputs],
  );
  const leadMilestones = React.useMemo(
    () => LEAD_MILESTONE_TARGETS.map((target) => ({
      target,
      milestone: findEnhancerLeadMilestone(earliestInputs, target, LEAD_MILESTONE_MAX_DAY),
    })),
    [earliestInputs],
  );
  const enhancerDetail = result.enhancerUse.day === null
    ? "No overtake in range"
    : `Day ${formatCompact(result.enhancerUse.day)}`;
  const winnerLabel =
    result.winningStrategy === "tied"
      ? "Tied"
      : result.winningStrategy === "strategyTwo"
        ? "Enhancers"
        : "FHCs";
  const endpointDay = formatCompact(result.inputs.graphDurationDays);
  const endpointDifferencePercent = relativeDifferencePercent(
    Math.abs(result.endpoint.difference),
    result.endpoint.strategyOneStat,
    result.endpoint.strategyTwoStat,
  );
  const endpointDifferenceDetail = `${formatSignedStat(Math.abs(result.endpoint.difference))} - ${formatSignedPercentFixed(endpointDifferencePercent, 3)}`;
  const outcomeLabel = result.winningStrategy === "tied"
    ? "Strategies tied"
    : `${winnerLabel} ahead by ${endpointDifferenceDetail}`;
  const leftoverMoney = result.enhancerUse.investmentBalance === null
    ? null
    : Math.max(0, result.enhancerUse.investmentBalance - result.enhancerUse.enhancersUsed * result.inputs.statEnhancerPrice);
  const earliestEnhancerSpend = earliestResult.enhancerUse.enhancersUsed * result.inputs.statEnhancerPrice;
  const enhancerBudgetAction = result.inputs.investmentEnabled
    ? "invest the"
    : "keep the";
  const enhancerBudgetDetail = result.inputs.investmentEnabled
    ? "FHC budget"
    : "FHC budget as cash";
  const summaryLines = [
    `FHCs use ${formatCompact(result.fhcPlan.totalFhcs)} FHCs during the initial 31 days, putting them ahead by ${formatSignedStat(result.bookEnd.lead)} stats at book end.`,
    earliestResult.enhancerUse.day === null
      ? `Enhancers ${enhancerBudgetAction} ${formatMoney(result.fhcPlan.cost)} ${enhancerBudgetDetail} and do not break even in the simulated range.`
      : `Enhancers ${enhancerBudgetAction} ${formatMoney(result.fhcPlan.cost)} ${enhancerBudgetDetail} and break even on day ${formatCompact(earliestResult.enhancerUse.day)} by purchasing ${formatCompact(earliestResult.enhancerUse.enhancersUsed)} enhancers for ${formatMoney(earliestEnhancerSpend)}.`,
    earliestResult.enhancerUse.day === null
      ? "No Enhancers lead is reached with the current inputs."
      : "From that point onward, the Enhancers lead continues to grow.",
    ...leadMilestones
      .filter((entry) => entry.milestone !== null)
      .map((entry) =>
        `Enhancers can be used for an immediate +${formatStat(entry.target)} lead on day ${formatCompact(entry.milestone?.day ?? 0)}.`,
      ),
  ].filter((line): line is string => line !== null);

  return (
    <section className="panel book-strategy-summary-panel">
      <PanelHeader icon={<Trophy size={17} />} title="Summary" />
      <div className="book-strategy-ending-grid">
        <SummaryEndingCard
          accent="strategy-one"
          label="FHCs"
          value={formatStat(result.endpoint.strategyOneStat)}
          detail={`Ending stat at day ${endpointDay}`}
        />
        <SummaryEndingCard
          accent="strategy-two"
          label="Enhancers"
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
        <SummaryItem
          icon={<CircleDollarSign size={16} />}
          label="Leftover cash"
          value={leftoverMoney === null ? "N/A" : formatMoney(leftoverMoney)}
          detail={result.enhancerUse.day === null ? "No enhancer use" : "After enhancers"}
        />
      </div>
      <div className="book-strategy-summary-writeup">
        {summaryLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
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
  const earliestOvertakeActive = form.enhancerMode === "earliestOvertake";

  return (
    <section className="panel book-strategy-panel book-strategy-timing-panel">
      <PanelHeader icon={<Sparkles size={17} />} title="Enhancer Timing" />
      <button
        type="button"
        className={`book-strategy-mode-button ${earliestOvertakeActive ? "active" : ""}`}
        onClick={onEarliestOvertake}
      >
        {earliestOvertakeActive ? "Earliest overtake" : "Set to earliest overtake"}
      </button>
      <div className="book-strategy-input-grid book-strategy-timing-grid">
        <NumberField label="Use day" value={useDayValue} onChange={onUseDayChange} />
        <NumberField label="Use stat" value={useStatValue} onChange={onUseStatChange} />
      </div>
    </section>
  );
}

function BookTimingSummaryPanel({ result }: { result: BookTimingComparisonResult }) {
  const endpointDay = formatCompact(result.inputs.graphDurationDays);
  const endpointDifferencePercent = relativeDifferencePercent(
    result.endpoint.difference,
    result.endpoint.useNowStat,
    result.endpoint.waitStat,
  );
  const endpointDifferenceDetail = `${formatSignedStat(Math.abs(result.endpoint.difference))} - ${formatSignedPercentFixed(endpointDifferencePercent, 3)}`;
  const winnerLabel =
    Math.abs(result.endpoint.difference) < 0.5
      ? "Paths tied"
      : result.endpoint.difference > 0
        ? `Wait ahead by ${endpointDifferenceDetail}`
        : `Use now ahead by ${endpointDifferenceDetail}`;
  const delayedStartDetail = result.delayedBookStartDay === null
    ? "Target not reached"
    : `Day ${formatCompact(result.delayedBookStartDay)}`;
  const immediatePercent = result.immediateBook.percentGain === null ? "N/A" : formatPercent(result.immediateBook.percentGain);
  const delayedPercent = result.delayedBook.percentGain === null ? "N/A" : formatPercent(result.delayedBook.percentGain);
  const immediateExtra = result.immediateBook.extraGain === null ? "N/A" : formatSignedStat(result.immediateBook.extraGain);
  const delayedExtra = result.delayedBook.extraGain === null ? "N/A" : formatSignedStat(result.delayedBook.extraGain);
  const timingSummaryLines = [
    `Use now applies the book from day 0 to day ${formatCompact(result.inputs.bookDurationDays)}, adding ${immediateExtra} stats (${immediatePercent}).`,
    result.delayedBookStartDay === null
      ? `Wait does not reach ${formatStat(result.inputs.delayedBookTargetStat)} within ${formatCompact(result.inputs.graphDurationDays)} days.`
      : `Wait reaches ${formatStat(result.inputs.delayedBookTargetStat)} on day ${formatCompact(result.delayedBookStartDay)} and adds ${delayedExtra} stats (${delayedPercent}).`,
    `Both paths use ${formatCompact(result.totalTrains)} trains with no starting-energy stack or delayed energy stack.`,
  ];

  return (
    <section className="panel book-strategy-summary-panel">
      <PanelHeader icon={<Trophy size={17} />} title="Book Timing Summary" />
      <div className="book-strategy-ending-grid">
        <SummaryEndingCard
          accent="strategy-one"
          label="Use now"
          value={formatStat(result.endpoint.useNowStat)}
          detail={`Ending stat at day ${endpointDay}`}
        />
        <SummaryEndingCard
          accent="strategy-two"
          label="Wait"
          value={formatStat(result.endpoint.waitStat)}
          detail={`Ending stat at day ${endpointDay}`}
        />
      </div>
      <div className={`book-strategy-summary-outcome ${result.endpoint.difference > 0 ? "is-strategyTwo" : result.endpoint.difference < 0 ? "is-strategyOne" : "is-tied"}`}>
        {winnerLabel}
      </div>
      <div className="book-strategy-summary-support-grid">
        <SummaryItem
          icon={<BookOpen size={16} />}
          label="Use now book gain"
          value={immediatePercent}
          detail={immediateExtra}
        />
        <SummaryItem
          icon={<Sparkles size={16} />}
          label="Wait book gain"
          value={delayedPercent}
          detail={delayedExtra}
        />
        <SummaryItem
          icon={<Activity size={16} />}
          label="Delayed book start"
          value={delayedStartDetail}
          detail={`Target ${formatStat(result.inputs.delayedBookTargetStat)}`}
        />
        <SummaryItem
          icon={<BatteryCharging size={16} />}
          label="Equal energy"
          value={formatCompact(result.totalTrains)}
          detail="50-energy trains"
        />
      </div>
      <div className="book-strategy-summary-writeup">
        {timingSummaryLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
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
      <span>FHCs: {formatStat(point.strategyOneStat)}</span>
      <span>Enhancers: {formatStat(point.strategyTwoStat)}</span>
      <span>Investment: {formatMoney(point.investmentBalance)}</span>
      <span>Affordable enhancers: {formatCompact(point.enhancersAffordable)}</span>
      <span>Difference: {formatSignedStat(point.difference)}</span>
    </div>
  );
}

function BookTimingTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: BookTimingComparisonPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="chart-tooltip-card book-strategy-tooltip">
      <strong>Day {formatCompact(point.day)}</strong>
      <span>Use now: {formatStat(point.useNowStat)}</span>
      <span>Wait: {formatStat(point.waitStat)}</span>
      <span>Difference: {formatSignedStat(point.difference)}</span>
      <span>Trains: {formatCompact(point.trainsConsumed)}</span>
      <span>
        Book active: {[point.useNowBookActive ? "Use now" : null, point.waitBookActive ? "Wait" : null].filter(Boolean).join(", ") || "None"}
      </span>
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
    postBookTrainingMonthsOutOfFour: parseNumber(form.postBookTrainingMonthsOutOfFour, defaultBookStrategyInputs.postBookTrainingMonthsOutOfFour),
    enhancerUseMode: enhancerModeFromForm(form),
  };
}

function timingInputsFromForm(form: BookTimingForm, energyMode: EnergyMode): BookTimingComparisonInputs {
  return {
    ...defaultBookTimingComparisonInputs,
    lowStat: parseNumber(form.lowStat, defaultBookTimingComparisonInputs.lowStat),
    delayedBookTargetStat: parseNumber(form.delayedBookTargetStat, defaultBookTimingComparisonInputs.delayedBookTargetStat),
    dailyEnergy: energyMode === "breakdown"
      ? calculatedTimingDailyEnergy(form)
      : parseNumber(form.dailyEnergy, defaultBookTimingComparisonInputs.dailyEnergy),
    happiness: defaultBookTimingComparisonInputs.happiness,
    privateIslandPercent: parseNumber(form.privateIslandPercent, defaultBookTimingComparisonInputs.privateIslandPercent),
    generalEducationPercent: parseNumber(form.generalEducationPercent, defaultBookTimingComparisonInputs.generalEducationPercent),
    statEducationPercent: parseNumber(form.statEducationPercent, defaultBookTimingComparisonInputs.statEducationPercent),
    steadfastPercent: parseNumber(form.steadfastPercent, defaultBookTimingComparisonInputs.steadfastPercent),
    customPerksPercent: parseNumber(form.customPerksPercent, defaultBookTimingComparisonInputs.customPerksPercent),
    graphDurationDays: parseNumber(form.graphDurationDays, defaultBookTimingComparisonInputs.graphDurationDays),
    bookBonusPercent: parseNumber(form.bookBonusPercent, defaultBookTimingComparisonInputs.bookBonusPercent),
    gymMultiplier: defaultBookTimingComparisonInputs.gymMultiplier,
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

function timingFormFromInputs(inputs: BookTimingComparisonInputs): BookTimingForm {
  return {
    lowStat: formatInputCompact(inputs.lowStat),
    delayedBookTargetStat: formatInputCompact(inputs.delayedBookTargetStat),
    dailyEnergy: String(inputs.dailyEnergy),
    naturalEnergy: "720",
    xanaxPerDay: "3",
    dailyRefill: "150",
    otherDailyEnergy: "0",
    privateIslandPercent: String(inputs.privateIslandPercent),
    generalEducationPercent: String(inputs.generalEducationPercent),
    statEducationPercent: String(inputs.statEducationPercent),
    steadfastPercent: String(inputs.steadfastPercent),
    customPerksPercent: String(inputs.customPerksPercent),
    graphDurationDays: String(inputs.graphDurationDays),
    bookBonusPercent: String(inputs.bookBonusPercent),
  };
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
    postBookTrainingMonthsOutOfFour: String(inputs.postBookTrainingMonthsOutOfFour),
    enhancerMode: inputs.enhancerUseMode.kind,
    enhancerTargetStat: "3.411b",
    enhancerTargetDay: "334",
  };
}

function calculatedTimingDailyEnergy(form: BookTimingForm): number {
  return (
    parseNumber(form.naturalEnergy, 0) +
    parseNumber(form.xanaxPerDay, 0) * FIXED_ENERGY_PER_XANAX +
    parseNumber(form.dailyRefill, 0) +
    parseNumber(form.otherDailyEnergy, 0)
  );
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

function formatDayInput(value: number): string {
  return Number(value.toFixed(2)).toString();
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

function formatPercent(value: number): string {
  return `${trimFixed(value)}%`;
}

function formatSignedPercentFixed(value: number, digits: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(digits)}%`;
}

function relativeDifferencePercent(difference: number, firstValue: number, secondValue: number): number {
  const comparisonBase = Math.min(Math.abs(firstValue), Math.abs(secondValue));
  return comparisonBase > 0 ? difference / comparisonBase * 100 : 0;
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
