import { describe, expect, it } from "vitest";
import { discordApplicationCommands } from "../src/discordCommands";
import { commands } from "./register-discord-commands.mjs";

describe("Discord command registration", () => {
  it("uses the same payload as the Worker command manifest", () => {
    expect(commands).toEqual(discordApplicationCommands());
  });
});
