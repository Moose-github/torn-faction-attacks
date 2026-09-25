import { getJson, postJson } from "./client";
import type { DiceGameResponse, DiceGameRollResponse, DiceGameSendXanaxResponse } from "./types";

export async function getDiceGame(): Promise<DiceGameResponse> {
  return getJson<DiceGameResponse>("/api/dice-game");
}

export async function rollDiceGame(
  betAmount: number,
  betNumber: number,
  hauntedOriginalNumber?: number,
): Promise<DiceGameRollResponse> {
  return postJson<DiceGameRollResponse>("/api/dice-game/roll", {
    bet_amount: betAmount,
    bet_number: betNumber,
    haunted_original_number: hauntedOriginalNumber,
  });
}

export async function sendXanaxToDiceGame(amount: number): Promise<DiceGameSendXanaxResponse> {
  return postJson<DiceGameSendXanaxResponse>("/api/dice-game/send-xanax", {
    amount,
  });
}
