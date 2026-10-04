@echo off
rem Daily YouTube run (scheduled task "Piano YouTube daily"):
rem   1. monthly stats refresh when due, resumable matching (in WSL)
rem   2. once the site exists: rebuild docs/works.json, commit and push it to GitHub Pages
rem Output is appended to cache\youtube_daily.log
cd /d "%~dp0.."
echo ==== %DATE% %TIME% ==== >> cache\youtube_daily.log
wsl -e bash -lc "cd '/mnt/c/Git Projects/piano' && python3 scripts/refresh_stats.py --if-older 28 && python3 scripts/youtube_match.py" >> cache\youtube_daily.log 2>&1
if errorlevel 1 (
  echo Data step failed; nothing published. >> cache\youtube_daily.log
  exit /b 1
)
if not exist scripts\build_data.py exit /b 0
wsl -e bash -lc "cd '/mnt/c/Git Projects/piano' && python3 scripts/build_data.py" >> cache\youtube_daily.log 2>&1
if errorlevel 1 (
  echo Build failed; nothing published. >> cache\youtube_daily.log
  exit /b 1
)
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo No GitHub remote yet; built locally only. >> cache\youtube_daily.log
  exit /b 0
)
git add docs/works.json >> cache\youtube_daily.log 2>&1
git diff --cached --quiet
if errorlevel 1 git commit -q -m "Daily recordings update" >> cache\youtube_daily.log 2>&1
rem push also retries any commit left unpushed by an earlier failed run
git push -q origin main >> cache\youtube_daily.log 2>&1
if errorlevel 1 (echo Push failed: check the GitHub sign-in for Smaju78. >> cache\youtube_daily.log) else (echo Published. >> cache\youtube_daily.log)
