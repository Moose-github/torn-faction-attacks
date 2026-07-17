import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const commands = await loadDiscordApplicationCommands();

export async function registerDiscordCommands({
  argv = process.argv,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const token = requiredEnv(env, "DISCORD_BOT_TOKEN");
  const applicationId = requiredEnv(env, "DISCORD_APPLICATION_ID");
  const guildMode = argv.includes("--guild");
  const guildId = guildMode ? requiredEnv(env, "DISCORD_GUILD_ID") : null;
  const route = guildId
    ? `/applications/${applicationId}/guilds/${guildId}/commands`
    : `/applications/${applicationId}/commands`;

  const response = await fetchImpl(`https://discord.com/api/v10${route}`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Discord command registration failed with HTTP ${response.status}: ${bodyText}`);
  }

  return {
    commandCount: commands.length,
    guildId,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await registerDiscordCommands();
  console.log(`Registered ${result.commandCount} Discord commands ${result.guildId ? `for guild ${result.guildId}` : "globally"}.`);
}

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function loadDiscordApplicationCommands() {
  const alertsModuleUrl = await transpileTypeScriptModule(new URL("../src/discordAlerts.ts", import.meta.url));
  const commandsSourceUrl = new URL("../src/discordCommands.ts", import.meta.url);
  const commandsSource = await readFile(commandsSourceUrl, "utf8");
  const source = commandsSource.replace(
    /from\s+["']\.\/discordAlerts["']/g,
    `from "${alertsModuleUrl}"`,
  );
  const moduleUrl = transpiledJavaScriptModuleUrl(source, fileURLToPath(commandsSourceUrl));
  const module = await import(moduleUrl);
  return module.discordApplicationCommands();
}

async function transpileTypeScriptModule(sourceUrl) {
  const source = await readFile(sourceUrl, "utf8");
  return transpiledJavaScriptModuleUrl(source, fileURLToPath(sourceUrl));
}

function transpiledJavaScriptModuleUrl(source, fileName) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
    fileName,
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}
