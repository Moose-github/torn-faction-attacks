"""Standalone SVG figures for the offline report; no remote scripts or images."""
from html import escape
from io import StringIO


def graphs_html(data, cards, whole=False):
    if data is None:
        return ''
    if not data['observations']:
        return '<section class="box"><h2>Reward graphs</h2><p>No fully priced observations pass the member-total checks.</p></section>'
    try:
        import matplotlib
        matplotlib.use('Agg')
        from matplotlib import pyplot as plt
    except ImportError:
        return '<section class="box"><h2>Reward graphs</h2><p>Install research/requirements.txt and rerun to render offline graphs. Chart data is still included in the dashboard upload.</p></section>'

    def svg(fig, title):
        stream = StringIO()
        fig.tight_layout()
        fig.savefig(stream, format='svg', bbox_inches='tight')
        plt.close(fig)
        text = stream.getvalue()
        text = text[text.index('<svg'):].replace('<svg ', f'<svg role="img" aria-label="{escape(title, quote=True)}" ', 1)
        return '<div style="overflow-x:auto">'+text+'</div>'

    with plt.rc_context({'svg.fonttype': 'none', 'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False}):
        sample = data['points']
        reward = 'combined pot' if whole else 'individual faction reward'
        content = f'<section class="box"><h2>Reward graphs</h2><p>Gross {reward}: {data["observations"]} priced, audited observations from {data["wars"]} wars. Descriptive plots do not isolate causal effects.</p>'
        content += f'<p>Scatter plots show {len(sample)} of {data["observations"]} observations. Above 1,000 observations, dots are a repeatable sample and may omit extremes. Axis ranges and grouped medians use the full sample. Orange squares are grouped medians, not a fitted trend.</p>'
        for index, f in enumerate(data['factors']):
            fig, ax = plt.subplots(figsize=(9, 4.5))
            ax.scatter([p['values'][index] for p in sample], [p['value']/1e6 for p in sample], s=13, alpha=.35, color='#2563eb', label='Observed sample')
            ax.scatter([m['x'] for m in f['medians']], [m['y']/1e6 for m in f['medians']], s=50, marker='s', color='#d97706', label='Full-sample grouped medians')
            lo, hi = f['range']
            ax.set_xlim(lo-.02*(hi-lo or 1), hi+.02*(hi-lo or 1))
            ax.set_ylim(0, (data['value_range'][1]/1e6 or 1)*1.05)
            ax.set_xlabel(f"{f['label']} ({f['unit']})"); ax.set_ylabel('Gross reward ($m)')
            ax.grid(alpha=.15); ax.legend(fontsize=8)
            title = f"{f['label']} versus gross rewards"
            content += f'<details><summary>{escape(title)}</summary>{svg(fig, title)}</details>'
        fig, ax = plt.subplots(figsize=(10, max(3, 1.5+.38*len(data['distributions']))))
        stats = []
        for d in data['distributions']:
            lo, q1, med, q3, hi = [v/1e6 for v in d['five_number']]
            stats.append({'label': f"{d['label']} (n={d['n']})", 'whislo': lo, 'q1': q1, 'med': med, 'q3': q3, 'whishi': hi, 'fliers': []})
        ax.bxp(stats, orientation='horizontal', showfliers=False, patch_artist=True, boxprops={'facecolor': '#bfdbfe'}, medianprops={'color': '#1d4ed8'})
        ax.invert_yaxis(); ax.set_xlim(left=0); ax.set_xlabel('Gross reward ($m)'); ax.grid(axis='x', alpha=.15)
        meaning = 'winner / loser' if whole else 'own / opponent, with faction outcome'
        content += f'<details><summary>Division reward distributions</summary><p>Pairings: {meaning} starting Platinum divisions. Boxes show the middle 50%, the inside line is the median, and whiskers show minimum and maximum. These are spreads, not confidence intervals; all observations are used.</p>{svg(fig, "Gross reward distributions by Platinum division pairing")}</details>'
        estimates = [c for c in cards if c['adjusted'] is not None]
        content += '<details><summary>Adjusted associations</summary><p>Dots show adjusted differences from the 25th to the 75th percentile; lines are approximate 95% intervals. Dashed zero line means no association. Input ranges differ, so this is not a ranking of achievable interventions. Intervals are not adjusted for multiple comparisons.</p>'
        if estimates:
            fig, ax = plt.subplots(figsize=(10, max(3, 1.5+.6*len(estimates))))
            names = {f['field']: f['label'] for f in data['factors']}
            labels = []
            for i, c in enumerate(estimates):
                a = c['adjusted']
                if a['interval'] is not None:
                    ax.plot([v/1e6 for v in a['interval']], [i, i], '|-', color='#334155', markersize=7)
                ax.scatter([a['difference']/1e6], [i], color='#2563eb', zorder=3)
                labels.append(f"{names.get(c['field'], c['field'].replace('_', ' '))}\n{a['range'][0]:.2f} → {a['range'][1]:.2f} {c['unit']}" + (' (no interval)' if a['interval'] is None else ''))
            ax.set_yticks(range(len(estimates)), labels); ax.invert_yaxis()
            ax.axvline(0, linestyle='--', color='#64748b'); ax.set_xlabel('Adjusted gross reward difference ($m)'); ax.grid(axis='x', alpha=.15)
            content += svg(fig, 'Adjusted gross reward associations and uncertainty intervals')
        else:
            content += '<p>No adjusted estimates are available. See the evidence cards for the data requirements.</p>'
        return content + '</details></section>'
