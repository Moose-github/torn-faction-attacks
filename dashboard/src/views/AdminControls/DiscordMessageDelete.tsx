import React from "react";
import { Trash2 } from "lucide-react";
import type { DiscordMessagePreview } from "../../../../shared/discordMessageAdmin";
import { deleteDiscordBotMessage, previewDiscordBotMessage } from "../../api/admin";
import { PanelHeader } from "../../components/Common";
import "./DiscordMessageDelete.css";

export function DiscordMessageDelete() {
  const [link, setLink] = React.useState("");
  const [preview, setPreview] = React.useState<DiscordMessagePreview | null>(null);
  const [confirmationLink, setConfirmationLink] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "delete" | null>(null);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const inFlight = React.useRef(false);

  async function run(action: "preview" | "delete") {
    if (inFlight.current || (action === "delete" && !confirmationLink)) return;
    inFlight.current = true;
    setBusy(action); setError(""); setNotice("");
    try {
      if (action === "preview") {
        setPreview(null); setConfirmationLink(null);
        const result = await previewDiscordBotMessage(link.trim());
        setPreview(result); setConfirmationLink(result.message_link);
      } else {
        const result = await deleteDiscordBotMessage(confirmationLink!);
        setPreview(null); setConfirmationLink(null); setLink("");
        setNotice(result.already_deleted ? "The message was already deleted." : "Message deleted from Discord.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete the request.");
    } finally {
      inFlight.current = false; setBusy(null);
    }
  }

  return <section className="panel discord-message-delete" aria-label="Delete bot message">
    <PanelHeader title="Delete bot message" icon={<Trash2 size={19} />} />
    <p>In Discord, choose Copy Message Link on a message sent by this bot, then paste it below. Preview is optional.</p>
    <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void run("preview"); }}>
      <label htmlFor="discord-message-link">Message link</label>
      <input id="discord-message-link" type="url" required value={link} disabled={busy !== null}
        placeholder="https://discord.com/channels/…/…/…" autoComplete="off"
        onChange={(event) => { setLink(event.target.value); setPreview(null); setConfirmationLink(null); setError(""); setNotice(""); }} />
      <button type="submit" className="admin-button" disabled={busy !== null || !link.trim()}>{busy === "preview" ? "Loading preview…" : "Preview message"}</button>
      {!confirmationLink ? <button type="button" className="admin-button" disabled={busy !== null || !link.trim()}
        onClick={() => { setPreview(null); setConfirmationLink(link.trim()); setError(""); setNotice(""); }}>Delete without preview…</button> : null}
    </form>
    {error ? <p className="discord-message-error" role="alert">{error}</p> : null}
    {notice ? <p className="discord-message-success" role="status">{notice}</p> : null}
    {confirmationLink ? <div className="discord-message-confirm">
      {preview ? <><div className="discord-message-meta"><strong>{preview.author_name} · #{preview.channel_name}</strong>
        {preview.timestamp ? <span>{new Date(preview.timestamp).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</span> : null}
        <a href={preview.message_link} target="_blank" rel="noreferrer">Open in Discord</a></div>
      <div className="discord-message-body">
        {preview.content ? <p>{preview.content}</p> : null}
        {preview.embeds.map((embed, index) => <div className="discord-message-embed" key={index}>
          {embed.title ? <strong>{embed.title}</strong> : null}
          {embed.description ? <p>{embed.description}</p> : null}
          {embed.fields.map((field, fieldIndex) => <p key={fieldIndex}><strong>{field.name}</strong><br />{field.value}</p>)}
          {embed.footer ? <small>{embed.footer}</small> : null}
        </div>)}
        {preview.attachments.length ? <p>Attachments: {preview.attachments.join(", ")}</p> : null}
        {!preview.content && !preview.embeds.length && !preview.attachments.length ? <p>This message has no text or attachments to preview.</p> : null}
      </div></> : <div className="discord-message-meta">
        <strong>Delete this message without a preview?</strong>
        <span>{confirmationLink}</span>
        <p>Check the message link before confirming. Only messages sent by this bot can be deleted.</p>
      </div>}
      <p>This permanently deletes the message from Discord.</p>
      <button type="button" className="admin-button discord-message-delete-button" disabled={busy !== null} onClick={() => void run("delete")}>
        <Trash2 size={15} />{busy === "delete" ? "Deleting…" : "Delete message"}
      </button>
      <button type="button" className="admin-button" disabled={busy !== null}
        onClick={() => { setPreview(null); setConfirmationLink(null); setError(""); }}>Cancel</button>
    </div> : null}
  </section>;
}
