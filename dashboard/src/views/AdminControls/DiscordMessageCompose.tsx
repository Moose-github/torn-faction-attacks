import React from "react";
import { Send } from "lucide-react";
import { DISCORD_CUSTOM_MESSAGE_MAX_LENGTH, type DiscordMessageSendResult } from "../../../../shared/discordMessageAdmin";
import type { DiscordRouteDestinationsResponse } from "../../../../shared/discordRouteAdmin";
import { getAdminDiscordRouteDestinations, sendAdminDiscordMessage } from "../../api/admin";
import { PanelHeader } from "../../components/Common";
import "./DiscordMessageCompose.css";

export function DiscordMessageCompose({ disabled = false }: { disabled?: boolean }) {
  const [channelId, setChannelId] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [channels, setChannels] = React.useState<DiscordRouteDestinationsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [sendError, setSendError] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState<DiscordMessageSendResult | null>(null);
  const [reload, setReload] = React.useState(0);
  const inFlight = React.useRef(false);
  const formId = React.useId();

  React.useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(""); setChannels(null);
    getAdminDiscordRouteDestinations().then(result => {
      if (!active) return;
      setChannels(result);
      setChannelId(current => result.destinations.some(channel => channel.id === current) ? current : "");
    }).catch(error => {
      if (active) setLoadError(error instanceof Error ? error.message : "Unable to load channels.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const destinations = channels?.destinations ?? [];
  const canSend = !disabled && !sending && !loading && !!message.trim() &&
    message.length <= DISCORD_CUSTOM_MESSAGE_MAX_LENGTH && destinations.some(channel => channel.id === channelId);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!canSend || inFlight.current) return;
    inFlight.current = true; setSending(true); setSendError(""); setSent(null);
    try {
      const result = await sendAdminDiscordMessage(channelId, message.trim());
      setSent(result); setMessage("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Unable to send the message.");
    } finally {
      inFlight.current = false; setSending(false);
    }
  }

  return <section className="panel discord-message-compose" aria-label="Send Discord message">
    <PanelHeader title="Send Discord message" icon={<Send size={19} />} />
    <p>Write a custom message and choose where the bot should send it.</p>
    <form className="admin-form" onSubmit={send}>
      <div className="discord-message-destination">
        <label htmlFor={`${formId}-channel`}>
          <span>Channel</span>
          <select id={`${formId}-channel`} required value={channelId} disabled={disabled || sending || loading}
            onChange={event => { setChannelId(event.target.value); setSendError(""); setSent(null); }}>
            <option value="">{loading ? "Loading channels…" : "Choose a channel"}</option>
            {destinations.map(channel => <option key={channel.id} value={channel.id}>
              {channel.kind === "thread" ? `${channel.name}${channel.parent_name ? ` — #${channel.parent_name}` : " (thread)"}` : `#${channel.name}`}
            </option>)}
          </select>
        </label>
        <button type="button" className="admin-button" disabled={disabled || sending || loading}
          onClick={() => setReload(value => value + 1)}>Refresh channels</button>
      </div>
      {loadError ? <p className="discord-compose-error" role="alert">{loadError}</p> : null}
      {channels?.threads_error ? <small>{channels.threads_error}</small> : null}
      {channels && destinations.length === 0 ? <p>No channels are available. Check the bot's access and refresh the list.</p> : null}
      <label htmlFor={`${formId}-message`}>
        <span>Message</span>
        <textarea id={`${formId}-message`} rows={5} required maxLength={DISCORD_CUSTOM_MESSAGE_MAX_LENGTH}
          aria-describedby={`${formId}-count`} value={message} disabled={disabled || sending}
          placeholder="Write your message…"
          onChange={event => { setMessage(event.target.value); setSendError(""); setSent(null); }} />
      </label>
      <small id={`${formId}-count`} className="discord-compose-count">{message.length.toLocaleString("en-GB")} / {DISCORD_CUSTOM_MESSAGE_MAX_LENGTH.toLocaleString("en-GB")} characters</small>
      <button type="submit" className="admin-button primary discord-compose-send" disabled={!canSend}>
        <Send size={16} />{sending ? "Sending…" : "Send to Discord"}
      </button>
    </form>
    {sendError ? <p className="discord-compose-error" role="alert">{sendError}</p> : null}
    {sent ? <p className="discord-compose-success" role="status">Message sent. <a href={sent.message_link} target="_blank" rel="noreferrer">View in Discord</a></p> : null}
  </section>;
}
