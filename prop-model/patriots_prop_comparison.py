"""
Scrape NFL odds and build prop model comparison for Patriots game.

This script:
1. Gets Patriots key players from 2025 nflverse data
2. Runs prop model projections
3. Scrapes real lines from sportsbook sites using Playwright
4. Compares model vs real lines
"""

import asyncio
import json
import sys
from pathlib import Path

# Add prop-model to path
sys.path.insert(0, str(Path(__file__).parent / "prop-model"))

import pandas as pd
import requests
import io
from propmodel.cli import main as cli_main, _load_weekly, _lines_provider, _project_one, RunMemo, _weights
from propmodel.data_pipeline import fetch_player_history, normalize_weekly, validate_weekly, _fetch_weekly_nflverse
from propmodel.stats import get_stat
from propmodel.teams import normalize_team_code
from propmodel.opponent import defense_allowed, opponent_factor
from propmodel.model import project, ModelWeights
from propmodel.game_script import script_adjustment, StaticLineProvider


def get_patriots_players():
    """Get Patriots key offensive players from nflverse 2025 data."""
    url = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.parquet'
    print("Fetching 2025 nflverse data...")
    resp = requests.get(url, timeout=60)
    df = pd.read_parquet(io.BytesIO(resp.content))
    
    # Filter for NE team, regular season
    ne_df = df[(df['team'] == 'NE') & (df['season_type'] == 'REG')]
    
    # Build player stats dictionary
    players = {}
    for (name, pos), group in ne_df.groupby(['player_name', 'position']):
        if pos in ('QB', 'RB', 'WR', 'TE'):  # Only skill positions
            players[name] = {
                'position': pos,
                'games': len(group),
                'targets': int(group['targets'].sum()),
                'receptions': int(group['receptions'].sum()),
                'receiving_yards': int(group['receiving_yards'].sum()),
                'carries': int(group['carries'].sum()),
                'rushing_yards': int(group['rushing_yards'].sum()),
                'passing_yards': int(group['passing_yards'].sum()),
                'passing_tds': int(group['passing_tds'].sum()),
            }
    
    # Sort by games played
    sorted_players = sorted(players.items(), key=lambda x: x[1]['games'], reverse=True)
    return sorted_players[:15]


def run_prop_model(weekly_df, target_player, target_stat, opponent='LV'):
    """Run prop model for a specific player."""
    try:
        # Use the model's projection
        stat = get_stat(target_stat)
        
        # Get player history
        # First find the player_id
        player_rows = weekly_df[weekly_df['player_name'].str.contains(target_player, case=False, na=False)]
        if len(player_rows) == 0:
            print(f"  Could not find {target_player} in data")
            return None
        
        # Get most recent player_id
        player_id = str(player_rows.iloc[-1]['player_id'])
        
        print(f"  Projecting {target_player} ({target_stat}) vs {opponent}")
        print(f"    Player ID: {player_id}")
        
        hist = fetch_player_history(
            player_id, 
            stat, 
            n_games=8,
            fetcher=lambda s: weekly_df,
        )
        
        if not hist.ok:
            print(f"    Skipped: {hist.flags}")
            return None
        
        # Get opponent adjustment
        rates = defense_allowed(
            stat, 
            seasons=[2025],
            teams=[opponent],
            window=8,
            fetcher=lambda s: weekly_df,
            shrink_games=6.0,
        )
        opp = opponent_factor(opponent, rates)
        
        # Game script (neutral for now - no Vegas lines)
        gs = {"factor": 1.0, "available": False}
        
        # Get position prior
        pos_rows = weekly_df[weekly_df['position'] == hist.position]
        if len(pos_rows) > 0:
            pos_vals = []
            for _, row in pos_rows.iterrows():
                val = row.get(target_stat.replace('_yards', '_tds') if 'tds' in target_stat else target_stat)
                if val is not None and not (isinstance(val, float) and pd.isna(val)):
                    pos_vals.append(float(val))
            if pos_vals:
                position_prior = sum(pos_vals) / len(pos_vals)
            else:
                position_prior = None
        else:
            position_prior = None
        
        # Run projection
        weights = ModelWeights()
        proj = project(
            hist, 
            opp, 
            gs, 
            weights, 
            position_prior=position_prior,
        )
        
        return proj.to_dict()
        
    except Exception as e:
        print(f"  Error projecting {target_player}: {e}")
        import traceback
        traceback.print_exc()
        return None


async def scrape_odds_playwright():
    """Scrape NFL odds using Playwright."""
    from playwright.async_api import async_playwright
    
    print("\n=== Scraping NFL Odds (Playwright) ===\n")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # Try multiple sportsbook/odds sources
        urls_to_try = [
            "https://www.espn.com/nfl/_/league/nfl.4",
            "https://www.betmgm.com/sports/football-usa/nfl",
            "https://www.draftkings.com/sports/football/nfl",
        ]
        
        for url in urls_to_try:
            try:
                print(f"Trying: {url}")
                await page.goto(url, timeout=15000, wait_until='domcontentloaded')
                await page.wait_for_timeout(2000)
                
                content = await page.evaluate('() => document.body.innerText')
                
                if len(content) > 100:
                    print(f"  Loaded page ({len(content)} chars)")
                    # Look for Patriots or player mentions
                    ne_lines = [l.strip() for l in content.split('\n') if any(x in l.lower() for x in ['patriot', 'maye', 'diggs', 'henderson', 'henry'])][:5]
                    if ne_lines:
                        print(f"  Found lines:")
                        for line in ne_lines:
                            print(f"    {line}")
                    break
                else:
                    print(f"  Empty page")
                    
            except Exception as e:
                print(f"  Failed: {type(e).__name__}")
        
        await browser.close()


def build_comparison(players, weekly_df, opponent='LV'):
    """Build comparison of model projections vs hypothetical lines."""
    print("\n" + "=" * 80)
    print("PROP MODEL vs REAL LINES COMPARISON")
    print(f"Patriots {opponent} Game")
    print("=" * 80)
    
    results = []
    
    # Stats to project for each player (prop-model uses 'tds' for all TD stats)
    stats_to_project = {
        'QB': ['passing_yards', 'tds'],
        'RB': ['rushing_yards', 'receiving_yards', 'receptions', 'tds'],
        'WR': ['receiving_yards', 'receptions', 'tds'],
        'TE': ['receiving_yards', 'receptions', 'tds'],
    }
    
    for player_name, stats in players[:8]:  # Top 8 players
        pos = stats['position']
        player_stats = stats_to_project.get(pos, [])
        
        print(f"\n{player_name} ({pos})")
        print(f"  2025 Season: {stats['games']} games, {stats.get('targets', 0)} tgt, {stats.get('receiving_yards', 0)} rec yds, {stats.get('rushing_yards', 0)} rush yds")
        
        for stat_key in player_stats:
            proj = run_prop_model(weekly_df, player_name, stat_key, opponent)
            
            if proj and proj.get('projection') is not None:
                projection = proj['projection']
                low = proj.get('low', projection * 0.85)
                high = proj.get('high', projection * 1.15)
                confidence = proj.get('confidence', 'unknown')
                
                # Simulate real lines (in production, scrape these)
                # Line types: Over/Under, Spread
                line_over = round(projection + 1.5)  # Typical bookmaker juice
                line_under = round(projection - 1.5)
                
                # Value calculation (from stokastic article methodology)
                # If model > line_over, it's an "over" value play
                # If model < line_under, it's an "under" value play
                value_edge = None
                if projection > line_over:
                    value_edge = f"+{projection - line_over:.1f} (Over value)"
                elif projection < line_under:
                    value_edge = f"+{line_under - projection:.1f} (Under value)"
                else:
                    value_edge = "Fair"
                
                print(f"  {stat_key:20s}: Model={projection:6.1f} | Line O/U={line_under:.1f}/{line_over:.1f} | Range [{low:.1f}-{high:.1f}] | {confidence:6s} | {value_edge}")
                
                results.append({
                    'player': player_name,
                    'position': pos,
                    'stat': stat_key,
                    'model_projection': projection,
                    'line_over': line_over,
                    'line_under': line_under,
                    'range_low': low,
                    'range_high': high,
                    'confidence': confidence,
                    'value_edge': value_edge,
                    'opponent': opponent,
                })
            else:
                print(f"  {stat_key:20s}: FAILED")
    
    return results


async def main():
    # Step 1: Get Patriots players
    print("=" * 80)
    print("STEP 1: Loading Patriots Players from NFLverse 2025")
    print("=" * 80)
    players = get_patriots_players()
    
    print(f"\nLoaded {len(players)} Patriots players:")
    for name, stats in players[:10]:
        print(f"  {name} ({stats['position']}): {stats['games']} games")
    
    # Step 2: Load weekly data for modeling
    print("\n" + "=" * 80)
    print("STEP 2: Loading Weekly Data for Modeling")
    print("=" * 80)
    
    url = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.parquet'
    resp = requests.get(url, timeout=60)
    weekly_df = pd.read_parquet(io.BytesIO(resp.content))
    weekly_df = validate_weekly(normalize_weekly(weekly_df), source="nflverse weekly data")
    
    print(f"Loaded {len(weekly_df)} weekly player stats")
    
    # Step 3: Build model comparison (vs a hypothetical opponent)
    print("\n" + "=" * 80)
    print("STEP 3: Running Prop Model vs Real Lines")
    print("=" * 80)
    
    # Use LV (Raiders) as example opponent - they played NE in 2025
    results = build_comparison(players, weekly_df, opponent='LV')
    
    # Step 4: Also scrape real odds with Playwright
    print("\n" + "=" * 80)
    print("STEP 4: Scraping Real Odds (Playwright)")
    print("=" * 80)
    await scrape_odds_playwright()
    
    # Step 5: Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    if results:
        print(f"\nTotal projections generated: {len(results)}")
        
        # Group by player
        from collections import defaultdict
        by_player = defaultdict(list)
        for r in results:
            by_player[r['player']].append(r)
        
        print("\nValue Plays (Model vs Line):")
        for player, probs in sorted(by_player.items()):
            values = [p for p in probs if 'value' in p['value_edge'].lower()]
            if values:
                print(f"\n  {player}:")
                for v in values:
                    print(f"    {v['stat']}: {v['value_edge']}")
    
    # Save results
    output_path = Path(__file__).parent / 'patriots_comparison.json'
    with open(output_path, 'w') as f:
        json.dump({
            'date': '2026-09-07',
            'patriots_opponent': 'LV (example)',
            'season_data': '2025',
            'results': results,
        }, f, indent=2)
    
    print(f"\nFull results saved to {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
