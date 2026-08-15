import React from "react";
import {
  Activity,
  BadgeDollarSign,
  BatteryCharging,
  BookOpen,
  Building2,
  CircleCheck,
  CircleDollarSign,
  Dumbbell,
  GraduationCap,
  Home,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
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
  calculateIgnoranceIsBliss,
  calculateBookTimingComparison,
  calculateBookStrategy,
  findEnhancerLeadMilestones,
  type BookStrategyInputs,
  type IgnoranceIsBlissPoint,
  type IgnoranceIsBlissResult,
  type BookTimingComparisonPoint,
  type BookTimingComparisonResult,
  type BookStrategyPoint,
  type BookStrategyResult,
} from "../utils/bookStrategy";
import {
  CHART_RIGHT_MARGIN,
  CHART_Y_AXIS_WIDTH,
  DEFAULT_FORM,
  DEFAULT_IIB_FORM,
  DEFAULT_SHARED_SETTINGS,
  DEFAULT_TIMING_FORM,
  LEAD_MILESTONE_MAX_DAY,
  LEAD_MILESTONE_TARGETS,
  applySharedSettings,
  buildLogPercentTicks,
  buildLogStatTicks,
  calculatedSharedDailyEnergy,
  clampNumber,
  expandGraphDurationForEarliestOvertake,
  formatCompact,
  formatDayInput,
  formatEnergy,
  formatInputCompact,
  formatLogPercentTick,
  formatMoney,
  formatPercent,
  formatSignedPercentFixed,
  formatSignedStat,
  formatStat,
  ignoranceIsBlissInputsFromForm,
  inputsFromForm,
  parseNumber,
  relativeDifferencePercent,
  timingInputsFromForm,
  type BookStrategyForm,
  type BookStrategyMode,
  type BookTimingForm,
  type BookTimingPopoutKind,
  type ChartClickState,
  type EnergyMode,
  type IgnoranceIsBlissForm,
  type IgnoranceIsBlissPopoutKind,
  type PopoutKind,
  type SharedTrainingSettings,
} from "./BookStrategy.helpers";

const MIN_GRAPH_DURATION_DAYS = 31;
const MAX_GRAPH_DURATION_DAYS = 3_650;
const GRAPH_DURATION_TOOLTIP = "Capped range: 31-3,650 days";
const GYM_DOTS_TOOLTIP = "Capped range: 1-10 gym dots";
const TRAINING_MONTHS_TOOLTIP = "Months spent training target stat out of a standard 4 month steadfast rotation";

export function BookStrategy() {
  const [mode, setMode] = React.useState<BookStrategyMode>("enhancers");
  const [form, setForm] = React.useState<BookStrategyForm>(DEFAULT_FORM);
  const [timingForm, setTimingForm] = React.useState<BookTimingForm>(DEFAULT_TIMING_FORM);
  const [iibForm, setIibForm] = React.useState<IgnoranceIsBlissForm>(DEFAULT_IIB_FORM);
  const [sharedSettings, setSharedSettings] = React.useState<SharedTrainingSettings>(DEFAULT_SHARED_SETTINGS);
  const [energyMode, setEnergyMode] = React.useState<EnergyMode>("total");
  const [openPopout, setOpenPopout] = React.useState<PopoutKind | null>(null);
  const [openTimingPopout, setOpenTimingPopout] = React.useState<BookTimingPopoutKind | null>(null);
  const [openIibPopout, setOpenIibPopout] = React.useState<IgnoranceIsBlissPopoutKind | null>(null);
  const [methodologyOpen, setMethodologyOpen] = React.useState(false);
  const effectiveForm = React.useMemo(() => applySharedSettings(form, sharedSettings), [form, sharedSettings]);
  const effectiveTimingForm = React.useMemo(() => applySharedSettings(timingForm, sharedSettings), [sharedSettings, timingForm]);
  const effectiveIibForm = React.useMemo(() => applySharedSettings(iibForm, sharedSettings), [iibForm, sharedSettings]);
  const inputs = React.useMemo(() => inputsFromForm(effectiveForm, energyMode), [effectiveForm, energyMode]);
  const result = React.useMemo(() => calculateBookStrategy(inputs), [inputs]);
  const enhancerMarkerDay = result.enhancerUse.day;

  function updateSharedSetting<K extends keyof SharedTrainingSettings>(field: K, value: SharedTrainingSettings[K]) {
    setSharedSettings((current) => ({ ...current, [field]: value }));
  }

  function updateField<K extends keyof BookStrategyForm>(field: K, value: BookStrategyForm[K]) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field !== "postBookTrainingMonthsOutOfFour" || typeof value !== "string") {
        return next;
      }

      const expanded = expandGraphDurationForEarliestOvertake(applySharedSettings(next, sharedSettings), energyMode);
      return {
        ...next,
        graphDurationDays: expanded.graphDurationDays,
      };
    });
  }

  function updateStartingStat(value: string) {
    updateField("startingStat", cappedMinimumStatValue(value));
  }

  function updateGraphDuration(value: string) {
    updateField("graphDurationDays", cappedGraphDurationValue(value));
  }

  function updateGymDots(value: string) {
    updateField("gymMultiplier", cappedGymDotsValue(value));
  }

  function updatePostBookTrainingMonths(value: string) {
    updateField("postBookTrainingMonthsOutOfFour", cappedTrainingMonthsValue(value));
  }

  function updateTimingField<K extends keyof BookTimingForm>(field: K, value: BookTimingForm[K]) {
    setTimingForm((current) => ({ ...current, [field]: value }));
  }

  function updateTimingLowStat(value: string) {
    const nextLowStat = cappedMinimumStatValue(value);
    setTimingForm((current) => {
      const lowStat = parseNumber(nextLowStat, 1);
      const delayedTarget = parseNumber(current.delayedBookTargetStat, lowStat + 1);

      return {
        ...current,
        lowStat: nextLowStat,
        delayedBookTargetStat: delayedTarget <= lowStat
          ? formatInputCompact(lowStat + 1)
          : current.delayedBookTargetStat,
      };
    });
  }

  function updateTimingDelayedBookTarget(value: string) {
    const lowStat = parseNumber(timingForm.lowStat, 1);
    updateTimingField("delayedBookTargetStat", cappedMinimumStatValue(value, lowStat + 1));
  }

  function updateTimingGraphDuration(value: string) {
    updateTimingField("graphDurationDays", cappedGraphDurationValue(value));
  }

  function updateIibField<K extends keyof IgnoranceIsBlissForm>(field: K, value: IgnoranceIsBlissForm[K]) {
    setIibForm((current) => ({ ...current, [field]: value }));
  }

  function updateIibNormalHappiness(value: string) {
    if (value.trim() === "") {
      updateIibField("normalHappiness", value);
      return;
    }

    const parsed = parseNumber(value, Number.NaN);
    updateIibField(
      "normalHappiness",
      Number.isFinite(parsed)
        ? formatInputCompact(clampNumber(parsed, 1, 10_000))
        : value,
    );
  }

  function updateIibGymDots(value: string) {
    updateIibField("gymMultiplier", cappedGymDotsValue(value));
  }

  function resetDefaults() {
    setForm(DEFAULT_FORM);
    setTimingForm(DEFAULT_TIMING_FORM);
    setIibForm(DEFAULT_IIB_FORM);
    setSharedSettings(DEFAULT_SHARED_SETTINGS);
    setEnergyMode("total");
    setOpenPopout(null);
    setOpenTimingPopout(null);
    setOpenIibPopout(null);
  }

  const dailyEnergy = energyMode === "breakdown"
    ? calculatedSharedDailyEnergy(sharedSettings)
    : parseNumber(sharedSettings.dailyEnergy, 0);

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

  const updateEnhancerTargetFromClientX = React.useCallback((clientX: number, chartElement: HTMLDivElement) => {
    const rect = chartElement.getBoundingClientRect();
    const plotLeft = rect.left + CHART_Y_AXIS_WIDTH;
    const plotWidth = Math.max(1, rect.width - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN);
    const rawRatio = (clientX - plotLeft) / plotWidth;
    const rawDay = rawRatio * result.inputs.graphDurationDays;
    setEnhancerTargetDay(Math.round(rawDay));
  }, [result.inputs.graphDurationDays, setEnhancerTargetDay]);
  const enhancerDrag = useChartMarkerDrag({ onClientX: updateEnhancerTargetFromClientX });
  const enhancerMarkerLeft =
    enhancerMarkerDay !== null
      ? CHART_Y_AXIS_WIDTH +
        (enhancerMarkerDay / Math.max(1, result.inputs.graphDurationDays)) *
        Math.max(1, enhancerDrag.chartWidth - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN)
      : null;

  const handleChartClick = React.useCallback((state: unknown) => {
    const day = getClickedChartValue(state, "day");
    if (day !== null) {
      setEnhancerTargetDay(day);
    }
  }, [setEnhancerTargetDay]);

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
          <button
            type="button"
            className={mode === "iib" ? "active" : ""}
            onClick={() => setMode("iib")}
            role="tab"
            aria-selected={mode === "iib"}
          >
            Ignorance Is Bliss
          </button>
          <button
            type="button"
            className={mode === "conclusions" ? "active" : ""}
            onClick={() => setMode("conclusions")}
            role="tab"
            aria-selected={mode === "conclusions"}
          >
            Conclusions
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
              <NumberField label="Starting stat" value={form.startingStat} onChange={updateStartingStat} />
              <NumberField label="Happiness" value={form.happiness} onChange={(value) => updateField("happiness", value)} />
              <NumberField
                label="Graph duration (days)"
                value={form.graphDurationDays}
                onChange={updateGraphDuration}
                title={GRAPH_DURATION_TOOLTIP}
              />
              <NumberField
                label="Gym dots"
                value={form.gymMultiplier}
                onChange={updateGymDots}
                title={GYM_DOTS_TOOLTIP}
              />
              <NumberField label="Book bonus %" value={form.bookBonusPercent} onChange={(value) => updateField("bookBonusPercent", value)} />
              <NumberField
                label="Months spent training stat"
                value={form.postBookTrainingMonthsOutOfFour}
                onChange={updatePostBookTrainingMonths}
                title={TRAINING_MONTHS_TOOLTIP}
              />
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
              <EnergyInputs
                settings={sharedSettings}
                energyMode={energyMode}
                dailyEnergy={dailyEnergy}
                startingEnergy={form.startingEnergy}
                onEnergyModeChange={setEnergyMode}
                onSettingChange={updateSharedSetting}
                onStartingEnergyChange={(value) => updateField("startingEnergy", value)}
              />
            ) : null}
            {openPopout === "perks" ? (
              <PerkInputs settings={sharedSettings} onSettingChange={updateSharedSetting} />
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

        <BookStrategyChartShell
          title="Expected growth"
          aside={`${formatCompact(result.inputs.graphDurationDays)} days`}
          chartRef={enhancerDrag.chartRef}
          isDragging={enhancerDrag.isDragging}
          dragClassName="is-dragging-enhancer"
          overlay={enhancerMarkerDay !== null && enhancerMarkerLeft !== null && enhancerDrag.chartWidth > 0 && enhancerMarkerDay <= result.inputs.graphDurationDays ? (
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
                enhancerDrag.startDrag(event.clientX);
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
        >
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
                  type="linear"
                  dataKey="strategyOneStat"
                  name="FHCs"
                  stroke="#fb7185"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="strategyTwoStat"
                  name="Enhancers"
                  stroke="#22d3ee"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
        </BookStrategyChartShell>

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
              Target-stat training uses {formatCompact(result.inputs.postBookTrainingMonthsOutOfFour)}
              {result.inputs.postBookTrainingMonthsOutOfFour === 1 ? " month" : " months"} out of four, modeled as
              31-day training blocks followed by off-stat blocks. The book window counts as the first target-stat block.
            </p>
            <FormulaMethodologyNote />
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
        ) : mode === "timing" ? (
          <BookTimingComparisonView
            form={effectiveTimingForm}
            energyMode={energyMode}
            sharedSettings={sharedSettings}
            openPopout={openTimingPopout}
            methodologyOpen={methodologyOpen}
            onFieldChange={updateTimingField}
            onLowStatChange={updateTimingLowStat}
            onDelayedBookTargetChange={updateTimingDelayedBookTarget}
            onGraphDurationChange={updateTimingGraphDuration}
            onEnergyModeChange={setEnergyMode}
            onSharedSettingChange={updateSharedSetting}
            onPopoutChange={setOpenTimingPopout}
            onMethodologyToggle={() => setMethodologyOpen((current) => !current)}
          />
        ) : mode === "iib" ? (
          <IgnoranceIsBlissView
            form={effectiveIibForm}
            energyMode={energyMode}
            sharedSettings={sharedSettings}
            openPopout={openIibPopout}
            methodologyOpen={methodologyOpen}
            onFieldChange={updateIibField}
            onNormalHappinessChange={updateIibNormalHappiness}
            onGymDotsChange={updateIibGymDots}
            onEnergyModeChange={setEnergyMode}
            onSharedSettingChange={updateSharedSetting}
            onPopoutChange={setOpenIibPopout}
            onMethodologyToggle={() => setMethodologyOpen((current) => !current)}
          />
        ) : (
          <ConclusionsView />
        )}
      </section>
    </>
  );
}

function BookTimingComparisonView({
  form,
  energyMode,
  sharedSettings,
  openPopout,
  methodologyOpen,
  onFieldChange,
  onLowStatChange,
  onDelayedBookTargetChange,
  onGraphDurationChange,
  onEnergyModeChange,
  onSharedSettingChange,
  onPopoutChange,
  onMethodologyToggle,
}: {
  form: BookTimingForm;
  energyMode: EnergyMode;
  sharedSettings: SharedTrainingSettings;
  openPopout: BookTimingPopoutKind | null;
  methodologyOpen: boolean;
  onFieldChange: <K extends keyof BookTimingForm>(field: K, value: BookTimingForm[K]) => void;
  onLowStatChange: (value: string) => void;
  onDelayedBookTargetChange: (value: string) => void;
  onGraphDurationChange: (value: string) => void;
  onEnergyModeChange: (mode: EnergyMode) => void;
  onSharedSettingChange: <K extends keyof SharedTrainingSettings>(field: K, value: SharedTrainingSettings[K]) => void;
  onPopoutChange: (popout: BookTimingPopoutKind | null) => void;
  onMethodologyToggle: () => void;
}) {
  const inputs = React.useMemo(() => timingInputsFromForm(form, energyMode), [energyMode, form]);
  const result = React.useMemo(() => calculateBookTimingComparison(inputs), [inputs]);
  const dailyEnergy = energyMode === "breakdown"
    ? calculatedSharedDailyEnergy(sharedSettings)
    : parseNumber(sharedSettings.dailyEnergy, 0);
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

  const setDelayedBookStartDay = React.useCallback((rawDay: number) => {
    if (!Number.isFinite(rawDay)) {
      return;
    }

    const day = clampNumber(rawDay, 0, result.inputs.graphDurationDays);
    const targetStat = bookTimingStatAtDayWithoutBook(result.inputs, day);
    onFieldChange("delayedBookTargetStat", formatInputCompact(targetStat));
  }, [onFieldChange, result.inputs]);

  const updateDelayedBookTargetFromClientX = React.useCallback((clientX: number, chartElement: HTMLDivElement) => {
    const rect = chartElement.getBoundingClientRect();
    const plotLeft = rect.left + CHART_Y_AXIS_WIDTH;
    const plotWidth = Math.max(1, rect.width - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN);
    const rawRatio = (clientX - plotLeft) / plotWidth;
    const handleCenterDay = rawRatio * result.inputs.graphDurationDays;
    setDelayedBookStartDay(handleCenterDay - result.inputs.bookDurationDays / 2);
  }, [result.inputs.bookDurationDays, result.inputs.graphDurationDays, setDelayedBookStartDay]);
  const delayedBookDrag = useChartMarkerDrag({ onClientX: updateDelayedBookTargetFromClientX });
  const handleBookTimingChartClick = React.useCallback((state: unknown) => {
    const day = getClickedChartValue(state, "day");
    if (day !== null) {
      setDelayedBookStartDay(day - result.inputs.bookDurationDays / 2);
    }
  }, [result.inputs.bookDurationDays, setDelayedBookStartDay]);
  const delayedBookHandleLeft =
    delayedBookHandleDay !== null
      ? CHART_Y_AXIS_WIDTH +
        (delayedBookHandleDay / Math.max(1, result.inputs.graphDurationDays)) *
        Math.max(1, delayedBookDrag.chartWidth - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN)
      : null;

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
          <NumberField label="Low stat" value={form.lowStat} onChange={onLowStatChange} />
          <NumberField label="Use later at stat" value={form.delayedBookTargetStat} onChange={onDelayedBookTargetChange} />
          <NumberField
            label="Graph duration (days)"
            value={form.graphDurationDays}
            onChange={onGraphDurationChange}
            title={GRAPH_DURATION_TOOLTIP}
          />
          <NumberField label="Book bonus %" value={form.bookBonusPercent} onChange={(value) => onFieldChange("bookBonusPercent", value)} />
        </div>
        {openPopout === "energy" ? (
          <EnergyInputs
            settings={sharedSettings}
            energyMode={energyMode}
            dailyEnergy={dailyEnergy}
            onEnergyModeChange={onEnergyModeChange}
            onSettingChange={onSharedSettingChange}
          />
        ) : null}
        {openPopout === "perks" ? (
          <PerkInputs settings={sharedSettings} onSettingChange={onSharedSettingChange} />
        ) : null}
      </section>

      <BookStrategyChartShell
        title="Book timing growth"
        aside={`${formatCompact(result.inputs.graphDurationDays)} days`}
        chartRef={delayedBookDrag.chartRef}
        isDragging={delayedBookDrag.isDragging}
        dragClassName="is-dragging-book-timing"
        overlay={shouldShowDelayedBookWindow && delayedBookHandleLeft !== null && delayedBookDrag.chartWidth > 0 ? (
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
              delayedBookDrag.startDrag(event.clientX);
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
      >
            <LineChart
              data={result.series}
              margin={{ top: 12, right: 18, left: 0, bottom: 14 }}
              onClick={handleBookTimingChartClick}
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
      </BookStrategyChartShell>

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
          <FormulaMethodologyNote />
        </div>
      </CollapsiblePanel>
    </>
  );
}

function ConclusionsView() {
  return (
    <section className="panel book-strategy-conclusions-panel">
      <PanelHeader icon={<BookOpen size={17} />} title="Conclusions" />
      <div className="book-strategy-conclusions">
        <section>
          <h3>When should you read the book?</h3>
          <p>
            A higher starting stat alone is not a good reason to delay. When training conditions remain the same,
            using the book now or later produces an almost identical long-term result.
          </p>
          <p>
            However, reading the book earlier can be more valuable in the short term. The additional stats represent a
            much larger proportion of your current stat and are available immediately, allowing you to benefit from the
            increased strength sooner.
          </p>
          <p>
            Delaying may still be worthwhile if your training conditions will improve later, such as unlocking a
            specialist gym, completing gym-gain educations, gaining better Steadfast, or joining a company with training perks.
          </p>
        </section>

        <section>
          <h3>Should you use FHCs?</h3>
          <p>
            Using FHCs throughout the book produces a large immediate stat increase, but it is extremely expensive. If
            the same money is saved and eventually spent on stat enhancers, FHCs lead at first, but enhancers eventually
            overtake.
          </p>
          <p>
            Under the calculator&apos;s default assumptions, the  break-even points are approximately:
          </p>
          <ul>
            <li>
              <strong>3.4b</strong> when using an <strong>8.0-dot specialist gym</strong>.
            </li>
            <li>
              <strong>2.9b</strong> when using <strong>George&apos;s 7.3-dot gym</strong>.
            </li>
          </ul>
          <p>
            After break-even, the enhancer strategy&apos;s advantage continues to grow as the stat increases. Investing
            the FHC budget can shorten the time needed to reach break-even, but does not change the break-even
            stat itself unless the returns are enough to buy an additional enhancer.
          </p>
        </section>

        <section>
          <h3>Ignorance Is Bliss</h3>
          <p>
            <em>Ignorance Is Bliss</em> provides an enormous increase in training gains at low stats because happiness
            contributes much more heavily to the training formula at that stage.
          </p>
          <p>
            Its benefit declines as starting stat increases, but it remains valuable at high stats. At 35m
            additional training gain drops to <strong>20%</strong>, putting it approximately equal
            to the 20% gym-gain book <em>Get Hard Or Go Home</em>. After that, effectiveness continues to slowly decline,
            hitting <strong>18%</strong> at 10b stats.
          </p>
        </section>
      </div>
    </section>
  );
}

function IgnoranceIsBlissView({
  form,
  energyMode,
  sharedSettings,
  openPopout,
  methodologyOpen,
  onFieldChange,
  onNormalHappinessChange,
  onGymDotsChange,
  onEnergyModeChange,
  onSharedSettingChange,
  onPopoutChange,
  onMethodologyToggle,
}: {
  form: IgnoranceIsBlissForm;
  energyMode: EnergyMode;
  sharedSettings: SharedTrainingSettings;
  openPopout: IgnoranceIsBlissPopoutKind | null;
  methodologyOpen: boolean;
  onFieldChange: <K extends keyof IgnoranceIsBlissForm>(field: K, value: IgnoranceIsBlissForm[K]) => void;
  onNormalHappinessChange: (value: string) => void;
  onGymDotsChange: (value: string) => void;
  onEnergyModeChange: (mode: EnergyMode) => void;
  onSharedSettingChange: <K extends keyof SharedTrainingSettings>(field: K, value: SharedTrainingSettings[K]) => void;
  onPopoutChange: (popout: IgnoranceIsBlissPopoutKind | null) => void;
  onMethodologyToggle: () => void;
}) {
  const inputs = React.useMemo(() => ignoranceIsBlissInputsFromForm(form, energyMode), [energyMode, form]);
  const result = React.useMemo(() => calculateIgnoranceIsBliss(inputs), [inputs]);
  const dailyEnergy = energyMode === "breakdown"
    ? calculatedSharedDailyEnergy(sharedSettings)
    : parseNumber(sharedSettings.dailyEnergy, 0);
  const xTicks = React.useMemo(() => buildLogStatTicks(result.inputs.graphMaxStat), [result.inputs.graphMaxStat]);
  const yTicks = React.useMemo(() => buildLogPercentTicks(), []);
  const xDomainStart = 1;
  const xDomainEnd = Math.max(xDomainStart, result.inputs.graphMaxStat);

  const setIibStartingStatFromRaw = React.useCallback((rawStat: number) => {
    if (!Number.isFinite(rawStat)) {
      return;
    }

    const stat = clampNumber(rawStat, 1, result.inputs.graphMaxStat);
    onFieldChange("startingStat", formatInputCompact(stat));
  }, [onFieldChange, result.inputs.graphMaxStat]);

  const updateIibStartingStatFromClientX = React.useCallback((clientX: number, chartElement: HTMLDivElement) => {
    const rect = chartElement.getBoundingClientRect();
    const plotLeft = rect.left + CHART_Y_AXIS_WIDTH;
    const plotWidth = Math.max(1, rect.width - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN);
    const rawRatio = clampNumber((clientX - plotLeft) / plotWidth, 0, 1);
    const stat = statFromLogRatio(rawRatio, xDomainStart, xDomainEnd);
    setIibStartingStatFromRaw(stat);
  }, [setIibStartingStatFromRaw, xDomainEnd]);
  const iibStatDrag = useChartMarkerDrag({ onClientX: updateIibStartingStatFromClientX });
  const handleIibChartClick = React.useCallback((state: unknown) => {
    const startingStat = getClickedChartValue(state, "startingStat");
    if (startingStat !== null) {
      setIibStartingStatFromRaw(startingStat);
    }
  }, [setIibStartingStatFromRaw]);
  const startingStatMarkerLeft = iibStatDrag.chartWidth > 0
    ? CHART_Y_AXIS_WIDTH +
      logRatioForStat(result.inputs.startingStat, xDomainStart, xDomainEnd) *
      Math.max(1, iibStatDrag.chartWidth - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN)
    : null;

  return (
    <>
      <section className="panel book-strategy-panel book-strategy-input-panel">
        <PanelHeader
          icon={<BookOpen size={17} />}
          title="Ignorance Is Bliss Inputs"
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
          <NumberField label="Starting stat" value={form.startingStat} onChange={(value) => onFieldChange("startingStat", value)} />
          <NumberField
            label="Happiness without book"
            value={form.normalHappiness}
            onChange={onNormalHappinessChange}
            title="Capped range: 1-10,000 standard happiness"
          />
          <NumberField label="Graph max stat" value={form.graphMaxStat} onChange={(value) => onFieldChange("graphMaxStat", value)} />
          <NumberField
            label="Gym dots"
            value={form.gymMultiplier}
            onChange={onGymDotsChange}
            title={GYM_DOTS_TOOLTIP}
          />
        </div>
        {openPopout === "energy" ? (
          <EnergyInputs
            settings={sharedSettings}
            energyMode={energyMode}
            dailyEnergy={dailyEnergy}
            onEnergyModeChange={onEnergyModeChange}
            onSettingChange={onSharedSettingChange}
          />
        ) : null}
        {openPopout === "perks" ? (
          <PerkInputs settings={sharedSettings} onSettingChange={onSharedSettingChange} />
        ) : null}
      </section>

      <BookStrategyChartShell
        title="Ignorance Is Bliss gain"
        aside="31 days"
        chartRef={iibStatDrag.chartRef}
        isDragging={iibStatDrag.isDragging}
        dragClassName="is-dragging-iib-stat"
        overlay={startingStatMarkerLeft !== null ? (
          <div
            className="book-iib-stat-drag-target"
            style={{ left: `${startingStatMarkerLeft}px` }}
            role="slider"
            tabIndex={0}
            aria-label="Starting stat marker"
            aria-valuemin={1}
            aria-valuemax={result.inputs.graphMaxStat}
            aria-valuenow={Math.round(result.inputs.startingStat)}
            onPointerDown={(event) => {
              event.preventDefault();
              iibStatDrag.startDrag(event.clientX);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                return;
              }

              event.preventDefault();
              const multiplier = event.key === "ArrowLeft" ? 1 / 1.1 : 1.1;
              setIibStartingStatFromRaw(result.inputs.startingStat * multiplier);
            }}
          >
            <span className="book-iib-stat-handle">
              <Dumbbell size={14} />
            </span>
          </div>
        ) : null}
      >
            <LineChart
              data={result.series}
              margin={{ top: 12, right: 18, left: 0, bottom: 14 }}
              onClick={handleIibChartClick}
            >
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
              <XAxis
                dataKey="startingStat"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--chart-axis)" }}
                tickFormatter={(value) => formatCompact(Number(value))}
                type="number"
                scale="log"
                domain={[xDomainStart, xDomainEnd]}
                ticks={xTicks}
                allowDataOverflow
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--chart-axis)" }}
                tickFormatter={(value) => formatLogPercentTick(Number(value))}
                scale="log"
                domain={[yTicks[0], yTicks[yTicks.length - 1]]}
                ticks={yTicks}
                width={64}
              />
              <Tooltip content={<IgnoranceIsBlissTooltip />} />
              <Legend wrapperStyle={{ color: "var(--text-muted)", fontWeight: 800 }} />
              <ReferenceLine
                x={result.inputs.startingStat}
                stroke="#f59e0b"
                strokeDasharray="4 4"
              />
              <Line
                type="linear"
                dataKey="percentIncrease"
                name="IIB gain"
                stroke="#22d3ee"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
      </BookStrategyChartShell>

      <IgnoranceIsBlissSummaryPanel result={result} />

      <CollapsiblePanel
        title="Methodology"
        collapsed={!methodologyOpen}
        onToggle={onMethodologyToggle}
      >
        <div className="book-strategy-methodology">
          <p>
            Uses Vladar's community gym formula over a fixed 31-day book window with 50-energy trains and no random term.
          </p>
          <p>
            Ignorance Is Bliss is modeled by treating happiness as restored to 99,999 for the book duration. The baseline
            uses the selected happiness value without the book.
          </p>
          <p>
            The graph shows the extra 31-day gain from Ignorance Is Bliss as a percentage of the same 31-day gain without
            the book.
          </p>
          <FormulaMethodologyNote />
        </div>
      </CollapsiblePanel>
    </>
  );
}

function FormulaMethodologyNote() {
  return (
    <>
      <div className="book-formula-block" aria-label="Vladar gym formula">
        <math display="block">
          <mrow>
            <msub>
              <mi>G</mi>
              <mtext>train</mtext>
            </msub>
            <mo>=</mo>
            <mfrac>
              <mrow>
                <mi>D</mi>
                <mo>*</mo>
                <mi>E</mi>
                <mo>*</mo>
                <mi>P</mi>
                <mo>*</mo>
                <mi>B</mi>
                <mo>*</mo>
                <msub>
                  <mi>G</mi>
                  <mtext>base</mtext>
                </msub>
              </mrow>
              <mn>200000</mn>
            </mfrac>
          </mrow>
        </math>
        <math display="block">
          <mrow>
            <msub>
              <mi>G</mi>
              <mtext>base</mtext>
            </msub>
            <mo>=</mo>
            <msub>
              <mi>S</mi>
              <mtext>eff</mtext>
            </msub>
            <mo>*</mo>
            <msub>
              <mi>H</mi>
              <mtext>term</mtext>
            </msub>
            <mo>+</mo>
            <mn>8</mn>
            <mo>*</mo>
            <msup>
              <mi>h</mi>
              <mn>1.05</mn>
            </msup>
            <mo>+</mo>
            <mn>1600</mn>
            <mo>*</mo>
            <mrow>
              <mo>(</mo>
              <mn>1</mn>
              <mo>-</mo>
              <msup>
                <mrow>
                  <mo>(</mo>
                  <mfrac>
                    <mi>h</mi>
                    <mn>99999</mn>
                  </mfrac>
                  <mo>)</mo>
                </mrow>
                <mn>2</mn>
              </msup>
              <mo>)</mo>
            </mrow>
            <mo>+</mo>
            <mn>1700</mn>
          </mrow>
        </math>
        <math display="block">
          <mrow>
            <msub>
              <mi>H</mi>
              <mtext>term</mtext>
            </msub>
            <mo>=</mo>
            <mn>1</mn>
            <mo>+</mo>
            <mn>0.07</mn>
            <mo>*</mo>
            <mi>ln</mi>
            <mo>(</mo>
            <mn>1</mn>
            <mo>+</mo>
            <mfrac>
              <mi>h</mi>
              <mn>250</mn>
            </mfrac>
            <mo>)</mo>
          </mrow>
        </math>
        <math display="block">
          <mrow>
            <msub>
              <mi>S</mi>
              <mtext>eff</mtext>
            </msub>
            <mo>=</mo>
            <mrow>
              <mo>{"{"}</mo>
              <mtable>
                <mtr>
                  <mtd>
                    <mi>S</mi>
                  </mtd>
                  <mtd>
                    <mtext>if </mtext>
                    <mi>S</mi>
                    <mo>&lt;</mo>
                    <mn>50000000</mn>
                  </mtd>
                </mtr>
                <mtr>
                  <mtd>
                    <mrow>
                      <mn>50000000</mn>
                      <mo>+</mo>
                      <mfrac>
                        <mrow>
                          <mi>S</mi>
                          <mo>-</mo>
                          <mn>50000000</mn>
                        </mrow>
                        <mrow>
                          <mn>8.77635</mn>
                          <mo>*</mo>
                          <msub>
                            <mi>log</mi>
                            <mn>10</mn>
                          </msub>
                          <mo>(</mo>
                          <mi>S</mi>
                          <mo>)</mo>
                        </mrow>
                      </mfrac>
                    </mrow>
                  </mtd>
                  <mtd>
                    <mtext>if </mtext>
                    <mi>S</mi>
                    <mo>&ge;</mo>
                    <mn>50000000</mn>
                  </mtd>
                </mtr>
              </mtable>
            </mrow>
          </mrow>
        </math>
      </div>
      <p>
        D = gym dots, E = energy per train, P = perk multiplier, B = book multiplier, h = happiness, and S_eff is
        the effective stat.
      </p>
    </>
  );
}

function BookTimingReasonsPanel() {
  const useNowReasons = [
    {
      icon: <Activity size={17} />,
      title: "Immediate strength increase",
      detail: "The book boost lands now, when near-term fights, missions, or growth checks can use it.",
    },
    {
      icon: <TrendingUp size={17} />,
      title: "Greater relative impact",
      detail: "The same book window is a larger percentage of your current strength at lower stats.",
    },
    {
      icon: <CircleCheck size={17} />,
      title: "No expected gain improvements",
      detail: "If your gym, education, housing, company, and perks are stable, waiting adds little timing value.",
    },
  ];
  const delayReasons = [
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
      <PanelHeader icon={<BookOpen size={17} />} title="Timing Considerations" />
      <p>
        Book timing is mostly a preference unless training conditions will change. Use now for short-term relative
        strength; delay only when the book window would benefit from better gains.
      </p>
      <div className="book-timing-reason-columns">
        <section className="book-timing-reason-section is-use-now">
          <h3>Reasons to Use Now</h3>
          <div className="book-timing-reason-grid">
            {useNowReasons.map((reason) => (
              <div className="book-timing-reason-item" key={reason.title}>
                <span>{reason.icon}</span>
                <strong>{reason.title}</strong>
                <small>{reason.detail}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="book-timing-reason-section is-delay">
          <h3>Reasons to Delay</h3>
          <div className="book-timing-reason-grid">
            {delayReasons.map((reason) => (
              <div className="book-timing-reason-item" key={reason.title}>
                <span>{reason.icon}</span>
                <strong>{reason.title}</strong>
                <small>{reason.detail}</small>
              </div>
            ))}
          </div>
        </section>
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
  const enhancerLeadMilestones = React.useMemo(
    () => findEnhancerLeadMilestones(earliestInputs, [0, ...LEAD_MILESTONE_TARGETS], LEAD_MILESTONE_MAX_DAY),
    [earliestInputs],
  );
  const earliestMilestone = enhancerLeadMilestones[0]?.milestone ?? null;
  const leadMilestones = enhancerLeadMilestones.slice(1);
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
  const outcomeLabel = result.winningStrategy === "tied"
    ? "Strategies tied"
    : `${winnerLabel} ahead`;
  const outcomeStat = result.winningStrategy === "tied"
    ? formatStat(0)
    : formatSignedStat(Math.abs(result.endpoint.difference));
  const outcomePercent = result.winningStrategy === "tied"
    ? formatSignedPercentFixed(0, 3)
    : formatSignedPercentFixed(endpointDifferencePercent, 3);
  const leftoverMoney = result.enhancerUse.investmentBalance === null
    ? null
    : Math.max(0, result.enhancerUse.investmentBalance - result.enhancerUse.enhancersUsed * result.inputs.statEnhancerPrice);
  const enhancerSpend = result.enhancerUse.enhancersUsed * result.inputs.statEnhancerPrice;
  const earliestEnhancerSpend = (earliestMilestone?.enhancersUsed ?? 0) * result.inputs.statEnhancerPrice;
  const enhancerBudgetAction = result.inputs.investmentEnabled
    ? "invest the"
    : "keep the";
  const enhancerBudgetDetail = result.inputs.investmentEnabled
    ? "FHC budget"
    : "FHC budget as cash";
  const summaryLines = [
    `FHCs use ${formatCompact(result.fhcPlan.totalFhcs)} FHCs during the initial 31 days, putting them ahead by ${formatSignedStat(result.bookEnd.lead)} stats at book end.`,
    earliestMilestone === null
      ? `Enhancers ${enhancerBudgetAction} ${formatMoney(result.fhcPlan.cost)} ${enhancerBudgetDetail} and do not break even in the simulated range.`
      : `Enhancers ${enhancerBudgetAction} ${formatMoney(result.fhcPlan.cost)} ${enhancerBudgetDetail} and break even on day ${formatCompact(earliestMilestone.day)} by purchasing ${formatCompact(earliestMilestone.enhancersUsed)} enhancers for ${formatMoney(earliestEnhancerSpend)}.`,
    earliestMilestone === null
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
      <div className="book-summary-primary-grid">
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
        <div className={`book-strategy-summary-outcome is-${result.winningStrategy}`}>
          <span>{outcomeLabel}</span>
          <strong>{outcomeStat}</strong>
          <small>{outcomePercent}</small>
        </div>
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
          label="Enhancers cost"
          value={formatMoney(enhancerSpend)}
          detail={`${leftoverMoney === null ? "N/A" : formatMoney(leftoverMoney)} leftover`}
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
  const endpointGapPercent = `${Math.abs(endpointDifferencePercent).toFixed(3)}%`;
  const endpointGapStat = formatStat(Math.abs(result.endpoint.difference));
  const endpointLead = Math.abs(result.endpoint.difference) < 0.5
    ? "No visible lead"
    : result.endpoint.difference > 0
      ? "Wait ahead"
      : "Use now ahead";
  const comparisonComplete =
    result.delayedBook.endDay !== null &&
    result.delayedBook.endDay <= result.inputs.graphDurationDays;
  const longRunVerdict = !comparisonComplete
    ? "Comparison incomplete"
    : Math.abs(endpointDifferencePercent) <= 0.1
      ? "Difference negligible"
      : endpointLead;
  const longRunDetail = comparisonComplete
    ? `Final gap ${endpointGapPercent} / ${endpointGapStat} stats at day ${endpointDay}`
    : "Extend the graph to compare both completed book paths";
  const delayedStartDetail = result.delayedBookStartDay === null
    ? "Target not reached"
    : `Day ${formatCompact(result.delayedBookStartDay)}`;
  const immediatePercent = result.immediateBook.percentGain === null ? "N/A" : formatPercent(result.immediateBook.percentGain);
  const delayedPercent = result.delayedBook.percentGain === null ? "N/A" : formatPercent(result.delayedBook.percentGain);
  const immediateExtra = result.immediateBook.extraGain === null ? "N/A" : formatSignedStat(result.immediateBook.extraGain);
  const delayedExtra = result.delayedBook.extraGain === null ? "N/A" : formatSignedStat(result.delayedBook.extraGain);
  const liftDifference =
    result.immediateBook.percentGain !== null && result.delayedBook.percentGain !== null
      ? result.immediateBook.percentGain - result.delayedBook.percentGain
      : null;
  const liftVerdict = liftDifference === null
    ? "Compare book lifts"
    : Math.abs(liftDifference) < 0.01
      ? "Relative lift is close"
      : liftDifference > 0
        ? "Use now has greater relative lift"
        : "Wait has greater relative lift";
  const liftDetail = liftDifference === null
    ? "Waiting target is outside the chart window"
    : `Now ${immediatePercent} vs wait ${delayedPercent}`;
  const timingSummaryLines = [
    comparisonComplete
      ? `${longRunVerdict}: the final gap is ${endpointGapPercent} (${endpointGapStat} stats) at day ${endpointDay}.`
      : "Comparison incomplete: extend the graph so the delayed book's 31-day window finishes before reading the long-run result.",
    `Use now gives a ${immediatePercent} lift against current strength, while waiting gives ${delayedPercent} at the delayed strength.`,
    result.delayedBookStartDay === null
      ? `Wait does not reach ${formatStat(result.inputs.delayedBookTargetStat)} within ${formatCompact(result.inputs.graphDurationDays)} days.`
      : `Wait reaches ${formatStat(result.inputs.delayedBookTargetStat)} on day ${formatCompact(result.delayedBookStartDay)}; that can add more raw stats later, but usually with a smaller relative impact.`,
    `Both paths use ${formatCompact(result.totalTrains)} trains with no starting-energy stack or delayed energy stack.`,
  ];

  return (
    <section className="panel book-strategy-summary-panel book-timing-summary-panel">
      <PanelHeader icon={<Trophy size={17} />} title="Book Timing Summary" />
      <div className="book-summary-primary-grid">
        <BookTimingInsightCard
          icon={<Activity size={18} />}
          tone="use-now"
          label="Short-term"
          value={liftVerdict}
          detail={liftDetail}
        />
        <BookTimingInsightCard
          icon={<Trophy size={18} />}
          tone="balanced"
          label="Long-run"
          value={longRunVerdict}
          detail={longRunDetail}
        />
      </div>
      <div className="book-strategy-summary-support-grid">
        <SummaryItem
          icon={<BookOpen size={16} />}
          label="Use now lift"
          value={immediatePercent}
          detail={`${immediateExtra} during first ${formatCompact(result.inputs.bookDurationDays)} days`}
        />
        <SummaryItem
          icon={<Sparkles size={16} />}
          label="Wait lift"
          value={delayedPercent}
          detail={`${delayedExtra} when used at ${formatStat(result.inputs.delayedBookTargetStat)}`}
        />
        <SummaryItem
          icon={<Activity size={16} />}
          label="Delayed book start"
          value={delayedStartDetail}
          detail={`Target ${formatStat(result.inputs.delayedBookTargetStat)}`}
        />
        <SummaryItem
          icon={<BatteryCharging size={16} />}
          label="Same inputs"
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

function BookTimingInsightCard({
  icon,
  tone,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  tone: "neutral" | "strategy-one" | "strategy-two" | "balanced" | "use-now";
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={`book-timing-insight-card is-${tone}`}>
      <span className="book-timing-insight-icon">{icon}</span>
      <span className="book-timing-insight-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function IgnoranceIsBlissSummaryPanel({ result }: { result: IgnoranceIsBlissResult }) {
  const selected = result.selected;
  const uplift = formatSignedPercentFixed(selected.percentIncrease, 3);
  const summaryLines = [
    `At ${formatStat(selected.startingStat)} starting stats, Ignorance Is Bliss adds ${formatSignedStat(selected.extraGain)} extra stats over ${formatCompact(result.inputs.bookDurationDays)} days.`,
    `That is ${uplift} more gain than training the same energy at ${formatCompact(result.inputs.normalHappiness)} happiness.`,
    `The comparison uses ${formatCompact(result.totalTrains)} trains and does not include a starting-energy stack.`,
  ];

  return (
    <section className="panel book-strategy-summary-panel book-iib-summary-panel">
      <PanelHeader icon={<Trophy size={17} />} title="Ignorance Is Bliss Summary" />
      <div className="book-summary-primary-grid">
        <SummaryEndingCard
          accent="strategy-one"
          label="Without book"
          value={formatSignedStat(selected.normalGain)}
          detail={`Ends at ${formatStat(selected.normalEndingStat)}`}
        />
        <SummaryEndingCard
          accent="strategy-two"
          label="With IIB"
          value={formatSignedStat(selected.bookGain)}
          detail={`Ends at ${formatStat(selected.bookEndingStat)}`}
        />
        <div className="book-strategy-summary-outcome is-strategyTwo">
          Ignorance Is Bliss gain {uplift}
        </div>
      </div>
      <div className="book-strategy-summary-support-grid">
        <SummaryItem
          icon={<Dumbbell size={16} />}
          label="Starting stat"
          value={formatStat(selected.startingStat)}
          detail="Selected marker"
        />
        <SummaryItem
          icon={<Sparkles size={16} />}
          label="Extra gain"
          value={formatSignedStat(selected.extraGain)}
          detail="With IIB vs without"
        />
        <SummaryItem
          icon={<BatteryCharging size={16} />}
          label="Energy used"
          value={formatCompact(result.totalTrains)}
          detail="50-energy trains"
        />
        <SummaryItem
          icon={<Activity size={16} />}
          label="Book happiness"
          value="99,999"
          detail={`Baseline ${formatCompact(result.inputs.normalHappiness)}`}
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

function IgnoranceIsBlissTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: IgnoranceIsBlissPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="chart-tooltip-card book-strategy-tooltip">
      <strong>Starting stat {formatStat(point.startingStat)}</strong>
      <span>Without book gain: {formatSignedStat(point.normalGain)}</span>
      <span>With IIB gain: {formatSignedStat(point.bookGain)}</span>
      <span>Extra gain: {formatSignedStat(point.extraGain)}</span>
      <span>Uplift: {formatSignedPercentFixed(point.percentIncrease, 3)}</span>
    </div>
  );
}

function BookStrategyChartShell({
  title,
  aside,
  chartRef,
  isDragging,
  dragClassName,
  overlay,
  children,
}: {
  title: string;
  aside: string;
  chartRef: React.Ref<HTMLDivElement>;
  isDragging: boolean;
  dragClassName: string;
  overlay?: React.ReactNode;
  children: React.ReactElement;
}) {
  return (
    <section className="panel book-strategy-chart-panel">
      <PanelHeader icon={<Activity size={17} />} title={title} aside={aside} />
      <div className={`book-strategy-chart ${isDragging ? dragClassName : ""}`} ref={chartRef}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
        {overlay ?? null}
      </div>
    </section>
  );
}

function getClickedChartValue(state: unknown, payloadKey: "day" | "startingStat"): number | null {
  const chartState = state as ChartClickState;
  const payloadValue = chartState?.activePayload
    ?.find((item) => item.payload?.[payloadKey] !== undefined)
    ?.payload?.[payloadKey];
  const value = Number(payloadValue ?? chartState?.activeLabel);

  return Number.isFinite(value) ? value : null;
}

function useChartMarkerDrag({
  onClientX,
}: {
  onClientX: (clientX: number, chartElement: HTMLDivElement) => void;
}) {
  const [isDragging, setIsDragging] = React.useState(false);
  const [chartWidth, setChartWidth] = React.useState(0);
  const chartRef = React.useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const pendingClientXRef = React.useRef<number | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);

  const applyClientX = React.useCallback((clientX: number) => {
    const chartElement = chartRef.current;
    if (!chartElement) {
      return;
    }

    onClientX(clientX, chartElement);
  }, [onClientX]);

  const scheduleClientX = React.useCallback((clientX: number) => {
    pendingClientXRef.current = clientX;
    if (animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const nextClientX = pendingClientXRef.current;
      pendingClientXRef.current = null;
      if (nextClientX !== null) {
        applyClientX(nextClientX);
      }
    });
  }, [applyClientX]);

  const flushScheduledClientX = React.useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const nextClientX = pendingClientXRef.current;
    pendingClientXRef.current = null;
    if (nextClientX !== null) {
      applyClientX(nextClientX);
    }
  }, [applyClientX]);

  const startDrag = React.useCallback((clientX: number) => {
    setIsDragging(true);
    applyClientX(clientX);
  }, [applyClientX]);

  const setChartElement = React.useCallback((element: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    chartRef.current = element;

    if (!element) {
      setChartWidth(0);
      return;
    }

    const updateWidth = () => setChartWidth(element.getBoundingClientRect().width);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    resizeObserverRef.current = observer;
  }, []);

  React.useEffect(() => (
    () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    }
  ), []);

  React.useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    function handlePointerMove(event: PointerEvent) {
      scheduleClientX(event.clientX);
    }

    function handlePointerUp() {
      flushScheduledClientX();
      setIsDragging(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      pendingClientXRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [flushScheduledClientX, isDragging, scheduleClientX]);

  return {
    chartRef: setChartElement,
    chartWidth,
    isDragging,
    startDrag,
  };
}

function logRatioForStat(stat: number, domainStart: number, domainEnd: number): number {
  const start = Math.max(1, domainStart);
  const end = Math.max(start, domainEnd);
  if (end <= start) {
    return 0;
  }

  const startLog = Math.log10(start);
  const endLog = Math.log10(end);
  return clampNumber((Math.log10(clampNumber(stat, start, end)) - startLog) / Math.max(0.000001, endLog - startLog), 0, 1);
}

function statFromLogRatio(ratio: number, domainStart: number, domainEnd: number): number {
  const start = Math.max(1, domainStart);
  const end = Math.max(start, domainEnd);
  if (end <= start) {
    return start;
  }

  const startLog = Math.log10(start);
  const endLog = Math.log10(end);
  return 10 ** (startLog + clampNumber(ratio, 0, 1) * (endLog - startLog));
}

function cappedGraphDurationValue(value: string): string {
  if (value.trim() === "") {
    return value;
  }

  const parsed = parseNumber(value, Number.NaN);
  return Number.isFinite(parsed)
    ? formatInputCompact(clampNumber(parsed, MIN_GRAPH_DURATION_DAYS, MAX_GRAPH_DURATION_DAYS))
    : value;
}

function cappedGymDotsValue(value: string): string {
  if (value.trim() === "") {
    return value;
  }

  const parsed = parseNumber(value, Number.NaN);
  return Number.isFinite(parsed)
    ? Number(clampNumber(parsed, 1, 10).toFixed(2)).toString()
    : value;
}

function cappedTrainingMonthsValue(value: string): string {
  if (value.trim() === "") {
    return value;
  }

  const parsed = parseNumber(value, Number.NaN);
  return Number.isFinite(parsed)
    ? Number(clampNumber(parsed, 1, 4).toFixed(2)).toString()
    : value;
}

function cappedMinimumStatValue(value: string, minimum = 1): string {
  if (value.trim() === "") {
    return value;
  }

  const parsed = parseNumber(value, Number.NaN);
  return Number.isFinite(parsed)
    ? formatInputCompact(Math.max(minimum, parsed))
    : value;
}

function EnergyInputs({
  settings,
  energyMode,
  dailyEnergy,
  startingEnergy,
  onEnergyModeChange,
  onSettingChange,
  onStartingEnergyChange,
}: {
  settings: SharedTrainingSettings;
  energyMode: EnergyMode;
  dailyEnergy: number;
  startingEnergy?: string;
  onEnergyModeChange: (mode: EnergyMode) => void;
  onSettingChange: <K extends keyof SharedTrainingSettings>(field: K, value: SharedTrainingSettings[K]) => void;
  onStartingEnergyChange?: (value: string) => void;
}) {
  return (
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
        <NumberField
          label="Daily energy"
          value={settings.dailyEnergy}
          onChange={(value) => onSettingChange("dailyEnergy", value)}
        />
      ) : (
        <div className="book-strategy-popout-grid">
          <NumberField
            label="Natural"
            value={settings.naturalEnergy}
            onChange={(value) => onSettingChange("naturalEnergy", value)}
          />
          <NumberField
            label="Xanax/day"
            value={settings.xanaxPerDay}
            onChange={(value) => onSettingChange("xanaxPerDay", value)}
          />
          <NumberField
            label="Daily refill"
            value={settings.dailyRefill}
            onChange={(value) => onSettingChange("dailyRefill", value)}
          />
          <NumberField
            label="Other"
            value={settings.otherDailyEnergy}
            onChange={(value) => onSettingChange("otherDailyEnergy", value)}
          />
        </div>
      )}
      {startingEnergy !== undefined && onStartingEnergyChange ? (
        <div className="book-strategy-popout-grid">
          <NumberField label="Starting energy" value={startingEnergy} onChange={onStartingEnergyChange} />
        </div>
      ) : null}
    </div>
  );
}

function PerkInputs({
  settings,
  onSettingChange,
}: {
  settings: SharedTrainingSettings;
  onSettingChange: <K extends keyof SharedTrainingSettings>(field: K, value: SharedTrainingSettings[K]) => void;
}) {
  return (
    <div className="book-strategy-popout" role="dialog" aria-label="Perks">
      <div className="book-strategy-popout-grid">
        <NumberField
          label="Property"
          suffix="%"
          value={settings.privateIslandPercent}
          onChange={(value) => onSettingChange("privateIslandPercent", value)}
        />
        <NumberField
          label="Education (General)"
          suffix="%"
          value={settings.generalEducationPercent}
          onChange={(value) => onSettingChange("generalEducationPercent", value)}
        />
        <NumberField
          label="Education (Stat Specific)"
          suffix="%"
          value={settings.statEducationPercent}
          onChange={(value) => onSettingChange("statEducationPercent", value)}
        />
        <NumberField
          label="Faction Steadfast"
          suffix="%"
          value={settings.steadfastPercent}
          onChange={(value) => onSettingChange("steadfastPercent", value)}
        />
        <NumberField
          label="Job Perks"
          suffix="%"
          value={settings.customPerksPercent}
          onChange={(value) => onSettingChange("customPerksPercent", value)}
        />
      </div>
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
  title,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <label className="book-strategy-field">
      <span className="book-strategy-field-label">
        {label}
        {title ? (
          <span
            className="book-strategy-field-help"
            tabIndex={0}
            aria-label={title}
          >
            ?
            <span className="book-strategy-field-tooltip" role="tooltip">
              {title}
            </span>
          </span>
        ) : null}
      </span>
      <div>
        <input
          type="text"
          inputMode="text"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </label>
  );
}
