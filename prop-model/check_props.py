import json

with open('/tmp/fanspot_player_props.json') as f:
    data = json.load(f)

print('Available:', data.get('available'))
print('Reason:', data.get('reason'))

if 'projections' in data:
    players = data['projections']
    print(f'\nPlayers returned: {len(players)}')
    
    from collections import Counter
    positions = Counter(p['position'] for p in players)
    print(f'Positions: {dict(positions)}')
    
    print('\nNE Players:')
    for p in players:
        if p['team'] == 'NE':
            print(f"  {p['name']} ({p['position']}): {len(p['lines'])} stats")
            for line in p['lines'][:4]:
                print(f"    {line['label']}: {line['value']}")

    print('\nSEA Players:')
    for p in players:
        if p['team'] == 'SEA':
            print(f"  {p['name']} ({p['position']}): {len(p['lines'])} stats")
            for line in p['lines'][:4]:
                print(f"    {line['label']}: {line['value']}")
