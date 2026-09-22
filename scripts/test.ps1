$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\backend"
if (-not (Test-Path .\.venv\Scripts\Activate.ps1)) { Write-Error "backend venv missing"; exit 1 }
.\.venv\Scripts\Activate.ps1; if (-not $?) { exit 1 }
python -m pytest -q; if (-not $?) { exit 1 }
python -m pytest ../scripts -q; if (-not $?) { exit 1 }
ruff check .; if (-not $?) { exit 1 }
mypy app/; if (-not $?) { exit 1 }
if (Test-Path "$root\frontend\package.json") {
  Set-Location "$root\frontend"; npm test -- --run; if (-not $?) { exit 1 }
}
