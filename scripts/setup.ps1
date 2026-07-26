# AI Shorts Studio — Windows setup
# Installs yt-dlp + ffmpeg (via winget) and faster-whisper (via pip), then verifies.
# Run from the shorts-app directory:  npm run setup
[CmdletBinding()]
param(
  [switch]$SkipWhisper
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    WRN $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "    ERR $msg" -ForegroundColor Red }

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# --- yt-dlp ---------------------------------------------------------------
Write-Step "yt-dlp"
if (Test-Command "yt-dlp") {
  $v = (yt-dlp --version 2>$null)
  Write-Ok "already installed ($v)"
} else {
  Write-Host "    installing via winget..." -ForegroundColor DarkGray
  try {
    winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Out-Host
  } catch {
    Write-Err "winget install of yt-dlp failed: $_"
    Write-Warn "Install manually from https://github.com/yt-dlp/yt-dlp/releases and add to PATH."
  }
  # winget may not refresh PATH in the current shell
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
  if (Test-Command "yt-dlp") { Write-Ok "installed ($((yt-dlp --version 2>$null)))" }
  else { Write-Warn "yt-dlp not yet on PATH. Open a NEW terminal and re-run npm run setup, or add it manually." }
}

# --- ffmpeg ---------------------------------------------------------------
Write-Step "ffmpeg"
if (Test-Command "ffmpeg") {
  $v = (ffmpeg -version 2>&1 | Select-Object -First 1)
  Write-Ok "already installed ($v)"
} else {
  Write-Host "    installing via winget (Gyan.FFmpeg)..." -ForegroundColor DarkGray
  try {
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Out-Host
  } catch {
    Write-Err "winget install of ffmpeg failed: $_"
    Write-Warn "Install manually from https://ffmpeg.org/download.html and add to PATH."
  }
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
  if (Test-Command "ffmpeg") { Write-Ok "installed" }
  else { Write-Warn "ffmpeg not yet on PATH. Open a NEW terminal and re-run npm run setup, or add it manually." }
}

# --- Python + faster-whisper ---------------------------------------------
if (-not $SkipWhisper) {
  Write-Step "faster-whisper (Python)"
  if (-not (Test-Command "python")) {
    Write-Err "python not found on PATH. Install Python 3.10+ from https://www.python.org/ and re-run setup."
  } else {
    Write-Host "    python: $((python --version 2>&1 | Out-String).Trim())" -ForegroundColor DarkGray
    $installed = $null
    try { $installed = (python -c "import faster_whisper; import mediapipe; import cv2; print('yes')" 2>&1 | Out-String).Trim() } catch { $installed = $null }
    if ($installed -eq "yes") {
      Write-Ok "faster-whisper and tracking dependencies already installed"
    } else {
      Write-Host "    pip install faster-whisper..." -ForegroundColor DarkGray
      try { python -m pip install --upgrade faster-whisper mediapipe opencv-python 2>&1 | Out-Host } catch { Write-Err "pip install raised: $_" }
      try { $installed = (python -c "import faster_whisper; import mediapipe; import cv2; print('yes')" 2>&1 | Out-String).Trim() } catch { $installed = $null }
      if ($installed -eq "yes") { Write-Ok "faster-whisper and tracking dependencies installed" }
      else { Write-Err "python dependencies import check failed" }
    }
  }
} else {
  Write-Warn "Skipping whisper (-SkipWhisper)"
}

# --- Summary --------------------------------------------------------------
Write-Step "Summary"
$ytdlp = if (Test-Command "yt-dlp") { "present" } else { "MISSING (open a new terminal or install manually)" }
$ff    = if (Test-Command "ffmpeg") { "present" } else { "MISSING (open a new terminal or install manually)" }
$py    = if (Test-Command "python") { "present" } else { "MISSING" }
Write-Host "    yt-dlp   : $ytdlp"
Write-Host "    ffmpeg   : $ff"
Write-Host "    python   : $py"
if (-not $SkipWhisper -and (Test-Command "python")) {
  $fw = $null
  try { $fw = (python -c "import faster_whisper; print('present')" 2>&1 | Out-String).Trim() } catch { $fw = $null }
  Write-Host "    faster-whisper : $(if ($fw -eq 'present') {'present'} else {'MISSING'})"
}

Write-Host ""
if ($ytdlp -eq "present" -and $ff -eq "present") {
  Write-Ok "External tooling ready. Next: npm run dev"
} else {
  Write-Warn "One or more tools missing. Open a NEW terminal (to refresh PATH) and re-run: npm run setup"
}
