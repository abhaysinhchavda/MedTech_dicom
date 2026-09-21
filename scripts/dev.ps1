# Starts the backend (and, once Part 2 is done, the frontend). Run from repo root.
$root = Split-Path -Parent $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit","-Command","Set-Location '$root\backend'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:create_app --factory --reload --port 8001"
if (Test-Path "$root\frontend\package.json") {
  Start-Process powershell -ArgumentList "-NoExit","-Command","Set-Location '$root\frontend'; npm run dev"
}
