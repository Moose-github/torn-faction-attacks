"""Standalone, escaped HTML report: usable without a running application."""
import html


def esc(value):
    return html.escape(str(value))


def money(value):
    return f'${value/1e6:,.2f}m'


def effect_cards(model):
    cards = ''
    if not model['available']:
        cards = '<div class="box"><h2>Adjusted analysis is not ready</h2><p>'+esc(model['reason'])+'</p></div>'
    else:
        for effect in model['effects']:
            if not effect['available']:
                cards += f'<section class="box"><h2>{esc(effect["label"])}</h2><p>{esc(effect["reason"])}</p></section>'
                continue
            lo, hi = effect['range']
            interval = effect['interval_m']
            ci = 'Not estimable' if interval is None else f'${interval[0]:+,.2f}m to ${interval[1]:+,.2f}m'
            bars = ''
            bins = effect['bins']
            scale = max([abs(b['adjusted_value_m']) for b in bins]+[1])
            for b in bins:
                width = max(1, abs(b['adjusted_value_m'])/scale*100)
                bars += f'<tr><td>{b["low"]:,.2f}–{b["high"]:,.2f}</td><td>{b["n"]}</td><td><span class="bar" style="width:{width:.1f}%"></span>${b["adjusted_value_m"]:,.2f}m</td></tr>'
            cards += f'''<section class="box"><div class="tag">{esc(effect['status'])}</div><h2>{esc(effect['label'])}</h2>
              <p>Comparing {lo:,.2f} with {hi:,.2f} (the middle half of this sample)</p>
              <div class="effect">${effect['effect_m']:+,.2f}m</div><p>Estimated adjusted difference · approximate 95% interval: {ci}</p>
              <p>{esc(' '.join(effect['cautions']))}</p><details><summary>Explore the shape</summary>
              <p>Partial-residual averages after adjustment. These bins are exploratory, can be negative, and do not establish a plateau or an achievable intervention.</p>
              <table><tr><th>Factor range</th><th>Observations</th><th>Adjusted value</th></tr>{bars}</table></details></section>'''
    return cards


def render(result):
    model = result['model']
    cards = effect_cards(model)
    whole = result.get('whole_war')
    whole_section = ''
    if whole is not None:
        whole_summaries = ''.join(f'<tr><td>Platinum {s["winner_division"]}</td><td>Platinum {s["loser_division"]}</td><td>{s["n"]}</td><td>{money(s["median_value"])}</td><td>{money(s["mean_value"])}</td></tr>' for s in whole['summaries'])
        pot = whole['median_value']
        value_summary = ('No fully priced wars yet.' if pot is None else f'Median combined pot: {money(pot)}. Mean combined pot: {money(whole["mean_value"])}.')
        whole_section = f'''<section class="box"><h2>Whole-war rewards: both factions combined</h2>
          <p>{whole['eligible_wars']} eligible wars · {whole['valued_wars']} fully priced wars · {whole['model_observations']} wars usable for adjusted analysis. Each war is counted once.</p>
          <p>{value_summary} This is a historical sample summary, not a future payout forecast. No expenses are deducted.</p></section>
          <div class="grid">{effect_cards(whole['model'])}</div>
          <section class="box"><h2>Observed combined rewards</h2><table><tr><th>Winner starting division</th><th>Loser starting division</th><th>Wars</th><th>Median pot</th><th>Mean pot</th></tr>{whole_summaries}</table>
          <p>{esc(whole['model'].get('method', 'Adjusted whole-war estimates are withheld until data requirements are met.'))}</p></section>'''
    summaries = ''.join(f'<tr><td>Platinum {s["division"]}</td><td>{"Win" if s["won"] else "Loss"}</td><td>{s["n"]}</td><td>{money(s["median_value"])}</td><td>{money(s["mean_value"])}</td></tr>' for s in result['summaries'])
    audit = ''.join(f'<tr><td>{a["war_id"]}</td><td>{esc(a["reason"] or "eligible")}</td><td>{esc(" ".join(a["warnings"]))}</td></tr>' for a in result['audit'])
    prices = ''.join(f'<tr><td>{esc(name)}</td><td>{"Not set" if value is None else money(value)}</td></tr>' for name, value in result['prices'].items())
    warnings = ''.join('<li>'+esc(w)+'</li>' for w in result['warnings'])
    count_rows = ''.join(f'<tr><td>{esc(k.replace("_", " "))}</td><td>{v}</td></tr>' for k, v in result['counts'].items())
    method = esc(model.get('method', 'Adjusted estimates are withheld until data requirements are met.'))
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Platinum War Lab · Factor report</title>
      <style>body{{margin:0;background:#f3f5f3;color:#182824;font:15px/1.6 system-ui,sans-serif}}main{{max-width:1100px;margin:50px auto;padding:0 24px}}h1{{font-size:40px;line-height:1.1}}h2{{font-size:21px}}.eyebrow,.tag{{text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#286a57}}.box{{background:white;border:1px solid #d7e1da;border-radius:14px;padding:24px;margin:18px 0}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}}.grid .box{{margin:0}}.effect{{font-size:32px;font-weight:700}}table{{width:100%;border-collapse:collapse;margin:16px 0}}th,td{{text-align:left;border-bottom:1px solid #e1e7e2;padding:9px;vertical-align:top}}th{{font-size:12px;color:#63746b}}.bar{{display:block;height:5px;background:#62ad90;max-width:100%}}a{{color:#16634e}}summary{{cursor:pointer}}.muted{{color:#63746b}}@media print{{.box{{break-inside:avoid}}main{{margin:0}}}}</style></head><body><main>
      <div class="eyebrow">Platinum War Lab / Evidence report</div><h1>What is associated with<br>greater war rewards?</h1>
      <p>{esc(result['range']['start'])} to {esc(result['range']['end'])} · Generated {esc(result['generated_at'])}</p>
      <p>{esc(result['scope'])}</p><div class="box"><b>{result['eligible_wars']} eligible wars</b> · {result['observations']} faction observations · {result['distinct_factions']} factions · {result['model_observations']} observations usable for adjusted analysis</div>
      {whole_section}<h2>Individual faction rewards</h2><div class="grid">{cards}</div><section class="box"><h2>Observed faction rewards</h2><p>Descriptive comparisons; these do not isolate the effect of any one factor.</p>
      <table><tr><th>Starting division</th><th>Outcome</th><th>Observations</th><th>Median gross value</th><th>Mean gross value</th></tr>{summaries}</table></section>
      <section class="box"><h2>Interpretation and method</h2><p>{method}</p><ul>{warnings}</ul>
      <p>All values use the same price table. They represent the estimated sale value of awarded caches, not historic sale proceeds or the value of opening caches. Respect is retained in raw reports but is not assigned a cash value.</p>
      <p>September 2026 is the conservative default start window after the August ranking update. Broader collection is possible, but adjusted analysis will not pool that transition.</p></section>
      <section class="box"><h2>Price assumptions</h2><table><tr><th>Item</th><th>Value per cache</th></tr>{prices}</table></section>
      <section class="box"><h2>Collection audit</h2><table><tr><th>Classification</th><th>Wars</th></tr>{count_rows}</table>
      <details><summary>Inspect each report</summary><table><tr><th>War</th><th>Classification</th><th>Checks</th></tr>{audit}</table></details></section>
      <p class="muted">Sources: <a href="https://www.torn.com/swagger.php#/Faction/getRankedWarReport">Torn API documentation</a> · <a href="https://wiki.torn.com/wiki/Ranked_War#Rewards">Ranked war mechanics</a></p>
      </main></body></html>'''
