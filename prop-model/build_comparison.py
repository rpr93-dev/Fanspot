"""Build comparison between prop model and ESPN player lines."""

import json
import pandas as pd
from pathlib import Path

# Load the ESPN player lines from Fanspot API
with open('/tmp/fanspot_player_props.json') as f:
    fanspot_data = json.load(f)

# Load the prop model projections
with open('patriots_comparison.json') as f:
    model_data = json.load(f)

# Parse ESPN lines
espn_lines = {}
for proj in fanspot_data.get('projections', []):
    if proj['team'] == 'NE':
        player_lines = {}
        for line in proj.get('lines', []):
            # Normalize stat names
            stat_key = line['label'].lower().replace(' ', '_').replace('rec_', 'receiving_').replace('rush_', 'rushing_')
            player_lines[stat_key] = line['value']
        espn_lines[proj['name']] = player_lines

# Get prop model projections
model_projections = {}
for proj in model_data.get('results', []):
    if proj.get('opponent') == 'LV':  # Our previous run
        key = f"{proj['player']}_{proj['stat']}"
        model_projections[key] = {
            'model': proj['model_projection'],
            'line': (proj['line_over'] + proj['line_under']) / 2,
            'range_low': proj['range_low'],
            'range_high': proj['range_high'],
            'confidence': proj['confidence'],
        }

print("=" * 80)
print("PROP MODEL vs ESPN PLAYER LINES")
print("Patriots @ Seahawks | Sep 9, 2026")
print("=" * 80)

print(f"\nESPN Lines Loaded: {len(espn_lines)} players")
print(f"Model Projections: {len(model_projections)} stats")

# Build comparison table
print("\n" + "=" * 80)
print("COMPARISON TABLE")
print("=" * 80)

comparison = []
for player, espn in list(espn_lines.items())[:10]:  # Top 10 players
    print(f"\n{player} (ESPN Lines):")
    for stat, value in list(espn.items())[:4]:
        key = f"{player}_{stat}"
        if key in model_projections:
            model_val = model_projections[key]['model']
            diff = model_val - value
            pct_diff = ((model_val - value) / value * 100) if value != 0 else 0
            
            print(f"  {stat:20s}: Model={model_val:6.1f} | ESPN={value:6.1f} | Diff={diff:+6.1f} ({pct_diff:+.1f}%)")
        else:
            print(f"  {stat:20s}: ESPN={value:6.1f} | No model data")

# Save full comparison
output = {
    'game': {
        'date': '2026-09-09',
        'time': '8:20 PM ET',
        'location': 'Lumen Field, Seattle',
        'spread': 'SEA -3.5',
        'total': 44.5,
    },
    'espn_lines': espn_lines,
    'model_projections': model_projections,
    'comparison': comparison,
}

with open('player_lines_comparison.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f"\nSaved to player_lines_comparison.json")
