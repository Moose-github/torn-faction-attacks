import React from "react";
import { WarSummary, WarType } from "../api";
import { EmptyState, PanelHeader } from "./Common";
import { formatDate } from "../utils/format";
import { displayWarStatus } from "../utils/members";

export function Sidebar({
  warType,
  onWarTypeChange,
  view,
  onViewChange,
  wars,
  selectedWarName,
  isLoadingWars,
  warRoomIcon,
  memberIcon,
  lifestyleIcon,
  adminIcon,
  onWarSelect,
}: {
  warType: WarType;
  onWarTypeChange: (value: WarType) => void;
  view: "war" | "warRoom" | "members" | "lifestyle" | "admin";
  onViewChange: (view: "war" | "warRoom" | "members" | "lifestyle" | "admin") => void;
  wars: WarSummary[];
  selectedWarName: string | null;
  isLoadingWars: boolean;
  warRoomIcon: React.ReactNode;
  memberIcon: React.ReactNode;
  lifestyleIcon: React.ReactNode;
  adminIcon: React.ReactNode;
  onWarSelect: (name: string) => void;
}) {
  return (
    <aside className="sidebar panel">
      <PanelHeader
        title="Recorded wars"
        aside={isLoadingWars ? "Loading" : `${wars.length}`}
        control={<WarTypeSelect value={warType} onChange={onWarTypeChange} />}
      />
      <SidebarLink
        active={view === "warRoom"}
        icon={warRoomIcon}
        label="War room"
        onClick={() => onViewChange("warRoom")}
      />
      <SidebarLink
        active={view === "members"}
        icon={memberIcon}
        label="Member performance"
        onClick={() => onViewChange("members")}
      />
      <SidebarLink
        active={view === "lifestyle"}
        icon={lifestyleIcon}
        label="Daily Averages"
        onClick={() => onViewChange("lifestyle")}
      />
      <SidebarLink
        active={view === "admin"}
        icon={adminIcon}
        label="Admin controls"
        onClick={() => onViewChange("admin")}
      />
      <WarNav
        view={view}
        wars={wars}
        selectedWarName={selectedWarName}
        onSelect={onWarSelect}
      />
    </aside>
  );
}

function WarTypeSelect({
  value,
  onChange,
}: {
  value: WarType;
  onChange: (value: WarType) => void;
}) {
  return (
    <select
      className="war-type-select"
      value={value}
      aria-label="Filter recorded wars"
      onChange={(event) => onChange(event.target.value as WarType)}
    >
      <option value="all">All</option>
      <option value="real">Real</option>
      <option value="termed">Termed</option>
      <option value="event">Event</option>
    </select>
  );
}

function SidebarLink({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "sidebar-link active" : "sidebar-link"} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function WarNav({
  view,
  wars,
  selectedWarName,
  onSelect,
}: {
  view: "war" | "warRoom" | "members" | "lifestyle" | "admin";
  wars: WarSummary[];
  selectedWarName: string | null;
  onSelect: (name: string) => void;
}) {
  if (wars.length === 0) {
    return <EmptyState text="No wars recorded" />;
  }

  return (
    <nav className="war-nav">
      {wars.map((war) => (
        <WarNavButton
          key={war.id}
          war={war}
          selected={view === "war" && war.name === selectedWarName}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function WarNavButton({
  war,
  selected,
  onSelect,
}: {
  war: WarSummary;
  selected: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      type="button"
      className={selected ? "selected" : ""}
      onClick={() => onSelect(war.name)}
    >
      <span className="war-nav-main">
        <strong>{war.name}</strong>
        <small>
          {displayWarStatus(war)} - {formatDate(war.practical_start_time)}
        </small>
      </span>
      <span className="war-nav-type">{war.war_type ?? "real"}</span>
    </button>
  );
}

