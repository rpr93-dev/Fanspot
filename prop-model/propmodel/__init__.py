"""propmodel — a self-built NFL player prop projection system.

Stage map (current status in parentheses):
  1. data_pipeline  — pull + validate player stat history        (DONE)
  2. opponent       — opponent/defense adjustment                (DONE)
  3. game_script    — Vegas total/spread pace & volume adjustment (DONE)
  4. model          — weighted projection + confidence interval  (DONE)
  5. reliability    — retries, caching, logging, cron-safe       (DONE)
  6. output + cli   — dashboard-ready table + batch CLI          (DONE)
"""

__version__ = "0.1.0"
