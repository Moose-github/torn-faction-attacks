import React from "react";
import { CircleDollarSign, Dices, Trophy, Waves } from "lucide-react";
import {
  getDiceGame,
  rollDiceGame,
  sendXanaxToDiceGame,
} from "../api";
import type {
  DiceGameLeaderboardRow,
  DiceGameProfile,
} from "../api";
import { MetricCard, PanelHeader } from "../components/Common";
import { formatNumber, formatRelativeTime } from "../utils/format";

const DEFAULT_BET_AMOUNT = "1";
const DEFAULT_DEPOSIT_AMOUNT = "1";
const INITIAL_CONSOLE_LINES = [
  "[SYSTEM] Dice audit console attached.",
  "[SYSTEM] Fairness module: defective.",
  "[READY] Awaiting xanax.",
];

const PENALTY_MESSAGES = [
  "[PENALTY] Table maintenance fee: -{amount} xanax.",
  "[PENALTY] Dice handling charge: -{amount} xanax.",
  "[PENALTY] M00SE needs some Xanax, {amount} xanax removed.",
  "[PENALTY] House edge recalibration fee: -{amount} xanax.",
  "[PENALTY] You've been hit by a smooth criminal: -{amount} xanax.",
  "[PENALTY] Your balance has been grazed: -{amount} xanax.",
    "[PENALTY] Processing fee processed: -{amount} xanax.",
    "[PENALTY] Fun detected. Fun deducted: -{amount} xanax.",
];

const TAX_MESSAGES = [
  "[TAX] Your net worth has been optimized downward: -{amount} xanax ({percent}%).",
  "[TAX] Funds skimmed at random: -{amount} xanax ({percent}%).",
  "[TAX] Unreported optimism levy: -{amount} xanax ({percent}%).",
  "[TAX] Balance inspection adjustment: -{amount} xanax ({percent}%).",
  "[TAX] The moose economy thanks you. The moose economy is fake. -{amount} xanax ({percent}%).",
];

const TAX_TOO_POOR_MESSAGE = "[TAX] Balance below 100 xanax, too poor to tax.";

const PIP_LAYOUT: Record<number, string[]> = {
  1: ["center"],
  2: ["top-left", "bottom-right"],
  3: ["top-left", "center", "bottom-right"],
  4: ["top-left", "top-right", "bottom-left", "bottom-right"],
  5: ["top-left", "top-right", "center", "bottom-left", "bottom-right"],
  6: ["top-left", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-right"],
};

type ConsoleAction =
  | { kind: "type"; text: string }
  | { kind: "backspace"; count: number }
  | { kind: "pause"; ms: number }
  | { kind: "commit" };

type ConsoleScript = ConsoleAction[];
type DiceJokeVariant = "plain" | "backspace" | "penalty";

export function DiceGame() {
  const [profile, setProfile] = React.useState<DiceGameProfile | null>(null);
  const [leaderboard, setLeaderboard] = React.useState<DiceGameLeaderboardRow[]>([]);
  const [betAmount, setBetAmount] = React.useState(DEFAULT_BET_AMOUNT);
  const [depositAmount, setDepositAmount] = React.useState(DEFAULT_DEPOSIT_AMOUNT);
  const [betNumber, setBetNumber] = React.useState(6);
  const [verdict, setVerdict] = React.useState<string | null>(null);
  const [lastRollOutcome, setLastRollOutcome] = React.useState<"win" | "loss" | null>(null);
  const [dieFace, setDieFace] = React.useState(1);
  const [isDieRolling, setIsDieRolling] = React.useState(false);
  const [isDieCorrecting, setIsDieCorrecting] = React.useState(false);
  const [consoleLines, setConsoleLines] = React.useState<string[]>(INITIAL_CONSOLE_LINES);
  const [activeConsoleLine, setActiveConsoleLine] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRolling, setIsRolling] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const consoleQueueRef = React.useRef<ConsoleScript[]>([]);
  const consoleBusyRef = React.useRef(false);
  const activeConsoleLineRef = React.useRef("");
  const consoleTimersRef = React.useRef<number[]>([]);

  React.useEffect(() => {
    return () => {
      for (const timer of consoleTimersRef.current) {
        window.clearTimeout(timer);
      }
      consoleTimersRef.current = [];
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getDiceGame();
        if (!cancelled) {
          setProfile(response.profile);
          setLeaderboard(response.leaderboard);
          setVerdict(response.profile.last_verdict);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitRoll() {
    const amount = Number(betAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("Bet amount must be a whole number of xanax.");
      return;
    }

    setIsRolling(true);
    setError(null);

    try {
      const response = await rollDiceGame(amount, betNumber);
      const jokeVariant = diceJokeVariant(
        response.profile.rolls,
        response.result.is_win,
        response.result.loss_amount,
        amount,
      );
      setProfile(response.profile);
      setLeaderboard(response.leaderboard);
      setVerdict(response.result.verdict);
      setLastRollOutcome(response.result.is_win ? "win" : "loss");
      queueConsoleScripts(
        rollConsoleScripts(
          response.result.roll_faces,
          response.result.bet_number,
          amount,
          response.result.is_win,
          response.result.win_amount,
          response.result.loss_amount,
          response.result.verdict,
          jokeVariant,
          {
            doubleWinBlocked: response.result.double_win_blocked,
            pityChecked: response.result.pity_checked,
            pityWin: response.result.pity_win,
            pityRequiredLosses: response.result.pity_required_losses,
            pityStreakLosses: response.result.pity_streak_losses,
            pityPayout: response.result.pity_payout,
            taxTriggered: response.result.tax_triggered,
            taxTooPoor: response.result.tax_too_poor,
            taxPercent: response.result.tax_percent,
            taxAmount: response.result.tax_amount,
          },
        ),
      );
      await animateDie(response.result.roll_faces, jokeVariant === "backspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRolling(false);
    }
  }

  async function handleRoll(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitRoll();
  }

  async function handleSendXanax() {
    const amount = Math.trunc(Number(depositAmount) || 0);

    setIsSending(true);
    setError(null);

    try {
      const response = await sendXanaxToDiceGame(amount);
      setProfile(response.profile);
      setLeaderboard(response.leaderboard);
      setVerdict(response.result.message);
      queueConsoleLines([
        `[DEPOSIT] ${formatNumber(response.result.amount)} xanax added.`,
        "[BALANCE] Current balance updated.",
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
    }
  }

  async function handleDeposit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleSendXanax();
  }

  const balance = profile?.xanax_balance ?? 0;
  const totalGained = profile?.total_gained ?? 0;
  const totalLost = profile?.total_lost ?? 0;
  const rolls = profile?.rolls ?? 0;
  const diceButtonClassName = [
    "dice-button",
    lastRollOutcome === "loss" ? "loss" : "",
  ].filter(Boolean).join(" ");

  async function animateDie(faces: [number, number, number], showCorrection: boolean) {
    setIsDieCorrecting(false);
    setIsDieRolling(true);

    for (let index = 0; index < 12; index += 1) {
      setDieFace(1 + ((faces[0] + index) % 6));
      await wait(54);
    }

    setDieFace(showCorrection ? faces[1] : faces[2]);
    setIsDieRolling(false);

    if (showCorrection) {
      await wait(520);
      setIsDieCorrecting(true);
      await wait(210);
      setDieFace(faces[2]);
      await wait(320);
      setIsDieCorrecting(false);
    }
  }

  function queueConsoleLines(lines: string[]) {
    queueConsoleScripts(lines.map((line) => typedLineScript(line)));
  }

  function queueConsoleScripts(scripts: ConsoleScript[]) {
    consoleQueueRef.current.push(...scripts);
    void runConsoleQueue();
  }

  async function runConsoleQueue() {
    if (consoleBusyRef.current) {
      return;
    }

    consoleBusyRef.current = true;

    while (consoleQueueRef.current.length > 0) {
      const script = consoleQueueRef.current.shift();
      if (!script) {
        continue;
      }

      activeConsoleLineRef.current = "";
      setActiveConsoleLine("");

      for (const action of script) {
        if (action.kind === "type") {
          await typeConsoleText(action.text);
        } else if (action.kind === "backspace") {
          await backspaceConsoleText(action.count);
        } else if (action.kind === "pause") {
          await wait(action.ms);
        } else {
          commitActiveConsoleLine();
        }
      }
    }

    consoleBusyRef.current = false;
  }

  async function typeConsoleText(text: string) {
    for (const character of text) {
      activeConsoleLineRef.current += character;
      setActiveConsoleLine(activeConsoleLineRef.current);
      await wait(character === " " ? 12 : 18);
    }
  }

  async function backspaceConsoleText(count: number) {
    for (let index = 0; index < count; index += 1) {
      activeConsoleLineRef.current = activeConsoleLineRef.current.slice(0, -1);
      setActiveConsoleLine(activeConsoleLineRef.current);
      await wait(45);
    }
  }

  function commitActiveConsoleLine() {
    const line = activeConsoleLineRef.current;
    if (!line) {
      return;
    }
    setConsoleLines((current) => [...current, line].slice(-18));
    activeConsoleLineRef.current = "";
    setActiveConsoleLine("");
  }

  function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        consoleTimersRef.current = consoleTimersRef.current.filter((item) => item !== timer);
        resolve();
      }, milliseconds);
      consoleTimersRef.current.push(timer);
    });
  }

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Definitely not gambling</p>
          <h2>Dice Game</h2>
          <p>Every roll is fair, every outcome is legit, and every refund request is immediately denied without appeal.</p>
        </div>
      </section>

      <section className="status-grid dice-status-grid">
        <MetricCard
          label="Xanax balance"
          value={formatNumber(balance)}
          detail={balance < 0 ? "The table accepts debt" : "For now"}
          icon={<CircleDollarSign size={18} />}
        />
        <MetricCard
          label="Xanax gained"
          value={formatNumber(totalGained)}
          detail="Dice wins only"
          icon={<Waves size={18} />}
        />
        <MetricCard
          label="Xanax lost"
          value={formatNumber(totalLost)}
          detail={profile?.last_loss_amount ? `Last loss ${formatNumber(profile.last_loss_amount)}` : `${formatNumber(rolls)} rolls`}
          icon={<Dices size={18} />}
        />
      </section>

      <section className="panel table-panel dice-leaderboard-panel">
        <PanelHeader
          icon={<Trophy size={18} />}
          title="Xanax leaderboard"
          aside={isLoading ? "Loading" : `${leaderboard.length} players`}
        />
        <DiceLeaderboard rows={leaderboard} />
      </section>

      <section className="dice-play-layout">
        <section className="panel dice-controls-panel">
          <section className="dice-control-section">
            <h3>Bet</h3>
            <form className="dice-form" onSubmit={handleRoll}>
              <label className="dice-bet-label">
                <span>Xanax amount</span>
                <input
                  type="number"
                  step="1"
                  inputMode="numeric"
                  value={betAmount}
                  onChange={(event) => setBetAmount(event.target.value)}
                />
              </label>

              <fieldset className="dice-number-field">
                <legend>Bet on</legend>
                <div className="dice-number-grid">
                  {[1, 2, 3, 4, 5, 6].map((number) => (
                    <button
                      key={number}
                      type="button"
                      className={number === betNumber ? "dice-number-button active" : "dice-number-button"}
                      aria-pressed={number === betNumber}
                      onClick={() => setBetNumber(number)}
                    >
                      {number}
                    </button>
                  ))}
                </div>
              </fieldset>
            </form>
          </section>

          <section className="dice-control-section">
            <div className="dice-section-heading">
              <h3>Deposit</h3>
              <span>Deposits work on the honor system</span>
            </div>
            <form className="dice-form" onSubmit={handleDeposit}>
              <label className="dice-bet-label">
                <span>Xanax amount</span>
                <input
                  type="number"
                  step="1"
                  inputMode="numeric"
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                />
              </label>

              <button
                type="submit"
                className="icon-text-button dice-send-button"
                disabled={isLoading || isSending}
              >
                <CircleDollarSign size={16} />
                {isSending ? "Adding xanax" : "Add xanax"}
              </button>
            </form>
          </section>
        </section>

        <section className="panel dice-game-panel">
          <button type="button" className={diceButtonClassName} disabled={isLoading || isRolling} onClick={() => void submitRoll()}>
            <AnimatedDie face={dieFace} rolling={isDieRolling} correcting={isDieCorrecting} />
            <span>{isRolling ? "Rolling" : "Roll"}</span>
          </button>

          <div className="dice-verdict-panel">
            <span>Latest verdict</span>
            <strong>{verdict ?? "Roll again never."}</strong>
          </div>
        </section>
      </section>

      <section className="panel dice-console-panel">
        <PanelHeader title="Roll console" />
        <div className="dice-console" aria-label="Dice roll console">
          {consoleLines.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
          {activeConsoleLine ? (
            <p className="dice-console-active">
              {activeConsoleLine}
              <span />
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}

function AnimatedDie({
  face,
  rolling,
  correcting,
}: {
  face: number;
  rolling: boolean;
  correcting: boolean;
}) {
  const className = [
    "animated-die",
    rolling ? "rolling" : "",
    correcting ? "correcting" : "",
  ].filter(Boolean).join(" ");

  return (
    <span className={className} aria-label={`Rolled ${face}`}>
      {(PIP_LAYOUT[face] ?? PIP_LAYOUT[1]).map((position) => (
        <span key={position} className={`die-pip ${position}`} />
      ))}
    </span>
  );
}

function typedLineScript(line: string): ConsoleScript {
  return [
    { kind: "type", text: line },
    { kind: "commit" },
  ];
}

function rollConsoleScripts(
  faces: [number, number, number],
  betNumber: number,
  betAmount: number,
  isWin: boolean,
  winAmount: number,
  lossAmount: number,
  verdict: string,
  jokeVariant: DiceJokeVariant,
  rollMeta: {
    doubleWinBlocked: boolean;
    pityChecked: boolean;
    pityWin: boolean;
    pityRequiredLosses: number;
    pityStreakLosses: number;
    pityPayout: number;
    taxTriggered: boolean;
    taxTooPoor: boolean;
    taxPercent: number;
    taxAmount: number;
  },
): ConsoleScript[] {
  const penaltyAmount = Math.max(0, lossAmount - betAmount);
  const nearWinSuffix = `${faces[1]} - WIN`;
  const scripts: ConsoleScript[] = [
    typedLineScript(`[BET] ${formatNumber(betAmount)} xanax on ${betNumber}. Brave. Misguided.`),
  ];

  if (rollMeta.doubleWinBlocked) {
    scripts.push(typedLineScript("[debug:streak] previous-win=true raw-win=true action=deny-reroll"));
  }

  if (rollMeta.pityChecked) {
    scripts.push(
      typedLineScript(
        `[debug:pity] trigger-losses=${formatNumber(rollMeta.pityRequiredLosses)} loss-total=${formatNumber(rollMeta.pityStreakLosses)} payout=${formatNumber(rollMeta.pityPayout)} ${rollMeta.pityWin ? "allow" : "deny"}`,
      ),
    );
  }

  if (isWin) {
    scripts.push(typedLineScript(`[ROLL] Roll - ${faces[2]} - WIN`));
    scripts.push(typedLineScript(`[PAYOUT] Extremely suspicious payout: ${formatNumber(winAmount)} xanax.`));
  } else if (jokeVariant === "backspace") {
    scripts.push([
      { kind: "type", text: `[ROLL] Roll - ${nearWinSuffix}` },
      { kind: "pause", ms: 520 },
      { kind: "backspace", count: nearWinSuffix.length },
      { kind: "type", text: `${faces[2]} - LOSS` },
      { kind: "commit" },
    ]);
  } else {
    scripts.push(typedLineScript(`[ROLL] Roll - ${faces[2]} - LOSS`));
  }

  if (jokeVariant === "penalty") {
    scripts.push(typedLineScript(penaltyMessage(penaltyAmount, betAmount, lossAmount)));
  }

  if (rollMeta.taxTriggered) {
    scripts.push(
      typedLineScript(
        rollMeta.taxTooPoor
          ? TAX_TOO_POOR_MESSAGE
          : taxMessage(rollMeta.taxAmount, rollMeta.taxPercent, betAmount, lossAmount),
      ),
    );
  }

  scripts.push(typedLineScript(`[RESULT] ${verdict}`));
  return scripts;
}

function penaltyMessage(penaltyAmount: number, betAmount: number, lossAmount: number): string {
  const index = Math.abs((betAmount + lossAmount) % PENALTY_MESSAGES.length);
  return PENALTY_MESSAGES[index].replace("{amount}", formatNumber(penaltyAmount));
}

function taxMessage(taxAmount: number, taxPercent: number, betAmount: number, lossAmount: number): string {
  const index = Math.abs((betAmount + lossAmount + taxAmount + taxPercent) % TAX_MESSAGES.length);
  return TAX_MESSAGES[index]
    .replace("{amount}", formatNumber(taxAmount))
    .replace("{percent}", formatNumber(taxPercent));
}

function diceJokeVariant(
  rollNumber: number,
  isWin: boolean,
  lossAmount: number,
  betAmount: number,
): DiceJokeVariant {
  if (isWin) {
    return "plain";
  }

  if (lossAmount > betAmount) {
    return "penalty";
  }

  if (rollNumber % 10 === 0) {
    return "backspace";
  }

  return "plain";
}

function DiceLeaderboard({ rows }: { rows: DiceGameLeaderboardRow[] }) {
  if (rows.length === 0) {
    return <div className="empty-state">No sacrifices recorded</div>;
  }

  return (
    <div className="table-scroll">
      <table className="dice-leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Member</th>
            <th>Gained</th>
            <th>Lost</th>
            <th>Net</th>
            <th>Rolls</th>
            <th>Largest</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.torn_user_id}>
              <td>#{row.rank}</td>
              <td>
                <a
                  className="member-link"
                  href={`https://www.torn.com/profiles.php?XID=${row.torn_user_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {row.member_name ?? row.torn_user_id}
                </a>
              </td>
              <td>{formatNumber(row.total_gained)}</td>
              <td>{formatNumber(row.total_lost)}</td>
              <td>{formatNumber(row.total_gained - row.total_lost)}</td>
              <td>{formatNumber(row.rolls)}</td>
              <td>{formatNumber(row.largest_loss)}</td>
              <td>{formatRelativeTime(row.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
