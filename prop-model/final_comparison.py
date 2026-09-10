"""Create final comparison with real lines from ESPN."""

import json
from pathlib import Path

# Load model projections
with open('patriots_comparison.json') as f:
    model_data = json.load(f)

# Real game info
game_info = {
    'date': '2026-09-09',
    'time': '8:20 PM ET',
    'network': 'NBC',
    'location': 'Lumen Field, Seattle, WA',
    'weather': '74°F',
    'patriots_record': '0-0',
    'seahawks_record': '0-0',
    'spread': 'SEA -3.5',
    'total': 44.5,
    'patriots_implied_total': round((44.5 - 3.5) / 2, 1),  # ~20.5
    'seahawks_implied_total': round((44.5 + 3.5) / 2, 1),  # ~24.0
}

# Injuries from ESPN scrape
injuries = [
    {'name': 'Ben Brown', 'pos': 'C', 'status': 'Out', 'reason': 'Knee', 'return': 'Sep 20'},
    {'name': 'TreVeyon Henderson', 'pos': 'RB', 'status': 'Questionable', 'reason': 'Ankle', 'return': 'Sep 9'},
    {'name': 'Bryce Baringer', 'pos': 'P', 'status': 'IR', 'reason': 'Undisclosed', 'return': 'Oct 11'},
    {'name': 'Khalil Jacobs', 'pos': 'LB', 'status': None, 'reason': None, 'return': None},
]

# Build output
output = {
    'game_info': game_info,
    'injuries': injuries,
    'model_projections': model_data['results'],
    'summary': {
        'total_projections': len(model_data['results']),
        'players_modeled': len(set(r['player'] for r in model_data['results'])),
        'high_confidence': len([r for r in model_data['results'] if r['confidence'] == 'high']),
        'medium_confidence': len([r for r in model_data['results'] if r['confidence'] == 'medium']),
        'data_source': 'NFLverse 2025 Season (594 player-weeks)',
        'model_vintage': 'September 7, 2026',
    }
}

# Save
with open('patriots_final_comparison.json', 'w') as f:
    json.dump(output, f, indent=2)

print(json.dumps(output['game_info'], indent=2))
print(f"\nInjuries ({len(injuries)}):")
for inj in injuries:
    if inj['status']:
        print(f"  {inj['name']} ({inj['pos']}): {inj['status']} - {inj['reason']}")
    else:
        print(f"  {inj['name']} ({inj['pos']})")

print(f"\nModel projections: {output['summary']['total_projections']}")
print(f"Players modeled: {output['summary']['players_modeled']}")
print(f"Saved to patriots_final_comparison.json")
