import React from "react";
import type { SharedTrainingSettings } from "../views/BookStrategy.helpers";
export type TrainingPerkSettings = Pick<SharedTrainingSettings, "privateIslandPercent" | "generalEducationPercent" | "statEducationPercent" | "steadfastPercent" | "customPerksPercent">;

export function PerkInputs({
  settings,
  onSettingChange,
}: {
  settings: TrainingPerkSettings;
  onSettingChange: (field: keyof TrainingPerkSettings, value: string) => void;
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

export function PopoutButton({
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

export function NumberField({
  label,
  value,
  onChange,
  suffix,
  title,
  disabled = false,
  commitOnBlur = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  title?: string;
  disabled?: boolean;
  commitOnBlur?: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);

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
          value={commitOnBlur ? draft : value}
          disabled={disabled}
          onChange={(event) => {
            if (commitOnBlur) setDraft(event.target.value);
            else onChange(event.target.value);
          }}
          onBlur={() => { if (commitOnBlur && draft !== value) onChange(draft); }}
          onKeyDown={(event) => {
            if (commitOnBlur && event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </label>
  );
}
