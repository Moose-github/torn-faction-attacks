import { describe, expect, it } from "vitest";
import { discordApplicationCommands } from "../src/discordCommands";
import { commands } from "./register-discord-commands.mjs";

describe("Discord command registration", () => {
  it("uses the same payload as the Worker command manifest", () => {
    expect(commands).toEqual(discordApplicationCommands());
  });

  it("includes the default alert route in every alert channel choice list", () => {
    const alertChannelsCommand = discordApplicationCommands()
      .find((command) => command.name === "alert-channels");

    for (const subcommandName of ["set", "unset", "test"]) {
      const subcommand = alertChannelsCommand?.options
        ?.find((option) => option.name === subcommandName);
      const alertOption = subcommand?.options
        ?.find((option) => option.name === "alert");

      expect(alertOption?.choices).toEqual(expect.arrayContaining([
        { name: "Default", value: "default" },
      ]));
    }
  });
});
